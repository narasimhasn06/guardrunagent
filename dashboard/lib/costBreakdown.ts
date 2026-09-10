import type { CostBreakdownRow, CostSummaryRow } from "./backend";

// Categorical palette, dark-mode steps, in the dataviz skill's validated
// fixed order (worst adjacent CVD Delta E 8.4, normal-vision 19.3, both
// clearing the skill's floors on the dark surface).
export const CATEGORICAL_COLORS = [
  "#3987e5", // blue
  "#d95926", // orange
  "#199e70", // aqua
  "#c98500", // yellow
  "#d55181", // magenta
  "#008300", // green
  "#9085e9", // violet
  "#e66767", // red
];
export const OTHER_COLOR = "#5c6068"; // muted gray, distinct from every categorical slot

const MAX_EXPLICIT_SERIES = CATEGORICAL_COLORS.length;

export interface StackedSegment {
  key: string;
  value: number;
  color: string;
}

export interface StackedDay {
  date: string;
  segments: StackedSegment[];
  total: number;
}

export interface LegendItem {
  key: string;
  color: string;
}

export interface StackedChartData {
  days: StackedDay[];
  legend: LegendItem[];
}

function enumerateDays(start: Date, end: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= endDay) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * Pivots long-format (day, group_key, cost) rows into per-day stacked
 * segments, per the dataviz skill's method: categorical hues assigned in
 * a fixed order that depends only on the group's identity (alphabetical),
 * never on its value-rank -- so a date-range change that reorders which
 * project is biggest never repaints an existing project's color. Capped
 * at the palette's 8 slots; beyond that, the smallest contributors fold
 * into "Other" (a value-based decision) rather than generating new hues.
 */
export function buildStackedChartData(rows: CostBreakdownRow[], start: Date, end: Date): StackedChartData {
  const days = enumerateDays(start, end);

  const totalsByGroup = new Map<string, number>();
  for (const row of rows) {
    const value = Number(row.cost_usd);
    totalsByGroup.set(row.group_key, (totalsByGroup.get(row.group_key) ?? 0) + value);
  }

  const allGroupsAlphabetical = Array.from(totalsByGroup.keys()).sort((a, b) => a.localeCompare(b));

  const explicitGroups =
    allGroupsAlphabetical.length <= MAX_EXPLICIT_SERIES
      ? allGroupsAlphabetical
      : Array.from(totalsByGroup.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, MAX_EXPLICIT_SERIES)
          .map(([key]) => key);
  const explicitGroupSet = new Set(explicitGroups);
  const hasOther = allGroupsAlphabetical.length > MAX_EXPLICIT_SERIES;

  const colorByGroup = new Map<string, string>();
  let slot = 0;
  for (const group of allGroupsAlphabetical) {
    if (explicitGroupSet.has(group)) {
      colorByGroup.set(group, CATEGORICAL_COLORS[slot % CATEGORICAL_COLORS.length]);
      slot++;
    }
  }

  const legend: LegendItem[] = allGroupsAlphabetical
    .filter((group) => explicitGroupSet.has(group))
    .map((key) => ({ key, color: colorByGroup.get(key)! }));
  if (hasOther) {
    legend.push({ key: "Other", color: OTHER_COLOR });
  }

  const rowsByDay = new Map<string, CostBreakdownRow[]>();
  for (const row of rows) {
    const list = rowsByDay.get(row.day) ?? [];
    list.push(row);
    rowsByDay.set(row.day, list);
  }

  const stackedDays: StackedDay[] = days.map((date) => {
    const dayRows = rowsByDay.get(date) ?? [];
    const valueByBucket = new Map<string, number>();
    for (const row of dayRows) {
      const value = Number(row.cost_usd);
      const bucket = explicitGroupSet.has(row.group_key) ? row.group_key : "Other";
      valueByBucket.set(bucket, (valueByBucket.get(bucket) ?? 0) + value);
    }

    const segments: StackedSegment[] = legend
      .map((item) => ({ key: item.key, value: valueByBucket.get(item.key) ?? 0, color: item.color }))
      .filter((segment) => segment.value > 0);

    return { date, segments, total: segments.reduce((sum, s) => sum + s.value, 0) };
  });

  return { days: stackedDays, legend };
}

/**
 * The "Day" toggle's chart is a plain (non-stacked) bar of daily totals --
 * a single series needs no legend, per the dataviz skill.
 */
export function buildSingleSeriesChartData(rows: CostSummaryRow[], start: Date, end: Date): StackedChartData {
  const days = enumerateDays(start, end);
  const valueByDay = new Map(rows.map((row) => [row.group_key, Number(row.total_cost_usd)]));

  const stackedDays: StackedDay[] = days.map((date) => {
    const value = valueByDay.get(date) ?? 0;
    const segments: StackedSegment[] = value > 0 ? [{ key: "Total", value, color: CATEGORICAL_COLORS[0] }] : [];
    return { date, segments, total: value };
  });

  return { days: stackedDays, legend: [] };
}
