from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth import UserAuth, verify_jwt
from app.db import get_supabase
from app.schemas import (
    BreakdownDimension,
    CostBreakdownOut,
    CostBreakdownRow,
    CostSummaryOut,
    CostSummaryRow,
    GroupBy,
)

router = APIRouter()

DEFAULT_RANGE_DAYS = 30  # matches docs/06-test-plan.md 5.3's "last 30 days" budget-review scenario


@router.get("/cost-summary", response_model=CostSummaryOut)
def get_cost_summary(
    group_by: GroupBy = Query(default="day"),
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    auth: UserAuth = Depends(verify_jwt),
) -> CostSummaryOut:
    range_end = end or datetime.now(timezone.utc)
    range_start = start or (range_end - timedelta(days=DEFAULT_RANGE_DAYS))

    if range_start >= range_end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start must be before end")

    supabase = get_supabase()
    result = supabase.rpc(
        "cost_summary",
        {
            "p_org_id": str(auth.org_id),
            "p_group_by": group_by,
            "p_start": range_start.isoformat(),
            "p_end": range_end.isoformat(),
        },
    ).execute()

    rows = [CostSummaryRow(**row) for row in result.data or []]

    return CostSummaryOut(
        group_by=group_by,
        start=range_start,
        end=range_end,
        rows=rows,
        total_cost_usd=sum((row.total_cost_usd for row in rows), Decimal("0")),
        total_tokens=sum((row.total_tokens for row in rows), 0),
    )


@router.get("/cost-breakdown", response_model=CostBreakdownOut)
def get_cost_breakdown(
    dimension: BreakdownDimension = Query(...),
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    auth: UserAuth = Depends(verify_jwt),
) -> CostBreakdownOut:
    range_end = end or datetime.now(timezone.utc)
    range_start = start or (range_end - timedelta(days=DEFAULT_RANGE_DAYS))

    if range_start >= range_end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start must be before end")

    supabase = get_supabase()
    result = supabase.rpc(
        "cost_breakdown_by_day",
        {
            "p_org_id": str(auth.org_id),
            "p_dimension": dimension,
            "p_start": range_start.isoformat(),
            "p_end": range_end.isoformat(),
        },
    ).execute()

    rows = [CostBreakdownRow(**row) for row in result.data or []]

    return CostBreakdownOut(dimension=dimension, start=range_start, end=range_end, rows=rows)
