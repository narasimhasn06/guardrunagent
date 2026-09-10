import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client for use in client components (the Login
 * form's signInWithPassword/signInWithOAuth/signUp calls, per
 * docs/03-low-level-design.md Section 2.2: "Next.js calls the Supabase
 * Auth client SDK directly").
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
