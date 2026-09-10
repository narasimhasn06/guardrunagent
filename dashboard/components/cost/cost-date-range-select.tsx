"use client";

import { useRouter, useSearchParams } from "next/navigation";

export type CostRangePreset = "7d" | "30d" | "90d";

const PRESETS: { value: CostRangePreset; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

/**
 * Date range for the Cost Dashboard -- defaults to 30 days (matches
 * backend/app/routers/cost_summary.py's own default, and the "last 30
 * days" budget-review flow in docs/04-ui-ux-design.md Section 4.3),
 * distinct from Home's 7-day default.
 */
export function CostDateRangeSelect({ current }: { current: CostRangePreset }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function select(value: CostRangePreset) {
    const params = new URLSearchParams(searchParams);
    params.set("range", value);
    router.push(`/cost?${params.toString()}`);
  }

  return (
    <div className="date-range-row" role="group" aria-label="Date range">
      {PRESETS.map((preset) => (
        <button
          key={preset.value}
          type="button"
          className={preset.value === current ? "date-range-button active" : "date-range-button"}
          onClick={() => select(preset.value)}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
