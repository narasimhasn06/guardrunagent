"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import type { SessionListItem } from "@/lib/backend";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return "In progress";
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`;
}

function formatCost(value: string): string {
  return `$${Number(value).toFixed(4)}`;
}

/**
 * Table per docs/04-ui-ux-design.md Section 3.2: "Started At, Project,
 * Agent, Duration, Cost, Event Count, Status" -- click a row for Session
 * Detail. The whole row is clickable (progressive enhancement for the
 * mouse); the Started At cell is a real anchor so keyboard and
 * screen-reader users get a genuine link regardless.
 */
export function SessionsTable({ sessions }: { sessions: SessionListItem[] }) {
  const router = useRouter();

  if (sessions.length === 0) {
    return <p className="page-placeholder">No sessions match these filters.</p>;
  }

  return (
    <table className="sessions-table">
      <thead>
        <tr>
          <th>Started At</th>
          <th>Project</th>
          <th>Agent</th>
          <th>Duration</th>
          <th>Cost</th>
          <th>Event Count</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((session) => (
          <tr
            key={session.id}
            className="sessions-table-row"
            onClick={() => router.push(`/sessions/${session.id}`)}
          >
            <td>
              <Link href={`/sessions/${session.id}`} className="sessions-table-row-link">
                {formatDateTime(session.started_at)}
              </Link>
            </td>
            <td>{session.project_label ?? "—"}</td>
            <td className="mono">{session.agent_name}</td>
            <td>{formatDuration(session.started_at, session.ended_at)}</td>
            <td className="mono">{formatCost(session.total_cost_usd)}</td>
            <td className="mono">{session.event_count.toLocaleString()}</td>
            <td>
              <span className="status-pill">{session.status}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
