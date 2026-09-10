from __future__ import annotations

import httpx

from app.db import get_supabase


def post_to_slack(webhook_url: str, text: str) -> bool:
    """Posts a message to a Slack incoming webhook, retrying once on
    failure (docs/03-low-level-design.md Section 5). Shared by the
    guardrail alert path below and the Settings page's "send test alert"
    button (app/routers/settings.py) -- both are "deliver one message to
    one webhook URL," just triggered differently.
    """
    for _attempt in range(2):  # initial attempt + one retry
        try:
            response = httpx.post(webhook_url, json={"text": text}, timeout=5.0)
            if response.status_code < 300:
                return True
        except httpx.HTTPError:
            continue
    return False


def dispatch_guardrail_alert(
    *,
    activity_id: str,
    slack_webhook_url: str | None,
    rule_name: str,
    action_summary: str | None,
    decision: str,
    session_id: str,
    dashboard_url: str | None = None,
) -> None:
    """Runs as a FastAPI background task so it never delays the
    guardrail-check response (docs/03-low-level-design.md Section 4.2:
    "async-dispatch to alerting service").

    Retries once on failure; alert_sent is recorded either way so the
    block/flag itself is never lost from the audit trail even if the
    webhook delivery failed (Section 5).
    """
    if not slack_webhook_url:
        return  # org has no Slack integration configured -- nothing to send

    verb = "blocked" if decision == "block" else "flagged"
    text = f":no_entry: GuardrunAgent {verb} an action: `{action_summary or 'unknown action'}` (Rule: {rule_name})"
    if dashboard_url:
        # DASHBOARD_URL isn't set until the dashboard is actually deployed
        # (no fixed URL exists in the docs yet) -- omit the link until then
        # rather than send a broken one.
        text += f" — <{dashboard_url.rstrip('/')}/sessions/{session_id}|Session>"

    sent = post_to_slack(slack_webhook_url, text)

    supabase = get_supabase()
    supabase.table("guardrail_activity").update({"alert_sent": sent}).eq("id", activity_id).execute()
