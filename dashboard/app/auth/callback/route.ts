import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Handles both the Google OAuth redirect and the password-reset email
 * link -- both send the browser here with a `code` query param that
 * exchanges for a session (docs/03-low-level-design.md Section 2.2 step
 * 2: "Supabase handles the OAuth redirect flow for Google").
 *
 * The redirect origin comes from X-Forwarded-Proto/X-Forwarded-Host when
 * present, not request.url's own origin: caught live in staging, where
 * behind Railway's reverse proxy request.url reflected this service's
 * own internal bind address (0.0.0.0:8080, per railway.toml's `-H
 * 0.0.0.0` start command) instead of the public domain -- sending real
 * users to an unreachable "https://0.0.0.0:8080" right after Google
 * approved sign-in. Falls back to request.url's origin for local dev,
 * where there's no reverse proxy in front and these headers don't exist.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin: directOrigin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : directOrigin;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
