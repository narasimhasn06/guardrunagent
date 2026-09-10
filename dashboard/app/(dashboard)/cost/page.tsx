import { CostChart } from "@/components/cost/cost-chart";
import { CostDateRangeSelect, type CostRangePreset } from "@/components/cost/cost-date-range-select";
import { CostTable } from "@/components/cost/cost-table";
import { ExportCsvButton } from "@/components/cost/export-csv-button";
import { GroupByToggle } from "@/components/cost/group-by-toggle";
import { SpendSummary } from "@/components/cost/spend-summary";
import { BackendError, getCostBreakdown, getCostSummary, type CostGroupBy } from "@/lib/backend";
import { buildSingleSeriesChartData, buildStackedChartData } from "@/lib/costBreakdown";

const RANGE_DAYS: Record<CostRangePreset, number> = { "7d": 7, "30d": 30, "90d": 90 };
const GROUP_LABELS: Record<CostGroupBy, string> = { day: "Day", project: "Project", agent: "Agent" };

function isGroupBy(value: string | undefined): value is CostGroupBy {
  return value === "day" || value === "project" || value === "agent";
}

function isRangePreset(value: string | undefined): value is CostRangePreset {
  return value === "7d" || value === "30d" || value === "90d";
}

export default async function CostPage({
  searchParams,
}: {
  searchParams: Promise<{ group_by?: string; range?: string }>;
}) {
  const params = await searchParams;
  const groupBy: CostGroupBy = isGroupBy(params.group_by) ? params.group_by : "day";
  const rangePreset: CostRangePreset = isRangePreset(params.range) ? params.range : "30d";
  const rangeDays = RANGE_DAYS[rangePreset];

  const end = new Date();
  const start = new Date(end.getTime() - rangeDays * 24 * 60 * 60 * 1000);
  const previousEnd = start;
  const previousStart = new Date(start.getTime() - rangeDays * 24 * 60 * 60 * 1000);

  let summary;
  let previousSummary;
  let breakdownRows: Awaited<ReturnType<typeof getCostBreakdown>>["rows"] = [];
  try {
    [summary, previousSummary] = await Promise.all([
      getCostSummary(groupBy, start, end),
      getCostSummary("day", previousStart, previousEnd), // grouping doesn't matter -- only the total is used
    ]);
    if (groupBy !== "day") {
      breakdownRows = (await getCostBreakdown(groupBy, start, end)).rows;
    }
  } catch (err) {
    const message = err instanceof BackendError ? err.message : "Unexpected error loading cost data.";
    return (
      <div>
        <h1 className="page-title">Cost</h1>
        <p className="login-error">Couldn&apos;t load cost data: {message}</p>
      </div>
    );
  }

  const chartData =
    groupBy === "day"
      ? buildSingleSeriesChartData(summary.rows, start, end)
      : buildStackedChartData(breakdownRows, start, end);

  return (
    <div className="cost-page">
      <header className="home-header">
        <h1 className="page-title">Cost</h1>
        <div className="cost-page-controls">
          <GroupByToggle current={groupBy} />
          <CostDateRangeSelect current={rangePreset} />
        </div>
      </header>

      <SpendSummary current={Number(summary.total_cost_usd)} previous={Number(previousSummary.total_cost_usd)} />

      <section className="home-card">
        <h2 className="home-card-title">
          Spend per day{groupBy !== "day" ? `, by ${GROUP_LABELS[groupBy].toLowerCase()}` : ""}
        </h2>
        <CostChart days={chartData.days} legend={chartData.legend} />
      </section>

      <section className="home-card">
        <div className="cost-table-header">
          <h2 className="home-card-title">Breakdown by {GROUP_LABELS[groupBy].toLowerCase()}</h2>
          <ExportCsvButton
            rows={summary.rows}
            groupLabel={GROUP_LABELS[groupBy]}
            filename={`guardrunagent-cost-${groupBy}-${rangePreset}.csv`}
          />
        </div>
        <CostTable rows={summary.rows} groupLabel={GROUP_LABELS[groupBy]} />
      </section>
    </div>
  );
}
