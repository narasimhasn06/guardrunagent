const LABELS: Record<"block" | "flag", string> = {
  block: "Block",
  flag: "Flag",
};

/** Action (Block/Flag) badge, docs/04-ui-ux-design.md Section 3.5. Reuses
 * the same color-coded badge treatment as session event status badges
 * (block = red, flag = amber) since they share the same block/flag
 * vocabulary. */
export function ActionBadge({ action }: { action: "block" | "flag" }) {
  return <span className={`status-badge status-badge-${action === "block" ? "blocked" : "flagged"}`}>{LABELS[action]}</span>;
}
