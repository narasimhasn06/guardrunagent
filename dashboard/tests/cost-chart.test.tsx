import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CostChart } from "@/components/cost/cost-chart";
import type { StackedDay } from "@/lib/costBreakdown";

describe("CostChart", () => {
  it("shows a placeholder when every day has zero spend", () => {
    const days: StackedDay[] = [{ date: "2026-09-08", segments: [], total: 0 }];
    render(<CostChart days={days} legend={[]} />);
    expect(screen.getByText(/no spend recorded/i)).toBeInTheDocument();
  });

  it("does not show a legend for a single series", () => {
    const days: StackedDay[] = [
      { date: "2026-09-08", segments: [{ key: "Total", value: 1.5, color: "#3987e5" }], total: 1.5 },
    ];
    render(<CostChart days={days} legend={[]} />);
    expect(screen.queryByText("Total")).not.toBeInTheDocument(); // no legend box rendered
  });

  it("shows a legend listing every stacked series", () => {
    const days: StackedDay[] = [
      {
        date: "2026-09-08",
        segments: [
          { key: "repo-a", value: 1, color: "#3987e5" },
          { key: "repo-b", value: 2, color: "#d95926" },
        ],
        total: 3,
      },
    ];
    render(<CostChart days={days} legend={[{ key: "repo-a", color: "#3987e5" }, { key: "repo-b", color: "#d95926" }]} />);

    expect(screen.getByText("repo-a")).toBeInTheDocument();
    expect(screen.getByText("repo-b")).toBeInTheDocument();
  });

  it("shows every segment's value in the tooltip when a bar is focused", async () => {
    const user = userEvent.setup();
    const days: StackedDay[] = [
      {
        date: "2026-09-08",
        segments: [
          { key: "repo-a", value: 1, color: "#3987e5" },
          { key: "repo-b", value: 2, color: "#d95926" },
        ],
        total: 3,
      },
    ];
    render(
      <CostChart
        days={days}
        legend={[
          { key: "repo-a", color: "#3987e5" },
          { key: "repo-b", color: "#d95926" },
        ]}
      />
    );

    await user.tab();

    expect(screen.getByText("$1.00")).toBeInTheDocument();
    expect(screen.getByText("$2.00")).toBeInTheDocument();
    expect(screen.getByText("$3.00")).toBeInTheDocument(); // total row, shown when >1 segment
  });
});
