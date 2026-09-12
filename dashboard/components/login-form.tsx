"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

type Mode = "sign-in" | "sign-up";

/**
 * Login screen per docs/04-ui-ux-design.md Section 3.0.
 *
 * Two deliberate deviations from the doc's literal wording, both because
 * the literal version would need an unauthenticated "does this email
 * exist, and does it use a password?" lookup -- which is either an
 * email-enumeration security hole or a new backend endpoint nobody asked
 * for yet:
 *
 * 1. "Forgot password?" is always shown (not conditionally hidden for
 *    Google-only accounts) and always responds with the same generic
 *    message, regardless of whether the email exists or which auth
 *    method it uses -- matches Supabase's own anti-enumeration behavior
 *    for resetPasswordForEmail.
 * 2. "Same screen handles sign-up and sign-in" is implemented as: try
 *    sign-in first; Supabase returns an identical error for "wrong
 *    password" and "no such account" (also anti-enumeration), so on
 *    failure this offers an explicit "create an account" step rather
 *    than guessing which case it is and silently switching to sign-up.
 */
export function LoginForm() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<Mode>("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleGoogleSignIn() {
    setError(null);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (oauthError) setError(oauthError.message);
  }

  async function handleSignIn(email: string, password: string) {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (!signInError) {
      router.push("/");
      router.refresh();
      return;
    }

    setMode("sign-up");
    setError("No account found, or incorrect password. New here? Create an account below.");
  }

  async function handleSignUp(email: string, password: string) {
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    if (data.session) {
      // Email confirmation is off for this project -- signed in immediately.
      router.push("/");
      router.refresh();
      return;
    }

    setNotice("Check your email to confirm your account, then sign in.");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setIsSubmitting(true);

    if (mode === "sign-up") {
      await handleSignUp(email, password);
    } else {
      await handleSignIn(email, password);
    }

    setIsSubmitting(false);
  }

  async function handleForgotPassword() {
    setError(null);
    setNotice(null);

    if (!email) {
      setError('Enter your email above first, then click "Forgot password?"');
      return;
    }

    // No redirectTo here -- the link the user actually clicks comes
    // entirely from Supabase's "Reset Password" email template (see
    // DEPLOYMENT.md), which points at /auth/confirm?token_hash=...
    // &type=recovery rather than this call's own default
    // {{ .ConfirmationURL }} link, for the same email-scanner-burns-the-
    // token reason the invite flow was fixed for (see CLAUDE.md).
    await supabase.auth.resetPasswordForEmail(email);

    setNotice("If an account with that email exists and uses a password, we've sent a reset link.");
  }

  return (
    <div className="login-card">
      <div className="login-brand">GuardrunAgent</div>

      <button type="button" className="btn btn-google" onClick={handleGoogleSignIn}>
        Continue with Google
      </button>

      <div className="login-divider">
        <span>or</span>
      </div>

      <form onSubmit={handleSubmit} className="login-form">
        <label className="login-label">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
        </label>
        <label className="login-label">
          Password
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          />
        </label>

        {error && <p className="login-error">{error}</p>}
        {notice && <p className="login-notice">{notice}</p>}

        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {mode === "sign-up" ? "Create account" : "Sign in"}
        </button>
      </form>

      {mode === "sign-in" ? (
        <button type="button" className="link-button" onClick={handleForgotPassword}>
          Forgot password?
        </button>
      ) : (
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setMode("sign-in");
            setError(null);
            setNotice(null);
          }}
        >
          Already have an account? Sign in
        </button>
      )}
    </div>
  );
}
