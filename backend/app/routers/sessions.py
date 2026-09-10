from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth import UserAuth, verify_jwt
from app.db import get_supabase, maybe_single_result
from app.models.sessions import SessionStatus
from app.schemas import (
    AgentEventOut,
    SessionDetailOut,
    SessionListItem,
    SessionsFilterOptions,
    SessionsListOut,
)

router = APIRouter()

MAX_EVENT_PAGE_SIZE = 500  # NFR3: replay of up to 500 events loads in under 2s
DEFAULT_SESSIONS_PAGE_SIZE = 50
MAX_SESSIONS_PAGE_SIZE = 200


@router.get("/sessions", response_model=SessionsListOut)
def list_sessions(
    project: str | None = Query(default=None),
    agent: str | None = Query(default=None),
    search: str | None = Query(default=None, description="Free-text search on project label"),
    status_filter: SessionStatus | None = Query(default=None, alias="status"),
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    limit: int = Query(default=DEFAULT_SESSIONS_PAGE_SIZE, ge=1, le=MAX_SESSIONS_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
    auth: UserAuth = Depends(verify_jwt),
) -> SessionsListOut:
    supabase = get_supabase()
    org_id = str(auth.org_id)

    result = supabase.rpc(
        "list_sessions",
        {
            "p_org_id": org_id,
            "p_project_label": project,
            "p_agent_name": agent,
            "p_search": search,
            "p_status": status_filter,
            "p_start": start.isoformat() if start else None,
            "p_end": end.isoformat() if end else None,
            "p_limit": limit,
            "p_offset": offset,
        },
    ).execute()

    rows = result.data or []
    total_count = rows[0]["total_count"] if rows else 0
    sessions = [SessionListItem(**{k: v for k, v in row.items() if k != "total_count"}) for row in rows]

    # Unfiltered by the current query params, so the dropdowns always
    # offer the org's full set of projects/agents rather than shrinking
    # to whatever the current filter selection already matches.
    facet_result = (
        supabase.table("sessions").select("project_label, agent_name").eq("org_id", org_id).execute()
    )
    projects = sorted({row["project_label"] for row in facet_result.data or [] if row["project_label"]})
    agents = sorted({row["agent_name"] for row in facet_result.data or [] if row["agent_name"]})

    return SessionsListOut(
        sessions=sessions,
        total_count=total_count,
        limit=limit,
        offset=offset,
        filters=SessionsFilterOptions(projects=projects, agents=agents),
    )


@router.get("/sessions/{session_id}", response_model=SessionDetailOut)
def get_session(
    session_id: UUID,
    limit: int = Query(default=100, ge=1, le=MAX_EVENT_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
    auth: UserAuth = Depends(verify_jwt),
) -> SessionDetailOut:
    supabase = get_supabase()

    session = maybe_single_result(
        supabase.table("sessions").select("*").eq("id", str(session_id)).eq("org_id", str(auth.org_id)).maybe_single()
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
