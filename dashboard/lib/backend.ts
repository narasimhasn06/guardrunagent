import { createClient } from "@/lib/supabase/server";

// Mirrors backend/app/schemas.py exactly. Decimal fields (cost_usd,
// total_cost_usd) serialize as JSON strings, not numbers -- verified
// directly against the backend's actual Pydantic output rather than
// assumed.

export type ActionType = "file_edit" | "bash" | "git" | "api_call";
export type EventStatus = "success" | "failure" | "blocked" | "flagged";
export type SessionStatus = "active" | "completed" | "error";

export interface AgentEventOut {
  id: string;
  action_type: ActionType;
  action_summary: string | null;
  payload_meta: Record<string, unknown> | null;
  reasoning_snippet: string | null;
  tokens_used: number;
  cost_usd: string;
  status: EventStatus;
  matched_rule_id: string | null;
  created_at: string;
}

export interface SessionDetailOut {
  id: string;
  agent_name: string;
  project_label: string | null;
  started_at: string;
  ended_at: string | null;
  total_cost_usd: string;
  total_tokens: number;
  status: SessionStatus;
  events: AgentEventOut[];
  event_count: number;
  limit: number;
  offset: number;
}

// ---- GET /me, POST /orgs --------------------------------------------------
// Not documented (see the comment above MeOut in backend/app/schemas.py).
// getMe() is called from the (dashboard) layout (a Server Component) to
// decide whether to render the normal app shell or the "create your
// organization" screen -- every other page 403s for a user with no org,
// so this has to be checked before any of them render. createOrg() is a
// mutation, so it's called from a Route Handler (app/api/orgs/route.ts)
// instead, same reasoning as createRule/updateRule further down.

export interface MeOut {
  email: string;
  has_org: boolean;
  org_id: string | null;
  role: "admin" | "member" | null;
  is_platform_admin: boolean;
}

export async function getMe(): Promise<MeOut> {
  const response = await authorizedFetch("/me");
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to load account info (${response.status})`);
  }
  return response.json();
}

export interface OrgCreateOut {
  org_id: string;
  org_name: string;
  api_key: string;
}

export async function createOrg(orgName: string): Promise<OrgCreateOut> {
  const response = await authorizedFetch("/orgs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ org_name: orgName }),
  });
  if (!response.ok) {
    if (response.status === 409) {
      throw new BackendError(409, "You already belong to an organization.");
    }
    throw new BackendError(response.status, `Failed to create organization (${response.status})`);
  }
  return response.json();
}

// ---- GET /sessions (list) ------------------------------------------------
// Not documented (see the comment in backend/app/schemas.py). The status
// filter uses SessionStatus (active/completed/error) -- the UI doc's
// "success/blocked/flagged/error" list is agent_events.status, a
// different enum; there's no "sessions containing a blocked event" filter
// here, flagged rather than silently built.

export interface SessionListItem {
  id: string;
  agent_name: string;
  project_label: string | null;
  started_at: string;
  ended_at: string | null;
  total_cost_usd: string;
  total_tokens: number;
  status: SessionStatus;
  event_count: number;
}

export interface SessionsFilterOptions {
  projects: string[];
  agents: string[];
}

export interface SessionsListOut {
  sessions: SessionListItem[];
  total_count: number;
  limit: number;
  offset: number;
  filters: SessionsFilterOptions;
}

export type SessionsDateRangePreset = "all" | "7d" | "30d";

export interface SessionsListParams {
  project?: string;
  agent?: string;
  search?: string;
  status?: SessionStatus;
  dateRange?: SessionsDateRangePreset;
  offset?: number;
}

export async function getSessionsList(params: SessionsListParams): Promise<SessionsListOut> {
  const query = new URLSearchParams();
  if (params.project) query.set("project", params.project);
  if (params.agent) query.set("agent", params.agent);
  if (params.search) query.set("search", params.search);
  if (params.status) query.set("status", params.status);
  if (params.offset) query.set("offset", String(params.offset));

  if (params.dateRange && params.dateRange !== "all") {
    const days = params.dateRange === "30d" ? 30 : 7;
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    query.set("start", start.toISOString());
    query.set("end", end.toISOString());
  }

  const response = await authorizedFetch(`/sessions?${query.toString()}`);
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to load sessions (${response.status})`);
  }
  return response.json();
}

