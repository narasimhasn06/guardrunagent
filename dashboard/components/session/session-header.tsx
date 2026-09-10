import type { SessionDetailOut } from "@/lib/backend";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatCost(value: string): string {
  return `$${Number(value).toFixed(4)}`;
}

export function SessionHeader({ session }: { session: SessionDetailOut }) {
  return (
    <header className="session-header">
      <div>
        <h1 className="page-title mono">{session.id}</h1>
        <p className="session-header-meta">
          {session.project_label ?? "Unlabeled project"} &middot; {session.agent_name}
        </p>
      </div>
      <dl className="session-header-stats">
        <div>
          <dt>Started</dt>
          <dd>{formatDateTime(session.started_at)}</dd>
        </div>
        <div>
          <dt>Ended</dt>
          <dd>{session.ended_at ? formatDateTime(session.ended_at) : "In progress"}</dd>
        </div>
        <div>
          <dt>Total cost</dt>
          <dd className="mono">{formatCost(session.total_cost_usd)}</dd>
        </div>
        <div>
          <dt>Total tokens</dt>
          <dd className="mono">{session.total_tokens.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <span className="status-pill">{session.status}</span>
          </dd>
        </div>
      </dl>
    </header>
  );
}
