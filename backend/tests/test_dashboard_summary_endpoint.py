"""Endpoint-level tests for GET /dashboard-summary.

Not part of docs/06-test-plan.md's original scope (the endpoint isn't in
the LLD's route table -- see the comment in app/schemas.py); these cover
the aggregation logic directly since it's new.
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import patch
from uuid import UUID

from app.auth import UserAuth, verify_jwt
from app.main import app
from tests.fakes import FakeSupabase, Sequence

ORG_ID = "11111111-1111-1111-1111-111111111111"


def _override_jwt_auth() -> None:
    app.dependency_overrides[verify_jwt] = lambda: UserAuth(
        auth_user_id=UUID("33333333-3333-3333-3333-333333333333"),
        org_id=UUID(ORG_ID),
        email="jane@example.com",
        role="admin",
    )


def test_computes_totals_from_sessions_events_and_cost_summary(client):
    _override_jwt_auth()
    fake = FakeSupabase(
        table_data={
            "sessions": {
                "select": {
                    "data": [
                        {"id": "aaaaaaaa-0000-0000-0000-000000000001", "agent_name": "claude-code"},
                        {"id": "aaaaaaaa-0000-0000-0000-000000000002", "agent_name": "claude-code"},
                        {"id": "aaaaaaaa-0000-0000-0000-000000000003", "agent_name": "cursor"},
                    ],
                    "count": 3,
                },
            },
            "agent_events": {
                "select": [
                    {
                        "id": "bbbbbbbb-0000-0000-0000-000000000001",
                        "session_id": "aaaaaaaa-0000-0000-0000-000000000001",
                        "action_type": "bash",
                        "action_summary": "git push --force",
                        "status": "blocked",
                        "created_at": "2026-09-10T10:00:00+00:00",
                    }
                ],
            },
        },
        rpc_data={
            "cost_summary": [
                {"group_key": "2026-09-08", "total_cost_usd": "1.50", "total_tokens": 300, "event_count": 5},
                {"group_key": "2026-09-09", "total_cost_usd": "2.25", "total_tokens": 450, "event_count": 8},
            ]
        },
    )

    with patch("app.routers.dashboard_summary.get_supabase", return_value=fake):
        response = client.get("/dashboard-summary")

    assert response.status_code == 200
    body = response.json()
    assert body["total_sessions"] == 3
    assert body["active_agents"] == 2  # claude-code, cursor -- distinct
    assert float(body["total_spend_usd"]) == 3.75
    assert len(body["spend_by_day"]) == 2
    # Same fixture answers both the range-scoped and unscoped sessions
    # queries here (count=3 either way), so this only confirms the field
    # is populated -- see the dedicated test below for the actual
    # range-scoped-vs-unscoped distinction.
    assert body["org_has_any_sessions"] is True


def test_includes_the_orgs_name_for_the_header(client):
    _override_jwt_auth()
    fake = FakeSupabase(
        table_data={
            "orgs": {"name": "Acme Corp"},
            "sessions": {"select": {"data": [], "count": 0}},
            "agent_events": {"select": {"data": [], "count": 0}},
        },
        rpc_data={"cost_summary": []},
    )

    with patch("app.routers.dashboard_summary.get_supabase", return_value=fake):
        response = client.get("/dashboard-summary")

    assert response.json()["org_name"] == "Acme Corp"


def test_guardrail_blocks_counts_only_blocked_events(client):
    _override_jwt_auth()
    fake = FakeSupabase(
        table_data={
            "sessions": {"select": {"data": [], "count": 0}},
            "agent_events": {
                "select": {"data": [], "count": 4},  # blocked-events count query
            },
        },
        rpc_data={"cost_summary": []},
    )

    with patch("app.routers.dashboard_summary.get_supabase", return_value=fake):
        response = client.get("/dashboard-summary")

    assert response.json()["guardrail_blocks"] == 4


def test_new_org_with_zero_sessions_returns_org_has_any_sessions_false(client):
    _override_jwt_auth()
    fake = FakeSupabase(
        table_data={
            "sessions": {"select": {"data": [], "count": 0}},
            "agent_events": {"select": {"data": [], "count": 0}},
        },
        rpc_data={"cost_summary": []},
    )

    with patch("app.routers.dashboard_summary.get_supabase", return_value=fake):
        response = client.get("/dashboard-summary")

    body = response.json()
    assert body["org_has_any_sessions"] is False
    assert body["total_sessions"] == 0


def test_established_org_quiet_this_week_still_reports_has_any_sessions_true(client):
    # The org has history but nothing in the selected window -- the
    # empty-state setup checklist must not fire for this case (that's the
    # whole reason org_has_any_sessions is a separate, unscoped field).
    # The handler queries "sessions".select() twice: first range-scoped
    # (0 results this week), then unscoped for the has-any-sessions check
    # (1 historical row) -- Sequence hands back a different response per
    # call, in call order, so this actually exercises the distinction
    # rather than just asserting on a shared fixture.
    _override_jwt_auth()
    fake = FakeSupabase(
        table_data={
            "sessions": {
                "select": Sequence(
                    {"data": [], "count": 0},
                    {"data": [{"id": "aaaaaaaa-0000-0000-0000-0000000000aa"}], "count": 1},
                )
            },
            "agent_events": {"select": {"data": [], "count": 0}},
        },
        rpc_data={"cost_summary": []},
    )

    with patch("app.routers.dashboard_summary.get_supabase", return_value=fake):
        response = client.get("/dashboard-summary")

    body = response.json()
    assert body["total_sessions"] == 0
    assert body["org_has_any_sessions"] is True


def test_defaults_to_a_7_day_range_when_none_given(client):
    _override_jwt_auth()
    fake = FakeSupabase(
        table_data={
            "sessions": {"select": {"data": [], "count": 0}},
            "agent_events": {"select": {"data": [], "count": 0}},
        },
        rpc_data={"cost_summary": []},
    )

    with patch("app.routers.dashboard_summary.get_supabase", return_value=fake):
        response = client.get("/dashboard-summary")

    body = response.json()
    start = datetime.fromisoformat(body["start"])
    end = datetime.fromisoformat(body["end"])
    assert 6.9 <= (end - start).total_seconds() / 86400 <= 7.1


def test_start_after_end_is_rejected(client):
    _override_jwt_auth()
    response = client.get("/dashboard-summary?start=2026-09-10T00:00:00Z&end=2026-09-01T00:00:00Z")
    assert response.status_code == 400


def test_missing_auth_is_rejected(client):
    app.dependency_overrides.pop(verify_jwt, None)
    response = client.get("/dashboard-summary")
    assert response.status_code == 401


def test_recent_activity_reflects_agent_events_rows_most_recent_first(client):
    _override_jwt_auth()
    fake = FakeSupabase(
        table_data={
            "sessions": {"select": {"data": [], "count": 0}},
            "agent_events": {
                "select": [
                    {
                        "id": "bbbbbbbb-0000-0000-0000-000000000001",
                        "session_id": "aaaaaaaa-0000-0000-0000-000000000001",
                        "action_type": "git",
                        "action_summary": "git push --force origin main",
                        "status": "blocked",
                        "created_at": "2026-09-10T10:00:05+00:00",
                    },
                    {
                        "id": "bbbbbbbb-0000-0000-0000-000000000002",
                        "session_id": "aaaaaaaa-0000-0000-0000-000000000001",
                        "action_type": "bash",
                        "action_summary": "npm install",
                        "status": "success",
                        "created_at": "2026-09-10T10:00:00+00:00",
                    },
                ],
            },
        },
        rpc_data={"cost_summary": []},
    )

    with patch("app.routers.dashboard_summary.get_supabase", return_value=fake):
        response = client.get("/dashboard-summary")

    activity = response.json()["recent_activity"]
    assert len(activity) == 2
    assert activity[0]["status"] == "blocked"
