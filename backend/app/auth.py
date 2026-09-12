from __future__ import annotations

from functools import lru_cache
from uuid import UUID

import jwt
from fastapi import Header, HTTPException, status
from jwt import PyJWKClient
from postgrest.exceptions import APIError
from pydantic import BaseModel

from app.api_keys import hash_api_key
from app.config import Settings, get_settings
from app.db import get_supabase, maybe_single_result


class OrgAuth(BaseModel):
    """Resolved from a machine (SDK) API key — docs/02-high-level-design.md Section 2.2."""

    org_id: UUID


class UserAuth(BaseModel):
    """Resolved from a dashboard user's Supabase JWT — docs/03-low-level-design.md Section 2.2."""

    auth_user_id: UUID
    org_id: UUID
    email: str
    role: str


class JwtIdentity(BaseModel):
    """A verified Supabase JWT's identity, with no org membership resolved
    (or required) yet. Used by the two endpoints that must be reachable
    *before* a user has an org at all -- GET /me and POST /orgs (see
    app/routers/orgs.py) -- since verify_jwt/UserAuth 403s a user with no
    org, which would make those endpoints unreachable for exactly the
    users who need them.
    """

    auth_user_id: UUID
    email: str


def verify_api_key(x_api_key: str | None = Header(default=None)) -> OrgAuth:
    """Machine auth for SDK -> backend requests (POST /events, /guardrail-check).

    Docs don't specify a header name for the API key; this uses `X-API-Key`
    to keep it visually distinct from the `Authorization: Bearer` scheme
    used for human Supabase JWTs on the dashboard-facing endpoints.

    Per docs/03-low-level-design.md Section 7, API keys are stored hashed,
    never in plaintext -- hashed with HMAC-SHA256 rather than the section's
    suggested bcrypt/argon2, see app/api_keys.py for why. That hash is
    deterministic, so the presented key can be looked up by a single
    equality query instead of the hash-and-loop-over-every-org approach
    bcrypt's salted output would force.
    """
    if not x_api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing API key")

    supabase = get_supabase()
    key_hash = hash_api_key(x_api_key)
    result = maybe_single_result(supabase.table("orgs").select("id").eq("api_key_hash", key_hash).maybe_single())

    if not result.data:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")

    return OrgAuth(org_id=result.data["id"])


@lru_cache
def _get_jwks_client(supabase_url: str) -> PyJWKClient:
    # Cached per URL (there's only ever one per process) -- PyJWKClient
    # itself caches the fetched key set in memory for its `lifespan`
    # (default 300s), so this doesn't mean a network round-trip per
    # request either.
    jwks_url = f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    return PyJWKClient(jwks_url)


def _decode_supabase_jwt(token: str, settings: Settings) -> dict:
    """Supabase now signs new/rotated projects' JWTs with an asymmetric
    key (its "JWT Signing Keys" feature -- ES256 by default), verified
    against the project's public JWKS endpoint, not the single shared
    HS256 secret docs/03-low-level-design.md Section 2.2 originally
    specified. Confirmed against this project's real deployment: its
    active signing key is ECC (P-256)/ES256, and the old HS256 "Legacy
    JWT Secret" was rotated out and no longer signs anything -- the
    original HS256-only implementation could never verify a real session
    token again.

    Tries JWKS/asymmetric first (the current model); SUPABASE_JWT_SECRET
    stays as a fallback for a project that hasn't migrated to JWT
    Signing Keys, where no JWKS key matches the token's `kid` at all --
    JWKS-only publishes public/asymmetric keys, never the shared secret,
    so this fallback can never partially overlap with the JWKS path.
    """
    try:
        jwks_client = _get_jwks_client(settings.supabase_url)
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        return jwt.decode(token, signing_key.key, algorithms=["ES256", "RS256"], audience="authenticated")
    except jwt.PyJWKClientError:
        pass  # no `kid` header, or no matching key in the JWKS -- likely a legacy HS256 token

    if not settings.supabase_jwt_secret:
        # No JWKS match and no legacy secret configured -- there's no way
        # left to verify this token. Raise the same family of exception
        # verify_jwt already catches (jwt.PyJWTError) so this fails as a
        # normal 401, not an unhandled 500.
        raise jwt.InvalidTokenError("No matching JWKS key and no legacy SUPABASE_JWT_SECRET configured")

    return jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated")


