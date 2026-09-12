from __future__ import annotations

from fastapi import HTTPException, status


def ensure_not_last_admin(supabase, org_id: str, member_id: str) -> None:
    """Raises 409 if `member_id` is the *only* Admin in `org_id` -- shared
    by every operation that could otherwise leave an org with zero
    Admins: app/routers/settings.py's update_team_member_role (demoting)
    and remove_team_member (removing), and app/routers/admin.py's
    remove_org_member (a Super Admin removing someone from any org).

    Safe to call unconditionally, even for a plain Member: `member_id`
    only ever matches the query's result if they're currently an Admin,
    so this is a no-op (one extra select) for anyone else.
    """
    admins_result = supabase.table("org_members").select("id").eq("org_id", org_id).eq("role", "admin").execute()
    admin_ids = {row["id"] for row in admins_result.data or []}
    if admin_ids == {member_id}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Every organization needs at least one Admin -- promote someone else first.",
        )
