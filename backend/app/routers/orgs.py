from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, status

from app.api_keys import hash_api_key
from app.auth import JwtIdentity, is_platform_admin, resolve_or_join_org, verify_jwt_identity
from app.db import get_supabase, maybe_single_result
from app.schemas import MeOut, OrgCreateIn, OrgCreateOut

router = APIRouter()


@router.get("/me", response_model=MeOut)
def get_me(identity: JwtIdentity = Depends(verify_jwt_identity)) -> MeOut:
    """The dashboard's first call after sign-in, to decide whether to show
    the normal app shell or the "create your organization" screen -- see
    app/schemas.py's comment above MeOut for why this can't just be
    verify_jwt/UserAuth.
    """
    supabase = get_supabase()
    member_data = resolve_or_join_org(supabase, str(identity.auth_user_id), identity.email)
    platform_admin = is_platform_admin(supabase, str(identity.auth_user_id))

    if not member_data:
        return MeOut(email=identity.email, has_org=False, is_platform_admin=platform_admin)

    return MeOut(
        email=identity.email,
        has_org=True,
        org_id=member_data["org_id"],
        role=member_data["role"],
        is_platform_admin=platform_admin,
    )


@router.post("/orgs", response_model=OrgCreateOut, status_code=status.HTTP_201_CREATED)
def create_org(body: OrgCreateIn, identity: JwtIdentity = Depends(verify_jwt_identity)) -> OrgCreateOut:
    """Creates a new org and makes the calling user its admin -- the
    new-org-signup half of docs/03-low-level-design.md Section 2.2 step 6
    that was never built until now (see app/schemas.py's comment above
    MeOut). Reachable only for a user GET /me already reported has no org
    -- by the time that's true, resolve_or_join_org has already consumed
    any pending invite for their email, so there's nothing here to
    conflict with (an invite is always the "join an existing org" path,
    never a reason to block "create your own").
    """
    org_name = body.org_name.strip()
    if not org_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Organization name is required")

    supabase = get_supabase()

    existing = maybe_single_result(
        supabase.table("org_members").select("id").eq("auth_user_id", str(identity.auth_user_id)).maybe_single()
    )
    if existing.data:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You already belong to an organization")

    api_key = f"grk_{secrets.token_urlsafe(32)}"
    key_hash = hash_api_key(api_key)

    org_result = supabase.table("orgs").insert({"name": org_name, "api_key_hash": key_hash}).execute()
    org_id = org_result.data[0]["id"]

    supabase.table("org_members").insert(
        {
            "org_id": org_id,
            "auth_user_id": str(identity.auth_user_id),
            "email": identity.email,
            "role": "admin",
        }
    ).execute()

    return OrgCreateOut(org_id=org_id, org_name=org_name, api_key=api_key)
