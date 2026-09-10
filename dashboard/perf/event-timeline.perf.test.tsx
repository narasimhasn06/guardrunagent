import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EventTimeline } from "@/components/session/event-timeline";
import type { AgentEventOut } from "@/lib/backend";

/**
 * docs/06-test-plan.md Section 6: "Session Replay load time | Under 2
 * seconds for a 500-event session | Seed a staging session with 500
 * synthetic events, measure page load."
 *
 * This measures the other half of that budget from
 * backend/scripts/load_test_session_detail.py: not how long the backend
 * takes to return 500 events, but how long turning them into 500
 * rendered event cards actually takes on the client (EventTimeline is a
 * "use client" component -- see its own file -- so this is the same
 * React renderer a real browser uses, not a server-render simulation).
 *
 * jsdom does real DOM node construction and React reconciliation here,
 * but not real browser layout/paint -- so this is an optimistic lower
 * bound on real render time, not the full page-load number. Combine with
 * the backend script's measured time for an estimate of the whole
 * budget; neither piece alone is "the" NFR number. A true end-to-end
 * measurement needs a real staging deployment (see
 * dashboard/e2e/01-first-time-setup.spec.ts and DEPLOYMENT.md).
 *
 * Kept out of the default `npm test` run (see vitest.perf.config.ts) --
 * timing assertions don't belong in a per-PR CI gate on a shared runner.
 * Run with `npm run test:perf`.
 */

const STATUSES: AgentEventOut["status"][] = ["success", "success", "success", "flagged", "blocked", "failure"];
const ACTION_TYPES: AgentEventOut["action_type"][] = ["bash", "file_edit", "git", "api_call"];

function makeEvents(n: number): AgentEventOut[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `event-${i}`,
    action_type: ACTION_TYPES[i % ACTION_TYPES.length],
    action_summary: `synthetic action #${i} for load testing`,
    payload_meta: { index: i },
    reasoning_snippet: "Synthetic reasoning text for load-test event, long enough to be realistic. ".repeat(3),
    tokens_used: 120 + i,
    cost_usd: "0.0050",
    status: STATUSES[i % STATUSES.length],
    matched_rule_id: null,
    created_at: new Date(Date.UTC(2026, 8, 10, 10, 0, i)).toISOString(),
  }));
}

// Generous relative to the measured numbers this produced while writing
// it (a few hundred ms on ordinary hardware) -- meant to catch a real
// regression (an accidental O(n^2), a runaway re-render), not to assert
// the literal NFR target, which this test can only ever under-estimate
// (see the caveat above).
const REGRESSION_GUARD_MS = 3000;

describe("EventTimeline render time at NFR scale (500 events)", () => {
  it(`renders 500 events in comfortably under ${REGRESSION_GUARD_MS}ms (jsdom, not a real browser)`, () => {
    const events = makeEvents(500);

    const start = performance.now();
    const { container } = render(<EventTimeline events={events} ruleNamesById={new Map()} />);
    const elapsedMs = performance.now() - start;

    expect(container.querySelectorAll(".event-card")).toHaveLength(500);
    // eslint-disable-next-line no-console
    console.log(`EventTimeline render time for 500 events: ${elapsedMs.toFixed(1)}ms (jsdom)`);
    expect(elapsedMs).toBeLessThan(REGRESSION_GUARD_MS);
  });
});
