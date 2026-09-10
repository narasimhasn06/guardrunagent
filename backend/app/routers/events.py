from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, status

from app.auth import OrgAuth, verify_api_key
from app.db import get_supabase, maybe_single_result
from app.schemas import EventsIn, EventsOut

router = APIRouter()


@router.post("/events", response_model=EventsOut, status_code=status.HTTP_202_ACCEPTED)
def post_events(body: EventsIn, auth: OrgAuth = Depends(verify_api_key)) -> EventsOut:
    supabase = get_supabase()

    existing = maybe_single_result(
        supabase.table("sessions")
        .select("id")
        .eq("id", str(body.session_id))
        .eq("org_id", str(auth.org_id))
        .maybe_single()
    )
    if not existing.data:
        # docs/03-low-level-design.md Section 4 documents no session-creation
        # endpoint, only POST /events referencing an existing session_id.
        # Auto-creating a minimal session row here on first sight of an
        # unknown session_id is a gap-fill, not a documented contract —
        # flagged for confirmation; an explicit SDK-called session-start
        # endpoint may be the better fit once session-level fields
        # (agent_name, project_label) need to come from the caller.
        supabase.table("sessions").insert(
            {
                "id": str(body.session_id),
                "org_id": str(auth.org_id),
                "agent_name": "claude-code",
                "started_at": datetime.now(timezone.utc).isoformat(),
            }
        ).execute()

    rows = [
        {
            "session_id": str(body.session_id),
            "org_id": str(auth.org_id),
            "action_type": event.action_type,
            "action_summary": event.action_summary,
            "payload_meta": event.payload_meta,
            "reasoning_snippet": event.reasoning_snippet,
            "tokens_used": event.tokens_used,
            "cost_usd": str(event.cost_usd),
            "status": event.status,
            **({"created_at": event.timestamp.isoformat()} if event.timestamp else {}),
        }
        for event in body.events
    ]
    supabase.table("agent_events").insert(rows).execute()

    total_cost = sum((event.cost_usd for event in body.events), Decimal("0"))
    total_tokens = sum(event.tokens_used for event in body.events)

    # Atomic increment via a Postgres function (see
    # supabase/migrations/20260910100006_create_increment_session_totals_fn.sql)
    # rather than read-modify-write, since concurrent event batches for the
    # same session would otherwise race — docs/03-low-level-design.md
    # Section 4.1 requires totals to "update incrementally and correctly."
    supabase.rpc(
        "increment_session_totals",
        {
            "p_session_id": str(body.session_id),
            "p_cost_delta": str(total_cost),
            "p_tokens_delta": total_tokens,
        },
    ).execute()

    return EventsOut(received=len(body.events))
