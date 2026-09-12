# Deployment

How to deploy the backend and dashboard per docs/05-architecture-document.md
Section 5 (Deployment View): two independently-deployable services, each
with a staging and a production environment, each environment backed by
its own Supabase project.

## Current status

- **Railway** (the current actual deployment target -- no Render
  subscription is available): `backend/railway.toml` and
  `dashboard/railway.toml` define each service's build/deploy config.
  Verified against real, current `railway.json`/`railway.toml` examples
  (Railway's own docs repo, and several public repos using the format
  today) rather than Railway's own docs site, which this session's
  network access can't reach. One thing config-as-code genuinely can't
  do: each service's **Root Directory** must be set in Railway's
  dashboard when the service is created (confirmed via
  [railwayapp/cli#839](https://github.com/railwayapp/cli/issues/839),
  still open) -- see "Deploying via Railway" below.
  **Deprecation note**: this config format is being phased out in favor
  of a new TypeScript `.railway/railway.ts` Infrastructure-as-Code
  system. It keeps working until Railway's stated cutoff of
  **2026-12-01** -- migrate before then (revisit once that system's docs
  are reachable to verify against, or from a machine that can reach
  docs.railway.com).
- **Render**: `render.yaml` at the repo root also still defines all four
  services (backend x{staging, production}, dashboard x{staging,
  production}), verified against Render's current Blueprint spec. Kept
  in the repo as a ready-to-use alternative for whenever a Render
  subscription exists -- not the active path right now.
- **CI**: `.github/workflows/ci.yml` runs the backend/dashboard/SDK test
  suites on every PR. It does not deploy anything -- see "How deploys
  actually happen" below.
- **Supabase**: two projects now exist, **staging** and **production**,
  each with every migration in `supabase/migrations/` applied and
  verified. **Don't trust "all migrations applied" on faith for any
  project, including these**: staging was once believed fully migrated
  but was actually missing 3 of the 12 files (`...0007`, `...0008`,
  `...0009` -- the `cost_summary`, `list_sessions`, and
  `cost_breakdown_by_day` functions) and one column (`...0010`'s
  `guardrail_activity.session_id`), discovered only when
  `/dashboard-summary` 500'd in production with `PGRST202: Could not find
  the function public.cost_summary(...)`. Verify with the two queries in
  "Before the first deploy" step 1 before believing a project is current
  -- including before applying any *new* migration to either one going
  forward.
- **New migration pending on both projects**:
  `...0013_add_platform_admins.sql` (the Super Admin role -- see
  CLAUDE.md's decisions log) has not yet been run against staging or
  production as of this PR. Same "run it, then verify" procedure as
  `...0012` (fail_mode) below applies: run the migration, then confirm
  with
  ```sql
  select column_name from information_schema.columns where table_name = 'platform_admins';
  ```
  **The table starts empty.** The Super Admin feature has no self-serve
  way to grant itself, by design (see CLAUDE.md's decisions log and
  `app/auth.py`'s `verify_platform_admin`) -- after migrating each
  project, manually insert whoever should be a platform admin:
  ```sql
  insert into platform_admins (auth_user_id) values ('<their auth.users id>');
  ```
  Find that id under the Supabase dashboard's **Authentication -> Users**
  for that project. Until this insert happens on a given project, nobody
  can reach `/admin/orgs` there even with this PR deployed -- `GET /me`
  will report `is_platform_admin: false` for everyone.
- **Production is live**: `guardrunagent-backend-production` and
  `guardrunagent-dashboard-production` are deployed as a manual-promote
  Railway environment alongside staging (see "Deploying production via
  Railway" below), with Auth/Google OAuth configured on the production
  Supabase project and end-to-end sign-in verified.

## Before the first deploy

1. **Create a second Supabase project.** Right now there's one Supabase
   project intended to have every migration in `supabase/migrations/`
   applied to it. Decide which of {existing project, a newly-created one}
   is `staging` and which is `production`, and run every migration in
   `supabase/migrations/` against whichever one is new, in order, the
   same way they should have been applied to the first (Supabase SQL
   Editor, RLS left off -- see the comments in each migration file and
   this project's own history for why). Before trusting either project is
   actually current, verify with:
   ```sql
   select table_name from information_schema.tables where table_schema = 'public' order by table_name;
   select routine_name from information_schema.routines where routine_schema = 'public' order by routine_name;
   ```
   Cross-check the result against `supabase/migrations/`'s file list --
   table-creating and function-creating migrations show up directly;
   column-adding migrations (e.g. `...0010`) need a third check:
   ```sql
   select column_name from information_schema.columns where table_name = '<table>';
   ```
   `create table`/`alter table add column` migrations aren't safely
   re-runnable (they error if already applied) -- only run the ones a
   check above shows are actually missing. The `create or replace
   function` ones are always safe to re-run.
2. **Confirm Auth is configured the same way on both projects**: email/
   password + Google OAuth enabled, "Confirm email" on (for safe account
   auto-linking by email, per docs/03-low-level-design.md's auth note).
3. **Configure real invite email delivery** (needed for
   `app/invites.py`'s `create_pending_invite`, added during
   implementation -- see CLAUDE.md's decisions log), on each Supabase
   project separately. Supabase moved this out of **Authentication ->
   Providers -> Email** (that page is now just the provider's own
   toggles/security settings, no SMTP or templates on it) into its own
   **Authentication -> Emails** section (a "Notifications" group in the
   sidebar, direct path `/project/<ref>/auth/templates`), which has two
   tabs:
   - **SMTP Settings** tab: enable "Custom SMTP" and fill in a real
     provider's credentials. Supabase's own default sender has a low
     rate limit meant for local development and testing only -- it is
     not reliable for real invite volume.
   - **Templates** tab -> **Invite user**: customize the subject/body to
     your own wording. This is a separate template from "Confirm
     signup" (used for ordinary account creation) -- editing it doesn't
     touch that flow. Keep `{{ .ConfirmationURL }}` (or an equivalent
     link built from `{{ .TokenHash }}`) in the body; that's what the
     invited person actually clicks.
   - Nothing to set for `redirect_to` beyond `DASHBOARD_URL` (Railway
     variable, see below) -- `app/invites.py` builds
     `{DASHBOARD_URL}/auth/callback` itself, the same callback route
     Google OAuth and password-reset links already use
     (`dashboard/app/auth/callback/route.ts`).
   - **Port must be a real SMTP port** (465 for SSL, 587 for STARTTLS) --
     any other value fails silently from the app's point of view: GoTrue
     hangs trying to connect, eventually 504s, and this project's own
     `_send_invite_email` (see the entry above logging its `AuthApiError`)
     only ever sees a generic connection/timeout error, not "wrong port."
     Caught live: a placeholder port left in this field produced
     `Dial tcp: lookup smtp.host.com on ...: no such host`, visible only
     in Supabase's own **Logs -> Auth Logs** (filter Log Type = Auth),
     not in Railway's backend logs or the dashboard's own error message.
   - **Testing with a personal Gmail account as the SMTP relay**: works
     (host `smtp.gmail.com`, port `587`), but needs an **App Password**
     (Google Account -> Security -> 2-Step Verification must already be
     on -> search "App passwords" -- it's not one of the listed
     "Second steps" methods, it's a separate page), not the account's
     real login password. Even once delivery succeeds, expect the email
     to **land in spam**: Gmail's own SMTP relay doesn't have SPF/DKIM/
     DMARC set up for a `noreply@guardrunagent.com`-style sender that
     doesn't match the authenticated Gmail account's own domain --
     exactly what Supabase's own "designed for personal rather than
     transactional email" warning on this page is about. Fine for
     confirming the flow works end-to-end; not a substitute for a real
     transactional provider (Resend, SendGrid, Postmark, SES, ...) with
     its own domain verified before relying on invite emails reaching
     an inbox reliably.
4. Decide the deploy region (`region: oregon` in `render.yaml` is a
   placeholder -- Section 5 says this should be "chosen based on where
   pilot customers are concentrated," which hasn't been decided).

## Deploying via Railway

1. In the Railway dashboard: **New Project > Deploy from GitHub repo**,
   pick this repo. Railway creates one service from it -- rename it
   `guardrunagent-backend-staging`.
2. Open that service's **Settings**:
   - **Root Directory**: `backend` (config-as-code can't set this --
     see "Current status" above).
   - **Config File Path**: leave as default (`railway.toml`) -- Railway
     looks for it inside the Root Directory once that's set, so it'll
     find `backend/railway.toml` automatically.
   - **Region**: Singapore (pilot customers are concentrated in
     Southeast Asia).
3. Under that service's **Variables** tab, add:
   - `SUPABASE_URL` = `https://ldycthbglwbtmzzvijyy.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = (that Supabase project -> Project
     Settings -> API -> service_role key)
   - `SUPABASE_JWT_SECRET` = (same page -> JWT Settings -> JWT Secret)
   - `API_KEY_PEPPER` = a random secret generated for this purpose --
     treat it like any other credential, never commit it
   - `DASHBOARD_URL` = leave blank for now, step 6 below
   - Railway injects `PORT` automatically; nothing to set for it.
