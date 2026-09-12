"""Endpoint-level tests for GET /me and POST /orgs -- the new-org-signup
half of docs/03-low-level-design.md Section 2.2 step 6 that was never
built until now (see the comment above MeOut in app/schemas.py). Not part
of docs/06-test-plan.md's original scope, same as the rest of Settings.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import UUID

from postgrest.exceptions import APIError

from app.auth import JwtIdentity, verify_jwt_identity
from app.main import app
from tests.fakes import FakeSupabase, Raises

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
        fake = FakeSupabase(
            table_data={"org_members": {"select": None}, "org_invites": {"select": None}, "platform_admins": None}
        )

        with patch("app.routers.orgs.get_supabase", return_value=fake):
            response = client.get("/me")

        assert response.status_code == 200
        body = response.json()
        assert body == {
            "email": "jane@example.com",
            "has_org": False,
            "org_id": None,
            "role": None,
            "is_platform_admin": False,
        }

    def test_platform_admin_with_no_org_is_reported(self, client):
        # A platform admin doesn't need an org membership at all -- see
        # app/auth.py's is_platform_admin and CLAUDE.md's "Planned, not
        # yet built" entry this closes.
        _override_identity(email="admin@example.com")
        fake = FakeSupabase(
            table_data={
                "org_members": {"select": None},
                "org_invites": {"select": None},
                "platform_admins": {"auth_user_id": AUTH_USER_ID},
            }
        )

        with patch("app.routers.orgs.get_supabase", return_value=fake):
            response = client.get("/me")

        assert response.status_code == 200
        body = response.json()
        assert body["has_org"] is False
        assert body["is_platform_admin"] is True

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

    def test_concurrent_double_submission_is_a_409_not_a_duplicate_org(self, client):
        # Caught live in production: the existence check above isn't
        # atomic with the org+membership inserts, so two near-simultaneous
        # POST /orgs for the same user (a double-click, a slow request
        # retried) can both pass it -- the Super Admin Organizations page
        # showed the same org name listed twice, each with its own
        # member, proving both fully succeeded instead of the loser being
        # rejected. This simulates being the loser: the org insert
        # succeeds (org_members.auth_user_id is unique, not orgs.name),
        # but the org_members insert then hits a real 23505.
        _override_identity(email="jane@example.com")
        duplicate_key_error = APIError(
            {
                "message": 'duplicate key value violates unique constraint "org_members_auth_user_id_key"',
                "code": "23505",
                "hint": None,
                "details": f"Key (auth_user_id)=({AUTH_USER_ID}) already exists.",
            }
        )
        fake = FakeSupabase(
            table_data={
                "org_members": {"select": None, "insert": Raises(duplicate_key_error)},
                "orgs": {"insert": [{"id": ORG_ID}]},
            }
        )

        with patch("app.routers.orgs.get_supabase", return_value=fake):
            response = client.post("/orgs", json={"org_name": "Organization Name 101"})

        assert response.status_code == 409
        assert response.json()["detail"] == "You already belong to an organization"

        # The org this losing request created gets cleaned up rather than
        # left behind as an orphan with zero members.
        org_delete = [c for c in fake.recorded_calls if c[0] == "delete" and c[1] == "orgs"]
        assert len(org_delete) == 1
