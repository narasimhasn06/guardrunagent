"""Endpoint-level tests for GET /me and POST /orgs -- the new-org-signup
half of docs/03-low-level-design.md Section 2.2 step 6 that was never
built until now (see the comment above MeOut in app/schemas.py). Not part
of docs/06-test-plan.md's original scope, same as the rest of Settings.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import UUID

from app.auth import JwtIdentity, verify_jwt_identity
from app.main import app
from tests.fakes import FakeSupabase

AUTH_USER_ID = "33333333-3333-3333-3333-333333333333"
ORG_ID = "11111111-1111-1111-1111-111111111111"


def _override_identity(email: str = "jane@example.com") -> None:
    app.dependency_overrides[verify_jwt_identity] = lambda: JwtIdentity(
        auth_user_id=UUID(AUTH_USER_ID), email=email
    )


class TestGetMe:
    def test_missing_auth_is_rejected(self, client):
        response = client.get("/me")
        assert response.status_code == 401

    def test_no_org_and_no_invite_reports_has_org_false(self, client):
        _override_identity()
        fake = FakeSupabase(table_data={"org_members": {"select": None}, "org_invites": {"select": None}})

        with patch("app.routers.orgs.get_supabase", return_value=fake):
            response = client.get("/me")

        assert response.status_code == 200
        body = response.json()
        assert body == {"email": "jane@example.com", "has_org": False, "org_id": None, "role": None}

    def test_existing_membership_reports_has_org_true(self, client):
        _override_identity()
        fake = FakeSupabase(
            table_data={"org_members": {"org_id": ORG_ID, "role": "admin", "email": "jane@example.com"}}
        )

        with patch("app.routers.orgs.get_supabase", return_value=fake):
            response = client.get("/me")

        assert response.status_code == 200
        body = response.json()
        assert body["has_org"] is True
        assert body["org_id"] == ORG_ID
        assert body["role"] == "admin"

    def test_pending_invite_is_auto_joined_and_consumed(self, client):
        # Same behavior verify_jwt already has (tests/test_auth_jwt.py's
        # test_first_login_with_a_pending_invite_joins_that_org) -- GET
        # /me must resolve this the same way, since it's what decides
        # whether the "create your organization" screen even shows.
        _override_identity(email="new.hire@example.com")
        new_member_row = {"org_id": ORG_ID, "role": "member", "email": "new.hire@example.com"}
        fake = FakeSupabase(
            table_data={
                "org_members": {"select": None, "insert": [new_member_row]},
                "org_invites": {
                    "select": {"id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", "org_id": ORG_ID, "role": "member"},
                    "delete": None,
                },
            }
        )

        with patch("app.routers.orgs.get_supabase", return_value=fake):
            response = client.get("/me")

        assert response.status_code == 200
        body = response.json()
        assert body["has_org"] is True
        assert body["org_id"] == ORG_ID

        delete_calls = [c for c in fake.recorded_calls if c[0] == "delete" and c[1] == "org_invites"]
        assert len(delete_calls) == 1


class TestCreateOrg:
    def test_missing_auth_is_rejected(self, client):
        response = client.post("/orgs", json={"org_name": "Acme Inc"})
        assert response.status_code == 401

    def test_empty_name_is_rejected(self, client):
        _override_identity()
        fake = FakeSupabase()

        with patch("app.routers.orgs.get_supabase", return_value=fake):
            response = client.post("/orgs", json={"org_name": "   "})

        assert response.status_code == 400

    def test_already_a_member_returns_409(self, client):
        _override_identity()
        fake = FakeSupabase(table_data={"org_members": {"select": {"id": "x"}}})

        with patch("app.routers.orgs.get_supabase", return_value=fake):
            response = client.post("/orgs", json={"org_name": "Acme Inc"})

        assert response.status_code == 409

    def test_creates_org_and_admin_membership(self, client):
        _override_identity(email="jane@example.com")
        fake = FakeSupabase(
            table_data={
                "org_members": {"select": None},
                "orgs": {"insert": [{"id": ORG_ID}]},
            }
        )

        with patch("app.routers.orgs.get_supabase", return_value=fake):
            response = client.post("/orgs", json={"org_name": "  Acme Inc  "})

        assert response.status_code == 201
        body = response.json()
        assert body["org_id"] == ORG_ID
        assert body["org_name"] == "Acme Inc"  # trimmed
        assert body["api_key"].startswith("grk_")

        org_insert = [c for c in fake.recorded_calls if c[0] == "insert" and c[1] == "orgs"]
        assert len(org_insert) == 1
        assert org_insert[0][2]["name"] == "Acme Inc"
        assert org_insert[0][2]["api_key_hash"] != body["api_key"]  # never stores the plaintext

        member_insert = [c for c in fake.recorded_calls if c[0] == "insert" and c[1] == "org_members"]
        assert member_insert == [
            (
                "insert",
                "org_members",
                {
                    "org_id": ORG_ID,
                    "auth_user_id": AUTH_USER_ID,
                    "email": "jane@example.com",
                    "role": "admin",
                },
            )
        ]
