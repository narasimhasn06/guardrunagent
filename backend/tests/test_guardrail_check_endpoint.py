"""Endpoint-level tests for POST /guardrail-check.

Cases per docs/06-test-plan.md Section 3.2 ("Backend -> POST
/guardrail-check") and Section 4 (integration: "SDK triggers a guardrail
check..." and "Guardrail block fires -> Slack alert dispatched").
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID

import httpx

from app.auth import OrgAuth, verify_api_key
from app.main import app
from tests.fakes import FakeSupabase

ORG_ID = "11111111-1111-1111-1111-111111111111"
SESSION_ID = "22222222-2222-2222-2222-222222222222"

FORCE_PUSH_RULE = {
    "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "name": "no-force-push-main",
    "pattern_type": "command_regex",
    "pattern_value": r"^git push --force",
    "action_on_match": "block",
    "enabled": True,
}

PROD_EDIT_FLAG_RULE = {
    "id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
    "name": "review-prod-edits",
    "pattern_type": "path_prefix",
    "pattern_value": "/prod/",
    "action_on_match": "flag",
    "enabled": True,
}


def _override_org_auth() -> None:
    app.dependency_overrides[verify_api_key] = lambda: OrgAuth(org_id=UUID(ORG_ID))


def _fake_settings(dashboard_url: str | None = None) -> SimpleNamespace:
    # Only .dashboard_url is read by the router; a full Settings() would
    # also require the three Supabase env vars, which aren't set in tests.
    return SimpleNamespace(dashboard_url=dashboard_url)


class FakeSlackResponse:
    status_code = 200


def test_matching_rule_returns_the_right_decision_and_rule_id(client):
    _override_org_auth()
    fake = FakeSupabase(
        table_data={
            "guardrail_rules": [FORCE_PUSH_RULE],
            "guardrail_activity": {"data": [{"id": "activity-1"}]},
            "orgs": {"slack_webhook_url": None},
        }
    )

    with (
        patch("app.routers.guardrail_check.get_supabase", return_value=fake),
        patch("app.routers.guardrail_check.get_settings", return_value=_fake_settings()),
    ):
        response = client.post(
            "/guardrail-check",
            json={
                "session_id": SESSION_ID,
                "action_type": "bash",
                "action_summary": "git push --force origin main",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["decision"] == "block"
    assert body["rule_id"] == FORCE_PUSH_RULE["id"]
    assert body["rule_name"] == "no-force-push-main"


def test_matching_rule_records_the_session_id_on_the_activity_row(client):
    # session_id links the Activity Log (docs/04-ui-ux-design.md Section
    # 3.5) firing back to its session.
    _override_org_auth()
    fake = FakeSupabase(
        table_data={
            "guardrail_rules": [FORCE_PUSH_RULE],
            "guardrail_activity": {"data": [{"id": "activity-1"}]},
            "orgs": {"slack_webhook_url": None},
        }
    )

    with (
        patch("app.routers.guardrail_check.get_supabase", return_value=fake),
        patch("app.routers.guardrail_check.get_settings", return_value=_fake_settings()),
    ):
        client.post(
            "/guardrail-check",
            json={
                "session_id": SESSION_ID,
                "action_type": "bash",
                "action_summary": "git push --force origin main",
            },
        )

    insert_calls = [c for c in fake.recorded_calls if c[0] == "insert" and c[1] == "guardrail_activity"]
    assert insert_calls[0][2]["session_id"] == SESSION_ID


def test_no_rule_match_returns_allow(client):
    _override_org_auth()
    fake = FakeSupabase(table_data={"guardrail_rules": []})

    with patch("app.routers.guardrail_check.get_supabase", return_value=fake):
        response = client.post(
            "/guardrail-check",
            json={"session_id": SESSION_ID, "action_type": "bash", "action_summary": "npm install"},
        )

    assert response.status_code == 200
    assert response.json() == {"decision": "allow", "rule_id": None, "rule_name": None}
    assert not any(c[0] == "insert" for c in fake.recorded_calls)  # no activity row for a non-match


def test_disabled_rules_are_never_matched(client):
    # The real query filters .eq("enabled", True) server-side, so a
    # disabled rule would never appear in rules_result.data -- this
    # mirrors that by returning an empty set even though a (disabled)
    # rule exists conceptually.
    _override_org_auth()
    fake = FakeSupabase(table_data={"guardrail_rules": []})

    with patch("app.routers.guardrail_check.get_supabase", return_value=fake):
        response = client.post(
            "/guardrail-check",
            json={"session_id": SESSION_ID, "action_type": "bash", "action_summary": "rm -rf /"},
        )

    assert response.json()["decision"] == "allow"


def test_missing_session_id_returns_4xx(client):
    _override_org_auth()
    response = client.post(
        "/guardrail-check",
        json={"action_type": "bash", "action_summary": "npm install"},
    )
    assert 400 <= response.status_code < 500


def test_flagged_action_also_dispatches_a_slack_alert(client):
    # docs/03-low-level-design.md Section 4.2: "On block or flag:
    # async-dispatch to alerting service" -- a flag isn't just a silent
    # log entry, it alerts the same as a block.
    _override_org_auth()
    fake = FakeSupabase(
        table_data={
            "guardrail_rules": [PROD_EDIT_FLAG_RULE],
            "guardrail_activity": {"data": [{"id": "activity-1"}]},
            "orgs": {"slack_webhook_url": "https://hooks.slack.example/services/xyz"},
        }
    )

    with (
        patch("app.routers.guardrail_check.get_supabase", return_value=fake),
        patch("app.routers.guardrail_check.get_settings", return_value=_fake_settings()),
        patch("app.alerting.get_supabase", return_value=fake),
        patch("app.alerting.httpx.post", return_value=FakeSlackResponse()) as slack_post,
    ):
        response = client.post(
            "/guardrail-check",
            json={
                "session_id": SESSION_ID,
                "action_type": "file_edit",
                "action_summary": "edited /prod/config.yaml",
            },
        )

    assert response.status_code == 200
    assert response.json()["decision"] == "flag"
    slack_post.assert_called_once()
    assert "flagged" in slack_post.call_args.kwargs["json"]["text"]
    update_calls = [c for c in fake.recorded_calls if c[0] == "update" and c[1] == "guardrail_activity"]
    assert update_calls == [("update", "guardrail_activity", {"alert_sent": True})]


def test_blocked_action_dispatches_slack_alert_and_records_success(client):
    _override_org_auth()
    fake = FakeSupabase(
        table_data={
            "guardrail_rules": [FORCE_PUSH_RULE],
            "guardrail_activity": {"data": [{"id": "activity-1"}]},
            "orgs": {"slack_webhook_url": "https://hooks.slack.example/services/xyz"},
        }
    )

    with (
        patch("app.routers.guardrail_check.get_supabase", return_value=fake),
        patch("app.routers.guardrail_check.get_settings", return_value=_fake_settings()),
        patch("app.alerting.get_supabase", return_value=fake),
        patch("app.alerting.httpx.post", return_value=FakeSlackResponse()) as slack_post,
    ):
        response = client.post(
            "/guardrail-check",
            json={
                "session_id": SESSION_ID,
                "action_type": "bash",
                "action_summary": "git push --force origin main",
            },
        )

    assert response.status_code == 200
    slack_post.assert_called_once()
    sent_text = slack_post.call_args.kwargs["json"]["text"]
    assert "Session" not in sent_text  # no dashboard_url configured -> no link
    update_calls = [c for c in fake.recorded_calls if c[0] == "update" and c[1] == "guardrail_activity"]
    assert update_calls == [("update", "guardrail_activity", {"alert_sent": True})]


def test_slack_message_includes_session_link_when_dashboard_url_configured(client):
    _override_org_auth()
    fake = FakeSupabase(
        table_data={
            "guardrail_rules": [FORCE_PUSH_RULE],
            "guardrail_activity": {"data": [{"id": "activity-1"}]},
            "orgs": {"slack_webhook_url": "https://hooks.slack.example/services/xyz"},
        }
    )

    with (
        patch("app.routers.guardrail_check.get_supabase", return_value=fake),
        patch(
            "app.routers.guardrail_check.get_settings",
            return_value=_fake_settings(dashboard_url="https://app.guardrunagent.example"),
        ),
        patch("app.alerting.get_supabase", return_value=fake),
        patch("app.alerting.httpx.post", return_value=FakeSlackResponse()) as slack_post,
    ):
        response = client.post(
            "/guardrail-check",
            json={
                "session_id": SESSION_ID,
                "action_type": "bash",
                "action_summary": "git push --force origin main",
            },
        )

    assert response.status_code == 200
    sent_text = slack_post.call_args.kwargs["json"]["text"]
    assert f"https://app.guardrunagent.example/sessions/{SESSION_ID}" in sent_text


def test_slack_failure_still_records_the_block_with_alert_sent_false(client):
    # docs/03-low-level-design.md Section 5: a failed webhook must never
    # lose the block/flag itself from the audit trail.
    _override_org_auth()
    fake = FakeSupabase(
        table_data={
            "guardrail_rules": [FORCE_PUSH_RULE],
            "guardrail_activity": {"data": [{"id": "activity-1"}]},
            "orgs": {"slack_webhook_url": "https://hooks.slack.example/services/xyz"},
        }
    )

    with (
        patch("app.routers.guardrail_check.get_supabase", return_value=fake),
        patch("app.routers.guardrail_check.get_settings", return_value=_fake_settings()),
        patch("app.alerting.get_supabase", return_value=fake),
        patch("app.alerting.httpx.post", side_effect=httpx.ConnectError("boom")),
    ):
        response = client.post(
            "/guardrail-check",
            json={
                "session_id": SESSION_ID,
                "action_type": "bash",
                "action_summary": "git push --force origin main",
            },
        )

    assert response.status_code == 200  # the check itself never fails because Slack is down
    update_calls = [c for c in fake.recorded_calls if c[0] == "update" and c[1] == "guardrail_activity"]
    assert update_calls == [("update", "guardrail_activity", {"alert_sent": False})]


def test_missing_api_key_is_rejected(client):
    app.dependency_overrides.pop(verify_api_key, None)
    response = client.post(
        "/guardrail-check",
        json={"session_id": SESSION_ID, "action_type": "bash", "action_summary": "ls"},
    )
    assert response.status_code == 401
