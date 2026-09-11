import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

import { GET } from "@/app/auth/callback/route";

/**
 * Regression coverage for a real bug caught live in staging: behind
 * Railway's reverse proxy, `new URL(request.url).origin` reflected this
 * service's own internal bind address (0.0.0.0:8080, per railway.toml's
 * `-H 0.0.0.0` start command) instead of the public domain, sending real
 * users to an unreachable "https://0.0.0.0:8080" right after Google
 * approved sign-in. The fix: prefer X-Forwarded-Proto/X-Forwarded-Host
 * when present, falling back to request.url's origin for local dev.
 */

const exchangeCodeForSessionMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: exchangeCodeForSessionMock },
  }),
}));

beforeEach(() => {
  exchangeCodeForSessionMock.mockReset().mockResolvedValue({ error: null });
});

it("redirects using X-Forwarded-Host/Proto, not request.url's own (possibly internal) origin", async () => {
  // request.url deliberately carries the internal bind address a
  // reverse proxy might present to the app -- the forwarded headers are
  // what carry the real public host, and must win.
  const request = new NextRequest("http://0.0.0.0:8080/auth/callback?code=abc123", {
    headers: { "x-forwarded-host": "guardrunagent-dashboard-staging-production.up.railway.app", "x-forwarded-proto": "https" },
  });

  const response = await GET(request);

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("https://guardrunagent-dashboard-staging-production.up.railway.app/");
});

it("falls back to request.url's origin when no forwarded headers are present (local dev)", async () => {
  const request = new NextRequest("http://localhost:3000/auth/callback?code=abc123");

  const response = await GET(request);

  expect(response.headers.get("location")).toBe("http://localhost:3000/");
});

it("honors the next param for the password-reset flow", async () => {
  const request = new NextRequest("http://localhost:3000/auth/callback?code=abc123&next=/settings");

  const response = await GET(request);

  expect(response.headers.get("location")).toBe("http://localhost:3000/settings");
});

it("redirects to /login?error=auth when the code exchange fails", async () => {
  exchangeCodeForSessionMock.mockResolvedValue({ error: new Error("invalid code") });
  const request = new NextRequest("http://localhost:3000/auth/callback?code=bad-code");

  const response = await GET(request);

  expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=auth");
});

it("redirects to /login?error=auth when there's no code at all", async () => {
  const request = new NextRequest("http://localhost:3000/auth/callback");

  const response = await GET(request);

  expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=auth");
  expect(exchangeCodeForSessionMock).not.toHaveBeenCalled();
});
