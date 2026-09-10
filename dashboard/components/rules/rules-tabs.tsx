"use client";

import { useRouter } from "next/navigation";

export type RulesTab = "rules" | "activity";

const TABS: { value: RulesTab; label: string }[] = [
  { value: "rules", label: "Rules" },
  { value: "activity", label: "Activity Log" },
];

/** Rules / Activity Log tabs, docs/04-ui-ux-design.md Section 3.5. */
export function RulesTabs({ current }: { current: RulesTab }) {
  const router = useRouter();

  function select(value: RulesTab) {
    router.push(value === "rules" ? "/rules" : "/rules?tab=activity");
  }

  return (
    <div className="date-range-row" role="tablist" aria-label="Guardrail Rules sections">
      {TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === current}
          className={tab.value === current ? "date-range-button active" : "date-range-button"}
          onClick={() => select(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
