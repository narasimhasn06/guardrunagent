"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Lets a Google-only account add a password, so it can also sign in
 * with email/password afterward -- the safe version of "attach a
 * password to an existing account": done as an authenticated action via
 * `supabase.auth.updateUser({ password })` (the same call the recovery
 * flow in app/auth/confirm/page.tsx uses), never by the login form
 * trying to detect or compare a password for an account it hasn't
 * verified belongs to the caller. Our backend has no visibility into
 * Supabase-managed password state at all, so this section discovers it
 * client-side from the current session's own `user.identities` --
 * absent an "email" provider identity means this account has never had
 * a password set.
 *
 * Renders nothing for an account that already has a password (the
 * common case) -- this is a one-time setup action, not a general
 * "change password" section.
 */
export function PasswordSection() {
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function checkIdentities() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      setHasPassword(Boolean(user?.identities?.some((identity) => identity.provider === "email")));
    }
    checkIdentities();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit() {
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
    setDone(true);
    setIsSubmitting(false);
  }

  if (hasPassword !== false) return null;

  return (
    <section className="home-card settings-section">
      <h2 className="home-card-title">Password</h2>

      {done ? (
        <p className="login-notice">Password set — you can now also sign in with your email and this password.</p>
      ) : (
        <>
          <p className="login-notice">
            Your account currently only signs in with Google. Set a password to also be able to sign in with your
            email.
          </p>
          <form
            className="login-form"
            onSubmit={(event) => {
              event.preventDefault();
              handleSubmit();
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
            <div className="new-rule-form-actions">
              <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Set password"}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
