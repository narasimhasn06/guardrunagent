# GuardrunAgent MVP — Architecture Document

This document describes the system's architectural qualities, views, and cross-cutting concerns. It complements the High-Level Design (component breakdown) and Low-Level Design (schema/API detail) rather than repeating them — read this for *why the system is shaped the way it is*, and the HLD/LLD for *what's inside each part*.

## 1. Architectural Goals & Constraints

| Goal | How the architecture addresses it |
|---|---|
| Ship an MVP in ~6 weeks | Every component choice favors managed services and boring, well-understood tech over building infrastructure (see Section 3) |
| Don't add latency to a customer's live AI agent | The only synchronous path (`guardrail-check`) is kept minimal, in-memory, and fast; everything else is async |
| Don't become a security liability before anyone trusts us | Redaction happens client-side (in the SDK) before data ever reaches our servers; secrets are structurally excluded, not just policy-excluded |
| Support a handful of pilot teams reliably | Architecture is deliberately single-region, low-complexity — correctness and reliability over premature scale |
| Keep the door open to grow | Component boundaries (SDK / backend / DB / dashboard) are clean enough to swap or scale any one piece later without a rewrite |

## 2. Architectural Style

**Layered, service-oriented monolith** — not microservices. One FastAPI backend service, one Next.js dashboard, one managed database. This is a deliberate choice for MVP stage: microservices add operational overhead (service discovery, inter-service auth, distributed tracing) that isn't justified by pilot-scale load, and would slow down the 6-week build target for no real benefit yet.

**Event-driven at the SDK boundary, request/response everywhere else** — the SDK emits events asynchronously (fire-and-forget with buffering), but the one place true real-time decision-making is needed (guardrail checks) uses a synchronous request/response call, because the agent's very next action depends on the answer.

## 3. Technology Stack & Rationale

| Layer | Choice | Rationale |
|---|---|---|
| SDK | TypeScript, Claude Code hooks | Matches the existing Claude Code plugin ecosystem; no new interception mechanism to invent |
| Backend | FastAPI (Python) | Fast to build in, good async support, easy JSON/Pydantic validation for the event/guardrail payloads |
| Backend hosting | Railway or Render | Persistent service hosting (not serverless) — needed for consistent low-latency on the synchronous guardrail-check path and stable DB connection pooling |
| Database | Supabase (managed Postgres) | Removes DB ops burden; standard Postgres underneath means no query/schema compromises; bundles Auth (see below) |
| Auth | Supabase Auth (email/password + Google OAuth, linked by email) | One vendor instead of two (no separate Clerk/Auth0); native support for both sign-in methods; JWT-based, so backend verification is stateless |
| Dashboard | Next.js | Standard, well-supported React framework; server-rendering where useful for the data-heavy dashboard views |
| Dashboard hosting | Railway or Render | Kept on the same vendor as the backend — one hosting relationship to manage at MVP stage, rather than splitting onto Vercel for marginal benefit |
| Alerting | Slack webhooks (+ email fallback) | Matches where the target users already work; no need for a dedicated notification service at this scale |
| Version control | GitHub | Standard, not a runtime dependency |

## 4. Logical View (Layers)

```
┌───────────────────────────────────────────────┐
│ Customer's environment                          │
│  Claude Code + GuardrunAgent SDK (TypeScript)   │
└───────────────────┬─────────────────────────────┘
                     │ HTTPS (API key auth)
┌───────────────────▼─────────────────────────────┐
│ GuardrunAgent Backend (FastAPI)                  │
│  - Ingestion (events)                            │
│  - Guardrail evaluation (sync)                   │
│  - Cost aggregation                               │
│  - JWT verification (Supabase)                    │
└───────────────────┬─────────────────────────────┘
                     │
┌───────────────────▼─────────────────────────────┐
│ Supabase                                          │
│  - Postgres (all application data)                │
│  - Auth (dashboard users)                          │
└───────────────────┬─────────────────────────────┘
                     │ (via backend API, Supabase JWT auth)
┌───────────────────▼─────────────────────────────┐
│ GuardrunAgent Dashboard (Next.js)                 │
│  Session Replay · Cost View · Rule Config          │
└───────────────────────────────────────────────────┘
```

