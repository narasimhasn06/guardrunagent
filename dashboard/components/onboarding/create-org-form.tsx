"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * Shown by the (dashboard) layout instead of the normal app shell when
 * GET /me reports has_org: false -- the new-org-signup half of
 * docs/03-low-level-design.md Section 2.2 step 6 that was never built
 * until now (see the comment above MeOut in backend/app/schemas.py).
 *
 * On success, shows the new org's API key exactly once (same convention
 * as components/settings/api-key-section.tsx's regenerate flow -- the
 * backend never stores or re-serves the plaintext) before continuing
 * into the dashboard, since this is also the only other place besides
 * Settings a user will ever see it.
 */
export function CreateOrgForm() {
  const router = useRouter();

  const [orgName, setOrgName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_name: orgName }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Couldn't create your organization — try again.");
      }
      setApiKey(body.api_key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create your organization — try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied -- the key is still visible as
      // selectable text, so this is a non-blocking convenience only.
    }
  }

  function handleContinue() {
    router.push("/");
    router.refresh();
  }

  if (apiKey) {
    return (
      <div className="login-card">
        <div className="login-brand">GuardrunAgent</div>
        <h1 className="page-title">You&apos;re all set</h1>
        <div className="api-key-reveal">
          <p className="login-notice">
            Copy your org&apos;s API key now — it won&apos;t be shown again outside of Settings. You&apos;ll need it
            to configure the SDK.
          </p>
          <div className="api-key-value-row">
            <code className="api-key-value">{apiKey}</code>
            <button type="button" className="btn" onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={handleContinue}>
          Continue to dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="login-card">
      <div className="login-brand">GuardrunAgent</div>
      <h1 className="page-title">Create your organization</h1>
      <p className="login-notice">
        You&apos;re signed in, but not part of an organization yet. Name one to get started — you&apos;ll be its
        admin.
      </p>

      <form onSubmit={handleSubmit} className="login-form">
        <label className="login-label">
          Organization name
          <input
            type="text"
            required
            value={orgName}
            onChange={(event) => setOrgName(event.target.value)}
            autoFocus
          />
        </label>

        {error && <p className="login-error">{error}</p>}

        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting ? "Creating…" : "Create organization"}
        </button>
      </form>
    </div>
  );
}