export interface RuleOut {
  id: string;
  name: string;
  pattern_type: "command_regex" | "path_prefix" | "action_type";
  pattern_value: string;
  action_on_match: "block" | "flag";
  enabled: boolean;
  created_at: string;
}

export class BackendError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_REPLAY_EVENTS = 500; // matches NFR3 and GET /sessions/:id's own cap

/**
 * Forwards the current dashboard user's Supabase JWT to the backend as a
 * Bearer token, per docs/03-low-level-design.md Section 2.2 step 4. Runs
 * server-side only (uses the server Supabase client) -- these calls
 * happen during Server Component rendering, not from the browser.
 */
async function authorizedFetch(path: string, init?: RequestInit): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new BackendError(401, "No active session");
  }

  return fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${session.access_token}`,
    },
    cache: "no-store",
  });
}

export async function getSessionDetail(sessionId: string): Promise<SessionDetailOut> {
  const response = await authorizedFetch(`/sessions/${sessionId}?limit=${MAX_REPLAY_EVENTS}`);
  if (response.status === 404) {
    throw new BackendError(404, "Session not found");
  }
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to load session (${response.status})`);
  }
  return response.json();
}

export async function getRules(): Promise<RuleOut[]> {
  const response = await authorizedFetch("/rules");
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to load rules (${response.status})`);
  }
  const body = (await response.json()) as { rules: RuleOut[] };
  return body.rules;
}

export interface RuleCreateIn {
  name: string;
  pattern_type: "command_regex" | "path_prefix" | "action_type";
  pattern_value: string;
  action_on_match: "block" | "flag";
  enabled?: boolean;
}

export interface RuleUpdateIn {
  name?: string;
  pattern_type?: "command_regex" | "path_prefix" | "action_type";
  pattern_value?: string;
  action_on_match?: "block" | "flag";
  enabled?: boolean;
}

// createRule/updateRule/enableStarterRules are called from Route Handlers
// (app/api/rules/**) rather than directly from Server Components -- they
// run in response to client-side button/toggle interactions
// (components/rules/*), which can't call a server-only helper like
// authorizedFetch (it needs the request's cookie jar) directly from the
// browser.

export async function createRule(input: RuleCreateIn): Promise<RuleOut> {
  const response = await authorizedFetch("/rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to create rule (${response.status})`);
  }
  return response.json();
}

export async function updateRule(id: string, input: RuleUpdateIn): Promise<RuleOut> {
  const response = await authorizedFetch(`/rules/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to update rule (${response.status})`);
  }
  return response.json();
}

export async function enableStarterRules(): Promise<RuleOut[]> {
  const response = await authorizedFetch("/rules/starter", { method: "POST" });
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to enable starter rules (${response.status})`);
  }
  const body = (await response.json()) as { rules: RuleOut[] };
  return body.rules;
}

// ---- GET /guardrail-activity ---------------------------------------------
// Activity Log tab, docs/04-ui-ux-design.md Section 3.5: "timestamp, rule
// name, session link, action taken, whether the Slack alert was
// successfully delivered."

export interface GuardrailActivityItem {
  id: string;
  fired_at: string;
  rule_id: string | null;
  rule_name: string | null;
  action_on_match: "block" | "flag" | null;
  session_id: string | null;
  alert_sent: boolean;
}

export interface GuardrailActivityOut {
  activity: GuardrailActivityItem[];
  total_count: number;
  limit: number;
  offset: number;
}

export async function getGuardrailActivity(offset = 0): Promise<GuardrailActivityOut> {
  const params = new URLSearchParams();
  if (offset) params.set("offset", String(offset));

  const response = await authorizedFetch(`/guardrail-activity?${params.toString()}`);
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to load guardrail activity (${response.status})`);
  }
  return response.json();
}

