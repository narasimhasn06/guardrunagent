import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { RecentActivity } from "@/components/home/recent-activity";
import { SetupChecklist } from "@/components/home/setup-checklist";
import { SpendChart } from "@/components/home/spend-chart";
import type { RecentActivityItem as RecentActivityItemType, SpendByDayRow } from "@/lib/backend";

describe("SpendChart", () => {
  it("shows a placeholder when there is no data", () => {
    render(<SpendChart data={[]} />);
    expect(screen.getByText(/no spend recorded/i)).toBeInTheDocument();
  });

  it("renders a chart with no tooltip until interacted with", () => {
    const data: SpendByDayRow[] = [
      { date: "2026-09-08", cost_usd: "1.50" },
      { date: "2026-09-09", cost_usd: "2.25" },
    ];
    render(<SpendChart data={data} />);
    expect(screen.getByRole("slider", { name: /spend per day/i })).toBeInTheDocument();
    expect(screen.queryByText("$1.50")).not.toBeInTheDocument();
    expect(screen.queryByText("$2.25")).not.toBeInTheDocument();
  });

  it("shows the tooltip for the most recent day on keyboard focus, and moves it with arrow keys", async () => {
    const user = userEvent.setup();
    const data: SpendByDayRow[] = [
      { date: "2026-09-08", cost_usd: "1.50" },
      { date: "2026-09-09", cost_usd: "2.25" },
      { date: "2026-09-10", cost_usd: "0.75" },
    ];
    render(<SpendChart data={data} />);

    const slider = screen.getByRole("slider", { name: /spend per day/i });
    await user.tab(); // focuses the (only) focusable element -- the chart

    expect(slider).toHaveFocus();
    expect(screen.getByText("$0.75")).toBeInTheDocument(); // last day, on initial focus

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("$2.25")).toBeInTheDocument();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("$1.50")).toBeInTheDocument();
  });

  it("does not let arrow-left move before the first day", async () => {
    const user = userEvent.setup();
    const data: SpendByDayRow[] = [{ date: "2026-09-08", cost_usd: "1.50" }];
    render(<SpendChart data={data} />);

    await user.tab();
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");

    expect(screen.getByText("$1.50")).toBeInTheDocument();
  });
});

describe("RecentActivity", () => {
  function makeItem(overrides: Partial<RecentActivityItemType> = {}): RecentActivityItemType {
    return {
      id: "11111111-1111-1111-1111-111111111111",
      session_id: "22222222-2222-2222-2222-222222222222",
      action_type: "bash",
      action_summary: "npm install",
      status: "success",
      created_at: "2026-09-10T10:00:00Z",
      ...overrides,
    };
  }

  it("shows a placeholder when there is no activity", () => {
    render(<RecentActivity items={[]} />);
    expect(screen.getByText(/no activity in this range/i)).toBeInTheDocument();
  });

  it("pairs the status dot with a visible text label, not color alone", () => {
    render(<RecentActivity items={[makeItem({ status: "blocked" })]} />);
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  it("links each item to its session detail page", () => {
    render(<RecentActivity items={[makeItem({ session_id: "session-xyz" })]} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/sessions/session-xyz");
  });

  it("renders most-recent-first order as given (the backend already orders by created_at desc)", () => {
    const items = [
      makeItem({ id: "a", action_summary: "newest", created_at: "2026-09-10T10:00:10Z" }),
      makeItem({ id: "b", action_summary: "oldest", created_at: "2026-09-10T10:00:00Z" }),
    ];
    render(<RecentActivity items={items} />);
    const summaries = screen.getAllByText(/newest|oldest/).map((el) => el.textContent);
    expect(summaries).toEqual(["newest", "oldest"]);
  });
});

describe("SetupChecklist", () => {
  it("shows all three steps and the real plugin install commands", () => {
    render(<SetupChecklist />);
    expect(screen.getByText(/install the sdk/i)).toBeInTheDocument();
    expect(screen.getByText(/add your api key/i)).toBeInTheDocument();
    expect(screen.getByText(/run your first session/i)).toBeInTheDocument();
    // Not `npm install` -- Claude Code never scans node_modules for
    // plugins, so the real install path is /plugin marketplace add + install.
    expect(screen.getByText("/plugin marketplace add narasimhasn06/guardrunagent")).toBeInTheDocument();
    expect(screen.getByText("/plugin install guardrunagent@guardrunagent")).toBeInTheDocument();
  });

  it("links the API key step to Settings", () => {
    render(<SetupChecklist />);
    expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute("href", "/settings");
  });
});
