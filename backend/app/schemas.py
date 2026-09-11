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


# ---- GET /sessions (list) -----------------------------------------------
# Not in the LLD's API design (Section 4 only covers /events,
# /guardrail-check, /sessions/:id, /cost-summary) but named as the
# Sessions List page's data source in Section 6. Columns/filters/search
# per docs/04-ui-ux-design.md Section 3.2.
#
# The UI doc's Status filter lists "success/blocked/flagged/error" --
# those are agent_events.status values (Section 1's schema), not
# sessions.status, which is 'active' | 'completed' | 'error'. Filtering
# by "sessions containing a blocked/flagged event" would need a join the
# doc doesn't otherwise ask for; this filters by the real sessions.status
# enum instead and flags the mismatch rather than silently building the
# cross-table version.


class SessionListItem(BaseModel):
    id: UUID
    agent_name: str
    project_label: str | None
    started_at: datetime
    ended_at: datetime | None
    total_cost_usd: Decimal
    total_tokens: int
    status: SessionStatus
    event_count: int


class SessionsFilterOptions(BaseModel):
    projects: list[str]
    agents: list[str]


class SessionsListOut(BaseModel):
    sessions: list[SessionListItem]
    total_count: int
    limit: int
    offset: int
    filters: SessionsFilterOptions


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
    # Org-level fail-open/fail-closed setting (orgs.fail_mode), piggybacked
    # onto this same response rather than a separate endpoint: the SDK
    # already polls GET /rules every 5 minutes to refresh its local rule
    # cache (sdk/src/ruleCache.ts) and has no persistent process to hold a
    # second value across hook invocations, so this is the one round-trip
    # it already makes. sdk/src/config.ts's local env var/config.json
    # override, when set, still wins over this on the SDK side.
    fail_mode: Literal["open", "closed"] = "open"


class RuleCreateIn(BaseModel):
    name: str
    pattern_type: Literal["command_regex", "path_prefix", "action_type"]
    pattern_value: str
    action_on_match: Literal["block", "flag"]
    enabled: bool = True


class RuleUpdateIn(BaseModel):
    """PATCH /rules/{id} -- a standard partial update. The dashboard's
    Rules tab only ever sends {"enabled": ...} today, for the "Enabled
    toggle" (docs/04-ui-ux-design.md Section 3.5); the other fields are
    accepted for completeness (a rename, a pattern fix) rather than
    building a narrower "toggle-only" endpoint, since no field here costs
    anything extra to support.
    """

    name: str | None = None
    pattern_type: Literal["command_regex", "path_prefix", "action_type"] | None = None
    pattern_value: str | None = None
    action_on_match: Literal["block", "flag"] | None = None
    enabled: bool | None = None


# ---- GET /guardrail-activity ---------------------------------------------
# Activity Log tab per docs/04-ui-ux-design.md Section 3.5: "timestamp,
# rule name, session link, action taken, whether the Slack alert was
# successfully delivered." Named in the LLD's dashboard pages table
# (Section 6: "GET /guardrail-activity") but never specified in the API
# design (Section 4).


class GuardrailActivityItem(BaseModel):
    id: UUID
    fired_at: datetime
    rule_id: UUID | None
    rule_name: str | None  # null if the rule was since deleted
    action_on_match: Literal["block", "flag"] | None
    session_id: UUID | None
    alert_sent: bool


class GuardrailActivityOut(BaseModel):
    activity: list[GuardrailActivityItem]
    total_count: int
    limit: int
    offset: int


# ---- GET /me, POST /orgs --------------------------------------------------
# Neither endpoint is in docs/03-low-level-design.md's Section 4 API design
# or Section 6 route table -- both close a real gap it names but never
# specifies storage/an endpoint for: docs/03-low-level-design.md Section
# 2.2 step 6 says a first-time signup with no org membership should get
# "creating a new org," but no UI, endpoint, or schema for that exists
# anywhere. GET /me is what the dashboard calls first to decide whether to
# render the normal app shell or a "create your organization" screen
# (verify_jwt/UserAuth can't answer this -- it 403s a user with no org,
# which would make the screen that's supposed to fix that unreachable).
# See app/auth.py's JwtIdentity/verify_jwt_identity and
# app/routers/orgs.py.


class MeOut(BaseModel):
    email: str
    has_org: bool
    org_id: UUID | None = None
    role: Literal["admin", "member"] | None = None
    # Platform-level operator status (platform_admins table), independent
    # of org_members -- a platform admin doesn't need an org membership at
    # all. Drives the dashboard's "Organizations" nav item -- see
    # CLAUDE.md's "Planned, not yet built" entry this closes and
    # app/routers/admin.py.
    is_platform_admin: bool = False


