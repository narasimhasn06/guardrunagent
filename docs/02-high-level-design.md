# GuardrunAgent MVP — High-Level Design

## 1. System Overview

Four components: an **SDK/hook** embedded in the customer's Claude Code environment, an **ingestion + storage backend**, a **dashboard** for viewing sessions/cost/guardrails, and **Supabase** providing both managed Postgres and user authentication.

```
┌─────────────────┐        HTTPS (async, batched)        ┌──────────────────┐
│  Claude Code     │ ───────────────────────────────────▶ │  Ingestion API    │
│  + GuardrunAgent │                                       │  (FastAPI,        │
│  SDK (hooks into │ ◀──── guardrail decision (sync) ───── │   Railway/Render) │
│  tool-use events)│                                       └────────┬──────────┘
└─────────────────┘                                                │
                                                                     ▼
                                                          ┌──────────────────┐
                                                          │   Supabase         │
                                                          │  - Postgres (data) │
                                                          │  - Auth (users)    │
                                                          └────────┬──────────┘
                                                                     ▼
                                          Supabase JWT   ┌──────────────────┐
                                        ◀──────────────  │  Dashboard         │
                                                          │  (Next.js,         │
                                                          │   Railway/Render)  │
                                                          │  Session Replay,   │
                                                          │  Cost View,        │
                                                          │  Rule Config       │
                                                          └──────────────────┘
                                                                     │
                                                                     ▼
                                                          ┌──────────────────┐
                                                          │  Alerting (Slack, │
                                                          │  Email)           │
                                                          └──────────────────┘
```

## 2. Component Breakdown

### 2.1 SDK / Hook Layer
- Language: TypeScript (matches Claude Code's plugin/hook ecosystem)
- Integrates via Claude Code's existing hooks system — intercepts tool-use events before/after execution
- Two modes:
  - **Async logging** (default): event is captured and sent to backend without blocking the agent
  - **Sync guardrail check** (only for actions matching a configured rule pattern): SDK makes a fast synchronous call to the backend's rule-check endpoint before allowing the action to proceed
- Buffers events locally and retries on network failure (avoid data loss, avoid blocking agent on backend downtime)
- Authenticates to the backend using a per-org **API key** — a separate, simpler mechanism from the human dashboard login (see Section 2.4)

### 2.2 Ingestion API
- FastAPI service, single deployment, hosted on **Railway or Render** (persistent service — not serverless — since the sync guardrail-check path needs consistent low latency and stable DB connections)
- Two endpoints matter most:
  - `POST /events` — accepts a batch of session events, writes to Supabase Postgres
  - `POST /guardrail-check` — accepts a proposed action, evaluates against the org's active rules, returns allow/block/flag synchronously (must be fast — target <200ms)
- Auth for these endpoints is the org's API key (machine-to-machine), not the human Supabase Auth session

### 2.3 Storage — Supabase (Postgres)
- Supabase provides managed Postgres — schema and query patterns are unchanged from vanilla Postgres, so the backend connects via the standard Supabase connection string
- No time-series DB, no event streaming platform — the data volume for pilot-scale usage (a handful of teams, thousands of events/day) doesn't justify the complexity
- Row-level scoping by `org_id` is enforced at the application layer for MVP (Supabase RLS is available as a cheap upgrade later — see Section 4)

### 2.4 Authentication — Supabase Auth
- **Dashboard users (humans):** Supabase Auth handles sign-in via email/password and "Login with Google" (OAuth). Accounts are linked by email so a user signing up both ways still resolves to a single account.
- **SDK → Backend (machines):** stays as a simple per-org API key, unrelated to Supabase Auth. Keeping human and machine auth separate avoids overengineering the machine path with a full auth provider it doesn't need.
- The Next.js dashboard talks to Supabase Auth directly for login/session; the resulting Supabase JWT is passed to the FastAPI backend on each request, which verifies it using Supabase's public JWT secret. No separate backend-side auth proxy layer.
- Supabase's **service role key** (which bypasses row-level security) lives only in the FastAPI backend's environment — never in the Next.js frontend/browser bundle.

### 2.5 Dashboard
- Next.js app, hosted on **Railway or Render** (kept consistent with the backend's hosting; Vercel was considered and intentionally not used, to avoid managing a second hosting vendor for no clear MVP benefit)
- Reads via the backend API (no separate analytics pipeline at MVP stage)
- Three core views: Session Replay, Cost Dashboard, Guardrail Rule Config + Activity Log

### 2.6 Alerting
- Slack webhook integration configured per-org (simplest to build and matches where eng teams already live)
- Email as fallback, not primary channel for MVP

## 3. Data Flow (Guardrail Path — the one path that must be synchronous)

1. Agent (via SDK hook) is about to execute a tool call
2. SDK checks: does this action type match a locally cached rule pattern? (fast local pre-check to avoid network round-trip for the 99% of harmless actions)
3. If it might match a guardrail rule → SDK calls `POST /guardrail-check` synchronously (authenticated via API key)
4. Backend evaluates against the org's active rules, returns `allow` / `block` / `flag`
5. If `block` → SDK prevents the action, logs the block event, triggers Slack alert
6. If `allow` or `flag` → action proceeds, event logged asynchronously either way

All other (non-risky) actions are logged fully asynchronously — no added latency to normal agent operation.

## 4. Key Design Decisions & Rationale

| Decision | Rationale |
|---|---|
| Start with Claude Code only, not a generic multi-framework SDK | Narrower integration = faster to ship, and Claude Code's hook system gives a clean interception point already |
| Local rule cache in the SDK for pre-check | Avoids adding network latency to every single tool call — only "maybe risky" actions hit the backend synchronously |
| No message queue / streaming infra at MVP | Pilot-scale event volume doesn't need it; added complexity would slow down time-to-first-customer |
| Guardrail rules are a small, curated set (not a full policy DSL) at MVP | Validates the concept and covers the highest-fear actions (force-push, `rm -rf`, protected paths) without over-engineering a rules engine no one has validated yet |
| Redact/truncate file contents in logged payloads | Avoids becoming a liability (storing customer source code/secrets) before any security review or compliance work is done |
| **Supabase for both DB and Auth** | Removes a vendor (no separate Clerk/Auth0) while still getting managed Postgres, built-in email/password + OAuth, and a clear upgrade path to RLS later |
| **Backend and dashboard both on Railway/Render, not split onto Vercel** | Keeps hosting simple (one vendor for both persistent services) and avoids the cold-start/timeout risk Vercel's serverless functions would introduce on the synchronous guardrail-check path |
| Human auth (Supabase Auth) and machine auth (API key) kept fully separate | These are different trust models — a person logging into a UI vs. a customer's server sending events — conflating them would overcomplicate both paths |

## 5. Deployment Topology (MVP)

- Backend (FastAPI) and Dashboard (Next.js): both hosted on Railway or Render as persistent services, single region
- Database + Auth: Supabase (managed Postgres + Supabase Auth), single project
- No multi-tenancy isolation beyond row-level `org_id` scoping (acceptable at pilot scale; RLS is a documented future upgrade — see Section 4)
- SDK distributed as an npm package customers install and configure with an API key
- Version control: GitHub (development only, not a runtime component)

## 6. What Explicitly Is NOT in the MVP Architecture

- No rollback/undo execution engine (would require modeling reversibility per action type — deferred)
- No anomaly detection service (no baseline data yet to detect deviation from)
- No multi-region or high-availability setup
- No support for agent frameworks other than Claude Code
- No Supabase Row-Level Security (RLS) — application-level `org_id` scoping only, for now
