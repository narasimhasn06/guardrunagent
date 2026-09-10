# Deployment

How to deploy the backend and dashboard per docs/05-architecture-document.md
Section 5 (Deployment View): two independently-deployable services, each
with a staging and a production environment, each environment backed by
its own Supabase project.

## Current status

- **Render**: `render.yaml` at the repo root defines all four services
  (backend x{staging, production}, dashboard x{staging, production}).
  Verified against Render's current Blueprint spec.
- **Railway**: not configured yet. Railway's "Config as Code"
  (`railway.json`/`railway.toml`) is being deprecated in favor of a new
  TypeScript-based `.railway/railway.ts` Infrastructure-as-Code system;
  the old format only keeps working until **2026-12-01**, and the new
  format's docs weren't reachable to verify while writing this, so
  nothing was written rather than guess at syntax that might not apply
  cleanly. If you want Railway, either configure it directly in Railway's
  dashboard (no config file required) or revisit this once
  `.railway/railway.ts`'s docs can be checked against.
- **CI**: `.github/workflows/ci.yml` runs the backend/dashboard/SDK test
  suites on every PR. It does not deploy anything -- see "How deploys
  actually happen" below.
- **Supabase**: only one project exists today (created earlier in this
  project, all current migrations applied to it). A second project is
  needed before this staging/production split is real -- see
  "Before the first deploy" below.

## Before the first deploy

1. **Create a second Supabase project.** Right now there's one Supabase
   project with every migration in `supabase/migrations/` applied to it.
   Decide which of {existing project, a newly-created one} is `staging`
   and which is `production`, and run every migration in
   `supabase/migrations/` against whichever one is new, in order, the
   same way they were applied to the first (Supabase SQL Editor, RLS left
   off -- see the comments in each migration file and this project's own
   history for why).
2. **Confirm Auth is configured the same way on both projects**: email/
   password + Google OAuth enabled, "Confirm email" on (for safe account
   auto-linking by email, per docs/03-low-level-design.md's auth note).
3. Decide the deploy region (`region: oregon` in `render.yaml` is a
   placeholder -- Section 5 says this should be "chosen based on where
   pilot customers are concentrated," which hasn't been decided).

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
