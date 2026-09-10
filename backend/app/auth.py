from __future__ import annotations

from functools import lru_cache
from uuid import UUID

import jwt
from fastapi import Header, HTTPException, status
from jwt import PyJWKClient
from pydantic import BaseModel

from app.api_keys import hash_api_key
from app.config import Settings, get_settings
from app.db import get_supabase


class OrgAuth(BaseModel):
    """Resolved from a machine (SDK) API key — docs/02-high-level-design.md Section 2.2."""

    org_id: UUID


class UserAuth(BaseModel):
    """Resolved from a dashboard user's Supabase JWT — docs/03-low-level-design.md Section 2.2."""

    auth_user_id: UUID
    org_id: UUID
    email: str
    role: str


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
    result = supabase.table("orgs").select("id").eq("api_key_hash", key_hash).maybe_single().execute()

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


def verify_jwt(authorization: str | None = Header(default=None)) -> UserAuth:
    """Human auth for dashboard -> backend requests.

    Verifies the Supabase-issued JWT locally -- see _decode_supabase_jwt
    for why this isn't just HS256-against-a-shared-secret anymore, per
    docs/03-low-level-design.md Section 2.2's original description. No
    round-trip call to Supabase's Auth API needed either way, only to its
    (public, cacheable) JWKS endpoint when the JWKS path is used.
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

    supabase = get_supabase()
    member = (
        supabase.table("org_members")
        .select("org_id, role, email")
        .eq("auth_user_id", auth_user_id)
        .maybe_single()
        .execute()
    )

    if not member.data:
        # Per docs/03-low-level-design.md Section 2.2 step 6: "joining an
        # org via invite, or creating a new org if this is a first-time
        # signup." The invite half is now built (Settings > Team --
        # app/routers/settings.py writes a pending org_invites row, keyed
        # by email); consume it here on the invited person's first login.
        # The new-org-signup half still isn't specified anywhere (no UI
        # for naming/creating an org exists), so that case still fails
        # clearly with 403 rather than guessing at unspecified behavior.
        email = (payload.get("email") or "").lower()
        invite = (
            supabase.table("org_invites").select("id, org_id, role").eq("email", email).maybe_single().execute()
            if email
            else None
        )
        if not invite or not invite.data:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No organization membership found for this user",
            )

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
        supabase.table("org_invites").delete().eq("id", invite.data["id"]).execute()
        member_data = created.data[0]

        return UserAuth(
            auth_user_id=auth_user_id,
            org_id=member_data["org_id"],
            email=member_data["email"],
            role=member_data["role"],
        )

    return UserAuth(
        auth_user_id=auth_user_id,
        org_id=member.data["org_id"],
        email=member.data.get("email") or payload.get("email") or "",
        role=member.data["role"],
    )


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
