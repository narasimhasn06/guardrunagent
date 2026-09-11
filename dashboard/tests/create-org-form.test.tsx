import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreateOrgForm } from "@/components/onboarding/create-org-form";

/**
 * The "create your organization" screen (components/onboarding/create-org-form.tsx),
 * shown by app/(dashboard)/layout.tsx for a signed-in user with no org --
 * the new-org-signup half of docs/03-low-level-design.md Section 2.2 step 6
 * that was never built until now.
 */

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("submits the org name to POST /api/orgs", async () => {
  const user = userEvent.setup();
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => ({ org_id: "org-1", org_name: "Acme Inc", api_key: "grk_test123" }),
  });

  render(<CreateOrgForm />);
  await user.type(screen.getByLabelText("Organization name"), "Acme Inc");
  await user.click(screen.getByRole("button", { name: "Create organization" }));

  await waitFor(() => {
    expect(fetch).toHaveBeenCalledWith(
      "/api/orgs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ org_name: "Acme Inc" }),
      })
    );
  });
});

it("shows the new API key exactly once on success", async () => {
  const user = userEvent.setup();
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => ({ org_id: "org-1", org_name: "Acme Inc", api_key: "grk_test123" }),
  });

  render(<CreateOrgForm />);
  await user.type(screen.getByLabelText("Organization name"), "Acme Inc");
  await user.click(screen.getByRole("button", { name: "Create organization" }));

  expect(await screen.findByText("grk_test123")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Continue to dashboard" })).toBeInTheDocument();
});

it("continuing to the dashboard refreshes the router", async () => {
  const user = userEvent.setup();
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => ({ org_id: "org-1", org_name: "Acme Inc", api_key: "grk_test123" }),
  });

  render(<CreateOrgForm />);
  await user.type(screen.getByLabelText("Organization name"), "Acme Inc");
  await user.click(screen.getByRole("button", { name: "Create organization" }));
  await screen.findByText("grk_test123");

  await user.click(screen.getByRole("button", { name: "Continue to dashboard" }));

  expect(pushMock).toHaveBeenCalledWith("/");
  expect(refreshMock).toHaveBeenCalledTimes(1);
});

it("shows an error and stays on the form when the backend rejects it", async () => {
  const user = userEvent.setup();
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: false,
    json: async () => ({ error: "You already belong to an organization." }),
  });

  render(<CreateOrgForm />);
  await user.type(screen.getByLabelText("Organization name"), "Acme Inc");
  await user.click(screen.getByRole("button", { name: "Create organization" }));

  expect(await screen.findByText("You already belong to an organization.")).toBeInTheDocument();
  expect(screen.getByLabelText("Organization name")).toBeInTheDocument();
});
