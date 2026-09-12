from __future__ import annotations

import secrets
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.alerting import post_to_slack
from app.api_keys import hash_api_key
from app.auth import UserAuth, verify_jwt
from app.db import get_supabase, maybe_single_result
from app.invites import create_pending_invite
from app.org_members import ensure_not_last_admin
from app.schemas import (
    ApiKeyRegenerateOut,
    FailModeIn,
    FailModeOut,
    PendingInviteOut,
    SettingsOut,
    SlackTestResult,
    SlackWebhookIn,
    SlackWebhookOut,
    TeamInviteIn,
    TeamMemberOut,
    TeamRoleUpdateIn,
)

router = APIRouter(prefix="/settings")


def _require_admin(auth: UserAuth) -> None:
    """Guards the Team tab's mutation endpoints below (invite, role
    change, cancel invite). These never actually checked `auth.role`
    before -- any Member, not just an Admin, could invite teammates or
    even promote themselves to Admin via the role toggle. Caught during
    manual verification of the Super Admin rollout; fixed here rather
    than left as "no granular permissions needed at MVP" (the docs'
    original framing, docs/04-ui-ux-design.md Section 3.6) -- Admin vs.
    Member is meant to mean something, and self-promotion in particular
    is a real privilege-escalation path, not just a missing nicety. The
    dashboard also hides these controls from a non-admin (see
    components/settings/team-section.tsx's `isAdmin` prop), but that's
    only ever a UI convenience -- this check is the actual gate.
    """
    if auth.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only org admins can manage the team")


@router.get("", response_model=SettingsOut)
def get_settings_page(auth: UserAuth = Depends(verify_jwt)) -> SettingsOut:
    supabase = get_supabase()
    org_id = str(auth.org_id)

    org_row = maybe_single_result(
        supabase.table("orgs").select("name, slack_webhook_url, fail_mode").eq("id", org_id).maybe_single()
    )
    org = org_row.data or {}

    team_result = (
        supabase.table("org_members")
        .select("id, email, role, created_at")
        .eq("org_id", org_id)
        .order("created_at")
        .execute()
    )
    invites_result = (
        supabase.table("org_invites")
        .select("id, email, role, created_at, invite_email_sent")
        .eq("org_id", org_id)
        .order("created_at")
        .execute()
    )

    return SettingsOut(
        org_name=org.get("name", ""),
        has_api_key=True,  # orgs.api_key_hash is NOT NULL -- every org always has one
        slack_webhook_configured=bool(org.get("slack_webhook_url")),
        slack_webhook_url=org.get("slack_webhook_url"),
        fail_mode=org.get("fail_mode", "open"),
        team=[TeamMemberOut(**row) for row in team_result.data or []],
        pending_invites=[PendingInviteOut(**row) for row in invites_result.data or []],
        your_role=auth.role,
    )


@router.post("/api-key/regenerate", response_model=ApiKeyRegenerateOut)
def regenerate_api_key(auth: UserAuth = Depends(verify_jwt)) -> ApiKeyRegenerateOut:
    """docs/04-ui-ux-design.md Section 3.6: "regenerate button (with
    confirmation -- regenerating breaks existing SDK installs)." The
    confirmation itself is a dashboard-side UX concern (components/settings);
    this endpoint just does the regeneration once called. Stored the same
    way the original key was (HMAC-SHA256, see app/api_keys.py) -- there's
    no way back to a plaintext key once this response is gone, by design.
    """
    supabase = get_supabase()
    new_key = f"grk_{secrets.token_urlsafe(32)}"
    key_hash = hash_api_key(new_key)

    supabase.table("orgs").update({"api_key_hash": key_hash}).eq("id", str(auth.org_id)).execute()

    return ApiKeyRegenerateOut(api_key=new_key)


@router.put("/slack-webhook", response_model=SlackWebhookOut)
def update_slack_webhook(body: SlackWebhookIn, auth: UserAuth = Depends(verify_jwt)) -> SlackWebhookOut:
    supabase = get_supabase()
    supabase.table("orgs").update({"slack_webhook_url": body.webhook_url}).eq("id", str(auth.org_id)).execute()

    return SlackWebhookOut(
        slack_webhook_configured=bool(body.webhook_url),
        slack_webhook_url=body.webhook_url,
    )


