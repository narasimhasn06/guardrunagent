"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

/**
 * Landing page for invite emails -- requires an explicit button click
 * before the invite token is ever consumed, rather than consuming it as
 * soon as the page loads.
 *
 * The link Supabase's "Invite user" email template builds (edited
 * directly in the Supabase dashboard, not in this codebase) points here
 * with `?token_hash={{ .TokenHash }}`, instead of the template's own
 * auto-generated `{{ .ConfirmationURL }}`, which points straight at
 * Supabase's own server-side verify-and-redirect endpoint. That
 * distinction is the whole point: `{{ .ConfirmationURL }}` *is* the
 * action that consumes the token, so anything that merely fetches
 * it -- an email provider's own link-safety scanner, chief among them --
 * silently burns the invite's one and only use before the actual human
 * ever clicks. Caught live in production: Supabase's own Auth Logs
 * showed the same invite token verified four separate times within 17
 * minutes, the first just 49 seconds after the invite was sent -- far
 * too fast to be a human opening Gmail, and consistent with an
 * automated pre-fetch. By the time the real click happened, the token
 * was already spent.
 *
 * This page's own URL, by contrast, is inert -- loading it does
 * nothing. The token is only ever consumed by the explicit
 * `supabase.auth.verifyOtp({ token_hash, type: "invite" })` call in
 * `handleAccept`, fired from a real button's `onClick`. An automated
 * scanner fetches pages; it doesn't simulate button clicks -- that gap
 * is what protects the token. `verifyOtp`'s own `{ data, error }`
 * response is checked directly, rather than the previous version's
 * generic "does any session exist?" check (`getSession()`), which
 * could be -- and in production, was -- fooled by an unrelated session
 * (e.g. a Super Admin's) already sitting in a shared browser profile.
 *
 * `useSearchParams()` needs the `Suspense` boundary below or Next.js
 * opts the whole route out of static rendering with a build warning --
 * moot for a page this dynamic, but required regardless.
 */
function AcceptInvite() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenHash = searchParams.get("token_hash");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!tokenHash) {
    return (
      <div className="login-card">
        <div className="login-brand">GuardrunAgent</div>
        <p className="login-error">This invite link is missing information — ask whoever invited you to send a new one.</p>
      </div>
    );
  }

  async function handleAccept() {
    setIsSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: "invite" });
    if (verifyError) {
      setError("This invite link has already been used or has expired — ask whoever invited you to send a new one.");
      setIsSubmitting(false);
      return;
    }
    router.replace("/");
  }

  return (
    <div className="login-card">
      <div className="login-brand">GuardrunAgent</div>
      <p>Click below to accept your invitation and sign in.</p>
      {error && <p className="login-error">{error}</p>}
      <button type="button" className="btn btn-primary" disabled={isSubmitting} onClick={handleAccept}>
        {isSubmitting ? "Signing you in…" : "Accept invitation"}
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
