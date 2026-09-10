# GuardrunAgent

AI-agent observability, cost tracking, and guardrails — starting with Claude Code sessions.

## Source of truth
All product/architecture decisions are documented in /docs. Always check the
relevant doc before making a design decision that isn't already specified:
- Requirements & scope: docs/01-mvp-requirements.md
- Component architecture: docs/02-high-level-design.md
- Schema & API contracts: docs/03-low-level-design.md
- UI/UX behavior: docs/04-ui-ux-design.md
- Architectural rationale: docs/05-architecture-document.md
- Test expectations: docs/06-test-plan.md

## Stack
- SDK: TypeScript, Claude Code hooks
- Backend: FastAPI (Python), hosted on Railway (see "Decisions made during implementation" — Render config also exists, unused for now)
- DB + Auth: Supabase (Postgres + Supabase Auth — email/password + Google OAuth, linked by email)
- Dashboard: Next.js, hosted on Railway

## Conventions
- Don't introduce new libraries/services not already named in the docs without flagging it first.
- Follow the schema in docs/03-low-level-design.md exactly — don't invent new tables ad hoc.
- Keep the guardrail-check path fast and synchronous; everything else async.

## Decisions made during implementation
Real decisions settled while building, each resolving an open question or a
gap in /docs. Noted here so future sessions don't re-litigate them — full
rationale lives in the referenced code's own comments.

- **SDK hooks are one-shot processes, not a persistent runtime.** Claude
  Code invokes each hook as a fresh process per tool call (verified
  against Claude Code's real hooks docs) — the LLD's `registerHook()`
  snippet (Section 3) is illustrative, not literal. The SDK uses a
  file-backed event queue (`sdk/src/queue.ts`) instead of an in-memory
  buffer as a result.
- **Guardrail-check fail-open vs. fail-closed** (docs/05-architecture-document.md
  Section 8): MVP default is fail-open. There's no org-level setting for
  this in the schema yet, so it's a client-side SDK config
  (`GUARDRUNAGENT_FAIL_MODE` env var / `~/.guardrunagent/config.json` —
  see `sdk/src/config.ts`), not a backend/dashboard setting.
- **Machine (SDK) auth header**: `X-API-Key` (not specified in the docs).
- **`GET /rules` serves both the SDK (API key) and the dashboard (JWT) at
  the same path** — see `app/auth.py`'s `verify_api_key_or_jwt`. Returns
  all rules, including disabled ones, to both; the SDK's local matcher
  filters `enabled` client-side.
- **Endpoints beyond the LLD's Section 4 API design**, needed by pages
  the LLD's own Section 6 route table names: `GET /sessions` (list),
  `GET /cost-breakdown`, `GET /dashboard-summary`, `GET
  /guardrail-activity`, `PATCH /rules/{id}`, `POST /rules/starter`, and
  the `/settings` group. Documented inline in `backend/app/schemas.py`.
- **Schema additions beyond docs/03-low-level-design.md Section 1**:
  `guardrail_activity.session_id` (links a firing back to its session —
  see `supabase/migrations/20260910100010_*`) and a new `org_invites`
  table (holds a pending Team invite until the invited person's first
  login — see `supabase/migrations/20260910100011_*` and
  `app/routers/settings.py`).
- **API key display in Settings**: never reconstructable (only a hash is
  stored) — shown as a fixed masked placeholder, with the real value
  surfaced exactly once, right after regeneration.
- **API key hashing: HMAC-SHA256 + pepper, not bcrypt/argon2** (a
  deviation from docs/03-low-level-design.md Section 7's suggested
  examples, now corrected there too). Measured bcrypt at ~270ms/check —
  alone over the guardrail-check path's 200ms p99 budget, and
  `verify_api_key` paid that once per *org* in a loop. API keys are
  high-entropy random tokens, not human passwords, so bcrypt's slowness
  bought nothing. See `backend/app/api_keys.py`. Required a new
  `API_KEY_PEPPER` config value (server-only secret) and is a breaking
  change for any already-issued API key — regenerate after deploying
  this.
- **Deployment target: Railway** (no Render subscription available).
  `backend/railway.toml` and `dashboard/railway.toml` use the legacy
  "Config as Code" format, verified against real current examples (not
  Railway's own docs site, which this session's network access can't
  reach) — it's deprecated in favor of a new `.railway/railway.ts`
  system, dead **2026-12-01**, so this needs migrating before then. One
  thing config-as-code can't set at all: each service's Root Directory,
  which has to be set in Railway's dashboard (railwayapp/cli#839, still
  open). `render.yaml` is still in the repo and fully valid, kept as a
  ready-to-use alternative once/if a Render subscription exists. See
  `DEPLOYMENT.md`.
- **Dashboard client-side mutations** (toggles, forms, buttons) never
  call the backend directly from the browser — they go through
  same-origin Next.js Route Handlers under `dashboard/app/api/**`, which
  forward the signed-in user's Supabase JWT server-side.
- **JWT verification: Supabase's public JWKS (ES256), not a single
  shared secret.** docs/03-low-level-design.md Section 2.2 originally
  described verifying against one "public JWT secret" (HS256). Supabase
  has since moved to "JWT Signing Keys" -- an asymmetric key, verified
  against the project's `/auth/v1/.well-known/jwks.json` -- and this
  project's real deployment already had its key rotated to ES256, which
  broke login in staging until caught (a persistent 401 on every
  authenticated dashboard request, no matter how carefully
  `SUPABASE_JWT_SECRET` was re-copied, since that legacy secret no
  longer signs anything). `app/auth.py`'s `verify_jwt` now tries the
  JWKS/ES256 path first and falls back to the legacy HS256 secret only
  when no matching key is found (a project that hasn't migrated) --
  never partially overlapping, since JWKS only ever publishes
  asymmetric keys. Needed a new dependency, `cryptography` (PyJWT's
  ES256/RS256 support requires it).
