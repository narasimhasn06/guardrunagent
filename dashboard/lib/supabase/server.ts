import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client for Server Components, Server Actions, and
 * Route Handlers -- reads/writes the session via Next.js's cookie jar.
 * Uses the anon key (RLS-scoped), never the service role key: that stays
 * backend-only per docs/05-architecture-document.md Section 7.
 *
 * Must be created fresh per request (not cached/reused across requests),
 * per @supabase/ssr's own guidance -- a shared instance would leak one
 * user's session into another's request.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll: ((cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component, which can't set cookies --
            // middleware.ts refreshes the session on the next request, so
            // this is safe to ignore here.
          }
        }) satisfies SetAllCookies,
      },
    }
  );
}
