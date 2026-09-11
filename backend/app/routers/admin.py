from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import PlatformAdminAuth, verify_platform_admin
from app.db import get_supabase, maybe_single_result
from app.schemas import AdminOrgMembersOut, AdminOrgOut, AdminOrgsOut, PendingInviteOut, TeamMemberOut

router = APIRouter(prefix="/admin")


@router.get("/orgs", response_model=AdminOrgsOut)
def list_all_orgs(_admin: PlatformAdminAuth = Depends(verify_platform_admin)) -> AdminOrgsOut:
    """Every org on the platform, with its member count -- the
    "Organizations" screen's list view. Deliberately unscoped by org_id
    (verify_platform_admin is the only guard, per its own docstring).

    org_members has no per-org aggregate query available through the thin
    query builder this backend uses elsewhere (see app/db.py) -- rather
    than add a new Postgres function for what's a low-traffic admin-only
    page, this fetches every org_members row's org_id once and counts them
    in Python, the same "fetch raw rows, aggregate server-side in the
    handler" pattern app/routers/dashboard_summary.py already uses.
    """
    supabase = get_supabase()

    orgs_result = supabase.table("orgs").select("id, name, created_at").order("created_at").execute()
    members_result = supabase.table("org_members").select("org_id").execute()

    member_counts: dict[str, int] = {}
    for row in members_result.data or []:
        org_id = str(row["org_id"])
        member_counts[org_id] = member_counts.get(org_id, 0) + 1

    orgs = [
        AdminOrgOut(
            id=row["id"],
            name=row["name"],
            created_at=row["created_at"],
            member_count=member_counts.get(str(row["id"]), 0),
        )
        for row in orgs_result.data or []
    ]
    return AdminOrgsOut(orgs=orgs)


@router.get("/orgs/{org_id}/members", response_model=AdminOrgMembersOut)
def get_org_members(
    org_id: UUID, _admin: PlatformAdminAuth = Depends(verify_platform_admin)
) -> AdminOrgMembersOut:
    """One org's member/invite list -- the "Organizations" screen's drill-
    in view. Same two queries as GET /settings (app/routers/settings.py),
    scoped to the requested org_id rather than the caller's own -- that's
    the entire point of this endpoint existing separately from Settings.
    """
    supabase = get_supabase()

    org_row = maybe_single_result(supabase.table("orgs").select("name").eq("id", str(org_id)).maybe_single())
    if not org_row.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    team_result = (
        supabase.table("org_members")
        .select("id, email, role, created_at")
        .eq("org_id", str(org_id))
        .order("created_at")
        .execute()
    )
    invites_result = (
        supabase.table("org_invites")
        .select("id, email, role, created_at")
        .eq("org_id", str(org_id))
        .order("created_at")
        .execute()
    )

    return AdminOrgMembersOut(
        org_id=org_id,
        org_name=org_row.data["name"],
        team=[TeamMemberOut(**row) for row in team_result.data or []],
        pending_invites=[PendingInviteOut(**row) for row in invites_result.data or []],
    )
