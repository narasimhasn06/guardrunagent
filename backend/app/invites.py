from __future__ import annotations

from fastapi import HTTPException, status

from app.db import maybe_single_result


def create_pending_invite(supabase, org_id: str, email: str, role: str) -> dict:
    """Shared by app/routers/settings.py's invite_team_member (an org
    admin inviting into their own org) and app/routers/admin.py's
    invite_org_member (a Super Admin inviting into any org) -- same
    org_invites row, same conflict rules, the only difference is which
    org_id the caller is allowed to pass in and how that's authorized
    (verify_jwt + _require_admin vs. verify_platform_admin).
    """
    email = email.strip().lower()

    existing_member = maybe_single_result(supabase.table("org_members").select("id").eq("email", email).maybe_single())
    if existing_member.data:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This email already belongs to a team")

    existing_invite = maybe_single_result(supabase.table("org_invites").select("id").eq("email", email).maybe_single())
    if existing_invite.data:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This email has already been invited")

    result = supabase.table("org_invites").insert({"org_id": org_id, "email": email, "role": role}).execute()
    return result.data[0]
