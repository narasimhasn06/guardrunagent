import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { updateSession } from "@/lib/supabase/proxy";

/**
 * PUBLIC_PATHS regression test: /auth/confirm was missing from this list,
 * so an unauthenticated visitor hitting it (exactly what happens right
 * after Supabase redirects an invite-email click here, before the page's
 * own client-side code has had a chance to turn the URL fragment into a
 * session) got redirected to /login by this proxy before ever reaching
 * the page -- and since NextResponse.redirect's Location header doesn't
 * repeat the fragment, the browser's own redirect-preserves-fragment
 * behavior stranded the invited user's access token on /login instead.
 * See CLAUDE.md's decisions log.
 */

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

function requestFor(pathname: string) {
  return new NextRequest(`https://example.com${pathname}`);
}

it("does not redirect an unauthenticated visitor to /auth/confirm", async () => {
  const response = await updateSession(requestFor("/auth/confirm"));
  expect(response.status).not.toBe(307);
  expect(response.headers.get("location")).toBeNull();
});

it("still redirects an unauthenticated visitor to /login for a protected route", async () => {
  const response = await updateSession(requestFor("/sessions"));
  expect(response.headers.get("location")).toContain("/login");
});
