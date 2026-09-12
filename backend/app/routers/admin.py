from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import PlatformAdminAuth, verify_platform_admin
from app.db import get_supabase, maybe_single_result
from app.invites import create_pending_invite
from app.org_members import ensure_not_last_admin
from app.schemas import AdminOrgMembersOut, AdminOrgOut, AdminOrgsOut, PendingInviteOut, TeamInviteIn, TeamMemberOut

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
        .select("id, email, role, created_at, invite_email_sent")
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


@router.post("/orgs/{org_id}/invite", response_model=PendingInviteOut, status_code=status.HTTP_201_CREATED)
def invite_org_member(
    org_id: UUID, body: TeamInviteIn, _admin: PlatformAdminAuth = Depends(verify_platform_admin)
) -> PendingInviteOut:
    """Lets a Super Admin invite a new member into *any* org, from the
    Organizations detail page -- added after the initial read-only build
    (see CLAUDE.md's decisions log) once real usage showed a genuine need
    for it, e.g. onboarding a client org's first user without having to
    be a member of that org already.

    Deliberately not a role change or invite-cancel here too -- an org's
    own admins still see and manage everything this creates through
    their normal Settings -> Team (the invite lands in the same
    org_invites table, via the same create_pending_invite as
    app/routers/settings.py's invite_team_member). This stays a narrow
    addition: get someone in, don't take over running the org.
    """
    supabase = get_supabase()

    org_row = maybe_single_result(supabase.table("orgs").select("name").eq("id", str(org_id)).maybe_single())
    if not org_row.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    invite = create_pending_invite(supabase, str(org_id), body.email, body.role)
    return PendingInviteOut(**invite)


@router.delete("/orgs/{org_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_org_member(
    org_id: UUID, member_id: UUID, _admin: PlatformAdminAuth = Depends(verify_platform_admin)
) -> None:
    """Lets a Super Admin remove a member from any org, directly in
    response to a real workaround: with no delete endpoint anywhere,
    removing someone meant editing org_members (and auth.users) by hand
    via the Supabase SQL Editor. Same last-admin protection as the
    Settings version (app/routers/settings.py's remove_team_member) --
    removing an org's only Admin is rejected the same way, whether an
    org's own admin or a Super Admin is the one doing it.
    """
    supabase = get_supabase()
    org_id_str = str(org_id)

    org_row = maybe_single_result(supabase.table("orgs").select("name").eq("id", org_id_str).maybe_single())
    if not org_row.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    ensure_not_last_admin(supabase, org_id_str, str(member_id))

    result = supabase.table("org_members").delete().eq("id", str(member_id)).eq("org_id", org_id_str).execute()
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team member not found")
