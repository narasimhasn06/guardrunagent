"""Direct unit tests for app.invites.create_pending_invite (and the
_send_invite_email helper it uses), the same "always exercise the shared
helper directly" approach tests/test_alerting.py uses for
dispatch_guardrail_alert.

create_pending_invite is shared by app/routers/settings.py's
invite_team_member and app/routers/admin.py's invite_org_member -- the
409 conflict checks are already covered end-to-end via those two
routers' own tests (tests/test_settings_endpoint.py,
tests/test_admin_endpoint.py); this file focuses on the invite-email
behavior added alongside it: sending a real invite via Supabase Auth's
admin API, best-effort, never failing the invite itself.
"""

from __future__ import annotations

from unittest.mock import patch

from supabase_auth.errors import AuthApiError

from app.config import Settings
from app.invites import create_pending_invite
from tests.fakes import FakeSupabase

ORG_ID = "11111111-1111-1111-1111-111111111111"


def _settings(dashboard_url: str | None = None) -> Settings:
    return Settings(
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="dummy-service-role-key",
        supabase_jwt_secret="dummy-jwt-secret",
        api_key_pepper="test-pepper-not-a-real-secret",
        dashboard_url=dashboard_url,
    )


def _fake(invite_email_error: Exception | None = None) -> FakeSupabase:
    return FakeSupabase(
        table_data={
            "org_members": {"select": None},
            "org_invites": {"select": None, "insert": [{"id": "invite-1"}]},
        },
        invite_email_error=invite_email_error,
    )


def test_successful_send_records_invite_email_sent_true():
    fake = _fake()

    with patch("app.invites.get_settings", return_value=_settings()):
        invite = create_pending_invite(fake, ORG_ID, "New.Hire@Example.com", "member")

    assert invite["id"] == "invite-1"
    insert_calls = [c for c in fake.recorded_calls if c[0] == "insert" and c[1] == "org_invites"]
    assert insert_calls[0][2] == {
        "org_id": ORG_ID,
        "email": "new.hire@example.com",
        "role": "member",
        "invite_email_sent": True,
    }
    invite_calls = [c for c in fake.recorded_calls if c[0] == "invite_user_by_email"]
    assert invite_calls == [("invite_user_by_email", "new.hire@example.com", None)]


def test_passes_the_dashboard_auth_confirm_page_as_redirect_to_when_configured():
    fake = _fake()

    with patch("app.invites.get_settings", return_value=_settings(dashboard_url="https://app.example.com/")):
        create_pending_invite(fake, ORG_ID, "new.hire@example.com", "member")

    invite_calls = [c for c in fake.recorded_calls if c[0] == "invite_user_by_email"]
    # rstrip('/') on the configured dashboard_url -- no double slash.
    # /auth/confirm, not /auth/callback -- this is an implicit-flow
    # (hash-fragment token) link, which a server-side route can't see;
    # see _send_invite_email's own docstring.
    assert invite_calls == [
        ("invite_user_by_email", "new.hire@example.com", {"redirect_to": "https://app.example.com/auth/confirm"})
    ]


def test_email_already_registered_is_not_a_failure_but_records_sent_false():
    # Expected, common case: this email already has a Supabase Auth
    # account -- e.g. previously removed from an org (remove_team_member
    # only deletes the org_members row, never auth.users) and now
    # re-invited. They'll be linked automatically on their next sign-in
    # (app/auth.py's resolve_or_join_org) -- this must not raise.
    already_registered = AuthApiError("A user with this email address has already been registered", 422, "email_exists")
    fake = _fake(invite_email_error=already_registered)

    with patch("app.invites.get_settings", return_value=_settings()):
        invite = create_pending_invite(fake, ORG_ID, "new.hire@example.com", "member")

    assert invite["id"] == "invite-1"
    insert_calls = [c for c in fake.recorded_calls if c[0] == "insert" and c[1] == "org_invites"]
    assert insert_calls[0][2]["invite_email_sent"] is False


def test_a_genuine_delivery_failure_also_does_not_fail_the_invite():
    # The org_invites row is the real source of truth regardless of
    # whether the email actually sends (misconfigured SMTP, Supabase
    # outage, etc.) -- creating the invite must never depend on it.
    delivery_failure = AuthApiError("SMTP error", 500, None)
    fake = _fake(invite_email_error=delivery_failure)

    with patch("app.invites.get_settings", return_value=_settings()):
        invite = create_pending_invite(fake, ORG_ID, "new.hire@example.com", "member")

    assert invite["id"] == "invite-1"
    insert_calls = [c for c in fake.recorded_calls if c[0] == "insert" and c[1] == "org_invites"]
    assert insert_calls[0][2]["invite_email_sent"] is False
