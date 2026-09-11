# GuardrunAgent MVP — Low-Level Design

## 1. Database Schema (Supabase Postgres)

Supabase manages its own `auth.users` table internally (handles email/password, Google OAuth, and email-based account linking automatically). Our application schema references it via `auth_user_id` rather than reimplementing user/password storage.

```sql
-- Organizations / workspaces
CREATE TABLE orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,   -- for SDK -> backend machine auth (unrelated to Supabase Auth)
  slack_webhook_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Dashboard users — links our org/role data to Supabase's managed auth.users
CREATE TABLE org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES orgs(id),
  auth_user_id UUID NOT NULL UNIQUE,   -- references auth.users(id), managed by Supabase Auth
  email TEXT NOT NULL,                 -- denormalized copy for display/query convenience
  role TEXT NOT NULL DEFAULT 'member', -- 'admin' | 'member'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Agent sessions (one row per Claude Code run)
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES orgs(id),
  agent_name TEXT NOT NULL,          -- e.g. 'claude-code'
  project_label TEXT,                -- user-assigned, e.g. repo name
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  total_cost_usd NUMERIC(10,4) DEFAULT 0,
  total_tokens INT DEFAULT 0,
  status TEXT DEFAULT 'active'       -- 'active' | 'completed' | 'error'
);

-- Individual events within a session
CREATE TABLE agent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  org_id UUID REFERENCES orgs(id),   -- denormalized for fast org-scoped queries
  action_type TEXT NOT NULL,         -- 'file_edit' | 'bash' | 'git' | 'api_call'
  action_summary TEXT,               -- redacted/truncated description
  payload_meta JSONB,                -- structured metadata (file path, command, no raw secrets)
  reasoning_snippet TEXT,            -- short excerpt if available from agent output
  tokens_used INT DEFAULT 0,
  cost_usd NUMERIC(10,4) DEFAULT 0,
  status TEXT NOT NULL,              -- 'success' | 'failure' | 'blocked' | 'flagged'
  matched_rule_id UUID REFERENCES guardrail_rules(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_events_session ON agent_events(session_id, created_at);
CREATE INDEX idx_events_org_time ON agent_events(org_id, created_at);

-- Guardrail rules
CREATE TABLE guardrail_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES orgs(id),
  name TEXT NOT NULL,
  pattern_type TEXT NOT NULL,        -- 'command_regex' | 'path_prefix' | 'action_type'
  pattern_value TEXT NOT NULL,       -- e.g. '^rm -rf' or '/prod/config'
  action_on_match TEXT NOT NULL,     -- 'block' | 'flag'
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Guardrail firing log (for the alert/audit view)
CREATE TABLE guardrail_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES guardrail_rules(id),
  event_id UUID REFERENCES agent_events(id),
  org_id UUID REFERENCES orgs(id),
  fired_at TIMESTAMPTZ DEFAULT now(),
  alert_sent BOOLEAN DEFAULT false
);
```

**Note on the auth split:** `orgs.api_key_hash` authenticates the SDK (machine-to-machine). `org_members.auth_user_id` links a dashboard user (human, authenticated by Supabase Auth) to an org and a role. These two auth paths never cross.

## 2. Authentication Design (Supabase Auth)

### 2.1 Sign-in methods
- **Email/password** and **"Continue with Google"** (OAuth) are both enabled in Supabase Auth's provider settings — no custom auth logic needed, this is native Supabase functionality.
- **Account linking by email** is enabled: if `jane@company.com` signs up with a password and later uses "Continue with Google" with the same email, Supabase resolves both to the same `auth.users` record rather than creating a duplicate. This is a Supabase project configuration setting, not custom code.

