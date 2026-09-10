"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { RuleOut } from "@/lib/backend";

import { ActionBadge } from "./action-badge";

/** Rules tab table per docs/04-ui-ux-design.md Section 3.5: "Name, Pattern
 * (monospace), Action (Block/Flag badge), Enabled toggle." */
export function RulesTable({ rules }: { rules: RuleOut[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (rules.length === 0) {
    return <p className="page-placeholder">No guardrail rules yet.</p>;
  }

  async function toggleEnabled(rule: RuleOut) {
    setError(null);
    setPendingId(rule.id);
    try {
      const response = await fetch(`/api/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (!response.ok) throw new Error();
      router.refresh();
    } catch {
      setError(`Couldn't update "${rule.name}" — try again.`);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      {error && <p className="login-error">{error}</p>}
      <table className="rules-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Pattern</th>
            <th>Action</th>
            <th>Enabled</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.id}>
              <td>{rule.name}</td>
              <td className="mono">{rule.pattern_value}</td>
              <td>
                <ActionBadge action={rule.action_on_match} />
              </td>
              <td>
                <button
                  type="button"
                  role="switch"
                  aria-checked={rule.enabled}
                  aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
                  className={rule.enabled ? "toggle-switch on" : "toggle-switch"}
                  disabled={pendingId === rule.id}
                  onClick={() => toggleEnabled(rule)}
                >
                  <span className="toggle-switch-thumb" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
