from __future__ import annotations

from uuid import UUID

import bcrypt
import jwt
from fastapi import Header, HTTPException, status
from pydantic import BaseModel

from app.config import get_settings
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

    Per docs/03-low-level-design.md Section 7, API keys are stored hashed
    with bcrypt, never in plaintext. bcrypt hashes are salted, so they can't
    be looked up by equality in SQL — the supplied key is checked against
    each org's stored hash instead. This is the same "simple loop, no
    engine needed at this scale" tradeoff the LLD makes explicitly for
    guardrail rule matching (Section 4.2); fine for a pilot-scale org
    count, not meant to scale indefinitely.
    """
    if not x_api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing API key")

    supabase = get_supabase()
    result = supabase.table("orgs").select("id, api_key_hash").execute()
    key_bytes = x_api_key.encode("utf-8")

    for row in result.data or []:
        try:
            if bcrypt.checkpw(key_bytes, row["api_key_hash"].encode("utf-8")):
                return OrgAuth(org_id=row["id"])
        except ValueError:
            continue  # malformed/foreign hash format, skip

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")


def verify_jwt(authorization: str | None = Header(default=None)) -> UserAuth:
    """Human auth for dashboard -> backend requests.

    Verifies the Supabase-issued JWT locally against SUPABASE_JWT_SECRET
    (HS256, shared-secret verification) per docs/03-low-level-design.md
    Section 2.2 — no round-trip call to Supabase needed.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    token = authorization.removeprefix("Bearer ").strip()
    settings = get_settings()

    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
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
        # Per docs/03-low-level-design.md Section 2.2 step 6, a first-time
        # login should trigger an org-join/creation flow. That flow's
        # mechanics (invite tokens, org naming, etc.) aren't specified
        # anywhere in the docs, so it isn't built yet — this fails clearly
        # instead of crashing or silently granting access to no org.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No organization membership found for this user",
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
