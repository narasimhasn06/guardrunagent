from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth import UserAuth, verify_jwt
from app.db import get_supabase
from app.schemas import AgentEventOut, SessionDetailOut

router = APIRouter()

MAX_EVENT_PAGE_SIZE = 500  # NFR3: replay of up to 500 events loads in under 2s


@router.get("/sessions/{session_id}", response_model=SessionDetailOut)
def get_session(
    session_id: UUID,
    limit: int = Query(default=100, ge=1, le=MAX_EVENT_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
    auth: UserAuth = Depends(verify_jwt),
) -> SessionDetailOut:
    supabase = get_supabase()

    session = (
        supabase.table("sessions")
        .select("*")
        .eq("id", str(session_id))
        .eq("org_id", str(auth.org_id))
        .maybe_single()
        .execute()
    )
    if not session.data:
        # Same 404 whether the session doesn't exist or belongs to another
        # org — never confirm cross-org existence.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    events = (
        supabase.table("agent_events")
        .select("*", count="exact")
        .eq("session_id", str(session_id))
        .order("created_at")
        .range(offset, offset + limit - 1)
        .execute()
    )

    return SessionDetailOut(
        **session.data,
        events=[AgentEventOut(**row) for row in events.data or []],
        event_count=events.count or 0,
        limit=limit,
        offset=offset,
    )
