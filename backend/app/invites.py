from __future__ import annotations

from fastapi import HTTPException, status
from supabase_auth.errors import AuthApiError

from app.config import get_settings
from app.db import maybe_single_result

# Supabase Auth's own error codes for "this email already has an
# account" -- returned by invite_user_by_email when the target email is
# already registered (most often: someone previously removed from an org
# via remove_team_member/remove_org_member, which only deletes the
# org_members row, never auth.users, then re-invited). Expected, not a
# failure -- they'll be linked automatically the next time they simply
# sign in (app/auth.py's resolve_or_join_org).
_ALREADY_REGISTERED_CODES = {"email_exists", "user_already_exists"}


def _send_invite_email(supabase, email: str) -> bool:
    """Best-effort: sends Supabase's own "Invite user" email (customized
    in the Supabase dashboard under Auth -> Email Templates, distinct
    from the "Confirm signup" template) via its admin API -- reuses
    Supabase's already-configured mail delivery, no new library or
    service. Never blocks or fails the invite itself: the org_invites
    row is the real source of truth regardless of whether this email
    actually sends (see create_pending_invite below) -- mirrors
    app/alerting.py's post_to_slack, which tracks delivery as a bool
    (guardrail_activity.alert_sent) rather than raising either.
    """
    settings = get_settings()
    options = {"redirect_to": f"{settings.dashboard_url.rstrip('/')}/auth/callback"} if settings.dashboard_url else None

    try:
        supabase.auth.admin.invite_user_by_email(email, options=options)
        return True
    except AuthApiError:
        # Covers both the expected case (email_exists/user_already_exists)
        # and a genuine delivery failure (misconfigured SMTP, etc.) --
        # either way, the pending invite itself must not fail because of
        # it; invite_email_sent (below) is how the dashboard surfaces the
        # difference to an admin, not an exception here.
        return False


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
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This email already belongs to another Org / Team")

    existing_invite = maybe_single_result(supabase.table("org_invites").select("id").eq("email", email).maybe_single())
    if existing_invite.data:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This email has already been invited")

    invite_email_sent = _send_invite_email(supabase, email)

    result = (
        supabase.table("org_invites")
        .insert({"org_id": org_id, "email": email, "role": role, "invite_email_sent": invite_email_sent})
        .execute()
    )
    return result.data[0]
