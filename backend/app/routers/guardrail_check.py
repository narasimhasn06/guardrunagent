from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends

from app.alerting import dispatch_guardrail_alert
from app.auth import OrgAuth, verify_api_key
from app.config import get_settings
from app.db import get_supabase
from app.guardrails import match_rule
from app.schemas import GuardrailCheckIn, GuardrailCheckOut

router = APIRouter()


@router.post("/guardrail-check", response_model=GuardrailCheckOut)
def post_guardrail_check(
    body: GuardrailCheckIn,
    background_tasks: BackgroundTasks,
    auth: OrgAuth = Depends(verify_api_key),
) -> GuardrailCheckOut:
    supabase = get_supabase()

    rules_result = (
        supabase.table("guardrail_rules")
        .select("*")
        .eq("org_id", str(auth.org_id))
        .eq("enabled", True)
        .order("created_at")
        .execute()
    )
    matched = match_rule(
        action_type=body.action_type,
        action_summary=body.action_summary,
        rules=rules_result.data or [],
    )

    if matched is None:
        return GuardrailCheckOut(decision="allow")

    decision = matched["action_on_match"]  # 'block' | 'flag'

    # event_id is left null: the agent_events row for this action is logged
    # asynchronously by the SDK *after* this check returns (the async
    # logging path in docs/02-high-level-design.md Section 3), so there's
    # no event row yet to link to. guardrail_activity.event_id is
    # nullable, so this doesn't violate the FK -- but nothing currently
    # backfills it once the event is logged. Flagged as an open gap.
    #
    # session_id *is* recorded, though -- it's what the Activity Log
    # (docs/04-ui-ux-design.md Section 3.5) links to.
    activity = (
        supabase.table("guardrail_activity")
        .insert(
            {
                "rule_id": str(matched["id"]),
                "event_id": None,
                "session_id": str(body.session_id),
                "org_id": str(auth.org_id),
                "alert_sent": False,
            }
        )
        .execute()
    )
    activity_id = activity.data[0]["id"]

    org_row = (
        supabase.table("orgs")
        .select("slack_webhook_url")
        .eq("id", str(auth.org_id))
        .maybe_single()
        .execute()
    )
    slack_webhook_url = (org_row.data or {}).get("slack_webhook_url")

    background_tasks.add_task(
        dispatch_guardrail_alert,
        activity_id=activity_id,
        slack_webhook_url=slack_webhook_url,
        rule_name=matched["name"],
        action_summary=body.action_summary,
        decision=decision,
        session_id=str(body.session_id),
        dashboard_url=get_settings().dashboard_url,
    )

    return GuardrailCheckOut(decision=decision, rule_id=matched["id"], rule_name=matched["name"])
