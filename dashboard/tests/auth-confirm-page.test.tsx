import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AuthConfirmPage from "@/app/auth/confirm/page";

/**
 * Invite and password-reset links no longer consume their token just by
 * loading this page -- see the page's own docstring and CLAUDE.md's
 * decisions log for the production bug (an email provider's link scanner
 * burning the single-use token before a human ever clicked) that this
 * design fixes for both flows. verifyOtp is only ever called from the
 * button's onClick, never on mount -- these tests assert that directly
 * (the mock is never called until the button is clicked).
 */

const replaceMock = vi.fn();
const verifyOtpMock = vi.fn();
const updateUserMock = vi.fn();
const useSearchParamsMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => useSearchParamsMock(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { verifyOtp: verifyOtpMock, updateUser: updateUserMock } }),
}));

beforeEach(() => {
  replaceMock.mockClear();
  verifyOtpMock.mockReset();
  updateUserMock.mockReset();
  useSearchParamsMock.mockReset().mockReturnValue(new URLSearchParams("token_hash=the-token-hash"));
});

it("does not call verifyOtp just from loading the page", () => {
  render(<AuthConfirmPage />);
  expect(verifyOtpMock).not.toHaveBeenCalled();
});

it("shows an error instead of a button when token_hash is missing from the link", () => {
  useSearchParamsMock.mockReturnValue(new URLSearchParams());

  render(<AuthConfirmPage />);

  expect(screen.getByText(/missing information/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Accept invitation" })).not.toBeInTheDocument();
});

it("defaults to the invite flow when type is absent from the link (backward-compatible with the existing invite template)", () => {
  render(<AuthConfirmPage />);
  expect(screen.getByRole("button", { name: "Accept invitation" })).toBeInTheDocument();
});

it("calls verifyOtp with the token hash only once the button is clicked, then redirects home", async () => {
  const user = userEvent.setup();
  verifyOtpMock.mockResolvedValue({ data: {}, error: null });

  render(<AuthConfirmPage />);
  await user.click(screen.getByRole("button", { name: "Accept invitation" }));

  expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: "the-token-hash", type: "invite" });
  await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/"));
});

it("shows an error and does not redirect when the token was already used", async () => {
  const user = userEvent.setup();
  verifyOtpMock.mockResolvedValue({ data: null, error: { message: "Token has expired or is invalid" } });

  render(<AuthConfirmPage />);
  await user.click(screen.getByRole("button", { name: "Accept invitation" }));

  await waitFor(() => expect(screen.getByText(/already been used or has expired/i)).toBeInTheDocument());
  expect(replaceMock).not.toHaveBeenCalled();
});

/**
 * type=recovery is what the "Reset Password" email template's link now
 * carries (see DEPLOYMENT.md) -- distinct from invite because verifying
 * the token alone would otherwise sign the user in without ever letting
 * them set a new password, defeating the point of "forgot password".
 */
describe("password reset (type=recovery)", () => {
  beforeEach(() => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams("token_hash=the-token-hash&type=recovery"));
  });

  it("shows a Continue button rather than Accept invitation", () => {
    render(<AuthConfirmPage />);
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept invitation" })).not.toBeInTheDocument();
  });

  it("verifies the token, then shows a set-new-password form instead of redirecting immediately", async () => {
    const user = userEvent.setup();
    verifyOtpMock.mockResolvedValue({ data: {}, error: null });

    render(<AuthConfirmPage />);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: "the-token-hash", type: "recovery" });
    await waitFor(() => expect(screen.getByText("Set a new password")).toBeInTheDocument());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("shows an error and never reaches the password form when the token was already used", async () => {
    const user = userEvent.setup();
    verifyOtpMock.mockResolvedValue({ data: null, error: { message: "Token has expired or is invalid" } });

    render(<AuthConfirmPage />);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByText(/already been used or has expired/i)).toBeInTheDocument());
    expect(screen.queryByText("Set a new password")).not.toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  async function reachPasswordForm(user: ReturnType<typeof userEvent.setup>) {
    verifyOtpMock.mockResolvedValue({ data: {}, error: null });
    render(<AuthConfirmPage />);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("Set a new password")).toBeInTheDocument());
  }

  it("submits the new password via updateUser and redirects home on success", async () => {
    const user = userEvent.setup();
    updateUserMock.mockResolvedValue({ data: {}, error: null });
    await reachPasswordForm(user);

    await user.type(screen.getByLabelText("New password"), "new-password-123");
    await user.type(screen.getByLabelText("Confirm new password"), "new-password-123");
    await user.click(screen.getByRole("button", { name: "Save password" }));

    expect(updateUserMock).toHaveBeenCalledWith({ password: "new-password-123" });
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/"));
  });

  it("rejects mismatched passwords without calling updateUser", async () => {
    const user = userEvent.setup();
    await reachPasswordForm(user);

    await user.type(screen.getByLabelText("New password"), "new-password-123");
    await user.type(screen.getByLabelText("Confirm new password"), "something-else");
    await user.click(screen.getByRole("button", { name: "Save password" }));

    expect(screen.getByText(/don't match/i)).toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("shows the backend's error message when updateUser fails", async () => {
    const user = userEvent.setup();
    updateUserMock.mockResolvedValue({ data: null, error: { message: "Password is too weak" } });
    await reachPasswordForm(user);

    await user.type(screen.getByLabelText("New password"), "new-password-123");
    await user.type(screen.getByLabelText("Confirm new password"), "new-password-123");
    await user.click(screen.getByRole("button", { name: "Save password" }));

    await waitFor(() => expect(screen.getByText("Password is too weak")).toBeInTheDocument());
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
