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


# ---- GET/POST /rules -----------------------------------------------------
# GET /rules serves two documented consumers at the same path: the SDK's
# local rule cache (docs/03-low-level-design.md Section 3.2, API-key
# auth) and the dashboard Rules page (Section 6: "GET/POST /rules", JWT
# auth) -- see app.auth.verify_api_key_or_jwt for how that's resolved.
# Both get the same shape, unfiltered by `enabled`: the SDK's own local
# matcher (sdk/src/matcher.ts) already skips disabled rules per-rule, so
# there's no need to filter server-side for that consumer, and the
# dashboard's "Enabled toggle" UI (docs/04-ui-ux-design.md Section 3.5)
# needs to see disabled rules to display and toggle them anyway.
#
# POST /rules (create) and POST /rules/starter (one-click enable the
# starter set) are dashboard-only, JWT auth -- no machine consumer creates
# rules programmatically per any doc.


class RuleOut(BaseModel):
    id: UUID
    name: str
    pattern_type: Literal["command_regex", "path_prefix", "action_type"]
    pattern_value: str
    action_on_match: Literal["block", "flag"]
    enabled: bool
    created_at: datetime


class RulesOut(BaseModel):
    rules: list[RuleOut]


class RuleCreateIn(BaseModel):
    name: str
    pattern_type: Literal["command_regex", "path_prefix", "action_type"]
    pattern_value: str
    action_on_match: Literal["block", "flag"]
    enabled: bool = True


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


# ---- GET /dashboard-summary ----------------------------------------------
# Not in the LLD's route table (Section 6 lists /sessions, /sessions/:id,
# /cost-summary, /rules, /guardrail-activity as Dashboard Home's data
# sources) -- but Home's four stat cards, spend chart, and recent-activity
# feed (docs/04-ui-ux-design.md Section 3.1) don't map cleanly onto any
# single existing endpoint, and stitching them together from several
# separate calls (some of which -- a sessions list, guardrail-activity --
# don't exist yet either) would mean re-deriving the same aggregation
# logic client-side. One consolidated, JWT-only endpoint instead. Flagged
# as a deviation, not a silent addition.


class SpendByDayRow(BaseModel):
    date: str
    cost_usd: Decimal


class RecentActivityItem(BaseModel):
    id: UUID
    session_id: UUID
    action_type: ActionType
    action_summary: str | None
    status: EventStatus
    created_at: datetime


class DashboardSummaryOut(BaseModel):
    org_name: str
    start: datetime
    end: datetime
    total_sessions: int
    total_spend_usd: Decimal
    guardrail_blocks: int
    active_agents: int
    spend_by_day: list[SpendByDayRow]
    recent_activity: list[RecentActivityItem]
    # True the moment this org has ever logged a single session, regardless
    # of the selected date range -- drives the empty-state setup checklist
    # (Section 3.1: "new org, no sessions yet"), which must not show up for
    # an established org just because it happened to be quiet this week.
    org_has_any_sessions: bool
