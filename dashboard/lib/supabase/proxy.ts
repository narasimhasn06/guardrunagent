import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth/callback"];

/**
 * Refreshes the Supabase session cookie on every request and redirects
 * unauthenticated visitors to /login (docs/04-ui-ux-design.md's
 * information architecture puts everything except Login behind auth).
 * Invoked from the project root's proxy.ts (Next.js 16 renamed the
 * `middleware.ts` file convention to `proxy.ts` -- see
 * https://nextjs.org/docs/messages/middleware-to-proxy). This is the
 * first line of defense; app/(dashboard)/layout.tsx double-checks with
 * its own getUser() call, since a proxy/middleware matcher can miss
 * request patterns it doesn't cover -- standard @supabase/ssr guidance,
 * not unique to this app.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll: ((cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: request.headers } });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }) satisfies SetAllCookies,
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}
