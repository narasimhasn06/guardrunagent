"""Endpoint-level tests for GET /sessions (list).

Not part of docs/06-test-plan.md's original scope (the endpoint isn't in
the LLD's API design -- see the comment in app/schemas.py); these cover
docs/04-ui-ux-design.md Section 3.2's stated behavior: table columns,
filters, search, and sort.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import UUID

from app.auth import UserAuth, verify_jwt
from app.main import app
from tests.fakes import FakeSupabase

ORG_ID = "11111111-1111-1111-1111-111111111111"

SESSION_ROW = {
    "id": "aaaaaaaa-0000-0000-0000-000000000001",
    "agent_name": "claude-code",
    "project_label": "guardrunagent",
    "started_at": "2026-09-10T10:00:00+00:00",
    "ended_at": "2026-09-10T10:05:00+00:00",
    "total_cost_usd": "0.5000",
    "total_tokens": 1200,
    "status": "completed",
    "event_count": 8,
    "total_count": 1,
}


def _override_jwt_auth() -> None:
    app.dependency_overrides[verify_jwt] = lambda: UserAuth(
        auth_user_id=UUID("33333333-3333-3333-3333-333333333333"),
        org_id=UUID(ORG_ID),
        email="jane@example.com",
        role="admin",
    )


def test_returns_sessions_with_pagination_and_total_count(client):
    _override_jwt_auth()
    fake = FakeSupabase(
        table_data={"sessions": {"data": [{"project_label": "guardrunagent", "agent_name": "claude-code"}]}},
        rpc_data={"list_sessions": [SESSION_ROW]},
    )

    with patch("app.routers.sessions.get_supabase", return_value=fake):
        response = client.get("/sessions")

    assert response.status_code == 200
    body = response.json()
    assert body["total_count"] == 1
    assert len(body["sessions"]) == 1
    assert body["sessions"][0]["event_count"] == 8
    assert "total_count" not in body["sessions"][0]  # internal window-fn column, not part of the item shape


def test_empty_result_returns_valid_empty_response_not_error(client):
    _override_jwt_auth()
    fake = FakeSupabase(
        table_data={"sessions": {"data": []}},
        rpc_data={"list_sessions": []},
    )

    with patch("app.routers.sessions.get_supabase", return_value=fake):
        response = client.get("/sessions")

    assert response.status_code == 200
    body = response.json()
    assert body["sessions"] == []
    assert body["total_count"] == 0


def test_filter_params_are_forwarded_to_the_rpc(client):
    _override_jwt_auth()
    fake = FakeSupabase(
        table_data={"sessions": {"data": []}},
        rpc_data={"list_sessions": []},
    )

    with patch("app.routers.sessions.get_supabase", return_value=fake):
        response = client.get(
            "/sessions?project=guardrunagent&agent=claude-code&search=guard&status=completed&limit=10&offset=20"
        )

    assert response.status_code == 200
    rpc_calls = [c for c in fake.recorded_calls if c[0] == "rpc"]
    params = rpc_calls[0][2]
    assert params["p_org_id"] == ORG_ID
    assert params["p_project_label"] == "guardrunagent"
    assert params["p_agent_name"] == "claude-code"
    assert params["p_search"] == "guard"
    assert params["p_status"] == "completed"
    assert params["p_limit"] == 10
    assert params["p_offset"] == 20


def test_invalid_status_value_is_rejected(client):
    _override_jwt_auth()
    response = client.get("/sessions?status=blocked")  # event-level status, not a session status
    assert response.status_code == 422


def test_filter_options_reflect_distinct_projects_and_agents_unscoped_by_current_filters(client):
    _override_jwt_auth()
    fake = FakeSupabase(
        table_data={
            "sessions": {
                "data": [
                    {"project_label": "repo-a", "agent_name": "claude-code"},
                    {"project_label": "repo-a", "agent_name": "claude-code"},
                    {"project_label": "repo-b", "agent_name": "cursor"},
                    {"project_label": None, "agent_name": "claude-code"},
                ]
            }
        },
        rpc_data={"list_sessions": []},
    )

    with patch("app.routers.sessions.get_supabase", return_value=fake):
        response = client.get("/sessions?project=repo-a")  # filters shouldn't narrow the facet lists

    filters = response.json()["filters"]
    assert filters["projects"] == ["repo-a", "repo-b"]
    assert filters["agents"] == ["claude-code", "cursor"]


def test_default_limit_and_offset(client):
    _override_jwt_auth()
    fake = FakeSupabase(table_data={"sessions": {"data": []}}, rpc_data={"list_sessions": []})

    with patch("app.routers.sessions.get_supabase", return_value=fake):
        response = client.get("/sessions")

    body = response.json()
    assert body["limit"] == 50
    assert body["offset"] == 0


def test_missing_auth_is_rejected(client):
    app.dependency_overrides.pop(verify_jwt, None)
    response = client.get("/sessions")
    assert response.status_code == 401
