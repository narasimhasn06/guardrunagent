from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import RulesAuth, UserAuth, verify_api_key_or_jwt, verify_jwt
from app.db import get_supabase, maybe_single_result
from app.schemas import RuleCreateIn, RuleOut, RulesOut, RuleUpdateIn
from app.starter_rules import STARTER_RULES

router = APIRouter()


@router.get("/rules", response_model=RulesOut)
def get_rules(auth: RulesAuth = Depends(verify_api_key_or_jwt)) -> RulesOut:
    """Also returns the org's fail_mode (orgs.fail_mode) alongside the
    rules -- this is the one call the SDK already makes on a 5-minute
    poll (sdk/src/ruleCache.ts) to refresh its local rule cache, so it
    piggybacks the fail-open/fail-closed setting onto the same response
    rather than adding a second network round-trip for it.
    """
    supabase = get_supabase()

    result = (
        supabase.table("guardrail_rules")
        .select("id, name, pattern_type, pattern_value, action_on_match, enabled, created_at")
        .eq("org_id", str(auth.org_id))
        .order("created_at")
        .execute()
    )

    org_row = maybe_single_result(supabase.table("orgs").select("fail_mode").eq("id", str(auth.org_id)).maybe_single())
    fail_mode = (org_row.data or {}).get("fail_mode", "open")

    return RulesOut(rules=[RuleOut(**row) for row in result.data or []], fail_mode=fail_mode)


@router.patch("/rules/{rule_id}", response_model=RuleOut)
def update_rule(rule_id: UUID, body: RuleUpdateIn, auth: UserAuth = Depends(verify_jwt)) -> RuleOut:
    supabase = get_supabase()

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    result = (
        supabase.table("guardrail_rules")
        .update(updates)
        .eq("id", str(rule_id))
        .eq("org_id", str(auth.org_id))  # never let one org edit another's rule
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")

    return RuleOut(**result.data[0])


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