### 2.2 Auth flow (dashboard)
1. User visits the Next.js dashboard, chooses email/password or Google
2. Next.js calls the Supabase Auth client SDK directly (`supabase-js`) — Supabase handles the OAuth redirect flow for Google, or validates the password directly
3. On success, Supabase issues a JWT (session token), stored client-side by the Supabase client library
4. Every request from the dashboard to the FastAPI backend includes this JWT in the `Authorization` header
5. FastAPI verifies the JWT signature locally (no round-trip call to Supabase's Auth API needed per-request). Not against a single "public JWT secret" as originally described here: Supabase's current default is its "JWT Signing Keys" feature, an asymmetric key (ES256) verified against the project's public JWKS endpoint, with the legacy shared HS256 secret kept only as a fallback for a project that hasn't migrated. Confirmed against a real deployment of this project, whose active signing key is already ES256 -- see `backend/app/auth.py`'s `_decode_supabase_jwt` and CLAUDE.md's decisions log.
6. On first login, if no `org_members` row exists for that `auth_user_id`, the backend resolves it: joining an org via invite happens automatically (a pending `org_invites` row matching the user's email is consumed); creating a new org for a first-time signup does not happen automatically -- the dashboard calls `GET /me`, and if it reports no org, shows a "create your organization" screen (`components/onboarding/create-org-form.tsx`) that calls `POST /orgs` to create one and make the user its admin. Neither endpoint is in Section 4's API design below -- see `app/routers/orgs.py` and CLAUDE.md's decisions log.

### 2.3 Service role key handling
- Supabase's service role key (bypasses RLS, full DB access) is stored only in the FastAPI backend's environment variables
- Never included in the Next.js build, never sent to the browser, never logged
- Used only for backend-initiated writes that need to bypass row-level scoping logic (rare — most queries go through the application-level `org_id` filtering instead)

### 2.4 Password reset
- Only relevant to users who signed up via email/password — determined by checking the user's `auth.users` provider metadata (Supabase exposes this)
- Google-auth users are shown no "forgot password" option; they manage credentials through their Google account

## 3. SDK Design (TypeScript)

### 3.1 Hook registration
```ts
// guardrunagent-sdk/src/index.ts
import { registerHook } from '@claude-code/hooks'; // conceptual — matches actual hook API

export function initGuardrunAgent(config: { apiKey: string; endpoint?: string }) {
  const client = new GuardrunAgentClient(config);

  registerHook('pre-tool-use', async (event) => {
    if (client.matchesLocalRuleCache(event)) {
      const decision = await client.checkGuardrail(event); // sync, network call
      if (decision === 'block') {
        client.logEvent({ ...event, status: 'blocked' }); // fire-and-forget
        throw new Error(`GuardrunAgent: action blocked by rule "${decision.ruleName}"`);
      }
    }
  });

  registerHook('post-tool-use', async (event, result) => {
    client.logEvent({ ...event, status: result.success ? 'success' : 'failure' }); // async, buffered
  });
}
```

### 3.2 Local rule cache
- On SDK init, fetch active guardrail rules for the org (`GET /rules`, authenticated via API key) and cache in memory
- Refresh every 5 minutes (poll — no need for websockets/push at MVP scale)
- Local pre-check is a cheap regex/prefix match against `pattern_value`; only escalate to a network call if a pattern *might* match, keeping the common path (harmless actions) fully local and fast

### 3.3 Event buffering & retry
- Events are pushed to an in-memory queue, flushed in batches of up to 50 or every 2 seconds (whichever first)
- On `POST /events` failure: exponential backoff retry (3 attempts), then write to a local fallback file (`~/.guardrunagent/failed_events.jsonl`) so nothing is silently lost
- A background flush on SDK init retries any previously failed events from that file

### 3.4 Redaction rules (client-side, before anything leaves the machine)
- File edit events: log file path + line-count diff, never full file contents
- Bash commands: log the command string but strip anything matching common secret patterns (API key formats, `.env` file contents) via regex before sending
- This redaction happens in the SDK, not the backend — payloads should already be safe by the time they leave the customer's machine

## 4. Backend API Design (FastAPI)

### 4.1 `POST /events` (machine auth — API key)
```
Request:
{
  "session_id": "uuid",
  "events": [
    {
      "action_type": "bash",
      "action_summary": "ran: npm install",
      "payload_meta": {...},
      "tokens_used": 120,
      "cost_usd": 0.002,
      "status": "success",
      "timestamp": "2026-09-10T10:15:00Z"
    }
  ]
}
Response: 202 Accepted { "received": 1 }
```
- Validates `org_id` from API key
- Batch insert into `agent_events`
- Updates `sessions.total_cost_usd` / `total_tokens` via incremental update (not recomputed from scratch each time)

### 4.2 `POST /guardrail-check` (machine auth — API key)
```
Request:
{
  "action_type": "bash",
  "action_summary": "git push --force origin main"
}
Response:
{
  "decision": "block",
  "rule_id": "uuid",
  "rule_name": "no-force-push-main"
}
```
- Target p99 latency: <200ms (in-memory rule evaluation against a small, per-org rule set — no need for a rules-engine library at this scale, a simple ordered loop over rules is sufficient)
- On `block` or `flag`: async-dispatch to alerting service (don't block the response on Slack delivery)

### 4.3 `GET /sessions/:id` (human auth — Supabase JWT)
- Returns session metadata + paginated event list, ordered by `created_at`
- Powers the Session Replay dashboard view
- Backend verifies the Supabase JWT, resolves `org_members.org_id`, and scopes the query to that org

### 4.4 `GET /cost-summary` (human auth — Supabase JWT)
- Query params: `group_by` (`day` | `project` | `agent`), `date_range`
- Aggregation query against `agent_events`, grouped and summed server-side — no need for a separate analytics warehouse at this volume

## 5. Alerting Service

- Simple internal function, not a separate microservice at MVP scale
- Triggered from `guardrail-check` when decision is `block` or `flag`
- Formats a Slack message via the org's stored webhook URL:
  > 🚫 GuardrunAgent blocked an action: `git push --force origin main` (Rule: no-force-push-main) — Session [link]
- Retries once on Slack API failure, logs failure to `guardrail_activity.alert_sent = false` for visibility in the dashboard even if the webhook itself failed

## 6. Dashboard Pages (Next.js)

| Route | Purpose | Key data source |
|---|---|---|
| `/login` | Email/password + "Continue with Google" | Supabase Auth client SDK |
| `/sessions` | List of recent sessions, filterable by project/agent | `GET /sessions` |
| `/sessions/[id]` | Session Replay — chronological event timeline | `GET /sessions/:id` |
| `/cost` | Cost dashboard, grouped by day/project/agent, simple bar/line charts | `GET /cost-summary` |
| `/rules` | Guardrail rule config (CRUD) + recent activity log | `GET/POST /rules`, `GET /guardrail-activity` |
| `/settings` | API key, Slack webhook config, team members | `orgs`, `org_members` tables |

## 7. Security Notes for MVP (minimum bar, not final)

- API keys (SDK auth) stored hashed, never logged in plaintext. Implemented as HMAC-SHA256 keyed by a server-only pepper (`API_KEY_PEPPER`), not bcrypt/argon2 as originally suggested here: those are deliberately slow to resist brute-forcing a human-guessable secret, but GuardrunAgent's API keys are high-entropy random tokens (`secrets.token_urlsafe(32)`) generated by the backend, not user-chosen -- bcrypt's slowness bought no real security there and cost ~270ms per check (measured), which alone exceeded the guardrail-check path's 200ms p99 target before any rule matching happened. See `backend/app/api_keys.py`.
- Supabase JWTs verified on every backend request using Supabase's public JWT secret; never trust a JWT without verifying its signature
- Supabase's service role key lives only in the backend environment — never in the frontend bundle (see Section 2.3)
- All traffic over HTTPS only
- Row-level scoping by `org_id` enforced at the application/query layer for MVP (not Postgres RLS) — Supabase makes RLS straightforward to add later since the DB is already Supabase-managed; documented as a v2 upgrade, not built now
- No customer source code or secrets persisted — enforced by SDK-side redaction (Section 3.4) as the primary control, with a backend-side regex scrub as a second layer of defense

## 8. Build Sequencing (maps to the 6-week MVP timeline)

1. Supabase project setup (Postgres schema + Auth providers configured: email/password, Google OAuth, account linking) — week 1
2. Backend skeleton (`/events`, `/sessions/:id`, JWT verification middleware) — week 1–2
3. SDK hook integration + event buffering — week 2–3
4. Guardrail rule engine + `/guardrail-check` + local SDK cache — week 3–4
5. Dashboard: Login flow + Session Replay + Cost view — week 4–5
6. Slack alerting + rule config UI — week 5
7. Redaction hardening, pilot onboarding, bug fixes — week 6
