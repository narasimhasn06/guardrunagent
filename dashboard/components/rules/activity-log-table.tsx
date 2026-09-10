import Link from "next/link";

import type { GuardrailActivityItem } from "@/lib/backend";

import { ActionBadge } from "./action-badge";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Activity Log tab per docs/04-ui-ux-design.md Section 3.5: "timestamp,
 * rule name, session link, action taken, whether the Slack alert was
 * successfully delivered." Delivery status pairs a status dot with a text
 * label -- never color alone. */
export function ActivityLogTable({ activity }: { activity: GuardrailActivityItem[] }) {
  if (activity.length === 0) {
    return <p className="page-placeholder">No guardrail activity yet.</p>;
  }

  return (
    <table className="rules-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Rule</th>
          <th>Session</th>
          <th>Action</th>
          <th>Slack Alert</th>
        </tr>
      </thead>
      <tbody>
        {activity.map((item) => (
          <tr key={item.id}>
            <td className="mono">{formatDateTime(item.fired_at)}</td>
            <td>{item.rule_name ?? <span className="page-placeholder">Deleted rule</span>}</td>
            <td>
              {item.session_id ? (
                <Link href={`/sessions/${item.session_id}`} className="sessions-table-row-link">
                  View session
                </Link>
              ) : (
                "—"
              )}
            </td>
            <td>{item.action_on_match ? <ActionBadge action={item.action_on_match} /> : "—"}</td>
            <td>
              <span
                className={item.alert_sent ? "status-dot status-dot-success" : "status-dot status-dot-failure"}
                aria-hidden="true"
              />
              {item.alert_sent ? "Delivered" : "Not delivered"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
