import { DateRangeSelect } from "@/components/home/date-range-select";
import { RecentActivity } from "@/components/home/recent-activity";
import { SetupChecklist } from "@/components/home/setup-checklist";
import { SpendChart } from "@/components/home/spend-chart";
import { StatCard } from "@/components/home/stat-card";
import { BackendError, getDashboardSummary, type DateRangePreset } from "@/lib/backend";

function isPreset(value: string | undefined): value is DateRangePreset {
  return value === "7d" || value === "30d";
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const preset: DateRangePreset = isPreset(range) ? range : "7d";

  let summary;
  try {
    summary = await getDashboardSummary(preset);
  } catch (err) {
    const message = err instanceof BackendError ? err.message : "Unexpected error loading the dashboard.";
    return (
      <div>
        <h1 className="page-title">Home</h1>
        <p className="login-error">Couldn&apos;t load your dashboard: {message}</p>
      </div>
    );
  }

  return (
    <div className="home-page">
      <header className="home-header">
        <h1 className="page-title">{summary.org_name || "Home"}</h1>
        <DateRangeSelect current={preset} />
      </header>

      {!summary.org_has_any_sessions ? (
        <SetupChecklist />
      ) : (
        <>
          <div className="stat-cards-row">
            <StatCard label="Total Sessions" value={summary.total_sessions.toLocaleString()} />
            <StatCard label="Total Spend" value={`$${Number(summary.total_spend_usd).toFixed(2)}`} />
            <StatCard label="Guardrail Blocks" value={summary.guardrail_blocks.toLocaleString()} />
            <StatCard label="Active Agents" value={summary.active_agents.toLocaleString()} />
          </div>

          <section className="home-card">
            <h2 className="home-card-title">Spend per day</h2>
            <SpendChart data={summary.spend_by_day} />
          </section>

          <section className="home-card">
            <h2 className="home-card-title">Recent Activity</h2>
            <RecentActivity items={summary.recent_activity} />
          </section>
        </>
      )}
    </div>
  );
}
