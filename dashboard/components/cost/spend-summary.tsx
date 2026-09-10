function formatCost(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * "Top: total spend for selected date range, with % change vs previous
 * period" -- docs/04-ui-ux-design.md Section 3.4. No good/bad color
 * judgment on the direction: whether higher spend is a problem is
 * context-dependent (a team may have scaled up on purpose), so this
 * reports the delta factually with a plain arrow rather than red/green.
 */
export function SpendSummary({ current, previous }: { current: number; previous: number }) {
  const hasPrevious = previous > 0;
  const change = hasPrevious ? ((current - previous) / previous) * 100 : null;

  return (
    <div className="spend-summary">
      <div className="spend-summary-value mono">{formatCost(current)}</div>
      {change !== null && (
        <span className="spend-summary-delta mono">
          {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}% vs previous period
        </span>
      )}
    </div>
  );
}
