"use client";

import { useMemo, useState } from "react";

import type { CostSummaryRow } from "@/lib/backend";

type SortKey = "group_key" | "total_cost_usd" | "total_tokens" | "event_count";

function formatCost(value: string): string {
  return `$${Number(value).toFixed(2)}`;
}

/**
 * "Below chart: a sortable table breaking down the same data numerically"
 * -- docs/04-ui-ux-design.md Section 3.4. Sorted client-side since the
 * full result set is already loaded (pilot-scale row counts).
 */
export function CostTable({ rows, groupLabel }: { rows: CostSummaryRow[]; groupLabel: string }) {
  const [sortKey, setSortKey] = useState<SortKey>("total_cost_usd");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let result: number;
      if (sortKey === "group_key") {
        result = a.group_key.localeCompare(b.group_key);
      } else if (sortKey === "total_cost_usd") {
        result = Number(a.total_cost_usd) - Number(b.total_cost_usd);
      } else {
        result = a[sortKey] - b[sortKey];
      }
      return sortDir === "asc" ? result : -result;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function headerButton(key: SortKey, label: string) {
    const isActive = key === sortKey;
    return (
      <button type="button" className="cost-table-sort-button" onClick={() => toggleSort(key)}>
        {label}
        {isActive && <span aria-hidden="true">{sortDir === "asc" ? " ↑" : " ↓"}</span>}
      </button>
    );
  }

  if (rows.length === 0) {
    return <p className="page-placeholder">No spend recorded in this range.</p>;
  }

  return (
    <table className="sessions-table cost-table">
      <thead>
        <tr>
          <th>{headerButton("group_key", groupLabel)}</th>
          <th>{headerButton("total_cost_usd", "Cost")}</th>
          <th>{headerButton("total_tokens", "Tokens")}</th>
          <th>{headerButton("event_count", "Events")}</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr key={row.group_key}>
            <td className="mono">{row.group_key}</td>
            <td className="mono">{formatCost(row.total_cost_usd)}</td>
            <td className="mono">{row.total_tokens.toLocaleString()}</td>
            <td className="mono">{row.event_count.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
