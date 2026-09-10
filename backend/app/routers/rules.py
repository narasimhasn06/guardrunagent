from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth import OrgAuth, verify_api_key
from app.db import get_supabase
from app.schemas import RuleOut, RulesOut

router = APIRouter()


@router.get("/rules", response_model=RulesOut)
def get_rules(auth: OrgAuth = Depends(verify_api_key)) -> RulesOut:
    supabase = get_supabase()

    result = (
        supabase.table("guardrail_rules")
        .select("id, name, pattern_type, pattern_value, action_on_match, enabled")
        .eq("org_id", str(auth.org_id))
        .eq("enabled", True)
        .order("created_at")
        .execute()
    )

    return RulesOut(rules=[RuleOut(**row) for row in result.data or []])