4. Deploy. Watch the build logs -- `pip install -r requirements.txt`
   should succeed and the service should go healthy against `/health`
   (from `backend/railway.toml`'s `healthcheckPath`).
5. Repeat steps 1-4 for the dashboard: **New Service > GitHub repo**
   (same repo, same project) -> name it `guardrunagent-dashboard-staging`
   -> Root Directory `dashboard`, Region Singapore -> Variables:
   - `NODE_VERSION` = `22.20.0` (dashboard/package.json's jsdom/vitest/
     undici require Node >=22 -- see `dashboard/railway.toml`'s comment)
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://ldycthbglwbtmzzvijyy.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (Supabase project -> Project
     Settings -> API -> anon/public key)
   - `NEXT_PUBLIC_BACKEND_URL` = leave blank for now
6. Once both are deployed, each has a `*.up.railway.app` domain (under
   the service's **Settings > Networking**, generate one if it isn't
   there already). Go back and set the real values:
   - Backend service's `DASHBOARD_URL` = the dashboard's domain
   - Dashboard service's `NEXT_PUBLIC_BACKEND_URL` = the backend's
     domain, then **redeploy** -- `NEXT_PUBLIC_*` values are baked in at
     build time, so saving the variable alone doesn't apply it.
7. **Production**: see "Deploying production via Railway" below.

## Deploying production via Railway

Do this once staging is stable and the second ("production") Supabase
project exists and is fully migrated (see "Before the first deploy"
step 1). Verified against Railway's current docs/support content
(`docs.railway.com` itself isn't reachable from this session's network,
but its content was confirmed via search-indexed copies and Railway
Central Station threads) -- re-check against the real dashboard if
anything below doesn't match what you see, since Railway's UI moves.

1. In the same Railway **project** as staging, open the environment
   switcher (top of the dashboard) and create a new environment named
   `production`. This is Railway's own multi-environment feature --
   each service gets an independent copy with its own variables and
   deploy settings, inside the one project.
2. Railway seeds the new environment by cloning staging's services and
   their variable *names* (not always safe values to keep as-is). For
   each service in the `production` environment:
   - **backend**: open **Variables**, replace every value with the
     **production** Supabase project's own credentials (from
     `backend/.env.production.example`'s comments) --
     `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
     (only if that project hasn't migrated to JWT Signing Keys -- see
     `app/auth.py`), and a **freshly generated** `API_KEY_PEPPER`
     (`openssl rand -hex 32` -- never reuse staging's). Leave
     `DASHBOARD_URL` blank for now.
   - **dashboard**: same idea with
     `dashboard/.env.production.example` -- `NEXT_PUBLIC_SUPABASE_URL`,
     `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the production Supabase
     project, `NODE_VERSION=22.20.0`, `NEXT_PUBLIC_BACKEND_URL` blank
     for now.
   - Confirm **Root Directory** carried over correctly (`backend` /
     `dashboard`) and set **Region** the same as staging.
3. Generate a domain for each service (**Settings > Networking >
   Generate Domain**) if one wasn't cloned automatically, then go back
   and fill in `DASHBOARD_URL` (backend) and `NEXT_PUBLIC_BACKEND_URL`
   (dashboard) with each other's real production domain, same
   two-sided-reference caveat as staging step 6 -- redeploy the
   dashboard service afterward since `NEXT_PUBLIC_*` is baked in at
   build time.
4. **Make production deploy manually, not on every push to `main`**
   (Section 5's "manual promote to production," and the reason
   staging/production are different environments in the first place):
   for each of the two production services, open **Settings > Deploy**
   and **Disable** the autodeploy toggle. This keeps the GitHub
   connection (so Railway still knows which commit is "latest") but
   stops it from redeploying on every push. To promote a commit once
   staging has verified it: **Cmd/Ctrl+K > Deploy Latest Commit** (or
   the same action from the service's **Deployments** tab), against the
   `production` environment.
5. Confirm both services go healthy (`/health`, `/login`) the same way
   as staging step 4, then do the "Before the first deploy" step 2/3
   checks (Auth config, region) against the production Supabase project
   specifically -- it's a separate project, so nothing about staging's
   Auth setup carries over automatically:
   - Supabase dashboard (production project) -> **Authentication ->
     URL Configuration**: Site URL and Redirect URLs must point at the
     **production dashboard's** real domain (from step 3), not
     staging's or `localhost`.
   - **Authentication -> Providers -> Google**: enable it and fill in
     the same Google OAuth Client ID/Secret as staging (Google OAuth
     clients aren't Supabase-project-scoped, so the same client can
     serve both, or use a separate one if you'd rather isolate them).
   - Google Cloud Console -> that OAuth client -> **Authorized redirect
     URIs**: add the **production** Supabase project's own callback
     URL, `https://<production-project-ref>.supabase.co/auth/v1/callback`
     -- this is additive, don't remove staging's.
6. Sign in against the production dashboard URL end-to-end (Google and
   email/password) before calling it done -- this is exactly the class
   of misconfiguration (wrong Site URL, missing redirect URI) that broke
   staging's first Google sign-in attempt; see CLAUDE.md's decisions log
   for what that looked like.

## Deploying via Render

1. Push this repo to GitHub with `render.yaml` at the root (already the
   case once this change is merged).
2. In the Render dashboard: **New > Blueprint**, connect this repo. Render
   reads `render.yaml` and shows all four services.
3. Render prompts for every environment variable marked `sync: false`.
   Fill staging services from the STAGING Supabase project's credentials
   and production services from the PRODUCTION project's -- see
   `backend/.env.staging.example`, `backend/.env.production.example`,
   `dashboard/.env.staging.example`, `dashboard/.env.production.example`
   for exactly which values and where to find them in Supabase's
   dashboard. **Never commit real values** -- these `.example` files are
   templates, not the real thing.
4. For `DASHBOARD_URL` (backend) and `NEXT_PUBLIC_BACKEND_URL`
   (dashboard), you can't know the real value until the *other* service
   in the pair has actually been created and assigned a `*.onrender.com`
   URL -- it's a two-sided reference. Apply the Blueprint once with
   placeholder values, then once both services in an environment have
   real URLs, go to each service's **Environment** tab, set the real
   value, and redeploy.
   - For the **dashboard** services specifically, this isn't optional:
     `NEXT_PUBLIC_*` variables are baked into the JavaScript bundle at
     *build* time, not read at runtime, so updating the env var alone
     does nothing until you trigger a new build.
5. Confirm each service's health check goes green:
   `/health` for the backend services, `/login` for the dashboard
   services (chosen over `/` specifically because `/` redirects
   unauthenticated requests, which would make the health check flaky).

## How deploys actually happen

**On Railway (the active path):**
- **Staging**: each service's autodeploy is left on (the default), so
  every push to `main` that passes CI auto-deploys both staging
  services. This *is* the "auto-deploy to staging on merge to main"
  behavior from Section 5 -- Railway's own native git-push deploy, not
  something the GitHub Actions workflow triggers.
- **Production**: autodeploy is disabled on both production services
  (see "Deploying production via Railway" step 4) -- deploys only
  happen when someone manually promotes the latest commit from the
  Railway dashboard. This is the "manual promote to production" step
  from Section 5.

**On Render (the kept-in-repo alternative, not currently used):**
- **Staging** (`autoDeploy: true` in `render.yaml`): same auto-deploy-on-
  push behavior as above, Render's native equivalent.
- **Production** (`autoDeploy: false`): deploys only when someone
  manually triggers one from the Render dashboard (or `render deploy` via
  Render's CLI), picking the commit to promote.

**Either way**, `.github/workflows/ci.yml` only runs tests on PRs -- it's
a gate, not a deploy mechanism. A red PR can't merge to `main` and
therefore can't reach staging; nothing stops a human from promoting a
bad commit to production, since that step is manual by design.

## Running the system tests against staging

`dashboard/e2e/` has Playwright specs for the four scenarios in
docs/06-test-plan.md Section 5. Each file has a small unconditional part
(login screen behavior, route shapes) that runs against anything,
including a plain local dev server, and a larger part gated behind
`E2E_SEEDED_STAGING` that needs a real deployment with real data:

```
E2E_BASE_URL=https://guardrunagent-dashboard-staging.onrender.com \
E2E_SEEDED_STAGING=1 \
E2E_SEEDED_SESSION_ID=<a session with a blocked/flagged event> \
npx playwright test
```

Setting `E2E_BASE_URL` also disables the config's automatic local
`npm run dev` spawn (`playwright.config.ts`), since it assumes the target
is already running. "Seeded" isn't automated here -- it means an org on
that Supabase project already has starter rules, a session with a
blocked event, and multi-project cost data in it, however that data got
there (a real SDK run, or a seed script someone writes later).

## Environment variable reference

| File | Service | Environment |
|---|---|---|
| `backend/.env.staging.example` | backend | staging |
| `backend/.env.production.example` | backend | production |
| `dashboard/.env.staging.example` | dashboard | staging |
| `dashboard/.env.production.example` | dashboard | production |
| `backend/.env.example` | backend | local dev |
| `dashboard/.env.example` | dashboard | local dev |
