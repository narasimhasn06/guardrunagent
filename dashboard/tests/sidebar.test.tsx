import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "@/components/sidebar";

/**
 * The sidebar's sign-out control -- flagged as a real product gap (never
 * specified in docs/04-ui-ux-design.md) and added directly in response to
 * it being missing from the deployed staging dashboard: no way to sign
 * out was reachable from any page.
 */

const pushMock = vi.fn();
const refreshMock = vi.fn();
const signOutMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  usePathname: () => "/",
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signOut: signOutMock,
    },
  }),
}));

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
  signOutMock.mockReset().mockResolvedValue({ error: null });
});

it("shows the signed-in user's email when provided", () => {
  render(<Sidebar userEmail="jane@example.com" />);
  expect(screen.getByText("jane@example.com")).toBeInTheDocument();
});

it("renders without a user email (defense in depth if auth.getUser() ever returns no email)", () => {
  render(<Sidebar />);
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
});

it("signs out and redirects to /login on click", async () => {
  const user = userEvent.setup();
  render(<Sidebar userEmail="jane@example.com" />);

  await user.click(screen.getByRole("button", { name: "Sign out" }));

  expect(signOutMock).toHaveBeenCalledTimes(1);
  expect(pushMock).toHaveBeenCalledWith("/login");
  expect(refreshMock).toHaveBeenCalledTimes(1);
});

/**
 * "Organizations" nav item (Super Admin role) -- shown only for a
 * platform admin, same conditional-render pattern as the "create your
 * organization" screen keyed off has_org. See CLAUDE.md's "Planned, not
 * yet built" entry this closes.
 */
it("hides the Organizations nav item by default", () => {
  render(<Sidebar userEmail="jane@example.com" />);
  expect(screen.queryByRole("link", { name: "Organizations" })).not.toBeInTheDocument();
});

it("shows the Organizations nav item for a platform admin", () => {
  render(<Sidebar userEmail="admin@example.com" isPlatformAdmin />);
  expect(screen.getByRole("link", { name: "Organizations" })).toHaveAttribute("href", "/admin/orgs");
});
