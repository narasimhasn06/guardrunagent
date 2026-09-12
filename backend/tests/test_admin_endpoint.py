"""Endpoint-level tests for GET /admin/orgs, GET /admin/orgs/:id/members,
and POST /admin/orgs/:id/invite -- the Super Admin role's endpoints
(app/routers/admin.py). See CLAUDE.md's "Planned, not yet built" entry
this closes and its decisions log for the invite endpoint added after.
Not part of docs/06-test-plan.md's original scope, same as the rest of
Settings/orgs.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import UUID

from app.auth import PlatformAdminAuth, verify_platform_admin
from app.main import app
from tests.fakes import FakeSupabase

ADMIN_AUTH_USER_ID = "99999999-9999-9999-9999-999999999999"
ORG_A = "11111111-1111-1111-1111-111111111111"
ORG_B = "22222222-2222-2222-2222-222222222222"


def _override_platform_admin() -> None:
    app.dependency_overrides[verify_platform_admin] = lambda: PlatformAdminAuth(
        auth_user_id=UUID(ADMIN_AUTH_USER_ID), email="admin@example.com"
    )


class TestListAllOrgs:
    def test_missing_auth_is_rejected(self, client):
        response = client.get("/admin/orgs")
        assert response.status_code == 401

    def test_non_platform_admin_is_rejected(self, client):
        # verify_platform_admin itself 403s; not re-tested here in depth
        # (see tests/test_auth_platform_admin.py) beyond confirming the
        # dependency is actually wired to this route.
        from fastapi import HTTPException, status

        def _reject():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a platform admin")

        app.dependency_overrides[verify_platform_admin] = _reject
        response = client.get("/admin/orgs")
        assert response.status_code == 403

    def test_lists_every_org_with_member_counts(self, client):
        _override_platform_admin()
        fake = FakeSupabase(
            table_data={
                "orgs": [
                    {"id": ORG_A, "name": "Acme Inc", "created_at": "2026-09-01T10:00:00+00:00"},
                    {"id": ORG_B, "name": "Widgets Co", "created_at": "2026-09-02T10:00:00+00:00"},
                ],
                "org_members": [
                    {"org_id": ORG_A},
                    {"org_id": ORG_A},
                    {"org_id": ORG_B},
                ],
            }
        )

        with patch("app.routers.admin.get_supabase", return_value=fake):
            response = client.get("/admin/orgs")

        assert response.status_code == 200
        body = response.json()
        assert body == {
            "orgs": [
                {
                    "id": ORG_A,
                    "name": "Acme Inc",
                    "created_at": "2026-09-01T10:00:00Z",
                    "member_count": 2,
                },
                {
                    "id": ORG_B,
                    "name": "Widgets Co",
                    "created_at": "2026-09-02T10:00:00Z",
                    "member_count": 1,
                },
            ]
        }

    def test_org_with_no_members_reports_zero(self, client):
        _override_platform_admin()
        fake = FakeSupabase(
            table_data={
                "orgs": [{"id": ORG_A, "name": "Acme Inc", "created_at": "2026-09-01T10:00:00+00:00"}],
                "org_members": [],
            }
        )

        with patch("app.routers.admin.get_supabase", return_value=fake):
            response = client.get("/admin/orgs")

        assert response.status_code == 200
        assert response.json()["orgs"][0]["member_count"] == 0


class TestGetOrgMembers:
    def test_missing_auth_is_rejected(self, client):
        response = client.get(f"/admin/orgs/{ORG_A}/members")
        assert response.status_code == 401

    def test_unknown_org_returns_404(self, client):
        _override_platform_admin()
        fake = FakeSupabase(table_data={"orgs": {"select": None}})

        with patch("app.routers.admin.get_supabase", return_value=fake):
            response = client.get(f"/admin/orgs/{ORG_A}/members")

        assert response.status_code == 404

    def test_returns_team_and_pending_invites_for_the_requested_org(self, client):
        _override_platform_admin()
        member_row = {
            "id": "33333333-3333-3333-3333-333333333333",
            "email": "jane@example.com",
            "role": "admin",
            "created_at": "2026-09-01T10:00:00+00:00",
        }
        invite_row = {
            "id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
            "email": "new.hire@example.com",
            "role": "member",
            "created_at": "2026-09-10T10:00:00+00:00",
        }
        fake = FakeSupabase(
            table_data={
                "orgs": {"select": {"name": "Acme Inc"}},
                "org_members": {"select": [member_row]},
                "org_invites": {"select": [invite_row]},
            }
        )

        with patch("app.routers.admin.get_supabase", return_value=fake):
            response = client.get(f"/admin/orgs/{ORG_A}/members")

        assert response.status_code == 200
        body = response.json()
        assert body["org_id"] == ORG_A
        assert body["org_name"] == "Acme Inc"
        assert body["team"] == [{**member_row, "created_at": "2026-09-01T10:00:00Z"}]
        assert body["pending_invites"] == [{**invite_row, "created_at": "2026-09-10T10:00:00Z"}]


class TestInviteOrgMember:
    """POST /admin/orgs/:id/invite -- lets a Super Admin invite a new
    member into any org from the Organizations detail page. Added after
    the initial read-only build; see CLAUDE.md's decisions log. Mirrors
    tests/test_settings_endpoint.py's TestInviteTeamMember, since both
    endpoints go through the same app/invites.py's create_pending_invite.
    """

    INVITE_ROW = {
        "id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        "email": "new.hire@example.com",
        "role": "member",
        "created_at": "2026-09-10T10:00:00+00:00",
    }

    def test_missing_auth_is_rejected(self, client):
        response = client.post(f"/admin/orgs/{ORG_A}/invite", json={"email": "x@example.com"})
        assert response.status_code == 401

    def test_non_platform_admin_is_rejected(self, client):
        from fastapi import HTTPException, status

        def _reject():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a platform admin")

        app.dependency_overrides[verify_platform_admin] = _reject
        response = client.post(f"/admin/orgs/{ORG_A}/invite", json={"email": "x@example.com"})
        assert response.status_code == 403

    def test_unknown_org_returns_404(self, client):
        _override_platform_admin()
        fake = FakeSupabase(table_data={"orgs": {"select": None}})

        with patch("app.routers.admin.get_supabase", return_value=fake):
            response = client.post(f"/admin/orgs/{ORG_A}/invite", json={"email": "new.hire@example.com"})

        assert response.status_code == 404

    def test_creates_a_pending_invite_scoped_to_the_requested_org(self, client):
        _override_platform_admin()
        fake = FakeSupabase(
            table_data={
                "orgs": {"select": {"name": "Acme Inc"}},
                "org_members": {"select": None},
                "org_invites": {"select": None, "insert": [self.INVITE_ROW]},
            }
        )

        with patch("app.routers.admin.get_supabase", return_value=fake):
            response = client.post(
                f"/admin/orgs/{ORG_A}/invite", json={"email": "New.Hire@Example.com", "role": "member"}
            )

        assert response.status_code == 201
        assert response.json()["email"] == "new.hire@example.com"

        insert_calls = [c for c in fake.recorded_calls if c[0] == "insert" and c[1] == "org_invites"]
        assert insert_calls[0][2] == {"org_id": ORG_A, "email": "new.hire@example.com", "role": "member"}

    def test_defaults_to_member_role(self, client):
        _override_platform_admin()
        fake = FakeSupabase(
            table_data={
                "orgs": {"select": {"name": "Acme Inc"}},
                "org_members": {"select": None},
                "org_invites": {"select": None, "insert": [self.INVITE_ROW]},
            }
        )

        with patch("app.routers.admin.get_supabase", return_value=fake):
            client.post(f"/admin/orgs/{ORG_A}/invite", json={"email": "new.hire@example.com"})

        insert_calls = [c for c in fake.recorded_calls if c[0] == "insert" and c[1] == "org_invites"]
        assert insert_calls[0][2]["role"] == "member"

    def test_already_a_member_returns_409(self, client):
        _override_platform_admin()
        fake = FakeSupabase(
            table_data={
                "orgs": {"select": {"name": "Acme Inc"}},
                "org_members": {"select": {"id": "x"}},
            }
        )

        with patch("app.routers.admin.get_supabase", return_value=fake):
            response = client.post(f"/admin/orgs/{ORG_A}/invite", json={"email": "jane@example.com"})

        assert response.status_code == 409

    def test_already_invited_returns_409(self, client):
        _override_platform_admin()
        fake = FakeSupabase(
            table_data={
                "orgs": {"select": {"name": "Acme Inc"}},
                "org_members": {"select": None},
                "org_invites": {"select": {"id": "x"}},
            }
        )

        with patch("app.routers.admin.get_supabase", return_value=fake):
            response = client.post(f"/admin/orgs/{ORG_A}/invite", json={"email": "new.hire@example.com"})

        assert response.status_code == 409


class TestRemoveOrgMember:
    """DELETE /admin/orgs/:id/members/:id -- lets a Super Admin remove a
    member from any org. Added directly in response to there being no
    way to do this except editing org_members by hand via the Supabase
    SQL Editor. Mirrors tests/test_settings_endpoint.py's
    TestRemoveTeamMember, since both go through the same
    app/org_members.py's ensure_not_last_admin.
    """

    OTHER_MEMBER_ID = "66666666-6666-6666-6666-666666666666"

    def test_missing_auth_is_rejected(self, client):
        response = client.delete(f"/admin/orgs/{ORG_A}/members/{self.OTHER_MEMBER_ID}")
        assert response.status_code == 401

    def test_unknown_org_returns_404(self, client):
        _override_platform_admin()
        fake = FakeSupabase(table_data={"orgs": {"select": None}})

        with patch("app.routers.admin.get_supabase", return_value=fake):
            response = client.delete(f"/admin/orgs/{ORG_A}/members/{self.OTHER_MEMBER_ID}")

        assert response.status_code == 404

    def test_removes_the_member(self, client):
        _override_platform_admin()
        fake = FakeSupabase(
            table_data={
                "orgs": {"select": {"name": "Acme Inc"}},
                "org_members": {
                    "select": [{"id": "some-admin-id"}],
                    "delete": [{"id": self.OTHER_MEMBER_ID}],
                },
            }
        )

        with patch("app.routers.admin.get_supabase", return_value=fake):
            response = client.delete(f"/admin/orgs/{ORG_A}/members/{self.OTHER_MEMBER_ID}")

        assert response.status_code == 204

    def test_unknown_member_id_returns_404(self, client):
        _override_platform_admin()
        fake = FakeSupabase(
            table_data={
                "orgs": {"select": {"name": "Acme Inc"}},
                "org_members": {"select": [{"id": "some-admin-id"}], "delete": []},
            }
        )

        with patch("app.routers.admin.get_supabase", return_value=fake):
            response = client.delete(f"/admin/orgs/{ORG_A}/members/{self.OTHER_MEMBER_ID}")

        assert response.status_code == 404

    def test_cannot_remove_the_organizations_only_admin(self, client):
        _override_platform_admin()
        fake = FakeSupabase(
            table_data={
                "orgs": {"select": {"name": "Acme Inc"}},
                "org_members": {"select": [{"id": self.OTHER_MEMBER_ID}]},
            }
        )

        with patch("app.routers.admin.get_supabase", return_value=fake):
            response = client.delete(f"/admin/orgs/{ORG_A}/members/{self.OTHER_MEMBER_ID}")

        assert response.status_code == 409
        assert "at least one Admin" in response.json()["detail"]
