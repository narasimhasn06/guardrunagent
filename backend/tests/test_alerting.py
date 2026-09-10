"""Direct unit tests for app.alerting.dispatch_guardrail_alert.

docs/03-low-level-design.md Section 5:
- Triggered from guardrail-check when decision is block or flag.
- Formats a Slack message via the org's stored webhook URL.
- Retries once on Slack API failure.
- Logs failure to guardrail_activity.alert_sent = false for visibility
  in the dashboard even if the webhook itself failed.

These call dispatch_guardrail_alert directly rather than going through
POST /guardrail-check (already covered at the endpoint level in
tests/test_guardrail_check_endpoint.py) so the retry/failure paths get
focused, thorough coverage without the rest of the request stack.
"""

from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from app.alerting import dispatch_guardrail_alert
from tests.fakes import FakeSupabase

ACTIVITY_ID = "activity-1"
WEBHOOK_URL = "https://hooks.slack.example/services/xyz"
SESSION_ID = "22222222-2222-2222-2222-222222222222"


class FakeSlackResponse:
    def __init__(self, status_code: int):
        self.status_code = status_code


def _call(
    *,
    slack_webhook_url: str | None = WEBHOOK_URL,
    decision: str = "block",
    action_summary: str | None = "git push --force origin main",
    rule_name: str = "no-force-push-main",
    dashboard_url: str | None = None,
):
    dispatch_guardrail_alert(
        activity_id=ACTIVITY_ID,
        slack_webhook_url=slack_webhook_url,
        rule_name=rule_name,
        action_summary=action_summary,
        decision=decision,
        session_id=SESSION_ID,
        dashboard_url=dashboard_url,
    )


def test_no_webhook_configured_sends_nothing_and_leaves_alert_sent_untouched():
    fake = FakeSupabase()

    with (
        patch("app.alerting.get_supabase", return_value=fake),
        patch("app.alerting.httpx.post") as post,
    ):
        _call(slack_webhook_url=None)

    post.assert_not_called()
    # guardrail_check.py inserts the activity row with alert_sent=False
    # already -- nothing to send means nothing to update.
    assert not any(c[0] == "update" for c in fake.recorded_calls)


def test_successful_first_attempt_sends_once_and_records_alert_sent_true():
    fake = FakeSupabase()

    with (
        patch("app.alerting.get_supabase", return_value=fake),
        patch("app.alerting.httpx.post", return_value=FakeSlackResponse(200)) as post,
    ):
        _call()

    assert post.call_count == 1  # no retry needed on first-attempt success
    update_calls = [c for c in fake.recorded_calls if c[0] == "update" and c[1] == "guardrail_activity"]
    assert update_calls == [("update", "guardrail_activity", {"alert_sent": True})]


def test_first_attempt_fails_second_attempt_succeeds():
    fake = FakeSupabase()

    with (
        patch("app.alerting.get_supabase", return_value=fake),
        patch(
            "app.alerting.httpx.post",
            side_effect=[FakeSlackResponse(500), FakeSlackResponse(200)],
        ) as post,
    ):
        _call()

    assert post.call_count == 2
    update_calls = [c for c in fake.recorded_calls if c[0] == "update" and c[1] == "guardrail_activity"]
    assert update_calls == [("update", "guardrail_activity", {"alert_sent": True})]


def test_both_attempts_fail_records_alert_sent_false():
    fake = FakeSupabase()

    with (
        patch("app.alerting.get_supabase", return_value=fake),
        patch("app.alerting.httpx.post", return_value=FakeSlackResponse(500)) as post,
    ):
        _call()

    assert post.call_count == 2  # one retry, per Section 5 -- then gives up
    update_calls = [c for c in fake.recorded_calls if c[0] == "update" and c[1] == "guardrail_activity"]
    assert update_calls == [("update", "guardrail_activity", {"alert_sent": False})]


def test_network_exception_on_both_attempts_records_alert_sent_false():
    fake = FakeSupabase()

    with (
        patch("app.alerting.get_supabase", return_value=fake),
        patch("app.alerting.httpx.post", side_effect=httpx.ConnectError("boom")) as post,
    ):
        _call()

    assert post.call_count == 2
    update_calls = [c for c in fake.recorded_calls if c[0] == "update" and c[1] == "guardrail_activity"]
    assert update_calls == [("update", "guardrail_activity", {"alert_sent": False})]


def test_mixed_exception_then_success_still_recovers():
    fake = FakeSupabase()

    with (
        patch("app.alerting.get_supabase", return_value=fake),
        patch(
            "app.alerting.httpx.post",
            side_effect=[httpx.ConnectError("boom"), FakeSlackResponse(200)],
        ),
    ):
        _call()

    update_calls = [c for c in fake.recorded_calls if c[0] == "update" and c[1] == "guardrail_activity"]
    assert update_calls == [("update", "guardrail_activity", {"alert_sent": True})]


@pytest.mark.parametrize(
    ("decision", "expected_verb"),
    [("block", "blocked"), ("flag", "flagged")],
)
def test_message_wording_matches_the_decision(decision: str, expected_verb: str):
    fake = FakeSupabase()

    with (
        patch("app.alerting.get_supabase", return_value=fake),
        patch("app.alerting.httpx.post", return_value=FakeSlackResponse(200)) as post,
    ):
        _call(decision=decision)

    sent_text = post.call_args.kwargs["json"]["text"]
    assert expected_verb in sent_text


def test_missing_action_summary_falls_back_to_placeholder_text():
    fake = FakeSupabase()

    with (
        patch("app.alerting.get_supabase", return_value=fake),
        patch("app.alerting.httpx.post", return_value=FakeSlackResponse(200)) as post,
    ):
        _call(action_summary=None)

    sent_text = post.call_args.kwargs["json"]["text"]
    assert "unknown action" in sent_text


def test_rule_name_is_included_in_the_message():
    fake = FakeSupabase()

    with (
        patch("app.alerting.get_supabase", return_value=fake),
        patch("app.alerting.httpx.post", return_value=FakeSlackResponse(200)) as post,
    ):
        _call(rule_name="no-rm-rf")

    assert "no-rm-rf" in post.call_args.kwargs["json"]["text"]
