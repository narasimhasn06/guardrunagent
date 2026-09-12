import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import AuthConfirmPage from "@/app/auth/confirm/page";

/**
 * Invite links no longer consume their token just by loading this page --
 * see the page's own docstring and CLAUDE.md's decisions log for the
 * production bug (an email provider's link scanner burning the
 * single-use token before a human ever clicked) that this design fixes.
 * verifyOtp is only ever called from the button's onClick, never on
 * mount -- these tests assert that directly (the mock is never called
 * until the button is clicked).
 */

const replaceMock = vi.fn();
const verifyOtpMock = vi.fn();
const useSearchParamsMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => useSearchParamsMock(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { verifyOtp: verifyOtpMock } }),
}));

beforeEach(() => {
  replaceMock.mockClear();
  verifyOtpMock.mockReset();
  useSearchParamsMock.mockReset().mockReturnValue(new URLSearchParams("token_hash=the-token-hash"));
});

it("does not call verifyOtp just from loading the page", () => {
  render(<AuthConfirmPage />);
  expect(verifyOtpMock).not.toHaveBeenCalled();
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

it("shows an error instead of a button when token_hash is missing from the link", () => {
  useSearchParamsMock.mockReturnValue(new URLSearchParams());

  render(<AuthConfirmPage />);

  expect(screen.getByText(/missing information/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Accept invitation" })).not.toBeInTheDocument();
});
