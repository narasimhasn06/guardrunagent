"""Endpoint-level tests for GET /admin/orgs and GET /admin/orgs/:id/members
-- the Super Admin role's two endpoints (app/routers/admin.py). See
CLAUDE.md's "Planned, not yet built" entry this closes. Not part of
docs/06-test-plan.md's original scope, same as the rest of Settings/orgs.
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
