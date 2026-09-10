"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** API Key section per docs/04-ui-ux-design.md Section 3.6: "show masked
 * key, 'regenerate' button (with confirmation -- regenerating breaks
 * existing SDK installs)." The backend only ever stores a bcrypt hash of
 * the key (see app/routers/settings.py), so there's no partial key to
 * reveal here -- "masked" is a fixed placeholder, and the real value is
 * shown in full exactly once, right after it's generated. */
export function ApiKeySection() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRegenerate() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/api-key/regenerate", { method: "POST" });
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { api_key: string };
      setRevealedKey(body.api_key);
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Couldn't regenerate the API key — try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied -- the key is still visible as
      // selectable text, so this is a non-blocking convenience only.
    }
  }

  return (
    <section className="home-card settings-section">
      <h2 className="home-card-title">API Key</h2>

      {revealedKey ? (
        <div className="api-key-reveal">
          <p className="login-notice">
            Copy this key now — it won&apos;t be shown again. Update any SDK installs still using the old key.
          </p>
          <div className="api-key-value-row">
            <code className="api-key-value">{revealedKey}</code>
            <button type="button" className="btn" onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : (
        <div className="api-key-value-row">
          <code className="api-key-value">••••••••••••••••••••••••••••••••</code>
        </div>
      )}

      {error && <p className="login-error">{error}</p>}

      {confirming ? (
        <div className="settings-confirm">
          <p className="login-notice">Regenerating breaks existing SDK installs using the old key. Continue?</p>
          <div className="new-rule-form-actions">
            <button type="button" className="btn btn-primary" onClick={handleRegenerate} disabled={loading}>
              {loading ? "Regenerating…" : "Yes, regenerate"}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={loading}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn" onClick={() => setConfirming(true)}>
          Regenerate
        </button>
      )}
    </section>
  );
}
