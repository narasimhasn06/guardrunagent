"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { RuleOut } from "@/lib/backend";

/** One-click starter rules per docs/04-ui-ux-design.md Section 3.5 and the
 * first-time-setup flow (Section 4.1). Idempotent server-side (see
 * app/routers/rules.py's enable_starter_rules), so clicking it again once
 * everything is already enabled is safe and just reports zero added. */
export function StarterRulesButton() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [addedCount, setAddedCount] = useState(0);

  async function handleClick() {
    setStatus("loading");
    try {
      const response = await fetch("/api/rules/starter", { method: "POST" });
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { rules: RuleOut[] };
      setAddedCount(body.rules.length);
      setStatus("done");
      router.refresh();
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="starter-rules">
      <button type="button" className="btn" onClick={handleClick} disabled={status === "loading"}>
        {status === "loading" ? "Enabling…" : "Enable starter rules"}
      </button>
      {status === "done" && (
        <p className="page-placeholder">
          {addedCount > 0
            ? `Added ${addedCount} starter rule${addedCount === 1 ? "" : "s"}.`
            : "Starter rules are already enabled."}
        </p>
      )}
      {status === "error" && <p className="login-error">Couldn&apos;t enable starter rules — try again.</p>}
    </div>
  );
}
