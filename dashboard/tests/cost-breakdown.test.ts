import { describe, expect, it } from "vitest";

import type { CostBreakdownRow, CostSummaryRow } from "@/lib/backend";
import { buildSingleSeriesChartData, buildStackedChartData, CATEGORICAL_COLORS, OTHER_COLOR } from "@/lib/costBreakdown";

describe("buildStackedChartData", () => {
  it("fills every day in the range, even ones with no data", () => {
    const rows: CostBreakdownRow[] = [{ day: "2026-09-08", group_key: "repo-a", cost_usd: "1.00" }];
    const result = buildStackedChartData(rows, new Date("2026-09-08T00:00:00Z"), new Date("2026-09-10T00:00:00Z"));

    expect(result.days.map((d) => d.date)).toEqual(["2026-09-08", "2026-09-09", "2026-09-10"]);
    expect(result.days[1].segments).toEqual([]);
    expect(result.days[1].total).toBe(0);
  });

  it("assigns colors in a fixed, alphabetical order rather than by value-rank", () => {
    const rows: CostBreakdownRow[] = [
      { day: "2026-09-08", group_key: "zebra", cost_usd: "10.00" }, // biggest spender
      { day: "2026-09-08", group_key: "alpha", cost_usd: "1.00" }, // smallest spender
    ];
    const result = buildStackedChartData(rows, new Date("2026-09-08T00:00:00Z"), new Date("2026-09-08T00:00:00Z"));

    // alpha sorts first alphabetically, so it gets the first color slot --
    // regardless of zebra having ten times the spend.
    expect(result.legend).toEqual([
      { key: "alpha", color: CATEGORICAL_COLORS[0] },
      { key: "zebra", color: CATEGORICAL_COLORS[1] },
    ]);
  });

  it("keeps the same color for a group across two different date ranges", () => {
    const rangeA: CostBreakdownRow[] = [
      { day: "2026-09-08", group_key: "repo-a", cost_usd: "1.00" },
      { day: "2026-09-08", group_key: "repo-b", cost_usd: "5.00" },
    ];
    const rangeB: CostBreakdownRow[] = [
      { day: "2026-09-15", group_key: "repo-b", cost_usd: "1.00" },
      { day: "2026-09-15", group_key: "repo-a", cost_usd: "5.00" },
    ];
    const resultA = buildStackedChartData(rangeA, new Date("2026-09-08T00:00:00Z"), new Date("2026-09-08T00:00:00Z"));
    const resultB = buildStackedChartData(rangeB, new Date("2026-09-15T00:00:00Z"), new Date("2026-09-15T00:00:00Z"));

    const colorFor = (legend: typeof resultA.legend, key: string) => legend.find((l) => l.key === key)?.color;
    expect(colorFor(resultA.legend, "repo-a")).toBe(colorFor(resultB.legend, "repo-a"));
    expect(colorFor(resultA.legend, "repo-b")).toBe(colorFor(resultB.legend, "repo-b"));
  });

  it("folds the smallest contributors into 'Other' beyond the palette's 8 slots", () => {
    const rows: CostBreakdownRow[] = Array.from({ length: 10 }, (_, i) => ({
      day: "2026-09-08",
      group_key: `project-${i}`,
      cost_usd: String(10 - i), // project-0 biggest, project-9 smallest
    }));
    const result = buildStackedChartData(rows, new Date("2026-09-08T00:00:00Z"), new Date("2026-09-08T00:00:00Z"));

    const legendKeys = result.legend.map((l) => l.key);
    expect(legendKeys).toHaveLength(9); // 8 explicit + "Other"
    expect(legendKeys).toContain("Other");
    expect(legendKeys).not.toContain("project-8"); // one of the two smallest
    expect(legendKeys).not.toContain("project-9");
    expect(result.legend.find((l) => l.key === "Other")?.color).toBe(OTHER_COLOR);

    const day = result.days[0];
    const otherSegment = day.segments.find((s) => s.key === "Other");
    expect(otherSegment?.value).toBeCloseTo(2 + 1, 5); // project-8 ($2) + project-9 ($1)
  });

  it("never generates a 9th categorical color", () => {
    const rows: CostBreakdownRow[] = Array.from({ length: 12 }, (_, i) => ({
      day: "2026-09-08",
      group_key: `p${i}`,
      cost_usd: "1.00",
    }));
    const result = buildStackedChartData(rows, new Date("2026-09-08T00:00:00Z"), new Date("2026-09-08T00:00:00Z"));

    const usedColors = new Set(result.legend.map((l) => l.color));
    for (const color of usedColors) {
      expect([...CATEGORICAL_COLORS, OTHER_COLOR]).toContain(color);
    }
  });

  it("omits zero-value segments from a day (only shows what was actually spent)", () => {
    const rows: CostBreakdownRow[] = [{ day: "2026-09-08", group_key: "repo-a", cost_usd: "1.00" }];
    const result = buildStackedChartData(rows, new Date("2026-09-08T00:00:00Z"), new Date("2026-09-09T00:00:00Z"));

    expect(result.days[0].segments).toHaveLength(1);
    expect(result.days[1].segments).toHaveLength(0);
  });
});

describe("buildSingleSeriesChartData", () => {
  it("produces one 'Total' segment per day with data, and none for empty days", () => {
    const rows: CostSummaryRow[] = [
      { group_key: "2026-09-08", total_cost_usd: "1.50", total_tokens: 100, event_count: 2 },
    ];
    const result = buildSingleSeriesChartData(
      rows,
      new Date("2026-09-08T00:00:00Z"),
      new Date("2026-09-09T00:00:00Z")
    );

    expect(result.days[0].segments).toEqual([{ key: "Total", value: 1.5, color: CATEGORICAL_COLORS[0] }]);
    expect(result.days[1].segments).toEqual([]);
    expect(result.legend).toEqual([]); // single series -- no legend box needed
  });
});
