"""Endpoint-level tests for GET /sessions/:id.

Cases per docs/06-test-plan.md Section 3.2 ("Backend -> GET
/sessions/:id" is covered generally by the JWT middleware cases plus the
Session Replay dashboard cases) and Section 4 (integration: auth handoff,
org-scoped data).
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import UUID

from app.auth import UserAuth, verify_jwt
from app.main import app
from tests.fakes import FakeSupabase

ORG_ID = "11111111-1111-1111-1111-111111111111"
OTHER_ORG_ID = "99999999-9999-9999-9999-999999999999"
SESSION_ID = "22222222-2222-2222-2222-222222222222"

SESSION_ROW = {
    "id": SESSION_ID,
    "org_id": ORG_ID,
    "agent_name": "claude-code",
    "project_label": "guardrunagent",
    "started_at": "2026-09-10T10:00:00+00:00",
    "ended_at": None,
    "total_cost_usd": "1.2500",
    "total_tokens": 500,
    "status": "active",
}

EVENT_ROW = {
    "id": "44444444-4444-4444-4444-444444444444",
    "action_type": "bash",
    "action_summary": "ran: npm install",
    "payload_meta": None,
    "reasoning_snippet": None,
    "tokens_used": 120,
    "cost_usd": "0.0020",
    "status": "success",
    "matched_rule_id": None,
    "created_at": "2026-09-10T10:00:05+00:00",
}


def _override_user_auth(org_id: str = ORG_ID) -> None:
    app.dependency_overrides[verify_jwt] = lambda: UserAuth(
        auth_user_id=UUID("33333333-3333-3333-3333-333333333333"),
        org_id=UUID(org_id),
        email="jane@example.com",
        role="admin",
    )


def test_returns_session_and_events_in_order(client):
    _override_user_auth()
    fake = FakeSupabase(
        table_data={"sessions": SESSION_ROW, "agent_events": {"data": [EVENT_ROW], "count": 1}}
    )

    with patch("app.routers.sessions.get_supabase", return_value=fake):
        response = client.get(f"/sessions/{SESSION_ID}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == SESSION_ID
    assert body["event_count"] == 1
    assert body["events"][0]["action_summary"] == "ran: npm install"


def test_unknown_session_returns_404(client):
    _override_user_auth()
    fake = FakeSupabase(table_data={"sessions": None})

    with patch("app.routers.sessions.get_supabase", return_value=fake):
        response = client.get(f"/sessions/{SESSION_ID}")

    assert response.status_code == 404


def test_session_belonging_to_another_org_returns_404_not_403(client):
    # This caller resolves to OTHER_ORG_ID; the org-scoped query
    # (.eq("org_id", OTHER_ORG_ID)) finds nothing for a session that
    # belongs to ORG_ID -- never confirm cross-org existence with a 403.
    _override_user_auth(org_id=OTHER_ORG_ID)
    fake = FakeSupabase(table_data={"sessions": None})

    with patch("app.routers.sessions.get_supabase", return_value=fake):
        response = client.get(f"/sessions/{SESSION_ID}")

    assert response.status_code == 404


def test_missing_auth_is_rejected(client):
    app.dependency_overrides.pop(verify_jwt, None)
    response = client.get(f"/sessions/{SESSION_ID}")
    assert response.status_code == 401


def test_limit_query_param_is_capped_at_500(client):
    _override_user_auth()
    fake = FakeSupabase(table_data={"sessions": SESSION_ROW, "agent_events": {"data": [], "count": 0}})

    with patch("app.routers.sessions.get_supabase", return_value=fake):
        response = client.get(f"/sessions/{SESSION_ID}?limit=1000")

    assert response.status_code == 422  # NFR3: pagination is capped at 500 events per page
