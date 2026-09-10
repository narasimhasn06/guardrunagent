import type { SessionDetailOut } from "@/lib/backend";

/**
 * Sticky right-side panel per docs/04-ui-ux-design.md Section 3.3.
 * The doc describes a scroll-position-aware "running cost total as you
 * scroll" -- this ships the simpler static session-total version instead
 * (the doc itself marks the panel "optional, collapsible"); the dynamic
 * per-scroll-position running sum is a reasonable later refinement, not
 * implemented here.
 */
export function CostPanel({ session }: { session: SessionDetailOut }) {
  return (
    <aside className="cost-panel">
      <div className="cost-panel-row">
        <span>Total cost</span>
        <span className="mono">${Number(session.total_cost_usd).toFixed(4)}</span>
      </div>
      <div className="cost-panel-row">
        <span>Total tokens</span>
        <span className="mono">{session.total_tokens.toLocaleString()}</span>
      </div>
      <div className="cost-panel-row">
        <span>Events</span>
        <span className="mono">{session.event_count.toLocaleString()}</span>
      </div>
    </aside>
  );
}
