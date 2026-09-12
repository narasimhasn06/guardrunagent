import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AuthConfirmPage from "@/app/auth/confirm/page";

/**
 * Client-side counterpart to /auth/callback for Supabase's implicit
 * flow (an admin-issued invite link's access token arrives as a URL
 * *fragment*, never sent to the server) -- see the page's own docstring
 * and CLAUDE.md's decisions log for the production bug this fixes.
 *
 * createClient() itself triggers @supabase/ssr's detectSessionInUrl
 * parsing of any `#access_token=...` in the current URL; getSession()
 * awaits that before resolving. Both are mocked here since jsdom has no
 * real Supabase session to parse -- this tests the page's own
 * wait-then-redirect behavior, not @supabase/ssr's fragment parsing
 * itself.
 */

const replaceMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: getSessionMock } }),
}));

beforeEach(() => {
  replaceMock.mockClear();
  getSessionMock.mockReset();
});

it("redirects home once a session is found", async () => {
  getSessionMock.mockResolvedValue({ data: { session: { access_token: "token" } } });

  render(<AuthConfirmPage />);

  await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/"));
});

it("redirects to the login error state when no session was found", async () => {
  getSessionMock.mockResolvedValue({ data: { session: null } });

  render(<AuthConfirmPage />);

  await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/login?error=auth"));
});
