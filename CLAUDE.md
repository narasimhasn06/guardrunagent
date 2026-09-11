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
- **`SUPABASE_JWT_SECRET` is optional, not required.** Following directly
  from the JWKS decision above: this value is now only a fallback for
  projects that haven't migrated to JWT Signing Keys. It was still a
  required (non-`Optional`) field on `Settings`, though, so unsetting it
  on a JWKS-only deployment crashed `Settings()` itself -- an unhandled
  `pydantic.ValidationError` on every authenticated request, surfacing
  as a 500 from `/dashboard-summary` with no useful traceback for the
  actual cause. Caught live in staging. `app/config.py`'s
  `supabase_jwt_secret` is now `str | None = None`; the HS256 fallback
  in `app/auth.py`'s `_decode_supabase_jwt` raises a normal
  `jwt.InvalidTokenError` (-> 401) when it's unset and JWKS didn't match,
  instead of the field's absence taking down settings construction.
- **`.maybe_single().execute()` can return `None` outright, not a
  response object with `.data = None`.** Caught live in staging as a
  second, different 500 from `/dashboard-summary` right after the fix
  above: `app/auth.py`'s `verify_jwt` did `member.data` straight off a
  `.maybe_single().execute()` call, assuming a response object either
  way. postgrest-py 2.x (the version this project is actually on)
  returns `None` itself when zero rows match -- confirmed by reading
  `SyncMaybeSingleRequestBuilder.execute()` in the installed package.
  `FakeSupabase` (the test double) didn't replicate this, so every
  "not found" test case passed locally while the real client 500'd in
  production the first time any of this backend's 8
  `.maybe_single()` call sites (`app/auth.py` x3, `app/db.py`-adjacent
  routers: `guardrail_check.py`, `sessions.py`, `events.py`,
  `settings.py` x3, `dashboard_summary.py`) genuinely found no row.
  Fixed at the root: `app/db.py`'s new `maybe_single_result(builder)`
  wraps `.execute()` and normalizes a `None` return into an object with
  `.data = None`, and every call site now goes through it instead of
  calling `.maybe_single().execute()` directly. `FakeQuery.execute()` in
  `tests/fakes.py` now also returns `None` for a `.maybe_single()` query
  with no matching row, matching the real client -- so this class of bug
  fails a test locally instead of only surfacing in production.
- **Staging's Supabase project was missing 3 function migrations and 1
  column migration, despite DEPLOYMENT.md claiming "all migrations
  applied."** Caught live as a third distinct `/dashboard-summary`
  failure (after the two bugs above were both fixed): a real
  `postgrest.exceptions.APIError` --
  `PGRST202: Could not find the function public.cost_summary(...)`.
  `...0007_create_cost_summary_fn.sql`, `...0008_create_list_sessions_fn.sql`,
  `...0009_create_cost_breakdown_by_day_fn.sql`, and
  `...0010_add_session_id_to_guardrail_activity.sql` had never actually
  been run against this project, though `...0000` through `...0006` and
  `...0011` had. Root cause unclear (a stated assumption never verified,
  or some migrations skipped/failed silently when run manually one-by-one
  via the Supabase SQL Editor) -- not investigated further since the fix
  (run the missing ones) was immediate either way. `DEPLOYMENT.md` no
  longer states migration status as a bare claim; it now gives the
  `information_schema` queries to verify it directly before trusting any
  project, staging included.
- **Self-serve "create your first org" flow: `GET /me` + `POST /orgs`,
  neither in the LLD's Section 4 API design.** Closes the gap flagged
  above -- docs/03-low-level-design.md Section 2.2 step 6 names "creating
  a new org if this is a first-time signup" but never specified an
  endpoint for it, so a real (non-invited) signup 403'd with no way
  forward except the manual-SQL staging workaround. `verify_jwt`/`UserAuth`
  can't serve this itself -- it 403s a user with no org, which would make
  the very screen meant to fix that unreachable -- so `app/auth.py` now
  also exposes `JwtIdentity`/`verify_jwt_identity` (decodes the JWT only,
  no org lookup) and a shared `resolve_or_join_org()` helper (org lookup,
  falling back to consuming a pending invite -- the same logic
  `verify_jwt` already had, now also used by `GET /me` so an invite is
  always resolved before the dashboard ever offers "create your own org,"
  which would otherwise orphan it). `app/routers/orgs.py`: `GET /me`
  returns `{has_org, org_id, role}` -- the dashboard's `(dashboard)/layout.tsx`
  calls it before rendering anything else and shows
  `components/onboarding/create-org-form.tsx` instead of the normal app
  shell when `has_org` is false; `POST /orgs` creates the org, makes the
  caller its admin, and returns a real API key (same "shown exactly once"
  convention as Settings' regenerate).
- **SDK distribution: a Claude Code plugin marketplace (`.claude-plugin/marketplace.json`
  at the repo root), not `npm install`.** The dashboard's onboarding card
  and docs/07-user-manual.md Section 3 both told real users to run `npm
  install @guardrunagent/sdk` -- caught live in staging as an `npm error
  404` (the package had never been published, since `sdk/package.json`
  was `private: true`). Fixing publishing alone would still have been
  wrong: Claude Code never scans `node_modules` for plugins, so even a
  successfully `npm install`ed package would sit inert -- its
  `hooks/hooks.json` never registered and `${CLAUDE_PLUGIN_ROOT}` never
  set, since those only happen through Claude Code's own plugin-loading
  paths (`/plugin marketplace add` + `/plugin install`, `--plugin-dir`,
  or the skills directory). Real fix: `sdk/package.json` un-privated with
  `files: ["dist", "hooks", ".claude-plugin"]` (the published npm package
  *is* the plugin root, so `hooks/hooks.json` and
  `.claude-plugin/plugin.json` have to ship alongside `dist/`, not just
  `dist/` alone) and `prepublishOnly: "npm run build"` (dist/ is
  gitignored, built on demand); a new `.claude-plugin/marketplace.json`
  at the repo root with one npm-sourced plugin entry; onboarding
  (`components/home/setup-checklist.tsx`) and
  docs/07-user-manual.md Section 3 both corrected to the real two-command
  install (`/plugin marketplace add narasimhasn06/guardrunagent` then
  `/plugin install guardrunagent@guardrunagent`) and the real
  config-via-env-var-or-`~/.guardrunagent/config.json` story (no
  `initGuardrunAgent()` call ever existed -- see the "one-shot processes"
  decision above). Actually publishing `@guardrunagent/sdk` to npm still
  needs a human to run `npm login`/`npm publish` themselves (this session
  has no npm credentials) -- also requires an npm Organization named
  `guardrunagent` to exist first, since a scoped package publish only
  succeeds automatically under a scope matching the publisher's own npm
  username.
