"use client";

import type { CostSummaryRow } from "@/lib/backend";
import { buildCsv } from "@/lib/csv";

/** "Export button: 'Export CSV'" -- docs/04-ui-ux-design.md Section 3.4. */
export function ExportCsvButton({
  rows,
  groupLabel,
  filename,
}: {
  rows: CostSummaryRow[];
  groupLabel: string;
  filename: string;
}) {
  function handleExport() {
    const csv = buildCsv(
      [groupLabel, "Cost (USD)", "Tokens", "Events"],
      rows.map((row) => [row.group_key, row.total_cost_usd, String(row.total_tokens), String(row.event_count)])
    );

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <button type="button" className="btn" onClick={handleExport} disabled={rows.length === 0}>
      Export CSV
    </button>
  );
}
