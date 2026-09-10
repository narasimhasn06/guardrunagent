"""Endpoint-level tests for GET /guardrail-activity.

Activity Log tab per docs/04-ui-ux-design.md Section 3.5: "timestamp, rule
name, session link, action taken, whether the Slack alert was successfully
delivered." Not part of docs/06-test-plan.md's original scope (the endpoint
isn't in the LLD's API design -- see the comment in app/schemas.py).
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import UUID

from app.auth import UserAuth, verify_jwt
from app.main import app
from tests.fakes import FakeSupabase

ORG_ID = "11111111-1111-1111-1111-111111111111"
SESSION_ID = "22222222-2222-2222-2222-222222222222"
RULE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

RULE_ROW = {
    "id": RULE_ID,
    "name": "no-force-push-main",
    "action_on_match": "block",
}

ACTIVITY_ROW = {
    "id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
    "fired_at": "2026-09-10T10:00:00+00:00",
    "rule_id": RULE_ID,
    "session_id": SESSION_ID,
    "alert_sent": True,
}


def _override_jwt_auth() -> None:
    app.dependency_overrides[verify_jwt] = lambda: UserAuth(
        auth_user_id=UUID("33333333-3333-3333-3333-333333333333"),
        org_id=UUID(ORG_ID),
        email="jane@example.com",
        role="admin",
    )


def test_returns_activity_joined_with_rule_name_and_action(client):
    _override_jwt_auth()
    fake = FakeSupabase(
        table_data={
            "guardrail_activity": {"data": [ACTIVITY_ROW], "count": 1},
            "guardrail_rules": [RULE_ROW],
        }
    )

    with patch("app.routers.guardrail_activity.get_supabase", return_value=fake):
        response = client.get("/guardrail-activity")

    assert response.status_code == 200
    body = response.json()
    assert body["total_count"] == 1
    assert len(body["activity"]) == 1
    item = body["activity"][0]
    assert item["rule_name"] == "no-force-push-main"
    assert item["action_on_match"] == "block"
    assert item["session_id"] == SESSION_ID
    assert item["alert_sent"] is True


def test_deleted_rule_yields_null_name_and_action_not_an_error(client):
    # rule_id still points at a row that no longer exists in guardrail_rules.
    _override_jwt_auth()
    fake = FakeSupabase(
        table_data={
            "guardrail_activity": {"data": [ACTIVITY_ROW], "count": 1},
            "guardrail_rules": [],
        }
    )

    with patch("app.routers.guardrail_activity.get_supabase", return_value=fake):
        response = client.get("/guardrail-activity")

    assert response.status_code == 200
    item = response.json()["activity"][0]
    assert item["rule_name"] is None
    assert item["action_on_match"] is None


def test_empty_result_returns_valid_empty_response_not_error(client):
    _override_jwt_auth()
    fake = FakeSupabase(table_data={"guardrail_activity": {"data": [], "count": 0}, "guardrail_rules": []})

    with patch("app.routers.guardrail_activity.get_supabase", return_value=fake):
        response = client.get("/guardrail-activity")

    assert response.status_code == 200
    body = response.json()
    assert body["activity"] == []
    assert body["total_count"] == 0


def test_pagination_params_are_forwarded(client):
    _override_jwt_auth()
    fake = FakeSupabase(table_data={"guardrail_activity": {"data": [], "count": 0}, "guardrail_rules": []})

    with patch("app.routers.guardrail_activity.get_supabase", return_value=fake):
        response = client.get("/guardrail-activity?limit=10&offset=20")

    assert response.status_code == 200
    body = response.json()
    assert body["limit"] == 10
    assert body["offset"] == 20


def test_default_limit_and_offset(client):
    _override_jwt_auth()
    fake = FakeSupabase(table_data={"guardrail_activity": {"data": [], "count": 0}, "guardrail_rules": []})

    with patch("app.routers.guardrail_activity.get_supabase", return_value=fake):
        response = client.get("/guardrail-activity")

    body = response.json()
    assert body["limit"] == 50
    assert body["offset"] == 0


def test_missing_auth_is_rejected(client):
    app.dependency_overrides.pop(verify_jwt, None)
    response = client.get("/guardrail-activity")
    assert response.status_code == 401