@router.post("/slack-webhook/test", response_model=SlackTestResult)
def test_slack_webhook(auth: UserAuth = Depends(verify_jwt)) -> SlackTestResult:
    supabase = get_supabase()
    org_row = maybe_single_result(
        supabase.table("orgs").select("slack_webhook_url").eq("id", str(auth.org_id)).maybe_single()
    )
    webhook_url = (org_row.data or {}).get("slack_webhook_url")
    if not webhook_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No Slack webhook configured")

    delivered = post_to_slack(webhook_url, ":wave: This is a test alert from GuardrunAgent.")
    return SlackTestResult(delivered=delivered)


@router.put("/fail-mode", response_model=FailModeOut)
def update_fail_mode(body: FailModeIn, auth: UserAuth = Depends(verify_jwt)) -> FailModeOut:
    """docs/05-architecture-document.md Section 8: promotes fail-open vs.
    fail-closed from a client-side-only SDK config to a real org-level
    setting (orgs.fail_mode). The SDK picks this up via GET /rules (see
    app/routers/rules.py) -- its own env var/config.json still overrides
    this per-machine when explicitly set (see sdk/src/config.ts).
    """
    supabase = get_supabase()
    supabase.table("orgs").update({"fail_mode": body.fail_mode}).eq("id", str(auth.org_id)).execute()

    return FailModeOut(fail_mode=body.fail_mode)


@router.post("/team/invite", response_model=PendingInviteOut, status_code=201)
def invite_team_member(body: TeamInviteIn, auth: UserAuth = Depends(verify_jwt)) -> PendingInviteOut:
    """Creates a pending org_invites row -- consumed by app.auth.verify_jwt
    on the invited person's first login (see the migration's comment for
    why this table exists). Checked against org_members globally, not just
    this org: org_members.auth_user_id is globally unique, i.e. this
    schema has one org per user, so an email already belonging to any org
    can't be re-invited.
    """
    _require_admin(auth)
    supabase = get_supabase()
    invite = create_pending_invite(supabase, str(auth.org_id), body.email, body.role)
    return PendingInviteOut(**invite)


@router.delete("/team/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_invite(invite_id: UUID, auth: UserAuth = Depends(verify_jwt)) -> None:
    _require_admin(auth)
    supabase = get_supabase()
    supabase.table("org_invites").delete().eq("id", str(invite_id)).eq("org_id", str(auth.org_id)).execute()


@router.patch("/team/{member_id}", response_model=TeamMemberOut)
def update_team_member_role(
    member_id: UUID, body: TeamRoleUpdateIn, auth: UserAuth = Depends(verify_jwt)
) -> TeamMemberOut:
    """Bug fix: demoting the org's only Admin to Member -- including an
    Admin demoting *themselves*, the common case -- used to succeed with
    no way back: the role-toggle button that would promote them again is
    gated on `isAdmin` (components/settings/team-section.tsx), which
    becomes false the moment their own role does. Rejects that specific
    case with a 409 instead; an org with 2+ admins can still demote any
    one of them freely. The dashboard also disables the toggle for the
    last admin's own row as a UI convenience, but this check is the real
    gate -- a race between two admins demoting each other simultaneously
    must still be caught here.
    """
    _require_admin(auth)
    supabase = get_supabase()
    org_id = str(auth.org_id)

    if body.role == "member":
        ensure_not_last_admin(supabase, org_id, str(member_id))

    result = (
        supabase.table("org_members")
        .update({"role": body.role})
        .eq("id", str(member_id))
        .eq("org_id", org_id)  # never let one org edit another's member
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team member not found")

    return TeamMemberOut(**result.data[0])


@router.delete("/team/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_team_member(member_id: UUID, auth: UserAuth = Depends(verify_jwt)) -> None:
    """Removes a member from the org entirely -- distinct from demoting
    them to Member (PATCH, above). Added directly in response to a real
    workaround: with no delete endpoint, removing someone meant editing
    org_members (and auth.users) by hand via the Supabase SQL Editor.
    Same last-admin protection as demoting: removing an org's only Admin
    is rejected the same way.
    """
    _require_admin(auth)
    supabase = get_supabase()
    org_id = str(auth.org_id)

    ensure_not_last_admin(supabase, org_id, str(member_id))

    result = supabase.table("org_members").delete().eq("id", str(member_id)).eq("org_id", org_id).execute()
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team member not found")
