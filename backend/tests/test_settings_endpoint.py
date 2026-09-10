"""Endpoint-level tests for the Settings page (docs/04-ui-ux-design.md
Section 3.6): GET /settings, API key regeneration, Slack webhook
config/test, and team invite/role management. Not part of
docs/06-test-plan.md's original scope (the endpoint shapes aren't in the
LLD's API design -- see the comment in app/schemas.py).
"""

from __future__ import annotations

import bcrypt
from unittest.mock import patch
from uuid import UUID

from app.auth import UserAuth, verify_jwt
from app.main import app
from tests.fakes import FakeSupabase

ORG_ID = "11111111-1111-1111-1111-111111111111"

MEMBER_ROW = {
    "id": "33333333-3333-3333-3333-333333333333",
    "email": "jane@example.com",
    "role": "admin",
    "created_at": "2026-09-01T10:00:00+00:00",
}

INVITE_ROW = {
    "id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    "email": "new.hire@example.com",
    "role": "member",
    "created_at": "2026-09-10T10:00:00+00:00",
}


def _override_jwt_auth() -> None:
    app.dependency_overrides[verify_jwt] = lambda: UserAuth(
        auth_user_id=UUID(MEMBER_ROW["id"]),
        org_id=UUID(ORG_ID),
        email="jane@example.com",
        role="admin",
    )


class TestGetSettings:
    def test_returns_org_slack_team_and_pending_invites(self, client):
        _override_jwt_auth()
        fake = FakeSupabase(
            table_data={
                "orgs": {"name": "Acme Inc", "slack_webhook_url": "https://hooks.slack.example/services/xyz"},
                "org_members": [MEMBER_ROW],
                "org_invites": [INVITE_ROW],
            }
        )

        with patch("app.routers.settings.get_supabase", return_value=fake):
            response = client.get("/settings")

        assert response.status_code == 200
        body = response.json()
        assert body["org_name"] == "Acme Inc"
        assert body["has_api_key"] is True
        assert body["slack_webhook_configured"] is True
        assert body["slack_webhook_url"] == "https://hooks.slack.example/services/xyz"
        assert body["team"][0]["email"] == "jane@example.com"
        assert body["pending_invites"][0]["email"] == "new.hire@example.com"

    def test_no_slack_webhook_configured(self, client):
        _override_jwt_auth()
        fake = FakeSupabase(
            table_data={
                "orgs": {"name": "Acme Inc", "slack_webhook_url": None},
                "org_members": [MEMBER_ROW],
                "org_invites": [],
            }
        )

        with patch("app.routers.settings.get_supabase", return_value=fake):
            response = client.get("/settings")

        body = response.json()
        assert body["slack_webhook_configured"] is False
        assert body["slack_webhook_url"] is None

    def test_missing_auth_is_rejected(self, client):
        response = client.get("/settings")
        assert response.status_code == 401


class TestRegenerateApiKey:
    def test_returns_a_new_plaintext_key_and_stores_only_its_hash(self, client):
        _override_jwt_auth()
        fake = FakeSupabase()

        with patch("app.routers.settings.get_supabase", return_value=fake):
            response = client.post("/settings/api-key/regenerate")

        assert response.status_code == 200
        new_key = response.json()["api_key"]
        assert new_key.startswith("grk_")

        update_calls = [c for c in fake.recorded_calls if c[0] == "update" and c[1] == "orgs"]
        assert len(update_calls) == 1
        stored_hash = update_calls[0][2]["api_key_hash"]
        assert stored_hash != new_key  # never stores the plaintext
        assert bcrypt.checkpw(new_key.encode("utf-8"), stored_hash.encode("utf-8"))

    def test_two_calls_produce_different_keys(self, client):
        _override_jwt_auth()
        fake = FakeSupabase()

        with patch("app.routers.settings.get_supabase", return_value=fake):
            first = client.post("/settings/api-key/regenerate").json()["api_key"]
            second = client.post("/settings/api-key/regenerate").json()["api_key"]

        assert first != second

    def test_requires_jwt_auth(self, client):
        response = client.post("/settings/api-key/regenerate")
        assert response.status_code == 401


class TestSlackWebhook:
    def test_updates_the_webhook_url(self, client):
        _override_jwt_auth()
        fake = FakeSupabase()

        with patch("app.routers.settings.get_supabase", return_value=fake):
            response = client.put(
                "/settings/slack-webhook", json={"webhook_url": "https://hooks.slack.example/services/new"}
            )

        assert response.status_code == 200
        body = response.json()
        assert body["slack_webhook_configured"] is True
        assert body["slack_webhook_url"] == "https://hooks.slack.example/services/new"

        update_calls = [c for c in fake.recorded_calls if c[0] == "update" and c[1] == "orgs"]
        assert update_calls == [
            ("update", "orgs", {"slack_webhook_url": "https://hooks.slack.example/services/new"})
        ]

    def test_null_webhook_clears_the_integration(self, client):
        _override_jwt_auth()
        fake = FakeSupabase()

        with patch("app.routers.settings.get_supabase", return_value=fake):
            response = client.put("/settings/slack-webhook", json={"webhook_url": None})

        assert response.status_code == 200
        body = response.json()
        assert body["slack_webhook_configured"] is False
        assert body["slack_webhook_url"] is None

    def test_requires_jwt_auth(self, client):
        response = client.put("/settings/slack-webhook", json={"webhook_url": "https://x"})
        assert response.status_code == 401


