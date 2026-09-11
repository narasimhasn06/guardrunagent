"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { FailMode } from "@/lib/backend";

/** Fail-open/fail-closed section per docs/05-architecture-document.md
 * Section 8: promotes what was a client-side-only SDK config
 * (GUARDRUNAGENT_FAIL_MODE, see sdk/src/config.ts) to a real org-level
 * setting. Applies to a rare case -- what an agent's action does when
 * GuardrunAgent's own backend is unreachable during a guardrail check --
 * so it's an instant-apply toggle (mirroring the Rules tab's "Enabled"
 * switch) rather than a form with a separate Save step. */
export function FailModeSection({ initialFailMode }: { initialFailMode: FailMode }) {
  const router = useRouter();
  const [failMode, setFailMode] = useState<FailMode>(initialFailMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClosed = failMode === "closed";

  async function toggle() {
    const next: FailMode = isClosed ? "open" : "closed";
    setError(null);
    setSaving(true);
    try {
      const response = await fetch("/api/settings/fail-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fail_mode: next }),
      });
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { fail_mode: FailMode };
      setFailMode(body.fail_mode);
      router.refresh();
    } catch {
      setError("Couldn't save this setting — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="home-card settings-section">
      <h2 className="home-card-title">Guardrail Availability</h2>
      <p className="page-placeholder">
        If GuardrunAgent&apos;s backend is temporarily unreachable while an agent is about to act, should that
        action be let through, or blocked until the connection is back?
      </p>
      <div className="fail-mode-row">
        <button
          type="button"
          role="switch"
          aria-checked={isClosed}
          aria-label={isClosed ? "Switch to fail open" : "Switch to fail closed"}
          className={isClosed ? "toggle-switch on" : "toggle-switch"}
          disabled={saving}
          onClick={toggle}
        >
          <span className="toggle-switch-thumb" />
        </button>
        <span>
          {isClosed
            ? "Fail closed — block actions until GuardrunAgent is reachable again."
            : "Fail open — let actions through rather than block the user's own work (default)."}
        </span>
      </div>
      {error && <p className="login-error">{error}</p>}
    </section>
  );
}
