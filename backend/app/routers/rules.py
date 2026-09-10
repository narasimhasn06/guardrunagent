from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth import RulesAuth, UserAuth, verify_api_key_or_jwt, verify_jwt
from app.db import get_supabase
from app.schemas import RuleCreateIn, RuleOut, RulesOut
from app.starter_rules import STARTER_RULES

router = APIRouter()


@router.get("/rules", response_model=RulesOut)
def get_rules(auth: RulesAuth = Depends(verify_api_key_or_jwt)) -> RulesOut:
    supabase = get_supabase()

    result = (
        supabase.table("guardrail_rules")
        .select("id, name, pattern_type, pattern_value, action_on_match, enabled, created_at")
        .eq("org_id", str(auth.org_id))
        .order("created_at")
        .execute()
    )

    return RulesOut(rules=[RuleOut(**row) for row in result.data or []])


@router.post("/rules", response_model=RuleOut, status_code=201)
def create_rule(body: RuleCreateIn, auth: UserAuth = Depends(verify_jwt)) -> RuleOut:
    supabase = get_supabase()

    result = (
        supabase.table("guardrail_rules")
        .insert(
            {
                "org_id": str(auth.org_id),
                "name": body.name,
                "pattern_type": body.pattern_type,
                "pattern_value": body.pattern_value,
                "action_on_match": body.action_on_match,
                "enabled": body.enabled,
            }
        )
        .execute()
    )

    return RuleOut(**result.data[0])


@router.post("/rules/starter", response_model=RulesOut, status_code=201)
def enable_starter_rules(auth: UserAuth = Depends(verify_jwt)) -> RulesOut:
    """One-click enable of the pre-built starter set
    (docs/04-ui-ux-design.md Section 3.5 and the first-time-setup flow in
    Section 4.1). Idempotent by rule name: only inserts starter rules the
    org doesn't already have, so clicking it twice (or having already
    customized/disabled a starter rule) doesn't create duplicates or
    silently re-enable something the user turned off.
    """
    supabase = get_supabase()

    existing = (
        supabase.table("guardrail_rules")
        .select("name")
        .eq("org_id", str(auth.org_id))
        .execute()
    )
    existing_names = {row["name"] for row in existing.data or []}

    to_create = [rule for rule in STARTER_RULES if rule["name"] not in existing_names]
    if not to_create:
        return RulesOut(rules=[])

    rows = [{**rule, "org_id": str(auth.org_id), "enabled": True} for rule in to_create]
    result = supabase.table("guardrail_rules").insert(rows).execute()

    return RulesOut(rules=[RuleOut(**row) for row in result.data or []])
