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
- **Guardrail-check fail-open vs. fail-closed is now a real org-level
  setting** (`orgs.fail_mode`, docs/05-architecture-document.md Section
  8 and docs/03-low-level-design.md Section 1), promoted from what was
  originally a client-side-only SDK config. Still defaults to fail-open.
  Closing this gap required solving a real constraint noted at the time
  it was deferred: each SDK hook is a fresh, one-shot process (see the
  entry above) with no persistent runtime to hold a fetched setting, and
  the one moment `fail_mode` actually matters (the backend is
  unreachable) is exactly when the SDK can't ask the backend for it.
  Fix: `GET /rules` (`app/routers/rules.py`) now also returns the org's
  `fail_mode`, piggybacked onto the same 5-minute-cached poll the SDK
  already does for its local rule cache (`sdk/src/ruleCache.ts`'s
  `getCachedOrgConfig`, renamed from `getCachedRules`) — no second
  network round-trip. `GUARDRUNAGENT_FAIL_MODE` /
  `~/.guardrunagent/config.json` (`sdk/src/config.ts`) still exist, now
  as `failModeOverride`: a per-machine override that wins over the org
  setting only when explicitly set (an invalid/unset value no longer
  silently means "open," it means "no override, defer to the org's
  setting"). Settings page: an instant-apply toggle (`PUT
  /settings/fail-mode`), mirroring the Rules tab's "Enabled" toggle
  rather than the Slack section's form+Save pattern, since it's a
  single two-state choice, not free text.
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
- **`request.url`'s origin in a Route Handler can be the container's own
  internal bind address, not the public domain, behind Railway's reverse
  proxy.** Caught live in staging: Google OAuth sign-in worked (Google
  approved, redirected to Supabase, Supabase redirected to the correct
  public dashboard domain per its own Site URL/Redirect URLs config --
  all separately verified correct), but the browser then landed on
  `https://0.0.0.0:8080` -- an address that was never reachable from
  outside the container in the first place -- and failed with
  `ERR_ADDRESS_INVALID`/connection-refused. Root cause:
  `app/auth/callback/route.ts` built its post-login redirect from `new
  URL(request.url).origin`, which reflected this dashboard service's own
  internal bind address (`0.0.0.0:8080`, per `dashboard/railway.toml`'s
  `-H 0.0.0.0` start command) rather than the public Railway domain --
  Railway's proxy doesn't preserve the original public host in the
  bare `Host` header the way `request.url` reads it. Fixed by preferring
  `X-Forwarded-Proto`/`X-Forwarded-Host` (which the proxy does set
  correctly) when present, falling back to `request.url`'s own origin
  for local dev where there's no proxy in front and those headers don't
  exist. Only this route was affected -- plain email/password sign-in
  never goes through it (`login-form.tsx` redirects client-side via
  `router.push`), so this stayed invisible until the first real Google
  OAuth (or password-reset) attempt against the deployed staging site.

- **Super Admin role, built** -- closes the entry formerly here under
  "Planned, not yet built." A platform-level operator, separate from
  each org's own admin/member role (`org_members.role`), who can see
  every org and every org's users across the whole product. Built
  exactly as designed: a new `platform_admins` table (`auth_user_id`
  primary key, no `org_id` at all -- deliberately *not* a value inside
  `org_members.role`, so it stays unreachable from an org's own
  team-invite dropdown, `TeamInviteIn.role`, which stays untouched);
  `app/auth.py`'s `verify_platform_admin` (same shape as `verify_jwt` --
  decode the JWT, then check table membership, 403 if absent), backed by
  a shared `is_platform_admin(supabase, auth_user_id)` helper so `GET
  /me` can report status without needing a second, differently-shaped
  auth path; `app/routers/admin.py`'s `GET /admin/orgs` (every org +
  member count, computed in Python from a single unfiltered
  `org_members` select rather than a new Postgres aggregate function --
  low-traffic admin-only page, not worth a dedicated RPC) and `GET
  /admin/orgs/{id}/members` (one org's team + pending invites, same
  shape `GET /settings` already returns, scoped to any org instead of
  the caller's own). `MeOut.is_platform_admin` drives the dashboard's
  "Organizations" nav item (`components/sidebar.tsx`) and its two pages
  (`app/(dashboard)/admin/orgs/**`) -- built read-only at first (no
  invite/role-toggle controls at all, unlike Settings' own Team tab); an
  invite capability was added shortly after, see the dedicated entry
  below -- role-toggle and cancel-invite are still deliberately absent
  here. No self-serve grant path, as designed -- `platform_admins` rows
  are added manually via SQL
  (see `DEPLOYMENT.md`), same pattern as the original "create an org"
  workaround earlier in this project's history. No SDK changes --
  confirmed unaffected, exactly as anticipated: the SDK only ever
  authenticates as one org via its API key. docs/03-low-level-design.md
  (Section 1 schema, Section 4.6, Section 6 route table) and
  docs/04-ui-ux-design.md (Section 2 IA diagram, new Section 3.7)
  updated alongside this, per this file's own Conventions section.
- **Settings → Team management was never actually restricted to Admins.**
  Caught during manual verification of the Super Admin rollout above: a
  Member could invite teammates, cancel a pending invite, and change any
  member's role -- including promoting themselves to Admin -- because
  `app/routers/settings.py`'s `invite_team_member`, `cancel_invite`, and
  `update_team_member_role` never checked `UserAuth.role`, and
  `components/settings/team-section.tsx` rendered the same controls for
  every viewer regardless of role. docs/04-ui-ux-design.md Section 3.6's
  "no granular permissions needed at MVP" was about the *number* of
  levels (just Admin/Member), not about Member having Admin's powers --
  clarified there now. Fixed: a new `_require_admin(auth)` guard (403 if
  `auth.role != "admin"`) on all three mutation endpoints -- the real
  gate. `GET /settings` also grows a `your_role` field (the caller's own
  `UserAuth.role`, already resolved by `verify_jwt` -- no extra query) so
  the dashboard can render read-only for a Member: no invite form, roles
  shown as plain text instead of a toggle button, no cancel-invite
  button. That UI hiding is a convenience only, never the actual
  security boundary -- confirmed by testing the backend endpoints
  directly with a Member's role, not just checking what the UI shows.
- **Organizations detail page (Super Admin) can now invite a member into
  any org.** The initial build was deliberately read-only end to end
  ("a platform admin looks, doesn't manage another org's team on its
  behalf"); real usage surfaced a genuine gap that read-only couldn't
  cover -- onboarding a client org's first user without a platform admin
  needing to already be a member of that org to invite anyone. Narrow
  addition, not a reversal of the read-only design: role-toggle and
  cancel-invite are still absent from this page -- an org's own admins
  keep those, from their normal Settings -> Team, over invites this page
  creates (same `org_invites` row, same table, fully visible and
  cancellable there). New `POST /admin/orgs/{org_id}/invite`
  (`app/routers/admin.py`'s `invite_org_member`, `verify_platform_admin`
  the only guard, org existence checked first -- 404 if not found)
  shares its conflict/insert logic with Settings' own invite endpoint via
  a new `app/invites.py`'s `create_pending_invite(supabase, org_id,
  email, role)`, extracted out of `app/routers/settings.py`'s
  `invite_team_member` rather than duplicated. Dashboard:
  `components/admin/org-members-panel.tsx` gained an invite form,
  submitting to a new `app/api/admin/orgs/[id]/invite/route.ts` Route
  Handler via plain browser `fetch` -- not `lib/backend.ts`'s
  `inviteOrgMember` directly, which wraps `authorizedFetch` and needs
  the server-only Supabase client; `inviteOrgMember` is called only from
  inside that Route Handler, same pattern as `createRule`/`updateRule`.
- **Demoting an org's last Admin was a self-lockout regression, introduced
  by the previous entry's own `isAdmin` gating.** Caught during a second
  round of manual verification: an Admin demoting *themselves* to Member
  (the common case of clicking their own role toggle) used to succeed
  outright -- but with the Team-management fix above now hiding all of
  `components/settings/team-section.tsx`'s controls once `isAdmin` is
  false, that same click removed the only way back (the toggle button
  they'd need to promote themselves again). Before the Team-management
  fix this was harmless: the toggle rendered for everyone regardless of
  role, so a self-demoted Admin could just click it again. Fixed at the
  root, not just in the UI: `app/routers/settings.py`'s
  `update_team_member_role` now 409s a demotion (`role: "member"`) that
  would leave an org with zero Admins -- counts admins via a single
  `org_members` select scoped to the org, checked only on the demotion
  path (promotions are never blocked). `lib/backend.ts`'s
  `updateTeamMemberRole` extracts and surfaces that 409's real `detail`
  message (same pattern `inviteTeamMember` already used), and
  `team-section.tsx` now has a `roleError` state showing it, plus
  pre-emptively disables the toggle for an org's sole remaining Admin
  (computed client-side from the `team` prop already in hand -- no extra
  request) so the situation is avoided rather than just rejected after
  the fact. The backend check stays the real gate either way, for a race
  between two admins demoting each other at once.
- **A member can now be removed from an org entirely, not just demoted.**
  Added directly in response to a real workaround: with no delete
  endpoint anywhere, removing someone meant editing `org_members` (and
  `auth.users`) by hand via the Supabase SQL Editor. New
  `DELETE /settings/team/{id}` (an org's own admin, own org) and
  `DELETE /admin/orgs/{org_id}/members/{id}` (a Super Admin, any org,
  404 if the org or member doesn't exist). Both share the last-admin
  guard with the existing role-demotion check via a new
  `app/org_members.py`'s `ensure_not_last_admin(supabase, org_id,
  member_id)` -- extracted out of `update_team_member_role` rather than
  duplicated a third time; safe to call unconditionally (it's a no-op
  select for anyone who isn't currently the org's only Admin).
  `components/settings/team-section.tsx` and
  `components/admin/org-members-panel.tsx` both gained a "Remove"
  button with an inline confirm step (mirroring
  `components/settings/api-key-section.tsx`'s confirm-before-regenerate
  pattern) and the same pre-emptive last-admin disable the role toggle
  already had.
- **Invite-conflict message reworded for clarity.** "This email already
  belongs to a team" read as ambiguous -- easy to misparse as "already
  invited into the org you're inviting them into" rather than "belongs
  somewhere else already." `app/invites.py`'s `create_pending_invite`
  now says "This email already belongs to another Org / Team."
- **Clarified: inviting someone never sends an email from this app.**
  Real confusion during testing -- a re-invited user "didn't receive an
  email to confirm." `org_invites` is purely an internal reservation
  row; the invited person has to be told out-of-band (Slack, whatever)
  to go sign in themselves with the same email, at which point
  `resolve_or_join_org` (`app/auth.py`) links them automatically. This
  was already the documented design (docs/03-low-level-design.md
  Section 2.2 step 6, docs/04-ui-ux-design.md Section 4.1) but
  docs/07-user-manual.md's Team section didn't say so explicitly, so
  it's easy to assume otherwise -- corrected there now, including that a
  Supabase-sent confirmation email (email/password signups only, not
  Google) is a separate thing from this app's own invite. No code
  change: an actual "send a real invite email" feature would be new
  scope (a mail provider isn't named in any doc) and hasn't been
  requested as such.
- **`resolve_or_join_org`'s select-then-insert wasn't atomic -- a
  concurrent race 500'd a brand-new user's very first login.** Caught
  live in production from a real Railway log
  (`postgrest.exceptions.APIError: duplicate key value violates unique
  constraint "org_members_auth_user_id_key"`, Postgres `23505`) for a
  deleted-then-reinvited user's first Google sign-in. Root cause: a
  brand-new user's first authenticated page load fires more than one
  request that each land in `resolve_or_join_org` around the same time
  (the dashboard layout's `GET /me` and the Home page's `GET
  /dashboard-summary`, at minimum) -- both see no existing `org_members`
  row (the `select` check) before either's `insert` commits, so both try
  to insert the same `auth_user_id`, and the loser hits the unique
  constraint instead of just getting back the winner's row. This was
  never reachable before the Super Admin work in this log: a first-time
  self-signup always went through `POST /orgs` (a different, single
  insert with its own membership check), so a race here needed a
  *pre-invited* first login specifically -- rare enough, or invite-only
  onboarding recent enough, that it hadn't surfaced until now. Fixed in
  `app/auth.py`'s `resolve_or_join_org`: the `insert` is now wrapped in
  `try`/`except postgrest.exceptions.APIError`, and on exactly code
  `23505` it re-fetches and returns the now-existing row instead of
  re-raising (any other error code still propagates as before). No
  retry loop or advisory lock needed -- one re-fetch is enough, since the
  only way this insert conflicts is another request's insert having
  already succeeded for the exact same `auth_user_id`.
  `tests/fakes.py` gained a `Raises` wrapper (parallel to the existing
  `Sequence`) so a fake table op can simulate a raised client exception,
  not just a returned response -- needed to test this without a real
  Supabase project to actually race against.
- **Inviting a team member now sends a real email.** Direct follow-up to
  the previous entry's "no email at all" clarification -- once that was
  explained, the actual ask was to make it work like real account
  creation: a real email, with a verify-and-log-in link, just with
  invite-specific wording. Built without any new library or service:
  Supabase Auth (already the auth provider) has its own admin "invite
  user" API -- `supabase.auth.admin.invite_user_by_email(email,
  options={"redirect_to": ...})`, confirmed present in the installed
  `supabase` client -- which creates the person's Supabase account and
  sends an email through Supabase's own configured mail delivery, using
  a separate, dashboard-customizable "Invite user" template distinct
  from "Confirm signup" (so the wording can say "invited to Org/Team,
  click to verify and log in" without touching the signup-confirmation
  template at all). Clicking the link lands on the same
  `dashboard/app/auth/callback/route.ts` Google OAuth and password-reset
  links already use -- no new dashboard route needed.
  `app/invites.py`'s `create_pending_invite` calls a new
  `_send_invite_email` helper after creating the `org_invites` row,
  passing `redirect_to={DASHBOARD_URL}/auth/callback` when
  `DASHBOARD_URL` is set (reusing the existing optional setting, no new
  config value). Mirrors `app/alerting.py`'s `post_to_slack`: tracked as
  a bool, never raises, never blocks or fails the invite itself -- the
  `org_invites` row is the real source of truth regardless of whether
  the email actually sends. The expected, common failure case:
  Supabase's admin API can't "invite" an email that already has an
  account (its own `email_exists`/`user_already_exists` error codes,
  caught specifically) -- most often someone previously removed via
  `remove_team_member`/`remove_org_member`, which only ever deletes the
  `org_members` row, never `auth.users`. That's not an error; they're
  linked automatically the next time they simply sign in
  (`resolve_or_join_org`), same as before this feature existed. New
  `org_invites.invite_email_sent` column (default `true`, so pre-existing
  rows created before this feature don't show a false "delivery failed"
  signal for something never attempted) persists the real outcome so the
  Team/Organizations lists can mark a never-delivered invite
  ("(no email sent)") for any pending invite, not just the one just
  created. `PendingInviteOut` grows the same field; `team-section.tsx`
  and `org-members-panel.tsx` both show a notice right after inviting
  when it didn't send. Needs the Supabase project's own SMTP configured
  for real delivery volume and its "Invite user" email template
  customized to real wording -- both dashboard settings, not code; see
  `DEPLOYMENT.md`.
- **`_send_invite_email` now logs the real Supabase error instead of
  swallowing it silently.** Caught live configuring SMTP on staging for
  the entry above: a genuinely new email got the same "(no email sent)"
  UI as the expected already-registered case, and Railway's own request
  logs showed nothing useful -- the `AuthApiError` was caught and
  discarded with no trace. Root cause (found only via Supabase's own
  Logs -> Auth Logs, not Railway) was an invalid SMTP port left as a
  placeholder, producing a DNS/connection timeout, not an
  already-registered response. `app/invites.py`'s `_send_invite_email`
  now logs the error's `code` and `message` via a module-level
  `logging.getLogger(__name__).warning(...)` (standard library, no new
  dependency -- matches this codebase's otherwise-nonexistent logging
  story) before returning `False`, so this doesn't require re-deriving
  from Supabase's dashboard next time. `DEPLOYMENT.md` also gained the
  concrete pitfalls hit configuring this live: the port must be a real
  SMTP port (465/587, not a placeholder), and testing with a personal
  Gmail account as the relay needs an App Password (not the account's
  real password) and will land in spam (no SPF/DKIM/DMARC alignment for
  a custom-domain sender) -- expected for verifying the flow works, not
  a substitute for a real transactional provider before relying on
  delivery.
- **Invite forms now confirm success, not just failure.** Once SMTP
  actually worked end-to-end, the gap became obvious: `handleInvite` in
  both `team-section.tsx` and `org-members-panel.tsx` only ever set
  `inviteNotice` for the "no email sent" case -- the ordinary
  successful-send path silently cleared the form and refreshed the list
  with no on-screen confirmation at all. Both now also set
  `inviteNotice` to `"Invite sent to {email}."` when
  `invite_email_sent` is `true`, reusing the same state/element as the
  existing warning notice rather than adding a second one.
- **The Supabase client now forces HTTP/1.1.** Caught live in
  production, reproducible on demand (not a one-off): a fresh Google
  sign-in's first `GET /me` intermittently 500'd with
  `httpx.RemoteProtocolError: ConnectionTerminated` -- `last_stream_id`
  in the traceback is an HTTP/2-only concept. Root cause: both
  postgrest-py and `supabase_auth` hardcode `http2=True` on the
  httpx.Client they build internally unless one is passed in, and
  neither `app/db.py` nor anything else in this codebase ever did.
  Most likely an HTTP/2 connection-pool race against Supabase's edge
  closing an idle connection out from under a reused one -- surfaced
  now because production had sat idle since its last deploy before
  this session's testing. `app/db.py`'s `get_supabase()` now passes
  `ClientOptions(httpx_client=httpx.Client(http2=False))` to
  `create_client()`, which `supabase-py` wires through to both its
  postgrest and auth clients from one place. HTTP/1.1 doesn't pool
  connections the same way and doesn't have this failure mode, at the
  cost of one connection per concurrent request instead of multiplexing
  several over one -- a non-issue at this project's traffic volume.
- **The Supabase client's timeout is now an explicit 20s, not httpx's
  5s default.** Caught live immediately after the HTTP/2 fix above
  shipped and Custom SMTP started genuinely working: inviting a team
  member in production hit `httpx.ReadTimeout`. Neither postgrest-py
  nor `supabase_auth` ever set a timeout on the client they build
  internally either, so this had always been 5s -- fine for an
  ordinary table read, too tight for `invite_user_by_email`, which
  Supabase's `/auth/v1/invite` handles by sending the email
  *synchronously* before responding, so a real (if slow) SMTP delivery
  can outrun it. `app/db.py`'s `get_supabase()` now also passes
  `timeout=20.0` on the same shared `httpx.Client`, alongside
  `http2=False` -- one client, one place, covers both. Only changes how
  long a genuinely stuck request takes to fail; the guardrail-check
  path's own 200ms p99 budget (see the API-key-hashing entry above) is
  about how long its own logic takes on the happy path, not this
  ceiling.
- **Invite links needed their own confirmation page --
  `/auth/callback` can't complete them.** Caught live in production
  once SMTP was actually sending: clicking an invite email landed on
  `/login?error=auth`, with the invited user's own access token
  stranded in the URL *fragment* (carried along only because a browser
  preserves the previous URL's fragment across a redirect whose
  `Location` doesn't specify one) -- and since the tester's browser
  already held a Super Admin session cookie, the dashboard just kept
  rendering as that admin, silently, with no visible error at all.
  Root cause: `/auth/callback/route.ts` only ever handles Supabase's
  **PKCE** flow (a `?code=` query param) -- what `signInWithOAuth`
  (Google) and `resetPasswordForEmail` both use, since a *client*
  starts those flows and can generate the `code_verifier` PKCE needs.
  An admin-issued link (`app/invites.py`'s `_send_invite_email`, via
  Supabase Auth's admin `invite_user_by_email` API) has no such
  client-side origin, so Supabase always redirects it back via the
  **implicit** flow instead -- `#access_token=...&refresh_token=...` in
  the URL fragment, which a server-side Route Handler can never see (
  fragments never reach the server). `/auth/callback` saw no `code`,
  treated it as a failed login, and redirected away -- correctly, for
  what it's built for, but it was never going to handle this case.
  Fix: a new `dashboard/app/auth/confirm/page.tsx` -- a client
  component, not a Route Handler, since only client-side JS can see
  `window.location.hash`. `createClient()` (`@supabase/ssr`) parses and
  persists a fragment-borne session automatically on construction
  (`detectSessionInUrl`, on by default); `getSession()` awaits that
  same initialization, so the page just waits for it and redirects
  (`/` on success, `/login?error=auth` on failure). `_send_invite_email`
  now points `redirect_to` at `{DASHBOARD_URL}/auth/confirm` instead of
  `/auth/callback` -- the only change on the backend side; Google OAuth
  and password-reset are untouched, since both already worked correctly
  through the PKCE path.
- **`/auth/confirm` also needed adding to the proxy's own public-path
  allowlist -- the page above wasn't enough by itself.** Caught live in
  production immediately after deploying the entry above: invite links
  *still* landed on `/login`, this time with no `?error=auth` at all --
  a different failure than the one that fix addressed. Root cause:
  `dashboard/lib/supabase/proxy.ts`'s `PUBLIC_PATHS` (checked by
  `updateSession`, the proxy Next.js 16 renamed from `middleware.ts`)
  never had `/auth/confirm` added to it, only `/auth/callback`. Every
  request to `/auth/confirm` has no session cookie yet -- that only
  gets created *client-side*, after the page's own JS turns the URL
  fragment into one -- so the proxy saw "no user, not a public path"
  and redirected to `/login` **before the page's client-side code ever
  ran**, on every single request, regardless of how valid the invite
  token was. Same fragment-preservation quirk as the entry above then
  stranded the token on `/login` instead of `/auth/confirm`. Ruled out
  first: Supabase's own Redirect URLs allowlist (already covered by an
  existing `https://.../**` wildcard, so not the cause) and the root
  `app/layout.tsx` (no auth check at all, only
  `app/(dashboard)/layout.tsx` and this proxy do). Fixed by adding
  `/auth/confirm` to `PUBLIC_PATHS`, mirroring `/auth/callback`.
  `dashboard/tests/proxy.test.ts` is this file's first test coverage at
  all -- confirmed it actually reproduces the bug (fails without the
  fix, passes with it) rather than trusting the read of the code alone.
