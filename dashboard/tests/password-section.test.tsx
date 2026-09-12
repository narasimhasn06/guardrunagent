import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { PasswordSection } from "@/components/settings/password-section";

/**
 * "Set a password" for a Google-only account -- the safe version of
 * attaching a password to an existing account (see CLAUDE.md's decisions
 * log and the login-form docstring for why the login form itself can't
 * do this). Whether it renders at all depends on the signed-in user's
 * own `identities` array, discovered client-side since our backend has
 * no visibility into Supabase-managed password state.
 */

const getUserMock = vi.fn();
const updateUserMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser: getUserMock, updateUser: updateUserMock } }),
}));

function makeUser(identities: { provider: string }[]) {
  return { data: { user: { identities } } };
}

beforeEach(() => {
  getUserMock.mockReset();
  updateUserMock.mockReset();
});

it("renders nothing while identities are still loading", () => {
  getUserMock.mockReturnValue(new Promise(() => {})); // never resolves
  render(<PasswordSection />);
  expect(screen.queryByText("Password")).not.toBeInTheDocument();
});

it("renders nothing for an account that already has a password identity", async () => {
  getUserMock.mockResolvedValue(makeUser([{ provider: "google" }, { provider: "email" }]));
  render(<PasswordSection />);
  await waitFor(() => expect(getUserMock).toHaveBeenCalled());
  expect(screen.queryByText("Password")).not.toBeInTheDocument();
});

it("shows the set-password form for a Google-only account", async () => {
  getUserMock.mockResolvedValue(makeUser([{ provider: "google" }]));
  render(<PasswordSection />);
  expect(await screen.findByText("Password")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Set password" })).toBeInTheDocument();
});

it("submits the new password via updateUser and shows a confirmation", async () => {
  const user = userEvent.setup();
  getUserMock.mockResolvedValue(makeUser([{ provider: "google" }]));
  updateUserMock.mockResolvedValue({ data: {}, error: null });

  render(<PasswordSection />);
  await screen.findByText("Password");

  await user.type(screen.getByLabelText("New password"), "new-password-123");
  await user.type(screen.getByLabelText("Confirm new password"), "new-password-123");
  await user.click(screen.getByRole("button", { name: "Set password" }));

  expect(updateUserMock).toHaveBeenCalledWith({ password: "new-password-123" });
  await waitFor(() => expect(screen.getByText(/password set/i)).toBeInTheDocument());
});

it("rejects mismatched passwords without calling updateUser", async () => {
  const user = userEvent.setup();
  getUserMock.mockResolvedValue(makeUser([{ provider: "google" }]));

  render(<PasswordSection />);
  await screen.findByText("Password");

  await user.type(screen.getByLabelText("New password"), "new-password-123");
  await user.type(screen.getByLabelText("Confirm new password"), "something-else");
  await user.click(screen.getByRole("button", { name: "Set password" }));

  expect(screen.getByText(/don't match/i)).toBeInTheDocument();
  expect(updateUserMock).not.toHaveBeenCalled();
});

it("shows the backend's error message when updateUser fails", async () => {
  const user = userEvent.setup();
  getUserMock.mockResolvedValue(makeUser([{ provider: "google" }]));
  updateUserMock.mockResolvedValue({ data: null, error: { message: "Password is too weak" } });

  render(<PasswordSection />);
  await screen.findByText("Password");

  await user.type(screen.getByLabelText("New password"), "new-password-123");
  await user.type(screen.getByLabelText("Confirm new password"), "new-password-123");
  await user.click(screen.getByRole("button", { name: "Set password" }));

  await waitFor(() => expect(screen.getByText("Password is too weak")).toBeInTheDocument());
});
