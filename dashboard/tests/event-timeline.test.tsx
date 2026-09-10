import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { EventTimeline } from "@/components/session/event-timeline";
import type { AgentEventOut } from "@/lib/backend";

// Cases per docs/06-test-plan.md Section 3.3 ("Session Replay"): events
// render in chronological order; blocked/flagged events show the correct
// visual treatment and matched rule name; expandable event cards show/hide
// reasoning correctly.

function makeEvent(overrides: Partial<AgentEventOut> = {}): AgentEventOut {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    action_type: "bash",
    action_summary: "npm install",
    payload_meta: null,
    reasoning_snippet: null,
    tokens_used: 100,
    cost_usd: "0.0020",
    status: "success",
    matched_rule_id: null,
    created_at: "2026-09-10T10:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("shows a placeholder when there are no events", () => {
    render(<EventTimeline events={[]} ruleNamesById={new Map()} />);
    expect(screen.getByText(/no events logged/i)).toBeInTheDocument();
  });

  it("renders events in the order given (chronological, since the backend already orders by created_at)", () => {
    const events = [
      makeEvent({ id: "event-1", action_summary: "first: npm install", created_at: "2026-09-10T10:00:00Z" }),
      makeEvent({ id: "event-2", action_summary: "second: npm test", created_at: "2026-09-10T10:00:05Z" }),
      makeEvent({ id: "event-3", action_summary: "third: git push", created_at: "2026-09-10T10:00:10Z" }),
    ];

    render(<EventTimeline events={events} ruleNamesById={new Map()} />);

    const summaries = screen.getAllByText(/^(first|second|third):/).map((el) => el.textContent);
    expect(summaries).toEqual(["first: npm install", "second: npm test", "third: git push"]);
  });

  it("shows the success status badge for a successful event", () => {
    render(<EventTimeline events={[makeEvent({ status: "success" })]} ruleNamesById={new Map()} />);
    expect(screen.getByText("Success")).toBeInTheDocument();
  });

  it("visually distinguishes a blocked event and shows the matched rule's name", () => {
    const event = makeEvent({
      id: "blocked-event",
      status: "blocked",
      action_summary: "git push --force origin main",
      matched_rule_id: "rule-1",
    });
    const ruleNamesById = new Map([["rule-1", "no-force-push-main"]]);

    render(<EventTimeline events={[event]} ruleNamesById={ruleNamesById} />);

    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText(/Blocked by rule:/)).toBeInTheDocument();
    expect(screen.getByText("no-force-push-main")).toBeInTheDocument();

    const card = screen.getByText("git push --force origin main").closest("li");
    expect(card).toHaveClass("event-card-flagged");
  });

  it("visually distinguishes a flagged event and shows the matched rule's name", () => {
    const event = makeEvent({
      id: "flagged-event",
      status: "flagged",
      action_summary: "edited /prod/config.yaml",
      action_type: "file_edit",
      matched_rule_id: "rule-2",
    });
    const ruleNamesById = new Map([["rule-2", "no-prod-edits"]]);

    render(<EventTimeline events={[event]} ruleNamesById={ruleNamesById} />);

    expect(screen.getByText("Flagged")).toBeInTheDocument();
    expect(screen.getByText(/Flagged by rule:/)).toBeInTheDocument();
    expect(screen.getByText("no-prod-edits")).toBeInTheDocument();
  });

  it("does not show a 'blocked by rule' line for a successful event", () => {
    render(<EventTimeline events={[makeEvent({ status: "success" })]} ruleNamesById={new Map()} />);
    expect(screen.queryByText(/blocked by rule/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/flagged by rule/i)).not.toBeInTheDocument();
  });

  it("does not render a rule line if the rule id has no matching name (e.g. rules fetch raced)", () => {
    const event = makeEvent({ status: "blocked", matched_rule_id: "unknown-rule-id" });
    render(<EventTimeline events={[event]} ruleNamesById={new Map()} />);
    expect(screen.queryByText(/blocked by rule/i)).not.toBeInTheDocument();
  });

  it("hides the reasoning snippet until the card is expanded, then shows it, then hides it again on toggle", async () => {
    const user = userEvent.setup();
    const event = makeEvent({ reasoning_snippet: "Running the test suite before committing." });

    render(<EventTimeline events={[event]} ruleNamesById={new Map()} />);

    expect(screen.queryByText("Running the test suite before committing.")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { expanded: false });
    await user.click(toggle);

    expect(screen.getByText("Running the test suite before committing.")).toBeInTheDocument();
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();

    await user.click(toggle);

    expect(screen.queryByText("Running the test suite before committing.")).not.toBeInTheDocument();
  });

  it("expanding one card collapses any previously expanded card", async () => {
    const user = userEvent.setup();
    const events = [
      makeEvent({ id: "a", action_summary: "event a", reasoning_snippet: "reason A" }),
      makeEvent({ id: "b", action_summary: "event b", reasoning_snippet: "reason B" }),
    ];

    render(<EventTimeline events={events} ruleNamesById={new Map()} />);

    const buttons = screen.getAllByRole("button");
    await user.click(buttons[0]);
    expect(screen.getByText("reason A")).toBeInTheDocument();

    await user.click(buttons[1]);
    expect(screen.queryByText("reason A")).not.toBeInTheDocument();
    expect(screen.getByText("reason B")).toBeInTheDocument();
  });

  it("shows payload metadata when expanded and no reasoning snippet is present", async () => {
    const user = userEvent.setup();
    const event = makeEvent({ payload_meta: { file_path: "src/index.ts" } });

    render(<EventTimeline events={[event]} ruleNamesById={new Map()} />);

    await user.click(screen.getByRole("button"));

    expect(screen.getByText("file_path")).toBeInTheDocument();
    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
  });

  it("shows a fallback message when expanded with no reasoning or metadata", async () => {
    const user = userEvent.setup();
    render(<EventTimeline events={[makeEvent()]} ruleNamesById={new Map()} />);

    await user.click(screen.getByRole("button"));

    expect(within(screen.getByRole("list")).getByText(/no additional detail available/i)).toBeInTheDocument();
  });
});
