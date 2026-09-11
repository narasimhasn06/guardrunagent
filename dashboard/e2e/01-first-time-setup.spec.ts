import { expect, test } from "@playwright/test";

/**
 * docs/06-test-plan.md Section 5.1: sign up (email/password AND,
 * separately, Google), see the empty-state setup checklist, install the
 * SDK + configure the API key + run a session, see it appear in the
 * Sessions list, enable starter guardrail rules with one click.
 *
 * Pass criteria: all steps complete without manual intervention or
 * unhandled errors; session data is accurate and complete.
 *
 * Steps 2-5 need a real Supabase project (to actually create an
 * account), a real deployed backend to receive SDK events, and an actual
 * Claude Code session run against it -- none of which exist in an
 * unattended run against a local dev server. Those are written out in
 * full below, gated behind E2E_SEEDED_STAGING, so they're ready to run
 * for real the moment a staging deployment with a seeded org exists (see
 * DEPLOYMENT.md). What's checkable without any of that -- the login
 * screen itself -- runs unconditionally.
 */

test("login screen offers both documented sign-up paths", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("unauthenticated visitors are redirected away from the dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test.describe("full first-time setup flow (needs a real staging deployment)", () => {
  test.skip(
    !process.env.E2E_SEEDED_STAGING,
    "set E2E_SEEDED_STAGING=1 against a real staging URL with a seeded SDK install to run this"
  );

  test("new email/password signup creates an org, then lands on the empty-state Home checklist", async ({
    page,
  }) => {
    const email = `e2e-${Date.now()}@example.com`;
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("a-real-test-password-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    // No account exists yet -- the form flips to sign-up mode per
    // login-form.tsx's documented behavior (see its own top comment).
    await page.getByRole("button", { name: "Create account" }).click();

    // A real signup (not an invite) has no org yet -- app/(dashboard)/layout.tsx
    // shows components/onboarding/create-org-form.tsx instead of any
    // dashboard page until one exists (backend/app/routers/orgs.py).
    await expect(page.getByText("Create your organization")).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("Organization name").fill(`E2E Org ${Date.now()}`);
    await page.getByRole("button", { name: "Create organization" }).click();

    await expect(page.getByText("You're all set")).toBeVisible();
    await page.getByRole("button", { name: "Continue to dashboard" }).click();
    await expect(page.getByText(/setup checklist/i)).toBeVisible({ timeout: 15_000 });
  });

  test("a session run against this org's API key appears in the Sessions list", async ({ page }) => {
    // Precondition: E2E_SEEDED_STAGING's org has already had at least one
    // real Claude Code session run against it via the SDK (step 3 of the
    // documented flow -- "install SDK, configure API key, run a session"
    // -- happens out of band before this spec runs; Playwright itself
    // doesn't drive a Claude Code session).
    await page.goto("/sessions");
    await expect(page.locator(".sessions-table-row").first()).toBeVisible({ timeout: 15_000 });
  });

  test("starter guardrail rules can be enabled with one click", async ({ page }) => {
    await page.goto("/rules");
    await page.getByRole("button", { name: "Enable starter rules" }).click();
    await expect(page.getByText(/starter rule/i)).toBeVisible();
  });
});
