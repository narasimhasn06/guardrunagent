from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth import UserAuth, verify_jwt
from app.db import get_supabase
from app.schemas import DashboardSummaryOut, RecentActivityItem, SpendByDayRow

router = APIRouter()

DEFAULT_RANGE_DAYS = 7  # docs/04-ui-ux-design.md Section 3.1: "default: last 7 days"
RECENT_ACTIVITY_LIMIT = 10


@router.get("/dashboard-summary", response_model=DashboardSummaryOut)
def get_dashboard_summary(
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    auth: UserAuth = Depends(verify_jwt),
) -> DashboardSummaryOut:
    range_end = end or datetime.now(timezone.utc)
    range_start = start or (range_end - timedelta(days=DEFAULT_RANGE_DAYS))

    if range_start >= range_end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start must be before end")

    supabase = get_supabase()
    org_id = str(auth.org_id)

    org_result = supabase.table("orgs").select("name").eq("id", org_id).maybe_single().execute()
    org_name = (org_result.data or {}).get("name", "")

    sessions_result = (
        supabase.table("sessions")
        .select("id, agent_name", count="exact")
        .eq("org_id", org_id)
        .gte("started_at", range_start.isoformat())
        .lt("started_at", range_end.isoformat())
        .execute()
    )
    total_sessions = sessions_result.count or 0
    active_agents = len({row["agent_name"] for row in sessions_result.data or []})

    blocks_result = (
        supabase.table("agent_events")
        .select("id", count="exact")
        .eq("org_id", org_id)
        .eq("status", "blocked")
        .gte("created_at", range_start.isoformat())
        .lt("created_at", range_end.isoformat())
        .execute()
    )
    guardrail_blocks = blocks_result.count or 0

    # Reuses the cost_summary RPC (already built for GET /cost-summary)
    # rather than a second aggregation function -- day-grouped rows serve
    # directly as the spend chart's data, and summing them in Python gives
    # the total-spend stat card without a separate query.
    spend_result = supabase.rpc(
        "cost_summary",
        {
            "p_org_id": org_id,
            "p_group_by": "day",
            "p_start": range_start.isoformat(),
            "p_end": range_end.isoformat(),
        },
    ).execute()
    spend_by_day = [
        SpendByDayRow(date=row["group_key"], cost_usd=row["total_cost_usd"]) for row in spend_result.data or []
    ]
    total_spend_usd = sum((row.cost_usd for row in spend_by_day), Decimal("0"))

    activity_result = (
        supabase.table("agent_events")
        .select("id, session_id, action_type, action_summary, status, created_at")
        .eq("org_id", org_id)
        .gte("created_at", range_start.isoformat())
        .lt("created_at", range_end.isoformat())
        .order("created_at", desc=True)
        .limit(RECENT_ACTIVITY_LIMIT)
        .execute()
    )
    recent_activity = [RecentActivityItem(**row) for row in activity_result.data or []]

    # Unscoped by date range on purpose -- see the field's docstring in
    # app/schemas.py.
    any_session_result = (
        supabase.table("sessions").select("id", count="exact").eq("org_id", org_id).limit(1).execute()
    )
    org_has_any_sessions = bool(any_session_result.count)

    return DashboardSummaryOut(
        org_name=org_name,
        start=range_start,
        end=range_end,
        total_sessions=total_sessions,
        total_spend_usd=total_spend_usd,
        guardrail_blocks=guardrail_blocks,
        active_agents=active_agents,
        spend_by_day=spend_by_day,
        recent_activity=recent_activity,
        org_has_any_sessions=org_has_any_sessions,
    )
