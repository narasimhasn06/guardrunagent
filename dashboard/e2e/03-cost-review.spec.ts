import { expect, test } from "@playwright/test";

/**
 * docs/06-test-plan.md Section 5.3: generate events across multiple
 * projects/days, open the Cost Dashboard, toggle between Day/Project/
 * Agent grouping, verify the chart and table numbers stay in sync, export
 * CSV and verify its contents match what's displayed.
 *
 * Pass criteria: cost numbers are accurate to the underlying event data
 * (spot-check against a manual sum).
 *
 * All of this needs real seeded event data across multiple projects/days
 * in a real Supabase project -- gated below. CSV *formatting* correctness
 * (columns, decimal precision, matching the displayed rows) is already
 * covered at the unit level in dashboard/tests/cost-components.test.tsx
 * and csv.test.ts; what this file adds once staging exists is confirming
 * the real page actually triggers a real download and that switching
 * group-by doesn't change the total.
 */

test.describe("cost review (needs a real staging deployment)", () => {
  test.skip(
    !process.env.E2E_SEEDED_STAGING,
    "set E2E_SEEDED_STAGING=1 against a real staging URL with seeded multi-project cost data to run this"
  );

  test("switching group-by keeps the displayed total spend unchanged", async ({ page }) => {
    await page.goto("/cost");
    const totalBefore = await page.locator(".spend-summary-value").textContent();
    await page.getByRole("button", { name: "Project" }).click();
    await expect(page.locator(".spend-summary-value")).toHaveText(totalBefore ?? "");
  });

  test("Export CSV triggers a real file download", async ({ page }) => {
    await page.goto("/cost");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export CSV" }).click(),
    ]);
    expect(await download.path()).toBeTruthy();
  });
});