// ---- GET /dashboard-summary --------------------------------------------
// Not a documented endpoint (see the comment in backend/app/schemas.py) --
// added because Home's stat cards, spend chart, and recent activity don't
// map onto any single existing route.

export interface SpendByDayRow {
  date: string;
  cost_usd: string;
}

export interface RecentActivityItem {
  id: string;
  session_id: string;
  action_type: ActionType;
  action_summary: string | null;
  status: EventStatus;
  created_at: string;
}

export interface DashboardSummaryOut {
  org_name: string;
  start: string;
  end: string;
  total_sessions: number;
  total_spend_usd: string;
  guardrail_blocks: number;
  active_agents: number;
  spend_by_day: SpendByDayRow[];
  recent_activity: RecentActivityItem[];
  org_has_any_sessions: boolean;
}

export type DateRangePreset = "7d" | "30d";

export function presetToRangeDays(preset: DateRangePreset): number {
  return preset === "30d" ? 30 : 7;
}

export async function getDashboardSummary(preset: DateRangePreset): Promise<DashboardSummaryOut> {
  const end = new Date();
  const start = new Date(end.getTime() - presetToRangeDays(preset) * 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
  const response = await authorizedFetch(`/dashboard-summary?${params}`);
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to load dashboard summary (${response.status})`);
  }
  return response.json();
}

// ---- GET /cost-summary and GET /cost-breakdown ---------------------------
// docs/04-ui-ux-design.md Section 3.4.

export type CostGroupBy = "day" | "project" | "agent";

export interface CostSummaryRow {
  group_key: string;
  total_cost_usd: string;
  total_tokens: number;
  event_count: number;
}

export interface CostSummaryOut {
  group_by: CostGroupBy;
  start: string;
  end: string;
  rows: CostSummaryRow[];
  total_cost_usd: string;
  total_tokens: number;
}

export async function getCostSummary(groupBy: CostGroupBy, start: Date, end: Date): Promise<CostSummaryOut> {
  const params = new URLSearchParams({ group_by: groupBy, start: start.toISOString(), end: end.toISOString() });
  const response = await authorizedFetch(`/cost-summary?${params}`);
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to load cost summary (${response.status})`);
  }
  return response.json();
}

export type BreakdownDimension = "project" | "agent";

export interface CostBreakdownRow {
  day: string;
  group_key: string;
  cost_usd: string;
}

export interface CostBreakdownOut {
  dimension: BreakdownDimension;
  start: string;
  end: string;
  rows: CostBreakdownRow[];
}

export async function getCostBreakdown(
  dimension: BreakdownDimension,
  start: Date,
  end: Date
): Promise<CostBreakdownOut> {
  const params = new URLSearchParams({ dimension, start: start.toISOString(), end: end.toISOString() });
  const response = await authorizedFetch(`/cost-breakdown?${params}`);
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to load cost breakdown (${response.status})`);
  }
  return response.json();
}

// ---- /settings ------------------------------------------------------------
// docs/04-ui-ux-design.md Section 3.6. Mutations here (regenerate,
// webhook save/test, invite/cancel/role) are called from Route Handlers
// (app/api/settings/**) rather than Server Components -- same reasoning as
// createRule/updateRule in the Rules section above: they run in response
// to client-side interactions, which can't call authorizedFetch directly.

export type TeamRole = "admin" | "member";

export interface TeamMemberOut {
  id: string;
  email: string;
  role: TeamRole;
  created_at: string;
}

export interface PendingInviteOut {
  id: string;
  email: string;
  role: TeamRole;
  created_at: string;
}

export type FailMode = "open" | "closed";

export interface SettingsOut {
  org_name: string;
  has_api_key: boolean;
  slack_webhook_configured: boolean;
  slack_webhook_url: string | null;
  fail_mode: FailMode;
  team: TeamMemberOut[];
  pending_invites: PendingInviteOut[];
}

export async function getSettings(): Promise<SettingsOut> {
  const response = await authorizedFetch("/settings");
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to load settings (${response.status})`);
  }
  return response.json();
}