def verify_jwt_identity(authorization: str | None = Header(default=None)) -> JwtIdentity:
    """Verifies the Supabase-issued JWT and returns its identity, with no
    org-membership lookup at all -- see JwtIdentity's docstring for why
    this exists separately from verify_jwt/UserAuth.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    token = authorization.removeprefix("Bearer ").strip()
    settings = get_settings()

    try:
        payload = _decode_supabase_jwt(token, settings)
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    auth_user_id = payload.get("sub")
    if not auth_user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing subject claim")

    return JwtIdentity(auth_user_id=auth_user_id, email=(payload.get("email") or "").lower())


def resolve_or_join_org(supabase, auth_user_id: str, email: str) -> dict | None:
    """Looks up this auth_user_id's org_members row, joining it to a
    pending invite's org first if one matches their email (per
    docs/03-low-level-design.md Section 2.2 step 6: "joining an org via
    invite"). Returns None if there's neither -- meaning this user has no
    org and no invite is waiting for them, so the caller decides what
    that means: verify_jwt (below) 403s, GET /me (app/routers/orgs.py)
    tells the dashboard to show the "create your organization" screen.

    Consuming any pending invite here, in the one function both verify_jwt
    and GET /me go through, matters for a specific reason: GET /me is
    what the dashboard calls to decide whether to show that screen at
    all, so an invite must already be resolved by the time GET /me
    answers -- otherwise a user could submit "create my own org" (POST
    /orgs) while a pending invite for their email still exists, orphaning
    it (their real invite forever unconsumed, and them now in a
    self-created org instead of the one that invited them).

    The select-then-insert below isn't atomic, and a brand-new user's
    very first authenticated page load fires more than one request that
    each land here concurrently (the dashboard layout's GET /me and the
    Home page's GET /dashboard-summary, at minimum) -- caught live in
    production as a 500: both requests' `member` select ran before
    either's insert committed, so both tried to insert the same
    auth_user_id and the loser hit
    `postgrest.exceptions.APIError` / Postgres `23505`
    (`org_members_auth_user_id_key` unique violation) instead of an
    unhandled crash. Caught here now: on that specific conflict, the
    winning concurrent request already created (and is about to return,
    or already returned) the membership, so this just re-fetches and
    returns it instead of erroring.
    """
    member = maybe_single_result(
        supabase.table("org_members").select("org_id, role, email").eq("auth_user_id", auth_user_id).maybe_single()
    )
    if member.data:
        return member.data

    invite = (
        maybe_single_result(supabase.table("org_invites").select("id, org_id, role").eq("email", email).maybe_single())
        if email
        else None
    )
    if not invite or not invite.data:
        return None

    try:
        created = (
            supabase.table("org_members")
            .insert(
                {
                    "org_id": invite.data["org_id"],
                    "auth_user_id": auth_user_id,
                    "email": email,
                    "role": invite.data["role"],
                }
            )
            .execute()
        )
    except APIError as exc:
        if exc.code == "23505":  # unique_violation -- a concurrent request already won this race
            existing = maybe_single_result(
                supabase.table("org_members")
                .select("org_id, role, email")
                .eq("auth_user_id", auth_user_id)
                .maybe_single()
            )
            if existing.data:
                return existing.data
        raise

    supabase.table("org_invites").delete().eq("id", invite.data["id"]).execute()
    return created.data[0]


def verify_jwt(authorization: str | None = Header(default=None)) -> UserAuth:
    """Human auth for dashboard -> backend requests.

    Verifies the Supabase-issued JWT locally -- see _decode_supabase_jwt
    for why this isn't just HS256-against-a-shared-secret anymore, per
    docs/03-low-level-design.md Section 2.2's original description. No
    round-trip call to Supabase's Auth API needed either way, only to its
    (public, cacheable) JWKS endpoint when the JWKS path is used.
    """
    identity = verify_jwt_identity(authorization=authorization)
    supabase = get_supabase()
    member_data = resolve_or_join_org(supabase, str(identity.auth_user_id), identity.email)

    if not member_data:
        # The new-org-signup half of step 6 above is now built -- POST
        # /orgs (app/routers/orgs.py) -- but it's a distinct, dedicated
        # endpoint a user reaches through the dashboard's "create your
        # organization" screen, not something verify_jwt does implicitly
        # on any old request (unlike the invite case, there's no name to
        # create the org with here).
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No organization membership found for this user",
        )

    return UserAuth(
        auth_user_id=identity.auth_user_id,
        org_id=member_data["org_id"],
        email=member_data.get("email") or identity.email,
        role=member_data["role"],
    )


class PlatformAdminAuth(BaseModel):
    """Resolved from a Supabase JWT belonging to a row in `platform_admins`
    -- a platform-level operator, separate from any org's own admin/member
    role (UserAuth.role), who can see every org. See CLAUDE.md's "Planned,
    not yet built" entry this closes and app/routers/admin.py.
    """

    auth_user_id: UUID
    email: str


def is_platform_admin(supabase, auth_user_id: str) -> bool:
    """Shared by verify_platform_admin (below) and GET /me
    (app/routers/orgs.py, which needs to report `is_platform_admin` to the
    dashboard regardless of org membership -- a platform admin has no
    special org_members row, so MeOut can't derive this from
    resolve_or_join_org).
    """
    row = maybe_single_result(
        supabase.table("platform_admins").select("auth_user_id").eq("auth_user_id", auth_user_id).maybe_single()
    )
    return bool(row.data)


def verify_platform_admin(authorization: str | None = Header(default=None)) -> PlatformAdminAuth:
    """Auth for the cross-org /admin/* endpoints -- same shape as
    verify_jwt: decode the JWT, then check membership in a table, 403 if
    absent. Checks `platform_admins` instead of `org_members`, and grants
    no org_id at all -- these endpoints deliberately query across all
    orgs with no org_id filter, guarded here at the FastAPI dependency
    layer rather than by Postgres RLS, consistent with how org-scoped
    endpoints are already guarded (docs/05-architecture-document.md
    Section 7: no RLS yet, app-layer auth instead).

    There's no self-serve way to become a platform admin -- rows in
    `platform_admins` are added manually via SQL (see DEPLOYMENT.md),
    deliberately, given how sensitive cross-org visibility is.
    """
    identity = verify_jwt_identity(authorization=authorization)
    supabase = get_supabase()

    if not is_platform_admin(supabase, str(identity.auth_user_id)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a platform admin")

    return PlatformAdminAuth(auth_user_id=identity.auth_user_id, email=identity.email)


class RulesAuth(BaseModel):
    """Resolved org_id from either credential — see verify_api_key_or_jwt."""

    org_id: UUID
    is_machine: bool


def verify_api_key_or_jwt(
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> RulesAuth:
    """Dual-mode auth for GET /rules, which two different docs assign to
    two different audiences at the *same* path: the SDK fetches its local
    rule cache via API key (docs/03-low-level-design.md Section 3.2), and
    the dashboard Rules page reads via Supabase JWT (Section 6: "GET/POST
    /rules"). FastAPI matches the first route registered for a given
    path+method and would silently never reach a second one — rather than
    let one of these two documented consumers shadow the other, this
    dispatches by whichever credential is present. Flagged as a
    non-obvious design choice; splitting onto distinct paths later is a
    reasonable alternative if this gets more complex.
    """
    if x_api_key:
        org_auth = verify_api_key(x_api_key=x_api_key)
        return RulesAuth(org_id=org_auth.org_id, is_machine=True)
    if authorization:
        user_auth = verify_jwt(authorization=authorization)
        return RulesAuth(org_id=user_auth.org_id, is_machine=False)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing credentials (X-API-Key or Authorization bearer token)",
    )