## 5. Deployment View

- **Single region** deployment for MVP (region chosen based on where pilot customers are concentrated — no multi-region need yet)
- **Backend and dashboard**: two separate persistent services on Railway/Render, each independently deployable
- **Database/Auth**: one Supabase project per environment (a `staging` and a `production` Supabase project, kept separate to avoid pilot data mixing with test data)
- **No containerized orchestration (Kubernetes, etc.)** — Railway/Render's native deploy-from-git flow is sufficient at this scale and avoids unnecessary ops complexity
- **CI**: GitHub Actions running tests on every PR (see the Test Plan document for coverage detail), auto-deploy to staging on merge to `main`, manual promote to production

## 6. Data Flow Architecture (Two Paths)

**Path A — Asynchronous logging (the common case, ~99% of events):**
Agent action → SDK buffers event → batched POST to backend → backend writes to Supabase Postgres → dashboard reads on next page load/refresh. No latency impact on the agent.

**Path B — Synchronous guardrail check (rare, only for actions matching a cached rule pattern):**
Agent about to act → SDK local pre-check → if potentially risky, synchronous POST to backend → backend evaluates in-memory rule set → decision returned → SDK allows or blocks → event logged asynchronously regardless of outcome. Target end-to-end latency: under 200ms, so the agent's flow isn't meaningfully disrupted even on a block.

## 7. Security Architecture

- **Two independent auth domains**, never crossed:
  - Machine auth (SDK → backend): per-org API key, hashed at rest
  - Human auth (dashboard user → backend): Supabase-issued JWT, verified statelessly via Supabase's public signing key
- **Data minimization at the source**: the SDK redacts file contents and likely-secret patterns *before* anything leaves the customer's machine — the backend never receives raw source code or credentials to begin with, rather than relying on server-side scrubbing as the only safeguard
- **Service role key isolation**: Supabase's service role key (full DB access, bypasses row-level security) exists only in the backend's server environment, never shipped to any client-side bundle
- **Transport security**: HTTPS everywhere, no exceptions
- **Tenant isolation**: enforced at the application query layer via `org_id` scoping for MVP; Supabase Postgres Row-Level Security (RLS) is a documented, low-effort upgrade path once a customer's requirements (e.g. a security review) call for defense-in-depth beyond application logic

## 8. Reliability & Failure Handling

| Failure scenario | Mitigation |
|---|---|
| Backend temporarily unreachable during event logging | SDK buffers events locally, retries with backoff, falls back to a local file (`~/.guardrunagent/failed_events.jsonl`) so no data is silently lost |
| Backend unreachable during a guardrail check | Fail-open vs. fail-closed is a configurable org-level setting; MVP default is documented and communicated clearly to pilot customers rather than silently choosing one — this is a deliberate product/trust decision, not just an engineering default |
| Slack webhook delivery fails | Retried once; failure is still recorded in `guardrail_activity` so the block/flag itself is never lost from the audit trail, even if the notification didn't arrive |
| Supabase outage | Out of scope for MVP-level mitigation (no cross-provider failover) — acceptable given Supabase's own SLA and the pilot scale; revisit if/when enterprise SLAs are sold |

## 9. Scalability Path (Not Built Now, but Designed For)

The architecture avoids decisions that would block scaling later:
- Event ingestion is already batch-based and stateless per-request, so it can move behind a queue (e.g. adding a lightweight message broker) without changing the SDK contract
- The backend is a stateless service (no in-memory session state beyond the guardrail rule cache), so horizontal scaling (multiple backend instances) is straightforward when needed
- Supabase Postgres can be vertically scaled or eventually paired with a read replica for dashboard queries without schema changes
- RLS can be layered in without breaking existing application-level scoping logic

None of this is built for MVP — it's simply not precluded by the choices made.

## 10. Explicit Architectural Non-Goals (MVP)

- No microservices decomposition
- No multi-region or high-availability architecture
- No message queue / event streaming platform
- No Kubernetes or container orchestration
- No cross-cloud-provider failover
