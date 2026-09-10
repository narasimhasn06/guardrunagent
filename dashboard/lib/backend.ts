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
