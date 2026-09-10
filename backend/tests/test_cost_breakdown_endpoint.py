"""Endpoint-level tests for GET /cost-breakdown.

Not part of docs/06-test-plan.md's original scope (see the comment in
app/schemas.py) -- feeds the Cost Dashboard's stacked bar chart.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import UUID

from app.auth import UserAuth, verify_jwt
from app.main import app
from tests.fakes import FakeSupabase

ORG_ID = "11111111-1111-1111-1111-111111111111"


def _override_jwt_auth() -> None:
    app.dependency_overrides[verify_jwt] = lambda: UserAuth(
        auth_user_id=UUID("33333333-3333-3333-3333-333333333333"),
        org_id=UUID(ORG_ID),
        email="jane@example.com",
        role="admin",
    )


def test_returns_long_format_rows_by_project(client):
    _override_jwt_auth()
    fake = FakeSupabase(
        rpc_data={
            "cost_breakdown_by_day": [
                {"day": "2026-09-08", "group_key": "repo-a", "cost_usd": "1.00"},
                {"day": "2026-09-08", "group_key": "repo-b", "cost_usd": "0.50"},
                {"day": "2026-09-09", "group_key": "repo-a", "cost_usd": "0.75"},
            ]
        }
    )

    with patch("app.routers.cost_summary.get_supabase", return_value=fake):
        response = client.get("/cost-breakdown?dimension=project")

    assert response.status_code == 200
    body = response.json()
    assert body["dimension"] == "project"
    assert len(body["rows"]) == 3
    assert body["rows"][0] == {"day": "2026-09-08", "group_key": "repo-a", "cost_usd": "1.00"}


def test_forwards_dimension_and_range_to_the_rpc(client):
    _override_jwt_auth()
    fake = FakeSupabase(rpc_data={"cost_breakdown_by_day": []})

    with patch("app.routers.cost_summary.get_supabase", return_value=fake):
        response = client.get(
            "/cost-breakdown?dimension=agent&start=2026-09-01T00:00:00Z&end=2026-09-10T00:00:00Z"
        )

    assert response.status_code == 200
    rpc_calls = [c for c in fake.recorded_calls if c[0] == "rpc"]
    params = rpc_calls[0][2]
    assert params["p_org_id"] == ORG_ID
    assert params["p_dimension"] == "agent"
    assert params["p_start"].startswith("2026-09-01")
    assert params["p_end"].startswith("2026-09-10")


def test_missing_dimension_is_rejected(client):
    _override_jwt_auth()
    response = client.get("/cost-breakdown")
    assert response.status_code == 422


def test_invalid_dimension_is_rejected(client):
    _override_jwt_auth()
    response = client.get("/cost-breakdown?dimension=day")  # 'day' isn't a valid breakdown dimension
    assert response.status_code == 422


def test_empty_result_returns_valid_empty_response_not_error(client):
    _override_jwt_auth()
    fake = FakeSupabase(rpc_data={"cost_breakdown_by_day": []})

    with patch("app.routers.cost_summary.get_supabase", return_value=fake):
        response = client.get("/cost-breakdown?dimension=project")

    assert response.status_code == 200
    assert response.json()["rows"] == []


def test_start_after_end_is_rejected(client):
    _override_jwt_auth()
    response = client.get(
        "/cost-breakdown?dimension=project&start=2026-09-10T00:00:00Z&end=2026-09-01T00:00:00Z"
    )
    assert response.status_code == 400


def test_missing_auth_is_rejected(client):
    app.dependency_overrides.pop(verify_jwt, None)
    response = client.get("/cost-breakdown?dimension=project")
    assert response.status_code == 401
