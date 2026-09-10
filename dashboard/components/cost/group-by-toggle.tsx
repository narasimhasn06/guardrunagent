"use client";

import { useRouter, useSearchParams } from "next/navigation";

import type { CostGroupBy } from "@/lib/backend";

const OPTIONS: { value: CostGroupBy; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "project", label: "Project" },
  { value: "agent", label: "Agent" },
];

/** "Toggle: group by Project / Agent / Day" -- docs/04-ui-ux-design.md Section 3.4. */
export function GroupByToggle({ current }: { current: CostGroupBy }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function select(value: CostGroupBy) {
    const params = new URLSearchParams(searchParams);
    params.set("group_by", value);
    router.push(`/cost?${params.toString()}`);
  }

  return (
    <div className="date-range-row" role="group" aria-label="Group by">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === current ? "date-range-button active" : "date-range-button"}
          onClick={() => select(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
