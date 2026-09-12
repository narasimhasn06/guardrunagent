"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

/**
 * Landing page for Supabase Auth links that use the implicit flow --
 * tokens arrive as `#access_token=...&refresh_token=...` in the URL
 * *fragment*, never sent to the server, so nothing at `/auth/callback`
 * (a server-side Route Handler built for the PKCE `?code=` exchange
 * Google OAuth and password-reset use) can ever see them.
 *
 * Admin-issued links -- specifically `app/invites.py`'s
 * `create_pending_invite`, via Supabase Auth's admin
 * `invite_user_by_email` API -- are always implicit-flow: PKCE needs a
 * `code_verifier` the *client* generated when it started the flow, which
 * doesn't exist for a link Supabase generated server-side on our
 * backend's behalf. Caught live in production: clicking an invite email
 * landed on `/login?error=auth` with the invited user's own access token
 * stranded in the URL fragment (carried along by the browser's own
 * redirect-preserves-fragment behavior) -- and, since the tester's
 * browser already held a Super Admin session cookie, the dashboard just
 * kept rendering as that admin instead, silently. The invited user was
 * never actually signed in.
 *
 * The browser's own Supabase client (`createClient()`, `@supabase/ssr`)
 * parses and persists a fragment-borne session automatically on
 * construction (`detectSessionInUrl`, on by default) -- `getSession()`
 * awaits that same initialization before resolving, so this only needs
 * to wait for it and then leave via a normal client-side redirect.
 */
export default function AuthConfirmPage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      router.replace(data.session ? "/" : "/login?error=auth");
    });
  }, [router]);

  return <p className="page-placeholder">Signing you in…</p>;
}
