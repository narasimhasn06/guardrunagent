import type { EventStatus } from "@/lib/backend";

// Status color coding per docs/04-ui-ux-design.md Section 5: green =
// success, red = blocked, amber = flagged, gray = neutral/unrelated
// failure. CSS classes map to the --color-success/blocked/flagged/neutral
// custom properties defined in app/globals.css.
const LABELS: Record<EventStatus, string> = {
  success: "Success",
  failure: "Failure",
  blocked: "Blocked",
  flagged: "Flagged",
};

export function StatusBadge({ status }: { status: EventStatus }) {
  return <span className={`status-badge status-badge-${status}`}>{LABELS[status]}</span>;
}