class TestSlackWebhookTest:
    def test_no_webhook_configured_returns_400(self, client):
        _override_jwt_auth()
        fake = FakeSupabase(table_data={"orgs": {"slack_webhook_url": None}})

        with patch("app.routers.settings.get_supabase", return_value=fake):
            response = client.post("/settings/slack-webhook/test")

        assert response.status_code == 400

    def test_successful_delivery_reports_delivered_true(self, client):
        _override_jwt_auth()
        fake = FakeSupabase(table_data={"orgs": {"slack_webhook_url": "https://hooks.slack.example/services/xyz"}})

        with (
            patch("app.routers.settings.get_supabase", return_value=fake),
            patch("app.routers.settings.post_to_slack", return_value=True) as post_to_slack,
        ):
            response = client.post("/settings/slack-webhook/test")

        assert response.status_code == 200
        assert response.json() == {"delivered": True}
        post_to_slack.assert_called_once_with(
            "https://hooks.slack.example/services/xyz", ":wave: This is a test alert from GuardrunAgent."
        )

    def test_failed_delivery_reports_delivered_false_not_an_error(self, client):
        _override_jwt_auth()
        fake = FakeSupabase(table_data={"orgs": {"slack_webhook_url": "https://hooks.slack.example/services/xyz"}})

        with (
            patch("app.routers.settings.get_supabase", return_value=fake),
            patch("app.routers.settings.post_to_slack", return_value=False),
        ):
            response = client.post("/settings/slack-webhook/test")

        assert response.status_code == 200
        assert response.json() == {"delivered": False}

    def test_requires_jwt_auth(self, client):
        response = client.post("/settings/slack-webhook/test")
        assert response.status_code == 401


class TestInviteTeamMember:
    def test_creates_a_pending_invite(self, client):
        _override_jwt_auth()
        fake = FakeSupabase(
            table_data={
                "org_members": {"select": None},
                "org_invites": {"select": None, "insert": [INVITE_ROW]},
            }
        )

        with patch("app.routers.settings.get_supabase", return_value=fake):
            response = client.post("/settings/team/invite", json={"email": "New.Hire@Example.com", "role": "member"})

        assert response.status_code == 201
        assert response.json()["email"] == "new.hire@example.com"

        insert_calls = [c for c in fake.recorded_calls if c[0] == "insert" and c[1] == "org_invites"]
        assert insert_calls[0][2] == {"org_id": ORG_ID, "email": "new.hire@example.com", "role": "member"}

    def test_already_a_member_returns_409(self, client):
        _override_jwt_auth()
        fake = FakeSupabase(table_data={"org_members": {"select": {"id": "x"}}})

        with patch("app.routers.settings.get_supabase", return_value=fake):
            response = client.post("/settings/team/invite", json={"email": "jane@example.com"})

        assert response.status_code == 409

    def test_already_invited_returns_409(self, client):
        _override_jwt_auth()
        fake = FakeSupabase(
            table_data={
                "org_members": {"select": None},
                "org_invites": {"select": {"id": "x"}},
            }
        )

        with patch("app.routers.settings.get_supabase", return_value=fake):
            response = client.post("/settings/team/invite", json={"email": "new.hire@example.com"})

        assert response.status_code == 409

    def test_defaults_to_member_role(self, client):
        _override_jwt_auth()
        fake = FakeSupabase(
            table_data={
                "org_members": {"select": None},
                "org_invites": {"select": None, "insert": [INVITE_ROW]},
            }
        )

        with patch("app.routers.settings.get_supabase", return_value=fake):
            client.post("/settings/team/invite", json={"email": "new.hire@example.com"})

        insert_calls = [c for c in fake.recorded_calls if c[0] == "insert" and c[1] == "org_invites"]
        assert insert_calls[0][2]["role"] == "member"

    def test_requires_jwt_auth(self, client):
        response = client.post("/settings/team/invite", json={"email": "x@example.com"})
        assert response.status_code == 401


class TestCancelInvite:
    def test_deletes_the_invite(self, client):
        _override_jwt_auth()
        fake = FakeSupabase()

        with patch("app.routers.settings.get_supabase", return_value=fake):
            response = client.delete(f"/settings/team/invites/{INVITE_ROW['id']}")

        assert response.status_code == 204
        delete_calls = [c for c in fake.recorded_calls if c[0] == "delete" and c[1] == "org_invites"]
        assert len(delete_calls) == 1

    def test_requires_jwt_auth(self, client):
        response = client.delete(f"/settings/team/invites/{INVITE_ROW['id']}")
        assert response.status_code == 401


class TestUpdateTeamMemberRole:
    def test_updates_the_role(self, client):
        _override_jwt_auth()
        updated_row = {**MEMBER_ROW, "role": "member"}
        fake = FakeSupabase(table_data={"org_members": {"update": [updated_row]}})

        with patch("app.routers.settings.get_supabase", return_value=fake):
            response = client.patch(f"/settings/team/{MEMBER_ROW['id']}", json={"role": "member"})

        assert response.status_code == 200
        assert response.json()["role"] == "member"

    def test_unknown_member_id_returns_404(self, client):
        _override_jwt_auth()
        fake = FakeSupabase(table_data={"org_members": {"update": []}})

        with patch("app.routers.settings.get_supabase", return_value=fake):
            response = client.patch(f"/settings/team/{MEMBER_ROW['id']}", json={"role": "admin"})

        assert response.status_code == 404

    def test_requires_jwt_auth(self, client):
        response = client.patch(f"/settings/team/{MEMBER_ROW['id']}", json={"role": "admin"})
        assert response.status_code == 401