class OrgCreateIn(BaseModel):
    org_name: str


class OrgCreateOut(BaseModel):
    org_id: UUID
    org_name: str
    api_key: str  # plaintext -- returned exactly once, same convention as ApiKeyRegenerateOut


# ---- /settings -----------------------------------------------------------
# Settings page per docs/04-ui-ux-design.md Section 3.6: API key
# (masked display + regenerate), Slack integration (webhook paste + test
# alert), Team (member list + invite-by-email + role toggle). Not in the
# LLD's API design (Section 4) -- Section 6's route table just names the
# page's two source tables (orgs, org_members); the concrete endpoint
# shapes below are new. See app/routers/settings.py for why the API key
# itself is never returned by GET (only orgs.api_key_hash exists --
# there's no way to recover or partially reveal the original key from a
# hash, so "masked key" is a fixed placeholder, not a real prefix).


class TeamMemberOut(BaseModel):
    id: UUID
    email: str
    role: Literal["admin", "member"]
    created_at: datetime


class PendingInviteOut(BaseModel):
    id: UUID
    email: str
    role: Literal["admin", "member"]
    created_at: datetime


class SettingsOut(BaseModel):
    org_name: str
    has_api_key: bool
    slack_webhook_configured: bool
    slack_webhook_url: str | None
    fail_mode: Literal["open", "closed"]
    team: list[TeamMemberOut]
    pending_invites: list[PendingInviteOut]
    # The caller's own role in this org (UserAuth.role) -- lets the
    # dashboard hide team-management controls (invite, role toggle,
    # cancel invite) from a Member. Added as a bug fix: those mutation
    # endpoints below were never actually role-gated, so any Member could
    # invite teammates or promote themselves to Admin -- caught during
    # manual verification of the Super Admin rollout. The read itself
    # (this whole response) stays available to any org member; only the
    # mutations are now admin-only, both here (UI) and, authoritatively,
    # on each mutation endpoint's own check below.
    your_role: Literal["admin", "member"]


# ---- GET /admin/orgs, GET /admin/orgs/:id/members, POST /admin/orgs/:id/invite ----
# Super Admin role -- see CLAUDE.md's "Planned, not yet built" entry this
# closes and app/routers/admin.py. New scope, not in the original docs;
# see docs/03-low-level-design.md Section 4.6 and docs/04-ui-ux-design.md's
# "Organizations" screen. All three endpoints require verify_platform_admin
# (app/auth.py) and deliberately accept any org_id, with no restriction to
# the caller's own -- the guard is the dependency itself, not a query
# scope. Reuses TeamMemberOut/PendingInviteOut above -- an org's
# member/invite list looks the same whether an org admin or a platform
# admin is asking. The invite endpoint reuses TeamInviteIn too, and
# PendingInviteOut as its response -- an invite is an invite regardless
# of who created it.


class AdminOrgOut(BaseModel):
    id: UUID
    name: str
    created_at: datetime
    member_count: int


class AdminOrgsOut(BaseModel):
    orgs: list[AdminOrgOut]


class AdminOrgMembersOut(BaseModel):
    org_id: UUID
    org_name: str
    team: list[TeamMemberOut]
    pending_invites: list[PendingInviteOut]


class ApiKeyRegenerateOut(BaseModel):
    api_key: str  # plaintext -- returned exactly once, never persisted or retrievable again


class SlackWebhookIn(BaseModel):
    webhook_url: str | None  # null clears the integration


class SlackWebhookOut(BaseModel):
    slack_webhook_configured: bool
    slack_webhook_url: str | None


class FailModeIn(BaseModel):
    fail_mode: Literal["open", "closed"]


class FailModeOut(BaseModel):
    fail_mode: Literal["open", "closed"]


class SlackTestResult(BaseModel):
    delivered: bool


class TeamInviteIn(BaseModel):
    email: str
    role: Literal["admin", "member"] = "member"


class TeamRoleUpdateIn(BaseModel):
    role: Literal["admin", "member"]


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


# ---- GET /cost-breakdown -------------------------------------------------
# Not in the LLD's API design -- needed for the Cost Dashboard's stacked
# bar chart (docs/04-ui-ux-design.md Section 3.4: "cost per day, stacked
# by project or agent"), which GET /cost-summary's single-dimension
# grouping can't produce. Long/tidy rows (one per day+group combination);
# pivoting into per-day stacks is dashboard-side presentation logic.

BreakdownDimension = Literal["project", "agent"]


class CostBreakdownRow(BaseModel):
    day: str
    group_key: str
    cost_usd: Decimal


class CostBreakdownOut(BaseModel):
    dimension: BreakdownDimension
    start: datetime
    end: datetime
    rows: list[CostBreakdownRow]


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
