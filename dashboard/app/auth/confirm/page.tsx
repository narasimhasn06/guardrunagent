"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

type EmailOtpType = "invite" | "recovery";

/**
 * Landing page for both invite and password-reset emails -- requires an
 * explicit button click before the one-time token is ever consumed,
 * rather than consuming it as soon as the page loads.
 *
 * The link each email template builds (edited directly in the Supabase
 * dashboard, not in this codebase) points here with
 * `?token_hash={{ .TokenHash }}` (and, for recovery, `&type=recovery` --
 * absent `type` defaults to "invite" for backward compatibility with the
 * invite template, which doesn't set one), instead of the template's own
 * auto-generated `{{ .ConfirmationURL }}`, which points straight at
 * Supabase's own server-side verify-and-redirect endpoint. That
 * distinction is the whole point: `{{ .ConfirmationURL }}` *is* the
 * action that consumes the token, so anything that merely fetches
 * it -- an email provider's own link-safety scanner, chief among them --
 * silently burns the token's one and only use before the actual human
 * ever clicks. Caught live in production for the invite flow: Supabase's
 * own Auth Logs showed the same invite token verified four separate
 * times within 17 minutes, the first just 49 seconds after the invite
 * was sent -- far too fast to be a human opening Gmail, and consistent
 * with an automated pre-fetch. The password-reset flow hit the exact
 * same failure mode once it was actually tested (docs/04-ui-ux-design.md
 * used to say this was "delegated entirely to Supabase Auth's built-in
 * reset email" -- corrected now that testing showed that default isn't
 * safe to use as-is).
 *
 * This page's own URL, by contrast, is inert -- loading it does
 * nothing. The token is only ever consumed by the explicit
 * `supabase.auth.verifyOtp({ token_hash, type })` call in `handleVerify`,
 * fired from a real button's `onClick`. An automated scanner fetches
 * pages; it doesn't simulate button clicks -- that gap is what protects
 * the token. `verifyOtp`'s own `{ data, error }` response is checked
 * directly, rather than a generic "does any session exist?" check
 * (`getSession()`), which could be -- and for the invite flow, in
 * production, was -- fooled by an unrelated session (e.g. a Super
 * Admin's) already sitting in a shared browser profile.
 *
 * Invite and recovery diverge after that shared verify step: an invite
 * grants a session for an account that never had a password to begin
 * with, so it's done -- straight to the dashboard. A recovery token also
 * grants a session, but leaving it at that would sign the user in
 * without ever letting them set a new password (the actual point of
 * "forgot password") -- so recovery instead moves to a second step, a
 * plain `supabase.auth.updateUser({ password })` call, before redirecting.
 *
 * `useSearchParams()` needs the `Suspense` boundary below or Next.js
 * opts the whole route out of static rendering with a build warning --
 * moot for a page this dynamic, but required regardless.
 */
function AcceptInvite() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenHash = searchParams.get("token_hash");
  const type: EmailOtpType = searchParams.get("type") === "recovery" ? "recovery" : "invite";

  const [step, setStep] = useState<"verify" | "set-password">("verify");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  if (!tokenHash) {
    return (
      <div className="login-card">
        <div className="login-brand">GuardrunAgent</div>
        <p className="login-error">This link is missing information — ask for a new one.</p>
      </div>
    );
  }

  async function handleVerify() {
    setIsSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash!, type });
    if (verifyError) {
      setError("This link has already been used or has expired — ask for a new one.");
      setIsSubmitting(false);
      return;
    }

    if (type === "recovery") {
      setStep("set-password");
      setIsSubmitting(false);
      return;
    }

    router.replace("/");
  }

  async function handleSetPassword() {
    if (password !== confirmPassword) {
      setError("Those passwords don't match.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setIsSubmitting(false);
      return;
    }
    router.replace("/");
  }

  if (step === "set-password") {
    return (
      <div className="login-card">
        <div className="login-brand">GuardrunAgent</div>
        <h1 className="page-title">Set a new password</h1>
        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault();
            handleSetPassword();
          }}
        >
          <label className="login-label">
            New password
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              autoFocus
            />
          </label>
          <label className="login-label">
            Confirm new password
            <input
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save password"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="login-card">
      <div className="login-brand">GuardrunAgent</div>
      <p>
        {type === "recovery"
          ? "Click below to verify it's you and set a new password."
          : "Click below to accept your invitation and sign in."}
      </p>
      {error && <p className="login-error">{error}</p>}
      <button type="button" className="btn btn-primary" disabled={isSubmitting} onClick={handleVerify}>
        {isSubmitting ? "Verifying…" : type === "recovery" ? "Continue" : "Accept invitation"}
      </button>
    </div>
  );
}

export default function AuthConfirmPage() {
  return (
    <Suspense fallback={null}>
      <AcceptInvite />
    </Suspense>
  );
}
