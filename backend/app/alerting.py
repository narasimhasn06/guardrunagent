from __future__ import annotations

import httpx

from app.db import get_supabase


def dispatch_guardrail_alert(
    *,
    activity_id: str,
    slack_webhook_url: str | None,
    rule_name: str,
    action_summary: str | None,
    decision: str,
) -> None:
    """Runs as a FastAPI background task so it never delays the
    guardrail-check response (docs/03-low-level-design.md Section 4.2:
    "async-dispatch to alerting service").

    Retries once on failure; alert_sent is recorded either way so the
    block/flag itself is never lost from the audit trail even if the
    webhook delivery failed (Section 5).

    Note: Section 5's example Slack message includes a "Session [link]",
    but POST /guardrail-check's documented request (Section 4.2) carries no
    session_id -- there's nothing to link to here. Flagged gap; the message
    below omits the link.
    """
    if not slack_webhook_url:
        return  # org has no Slack integration configured -- nothing to send

    verb = "blocked" if decision == "block" else "flagged"
    text = f":no_entry: GuardrunAgent {verb} an action: `{action_summary or 'unknown action'}` (Rule: {rule_name})"

    sent = False
    for _attempt in range(2):  # initial attempt + one retry, per Section 5
        try:
            response = httpx.post(slack_webhook_url, json={"text": text}, timeout=5.0)
            if response.status_code < 300:
                sent = True
                break
        except httpx.HTTPError:
            continue

    supabase = get_supabase()
    supabase.table("guardrail_activity").update({"alert_sent": sent}).eq("id", activity_id).execute()
