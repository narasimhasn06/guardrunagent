import { expect, test } from "@playwright/test";

/**
 * docs/06-test-plan.md Section 5.4: sign up with email/password, sign in
 * with Google using the same email, confirm it resolves to the same
 * account/org (not a duplicate), confirm password-reset is only offered
 * where applicable.
 *
 * Pass criteria: no duplicate accounts are ever created; password-reset
 * visibility is correct per user type.
 *
 * The account-linking assertion needs a real Google test account and a
 * real Supabase project with "Confirm email" on (the setting this
 * project turned on specifically to enable safe auto-linking by email --
 * see CLAUDE.md's decisions log) -- Playwright can't drive Google's real
 * OAuth consent screen unattended without a throwaway account, and
 * shouldn't fake Supabase's own linking behavior (that would test this
 * script, not the product). Gated below. What's unconditionally
 * checkable is the login screen's own documented behavior.
 */

test("forgot-password always responds with the same generic message", async ({ page }) => {
  // login-form.tsx's documented anti-enumeration behavior (see its own
  // top comment): the message never reveals whether the email exists.
  await page.goto("/login");
  await page.getByLabel("Email").fill(`nonexistent-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByText(/if an account with that email exists/i)).toBeVisible();
});

test("forgot-password requires an email first", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByText(/enter your email above first/i)).toBeVisible();
});

test.describe("account linking (needs a real Supabase project + Google test account)", () => {
  test.skip(
    !process.env.E2E_SEEDED_STAGING,
    "set E2E_SEEDED_STAGING=1 (plus real Google test-account credentials) against a real staging URL to run this"
  );

  test("signing in with Google using an existing email/password account's address resolves to the same org", async () => {
    test.fixme(true, "wire up a throwaway Google test account before enabling this");
  });
});
