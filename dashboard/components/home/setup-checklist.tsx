"use client";

import Link from "next/link";
import { useState } from "react";

const INSTALL_COMMAND = "npm install @guardrunagent/sdk";

/**
 * Empty state for a new org with no sessions ever (docs/04-ui-ux-design.md
 * Section 3.1: "Replace the charts with a setup checklist... with
 * copy-paste install command shown directly on the page").
 *
 * Step 2 links to Settings rather than showing an actual API key: key
 * generation/display isn't wired up yet (that's the Settings page, a
 * separate piece of this same multi-part request) -- showing a fake key
 * here would be worse than pointing at where the real one will live.
 */
export function SetupChecklist() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (permissions, insecure context) --
      // the command is still selectable text either way.
    }
  }

  return (
    <div className="setup-checklist">
      <ol>
        <li>
          <p className="setup-checklist-step-title">Install the SDK</p>
          <div className="setup-checklist-code-row">
            <code className="mono setup-checklist-code">{INSTALL_COMMAND}</code>
            <button type="button" className="btn" onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </li>
        <li>
          <p className="setup-checklist-step-title">Add your API key</p>
          <p className="page-placeholder">
            Configure the SDK with your org&apos;s API key from{" "}
            <Link href="/settings" className="link-button" style={{ display: "inline" }}>
              Settings
            </Link>
            .
          </p>
        </li>
        <li>
          <p className="setup-checklist-step-title">Run your first session</p>
          <p className="page-placeholder">Use Claude Code as normal -- this page updates once events arrive.</p>
        </li>
      </ol>
    </div>
  );
}
