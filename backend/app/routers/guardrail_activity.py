from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.auth import UserAuth, verify_jwt
from app.db import get_supabase
from app.schemas import GuardrailActivityItem, GuardrailActivityOut

router = APIRouter()

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


@router.get("/guardrail-activity", response_model=GuardrailActivityOut)
def list_guardrail_activity(
    limit: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
    auth: UserAuth = Depends(verify_jwt),
) -> GuardrailActivityOut:
    """Activity Log tab (docs/04-ui-ux-design.md Section 3.5). Joins rule
    name/action_on_match onto each firing in Python rather than a new
    Postgres function: guardrail_rules is a small, org-scoped set (the
    LLD's own "curated, not a full policy DSL" framing), so fetching it
    once and joining in-process is simpler than a function for this.
    """
    supabase = get_supabase()
    org_id = str(auth.org_id)

    activity_result = (
        supabase.table("guardrail_activity")
        .select("id, fired_at, rule_id, session_id, alert_sent", count="exact")
        .eq("org_id", org_id)
        .order("fired_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    rows = activity_result.data or []

    rules_result = (
        supabase.table("guardrail_rules").select("id, name, action_on_match").eq("org_id", org_id).execute()
    )
    rules_by_id = {rule["id"]: rule for rule in rules_result.data or []}

    activity = [
        GuardrailActivityItem(
            id=row["id"],
            fired_at=row["fired_at"],
            rule_id=row["rule_id"],
            rule_name=(rules_by_id.get(row["rule_id"]) or {}).get("name"),
            action_on_match=(rules_by_id.get(row["rule_id"]) or {}).get("action_on_match"),
            session_id=row["session_id"],
            alert_sent=row["alert_sent"],
        )
        for row in rows
    ]

    return GuardrailActivityOut(
        activity=activity,
        total_count=activity_result.count or 0,
        limit=limit,
        offset=offset,
    )
