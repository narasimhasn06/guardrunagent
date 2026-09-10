from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.agent_events import ActionType, EventStatus
from app.models.sessions import SessionStatus

# ---- POST /events -----------------------------------------------------
# Request/response shapes per docs/03-low-level-design.md Section 4.1.


class EventIn(BaseModel):
    action_type: ActionType
    action_summary: str | None = None
    payload_meta: dict[str, Any] | None = None
    reasoning_snippet: str | None = None
    tokens_used: int = 0
    cost_usd: Decimal = Decimal("0")
    status: EventStatus
    timestamp: datetime | None = None  # defaults to insert-time (now()) if omitted


class EventsIn(BaseModel):
    session_id: UUID
    events: list[EventIn] = Field(min_length=1)


class EventsOut(BaseModel):
    received: int


# ---- GET /sessions/:id -------------------------------------------------
# Response shape per docs/03-low-level-design.md Section 4.3.


class AgentEventOut(BaseModel):
    id: UUID
    action_type: ActionType
    action_summary: str | None
    payload_meta: dict[str, Any] | None
    reasoning_snippet: str | None
    tokens_used: int
    cost_usd: Decimal
    status: EventStatus
    matched_rule_id: UUID | None
    created_at: datetime


class SessionDetailOut(BaseModel):
    id: UUID
    agent_name: str
    project_label: str | None
    started_at: datetime
    ended_at: datetime | None
    total_cost_usd: Decimal
    total_tokens: int
    status: SessionStatus
    events: list[AgentEventOut]
    event_count: int
    limit: int
    offset: int


# ---- POST /guardrail-check ---------------------------------------------
# Response shape per docs/03-low-level-design.md Section 4.2. The request
# adds `session_id` on top of the documented shape (action_type,
# action_summary only) -- needed so a blocked/flagged action's Slack alert
# can link back to the session, and so guardrail_activity's event_id could
# eventually be correlated to the session's events. A deliberate deviation
# from "exactly as specified," not an oversight.


class GuardrailCheckIn(BaseModel):
    session_id: UUID
    action_type: ActionType
    action_summary: str | None = None


class GuardrailCheckOut(BaseModel):
    decision: Literal["allow", "block", "flag"]
    rule_id: UUID | None = None
    rule_name: str | None = None


# ---- GET /cost-summary --------------------------------------------------
# Response shape per docs/03-low-level-design.md Section 4.4. The LLD names
# a single "date_range" query param without specifying its shape; this
# implements it as explicit `start`/`end` params instead (see
# app/routers/cost_summary.py) -- a judgment call, flagged for review.

GroupBy = Literal["day", "project", "agent"]


class CostSummaryRow(BaseModel):
    group_key: str
    total_cost_usd: Decimal
    total_tokens: int
    event_count: int


class CostSummaryOut(BaseModel):
    group_by: GroupBy
    start: datetime
    end: datetime
    rows: list[CostSummaryRow]
    total_cost_usd: Decimal
    total_tokens: int
