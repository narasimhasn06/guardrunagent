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
- **Supabase**: the existing project (created earlier in this project) is
  designated **staging**. A second project is needed for production --
  see "Before the first deploy" below. **Don't trust "all migrations
  applied" on faith for any project, including this one**: staging was
  believed fully migrated but was actually missing 3 of the 12 files
  (`...0007`, `...0008`, `...0009` -- the `cost_summary`, `list_sessions`,
  and `cost_breakdown_by_day` functions) and one column
  (`...0010`'s `guardrail_activity.session_id`), discovered only when
  `/dashboard-summary` 500'd in production with `PGRST202: Could not find
  the function public.cost_summary(...)`. Verify with the two queries in
  "Before the first deploy" step 1 before believing a project is current.

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
3. Decide the deploy region (`region: oregon` in `render.yaml` is a
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
7. For **production**, later: a new Railway **environment** inside the
   same project (Railway's environments feature -- separate variable
   sets and, per-environment, which branch/deploy trigger to use),
   pointed at the second Supabase project once that exists. Set it to
   deploy manually rather than on every push to `main`, matching
   Section 5's "manual promote to production."

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

- **Staging** (`autoDeploy: true` in `render.yaml`): every push to `main`
  that passes CI auto-deploys to both staging services. This *is* the
  "auto-deploy to staging on merge to main" behavior from Section 5 --
  it's Render's own native git-push deploy, not something the GitHub
  Actions workflow triggers.
- **Production** (`autoDeploy: false`): deploys only when someone
  manually triggers one from the Render dashboard (or `render deploy` via
  Render's CLI), picking the commit to promote. This is the "manual
  promote to production" step from Section 5.
- `.github/workflows/ci.yml` only runs tests on PRs -- it's a gate, not a
  deploy mechanism. A red PR can't merge to `main` and therefore can't
  reach staging; nothing stops a human from promoting a bad commit to
  production, since that step is manual by design.

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