export interface ApiKeyRegenerateOut {
  api_key: string;
}

export async function regenerateApiKey(): Promise<ApiKeyRegenerateOut> {
  const response = await authorizedFetch("/settings/api-key/regenerate", { method: "POST" });
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to regenerate API key (${response.status})`);
  }
  return response.json();
}

export interface SlackWebhookOut {
  slack_webhook_configured: boolean;
  slack_webhook_url: string | null;
}

export async function updateSlackWebhook(webhookUrl: string | null): Promise<SlackWebhookOut> {
  const response = await authorizedFetch("/settings/slack-webhook", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ webhook_url: webhookUrl }),
  });
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to save Slack webhook (${response.status})`);
  }
  return response.json();
}

export interface SlackTestResult {
  delivered: boolean;
}

export interface FailModeOut {
  fail_mode: FailMode;
}

export async function updateFailMode(failMode: FailMode): Promise<FailModeOut> {
  const response = await authorizedFetch("/settings/fail-mode", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fail_mode: failMode }),
  });
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to save fail mode (${response.status})`);
  }
  return response.json();
}

export async function testSlackWebhook(): Promise<SlackTestResult> {
  const response = await authorizedFetch("/settings/slack-webhook/test", { method: "POST" });
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to send test alert (${response.status})`);
  }
  return response.json();
}

export async function inviteTeamMember(email: string, role: TeamRole): Promise<PendingInviteOut> {
  const response = await authorizedFetch("/settings/team/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role }),
  });
  if (!response.ok) {
    if (response.status === 409) {
      const body = (await response.json().catch(() => null)) as { detail?: string } | null;
      throw new BackendError(409, body?.detail ?? "This email has already been invited or is already a member.");
    }
    throw new BackendError(response.status, `Failed to invite team member (${response.status})`);
  }
  return response.json();
}

export async function cancelInvite(inviteId: string): Promise<void> {
  const response = await authorizedFetch(`/settings/team/invites/${inviteId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to cancel invite (${response.status})`);
  }
}

export async function updateTeamMemberRole(memberId: string, role: TeamRole): Promise<TeamMemberOut> {
  const response = await authorizedFetch(`/settings/team/${memberId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to update team member role (${response.status})`);
  }
  return response.json();
}

// ---- GET /admin/orgs, GET /admin/orgs/:id/members -------------------------
// Super Admin role -- a platform-level operator, separate from each org's
// own admin/member roles, who can see every org (MeOut.is_platform_admin
// drives the "Organizations" nav item, see components/sidebar.tsx). Both
// calls are reads only, from Server Components (app/(dashboard)/admin/**),
// same as getSessionDetail above -- there's no mutation on this screen, so
// no Route Handler indirection is needed.

export interface AdminOrgOut {
  id: string;
  name: string;
  created_at: string;
  member_count: number;
}

export interface AdminOrgsOut {
  orgs: AdminOrgOut[];
}

export async function getAdminOrgs(): Promise<AdminOrgsOut> {
  const response = await authorizedFetch("/admin/orgs");
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to load organizations (${response.status})`);
  }
  return response.json();
}

export interface AdminOrgMembersOut {
  org_id: string;
  org_name: string;
  team: TeamMemberOut[];
  pending_invites: PendingInviteOut[];
}

export async function getAdminOrgMembers(orgId: string): Promise<AdminOrgMembersOut> {
  const response = await authorizedFetch(`/admin/orgs/${orgId}/members`);
  if (response.status === 404) {
    throw new BackendError(404, "Organization not found");
  }
  if (!response.ok) {
    throw new BackendError(response.status, `Failed to load organization members (${response.status})`);
  }
  return response.json();
}
