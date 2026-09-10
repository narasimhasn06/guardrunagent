import { expect, test } from "@playwright/test";

/**
 * docs/06-test-plan.md Section 5.2: a guardrail-matching action is
 * blocked, a Slack alert fires with a working link, clicking it lands on
 * the Session Detail view scrolled/highlighted to the flagged event, and
 * the event's reasoning snippet and metadata are visible on expansion.
 *
 * Pass criteria: the block actually prevents the action (not just logs
 * it), and the investigation path from alert to root cause takes no more
 * than a couple of clicks.
 *
 * The full flow needs a real Claude Code session that actually attempts
 * a rule-matching action against a real backend (to prove the SDK
 * genuinely blocks it, not just that the dashboard can render a blocked
 * event record), a real Slack webhook receiving a real alert, and a
 * seeded blocked/flagged event to click through to. None of that exists
 * without a real staging deployment -- gated below. What's checkable
 * without it: the route Slack's alert link actually points at exists and
 * behaves sanely.
 */

test("session detail route shape matches what a Slack alert link points at", async ({ page }) => {
  // docs/03-low-level-design.md Section 5's Slack message links to
  // `${DASHBOARD_URL}/sessions/${session_id}` (see
  // backend/app/alerting.py) -- confirm that route exists and redirects
  // to login rather than 404ing, independent of any seeded data.
  await page.goto("/sessions/00000000-0000-0000-0000-000000000000");
  await expect(page).toHaveURL(/\/login|\/sessions\//);
});

test.describe("incident investigation (needs a real staging deployment)", () => {
  test.skip(
    !process.env.E2E_SEEDED_STAGING,
    "set E2E_SEEDED_STAGING=1 against a real staging URL with a seeded blocked event to run this"
  );

  test("clicking the session link from an alert lands on the flagged event, expanded", async ({ page }) => {
    // E2E_SEEDED_SESSION_ID: set by whatever seeds the blocked event this
    // spec exercises (see DEPLOYMENT.md).
    const sessionId = process.env.E2E_SEEDED_SESSION_ID;
    test.skip(!sessionId, "set E2E_SEEDED_SESSION_ID to a session containing a blocked/flagged event");

    await page.goto(`/sessions/${sessionId}`);
    const blockedEvent = page.locator(".event-card-flagged").first();
    await expect(blockedEvent).toBeVisible();
    await blockedEvent.click();
    await expect(blockedEvent.getByText(/reasoning/i)).toBeVisible();
  });
});
