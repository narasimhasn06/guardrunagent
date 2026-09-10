"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/** Slack Integration section per docs/04-ui-ux-design.md Section 3.6:
 * "manual webhook URL paste for MVP simplicity; test button to send a
 * sample alert." (The OAuth "Connect Slack" alternative the doc mentions
 * isn't built -- no Slack app/OAuth client is named anywhere in the docs,
 * so it isn't introduced without flagging it first, per CLAUDE.md.) */
export function SlackSection({ initialWebhookUrl }: { initialWebhookUrl: string | null }) {
  const router = useRouter();
  const [savedUrl, setSavedUrl] = useState(initialWebhookUrl ?? "");
  const [webhookUrl, setWebhookUrl] = useState(initialWebhookUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"delivered" | "failed" | null>(null);

  const isDirty = webhookUrl.trim() !== savedUrl.trim();
  const configured = savedUrl.trim().length > 0;

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setTestResult(null);
    try {
      const response = await fetch("/api/settings/slack-webhook", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhook_url: webhookUrl.trim() || null }),
      });
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { slack_webhook_url: string | null };
      setSavedUrl(body.slack_webhook_url ?? "");
      setWebhookUrl(body.slack_webhook_url ?? "");
      router.refresh();
    } catch {
      setSaveError("Couldn't save the Slack webhook — try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/settings/slack-webhook/test", { method: "POST" });
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { delivered: boolean };
      setTestResult(body.delivered ? "delivered" : "failed");
    } catch {
      setTestResult("failed");
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="home-card settings-section">
      <h2 className="home-card-title">Slack Integration</h2>
      <form onSubmit={handleSave} className="slack-form">
        <label className="login-label" htmlFor="slack-webhook-url">
          Webhook URL
        </label>
        <input
          id="slack-webhook-url"
          type="url"
          placeholder="https://hooks.slack.com/services/..."
          value={webhookUrl}
          onChange={(event) => setWebhookUrl(event.target.value)}
          className="mono"
        />
        {saveError && <p className="login-error">{saveError}</p>}
        <div className="new-rule-form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleTest}
            disabled={testing || !configured || isDirty}
          >
            {testing ? "Sending…" : "Send test alert"}
          </button>
        </div>
      </form>
      {isDirty && configured && (
        <p className="page-placeholder">Save your changes before sending a test alert.</p>
      )}
      {testResult === "delivered" && <p className="page-placeholder">Test alert delivered.</p>}
      {testResult === "failed" && <p className="login-error">Test alert couldn&apos;t be delivered.</p>}
    </section>
  );
}
