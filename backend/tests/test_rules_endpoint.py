"""Endpoint-level tests for GET /rules.

Not part of docs/06-test-plan.md's original scope (the endpoint itself
isn't specified in the LLD's API design, Section 4 -- see the comment in
app/schemas.py) -- these mirror the same shape as the other endpoint
tests: auth resolution, org scoping, and an empty-result case.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import UUID

from app.auth import OrgAuth, verify_api_key
from app.main import app
from tests.fakes import FakeSupabase

ORG_ID = "11111111-1111-1111-1111-111111111111"

RULE_ROW = {
    "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "name": "no-force-push-main",
    "pattern_type": "command_regex",
    "pattern_value": "^git push --force",
    "action_on_match": "block",
    "enabled": True,
}


def _override_org_auth() -> None:
    app.dependency_overrides[verify_api_key] = lambda: OrgAuth(org_id=UUID(ORG_ID))


def test_returns_the_orgs_enabled_rules(client):
    _override_org_auth()
    fake = FakeSupabase(table_data={"guardrail_rules": [RULE_ROW]})

    with patch("app.routers.rules.get_supabase", return_value=fake):
        response = client.get("/rules")

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "rules": [
            {
                "id": RULE_ROW["id"],
                "name": "no-force-push-main",
                "pattern_type": "command_regex",
                "pattern_value": "^git push --force",
                "action_on_match": "block",
                "enabled": True,
            }
        ]
    }


def test_empty_result_returns_valid_empty_response_not_error(client):
    _override_org_auth()
    fake = FakeSupabase(table_data={"guardrail_rules": []})

    with patch("app.routers.rules.get_supabase", return_value=fake):
        response = client.get("/rules")

    assert response.status_code == 200
    assert response.json() == {"rules": []}


def test_missing_api_key_is_rejected(client):
    app.dependency_overrides.pop(verify_api_key, None)
    response = client.get("/rules")
    assert response.status_code == 401
