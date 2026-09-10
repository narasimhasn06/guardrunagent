"""Endpoint-level tests for GET /cost-summary.

Cases per docs/06-test-plan.md Section 3.2 ("Backend -> Cost aggregation")
and Section 6 ("empty result set... returns a valid empty response, not an
error").
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import UUID

from app.auth import UserAuth, verify_jwt
from app.main import app
from tests.fakes import FakeSupabase

ORG_ID = "11111111-1111-1111-1111-111111111111"


def _override_user_auth() -> None:
    app.dependency_overrides[verify_jwt] = lambda: UserAuth(
        auth_user_id=UUID("33333333-3333-3333-3333-333333333333"),
        org_id=UUID(ORG_ID),
        email="jane@example.com",
        role="admin",
    )


def test_groups_by_day_and_sums_totals(client):
    _override_user_auth()
    fake = FakeSupabase(
        rpc_data={
            "cost_summary": [
                {"group_key": "2026-09-08", "total_cost_usd": "1.50", "total_tokens": 300, "event_count": 5},
                {"group_key": "2026-09-09", "total_cost_usd": "2.25", "total_tokens": 450, "event_count": 8},
            ]
        }
    )

    with patch("app.routers.cost_summary.get_supabase", return_value=fake):
        response = client.get("/cost-summary?group_by=day")

    assert response.status_code == 200
    body = response.json()
    assert body["group_by"] == "day"
    assert len(body["rows"]) == 2
    assert float(body["total_cost_usd"]) == 3.75
    assert body["total_tokens"] == 750

    rpc_calls = [c for c in fake.recorded_calls if c[0] == "rpc"]
    assert rpc_calls[0][1] == "cost_summary"
    assert rpc_calls[0][2]["p_group_by"] == "day"
    assert rpc_calls[0][2]["p_org_id"] == ORG_ID


def test_empty_result_returns_valid_empty_response_not_error(client):
    _override_user_auth()
    fake = FakeSupabase(rpc_data={"cost_summary": []})

    with patch("app.routers.cost_summary.get_supabase", return_value=fake):
        response = client.get("/cost-summary?group_by=project")

    assert response.status_code == 200
    body = response.json()
    assert body["rows"] == []
    assert float(body["total_cost_usd"]) == 0
    assert body["total_tokens"] == 0


def test_invalid_group_by_is_rejected(client):
    _override_user_auth()
    response = client.get("/cost-summary?group_by=hour")
    assert response.status_code == 422


def test_start_after_end_is_rejected(client):
    _override_user_auth()
    response = client.get("/cost-summary?start=2026-09-10T00:00:00Z&end=2026-09-01T00:00:00Z")
    assert response.status_code == 400


def test_defaults_to_a_30_day_range_when_none_given(client):
    _override_user_auth()
    fake = FakeSupabase(rpc_data={"cost_summary": []})

    with patch("app.routers.cost_summary.get_supabase", return_value=fake):
        response = client.get("/cost-summary?group_by=agent")

    assert response.status_code == 200
    rpc_calls = [c for c in fake.recorded_calls if c[0] == "rpc"]
    params = rpc_calls[0][2]
    assert params["p_start"] < params["p_end"]


def test_missing_auth_is_rejected(client):
    app.dependency_overrides.pop(verify_jwt, None)
    response = client.get("/cost-summary")
    assert response.status_code == 401
