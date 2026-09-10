"use client";

import Link from "next/link";
import { useState } from "react";

// GuardrunAgent ships as a Claude Code plugin (sdk/.claude-plugin/plugin.json,
// sdk/hooks/hooks.json), not a library you `npm install` and wire up
// yourself -- Claude Code never scans node_modules for plugins, so a plain
// `npm install @guardrunagent/sdk` (the previous text here) would leave the
// hooks completely inactive despite "succeeding." These are the two real
// commands, run inside a Claude Code session: add the marketplace once,
// then install the plugin from it (see .claude-plugin/marketplace.json at
// the repo root, and CLAUDE.md's decisions log for why this changed).
const INSTALL_COMMANDS = ["/plugin marketplace add narasimhasn06/guardrunagent", "/plugin install guardrunagent@guardrunagent"];

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
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  async function handleCopy(command: string, index: number) {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((current) => (current === index ? null : current)), 2000);
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
          <p className="page-placeholder">Run these inside a Claude Code session:</p>
          {INSTALL_COMMANDS.map((command, index) => (
            <div key={command} className="setup-checklist-code-row">
              <code className="mono setup-checklist-code">{command}</code>
              <button type="button" className="btn" onClick={() => handleCopy(command, index)}>
                {copiedIndex === index ? "Copied" : "Copy"}
              </button>
            </div>
          ))}
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
