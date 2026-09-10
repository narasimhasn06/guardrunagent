"""Endpoint-level tests for GET/POST /rules and POST /rules/starter.

GET /rules isn't part of docs/06-test-plan.md's original scope (the
endpoint itself isn't specified in the LLD's API design, Section 4) --
these mirror the same shape as the other endpoint tests. Disabled-rule
exclusion from *matching* (Section 3.2's actual test case) is covered by
tests/test_guardrails.py and tests/test_guardrail_check_endpoint.py, not
duplicated here -- this file covers listing/creating rules, not the
guardrail-check decision path.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import UUID

from app.auth import RulesAuth, UserAuth, verify_api_key_or_jwt, verify_jwt
from app.main import app
from tests.fakes import FakeSupabase

ORG_ID = "11111111-1111-1111-1111-111111111111"

ENABLED_RULE_ROW = {
    "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "name": "no-force-push-main",
    "pattern_type": "command_regex",
    "pattern_value": "^git push --force",
    "action_on_match": "block",
    "enabled": True,
    "created_at": "2026-09-10T10:00:00+00:00",
}

DISABLED_RULE_ROW = {
    "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "name": "old-custom-rule",
    "pattern_type": "command_regex",
    "pattern_value": "^curl",
    "action_on_match": "flag",
    "enabled": False,
    "created_at": "2026-09-09T10:00:00+00:00",
}


def _override_rules_auth_as_machine() -> None:
    # GET /rules resolves auth via verify_api_key_or_jwt (see app/auth.py),
    # not verify_api_key directly -- that's what FastAPI's dependency
    # injection actually wires to the route, so that's what has to be
    # overridden for the override to take effect.
    app.dependency_overrides[verify_api_key_or_jwt] = lambda: RulesAuth(org_id=UUID(ORG_ID), is_machine=True)


def _override_rules_auth_as_human() -> None:
    app.dependency_overrides[verify_api_key_or_jwt] = lambda: RulesAuth(org_id=UUID(ORG_ID), is_machine=False)


def _override_jwt_auth() -> None:
    app.dependency_overrides[verify_jwt] = lambda: UserAuth(
        auth_user_id=UUID("33333333-3333-3333-3333-333333333333"),
        org_id=UUID(ORG_ID),
        email="jane@example.com",
        role="admin",
    )


class TestGetRules:
    def test_api_key_auth_returns_all_rules_including_disabled(self, client):
        _override_rules_auth_as_machine()
        fake = FakeSupabase(table_data={"guardrail_rules": [ENABLED_RULE_ROW, DISABLED_RULE_ROW]})

        with patch("app.routers.rules.get_supabase", return_value=fake):
            response = client.get("/rules")

        assert response.status_code == 200
        names = [rule["name"] for rule in response.json()["rules"]]
        assert names == ["no-force-push-main", "old-custom-rule"]

    def test_jwt_auth_also_works_on_the_same_path(self, client):
        _override_rules_auth_as_human()
        fake = FakeSupabase(table_data={"guardrail_rules": [ENABLED_RULE_ROW]})

        with patch("app.routers.rules.get_supabase", return_value=fake):
            response = client.get("/rules")

        assert response.status_code == 200
        assert len(response.json()["rules"]) == 1

    def test_empty_result_returns_valid_empty_response_not_error(self, client):
        _override_rules_auth_as_machine()
        fake = FakeSupabase(table_data={"guardrail_rules": []})

        with patch("app.routers.rules.get_supabase", return_value=fake):
            response = client.get("/rules")

        assert response.status_code == 200
        assert response.json() == {"rules": []}

    def test_missing_both_credentials_is_rejected(self, client):
        response = client.get("/rules")
        assert response.status_code == 401


class TestUpdateRule:
    RULE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

    def test_toggles_enabled_for_the_callers_org(self, client):
        _override_jwt_auth()
        updated_row = {**ENABLED_RULE_ROW, "enabled": False}
        fake = FakeSupabase(table_data={"guardrail_rules": {"update": [updated_row]}})

        with patch("app.routers.rules.get_supabase", return_value=fake):
            response = client.patch(f"/rules/{self.RULE_ID}", json={"enabled": False})

        assert response.status_code == 200
        assert response.json()["enabled"] is False

        update_calls = [c for c in fake.recorded_calls if c[0] == "update" and c[1] == "guardrail_rules"]
        assert update_calls == [("update", "guardrail_rules", {"enabled": False})]

    def test_only_sends_the_fields_that_were_actually_set(self, client):
        _override_jwt_auth()
        fake = FakeSupabase(table_data={"guardrail_rules": {"update": [ENABLED_RULE_ROW]}})

        with patch("app.routers.rules.get_supabase", return_value=fake):
            response = client.patch(f"/rules/{self.RULE_ID}", json={"name": "renamed-rule"})

        assert response.status_code == 200
        update_calls = [c for c in fake.recorded_calls if c[0] == "update" and c[1] == "guardrail_rules"]
        assert update_calls == [("update", "guardrail_rules", {"name": "renamed-rule"})]

    def test_empty_body_is_rejected(self, client):
        _override_jwt_auth()
        response = client.patch(f"/rules/{self.RULE_ID}", json={})
        assert response.status_code == 400

    def test_unknown_rule_id_returns_404(self, client):
        _override_jwt_auth()
        fake = FakeSupabase(table_data={"guardrail_rules": {"update": []}})

        with patch("app.routers.rules.get_supabase", return_value=fake):
            response = client.patch(f"/rules/{self.RULE_ID}", json={"enabled": False})

        assert response.status_code == 404

    def test_requires_jwt_auth_not_api_key(self, client):
        response = client.patch(f"/rules/{self.RULE_ID}", json={"enabled": False})
        assert response.status_code == 401


class TestCreateRule:
    def test_creates_a_rule_for_the_callers_org(self, client):
        _override_jwt_auth()
        fake = FakeSupabase(
            table_data={
                "guardrail_rules": [
                    {
                        "id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
                        "name": "no-secrets-in-commits",
                        "pattern_type": "command_regex",
                        "pattern_value": "git commit",
                        "action_on_match": "flag",
                        "enabled": True,
                        "created_at": "2026-09-10T11:00:00+00:00",
                    }
                ]
            }
        )

        with patch("app.routers.rules.get_supabase", return_value=fake):
            response = client.post(
                "/rules",
                json={
                    "name": "no-secrets-in-commits",
                    "pattern_type": "command_regex",
                    "pattern_value": "git commit",
                    "action_on_match": "flag",
                },
            )

        assert response.status_code == 201
        assert response.json()["name"] == "no-secrets-in-commits"

        insert_calls = [c for c in fake.recorded_calls if c[0] == "insert" and c[1] == "guardrail_rules"]
        assert insert_calls[0][2]["org_id"] == ORG_ID
        assert insert_calls[0][2]["enabled"] is True  # default

    def test_requires_jwt_auth_not_api_key(self, client):
        response = client.post(
            "/rules",
            json={
                "name": "x",
                "pattern_type": "command_regex",
                "pattern_value": "x",
                "action_on_match": "block",
            },
        )
        assert response.status_code == 401

    def test_missing_required_field_returns_4xx(self, client):
        _override_jwt_auth()
        response = client.post("/rules", json={"name": "incomplete-rule"})
        assert 400 <= response.status_code < 500


class TestEnableStarterRules:
    def test_creates_the_starter_rules_that_dont_already_exist(self, client):
        _override_jwt_auth()
        fake = FakeSupabase(
            table_data={
                "guardrail_rules": {
                    "select": [{"name": "no-rm-rf"}],  # org already has this one
                    "insert": [
                        {
                            "id": "d0000000-0000-0000-0000-000000000001",
                            "name": "no-force-push-main",
                            "pattern_type": "command_regex",
                            "pattern_value": "x",
                            "action_on_match": "block",
                            "enabled": True,
                            "created_at": "2026-09-10T12:00:00+00:00",
                        },
                        {
                            "id": "d0000000-0000-0000-0000-000000000002",
                            "name": "no-prod-edits",
                            "pattern_type": "path_prefix",
                            "pattern_value": "/prod/",
                            "action_on_match": "block",
                            "enabled": True,
                            "created_at": "2026-09-10T12:00:00+00:00",
                        },
                        {
                            "id": "d0000000-0000-0000-0000-000000000003",
                            "name": "no-env-edits",
                            "pattern_type": "path_prefix",
                            "pattern_value": ".env",
                            "action_on_match": "block",
                            "enabled": True,
                            "created_at": "2026-09-10T12:00:00+00:00",
                        },
                    ],
                }
            }
        )

        with patch("app.routers.rules.get_supabase", return_value=fake):
            response = client.post("/rules/starter")

        assert response.status_code == 201
        created_names = {rule["name"] for rule in response.json()["rules"]}
        assert created_names == {"no-force-push-main", "no-prod-edits", "no-env-edits"}

        insert_calls = [c for c in fake.recorded_calls if c[0] == "insert" and c[1] == "guardrail_rules"]
        inserted_names = {row["name"] for row in insert_calls[0][2]}
        assert "no-rm-rf" not in inserted_names  # already existed -- not recreated

    def test_is_a_no_op_when_all_starter_rules_already_exist(self, client):
        _override_jwt_auth()
        all_starter_names = [
            {"name": "no-force-push-main"},
            {"name": "no-rm-rf"},
            {"name": "no-prod-edits"},
            {"name": "no-env-edits"},
        ]
        fake = FakeSupabase(table_data={"guardrail_rules": {"select": all_starter_names}})

        with patch("app.routers.rules.get_supabase", return_value=fake):
            response = client.post("/rules/starter")

        assert response.status_code == 201
        assert response.json() == {"rules": []}
        assert not any(c[0] == "insert" for c in fake.recorded_calls)

    def test_requires_jwt_auth(self, client):
        response = client.post("/rules/starter")
        assert response.status_code == 401
