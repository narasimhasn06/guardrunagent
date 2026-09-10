"use client";

import { useRouter, useSearchParams } from "next/navigation";

import type { DateRangePreset } from "@/lib/backend";

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

/**
 * Date range selector per docs/04-ui-ux-design.md Section 3.1 ("date
 * range selector (default: last 7 days)"). Presets in a row, driven by a
 * URL search param so the selection survives navigation/refresh and the
 * Server Component page re-fetches against it -- per the dataviz skill's
 * filter guidance, this scopes everything on the page below it.
 */
export function DateRangeSelect({ current }: { current: DateRangePreset }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function selectPreset(preset: DateRangePreset) {
    const params = new URLSearchParams(searchParams);
    params.set("range", preset);
    router.push(`/?${params.toString()}`);
  }

  return (
    <div className="date-range-row" role="group" aria-label="Date range">
      {PRESETS.map((preset) => (
        <button
          key={preset.value}
          type="button"
          className={preset.value === current ? "date-range-button active" : "date-range-button"}
          onClick={() => selectPreset(preset.value)}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
