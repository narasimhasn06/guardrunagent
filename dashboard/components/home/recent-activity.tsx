import Link from "next/link";

import type { EventStatus, RecentActivityItem as RecentActivityItemType } from "@/lib/backend";

const STATUS_LABELS: Record<EventStatus, string> = {
  success: "Success",
  failure: "Failure",
  blocked: "Blocked",
  flagged: "Flagged",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * "Recent Activity: last 10 events across all sessions, most recent
 * first, with a colored status dot" -- docs/04-ui-ux-design.md Section
 * 3.1. The dot pairs with a text status label rather than standing alone
 * (dataviz skill: a status color never carries meaning by hue alone).
 */
export function RecentActivity({ items }: { items: RecentActivityItemType[] }) {
  if (items.length === 0) {
    return <p className="page-placeholder">No activity in this range.</p>;
  }

  return (
    <ul className="recent-activity-list">
      {items.map((item) => (
        <li key={item.id} className="recent-activity-item">
          <Link href={`/sessions/${item.session_id}`} className="recent-activity-link">
            <span className={`status-dot status-dot-${item.status}`} aria-hidden="true" />
            <span className="recent-activity-status">{STATUS_LABELS[item.status]}</span>
            <span className="recent-activity-summary mono">{item.action_summary || "(no summary)"}</span>
            <span className="recent-activity-time">{formatTime(item.created_at)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
