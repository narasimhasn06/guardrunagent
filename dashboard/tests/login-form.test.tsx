import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/components/login-form";

/**
 * Login screen per docs/04-ui-ux-design.md Section 3.0 and
 * docs/06-test-plan.md Section 3.3: "Email/password form validation;
 * Google OAuth button triggers the correct redirect; password-reset link
 * only shown for email/password users."
 *
 * The last case is tested against this component's actual, documented
 * behavior (see the comment at the top of login-form.tsx): the doc's
 * literal "hidden for Google-only accounts" isn't implemented (that would
 * need an unauthenticated email lookup -- an enumeration hole), so what's
 * tested here is the real deviation instead: "Forgot password?" shows in
 * sign-in mode and is replaced by the sign-in toggle in sign-up mode.
 */

const pushMock = vi.fn();
const refreshMock = vi.fn();
const signInWithPasswordMock = vi.fn();
const signInWithOAuthMock = vi.fn();
const signUpMock = vi.fn();
const resetPasswordForEmailMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      signInWithOAuth: signInWithOAuthMock,
      signUp: signUpMock,
      resetPasswordForEmail: resetPasswordForEmailMock,
    },
  }),
}));

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
  signInWithPasswordMock.mockReset().mockResolvedValue({ error: null });
  signInWithOAuthMock.mockReset().mockResolvedValue({ error: null });
  signUpMock.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  resetPasswordForEmailMock.mockReset().mockResolvedValue({ error: null });
});

describe("form validation", () => {
  it("marks email and password as required, and password with a minimum length", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Email")).toBeRequired();
    const password = screen.getByLabelText("Password");
    expect(password).toBeRequired();
    expect(password).toHaveAttribute("minlength", "6");
  });

  it("uses the email input type so the browser validates the format", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  });
});

describe("Google OAuth", () => {
  it("triggers signInWithOAuth with the google provider and the callback redirect", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  });

  it("shows an error if the OAuth redirect itself fails to start", async () => {
    const user = userEvent.setup();
    signInWithOAuthMock.mockResolvedValue({ error: { message: "OAuth provider unavailable" } });
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    await waitFor(() => expect(screen.getByText("OAuth provider unavailable")).toBeInTheDocument());
  });
});

describe("password-reset visibility", () => {
  it("shows 'Forgot password?' in sign-in mode", () => {
    render(<LoginForm />);
    expect(screen.getByRole("button", { name: "Forgot password?" })).toBeInTheDocument();
  });

  it("replaces it with a sign-in toggle once switched to sign-up mode", async () => {
    const user = userEvent.setup();
    signInWithPasswordMock.mockResolvedValue({ error: { message: "Invalid credentials" } });
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "new.user@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Already have an account? Sign in" })).toBeInTheDocument()
    );
    expect(screen.queryByRole("button", { name: "Forgot password?" })).not.toBeInTheDocument();
  });

  it("requires an email before sending a reset link", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: "Forgot password?" }));

    expect(screen.getByText(/enter your email above first/i)).toBeInTheDocument();
    expect(resetPasswordForEmailMock).not.toHaveBeenCalled();
  });

  it("sends a generic non-enumerating notice regardless of whether the account exists", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "someone@example.com");
    await user.click(screen.getByRole("button", { name: "Forgot password?" }));

    expect(resetPasswordForEmailMock).toHaveBeenCalledWith("someone@example.com");
    await waitFor(() =>
      expect(screen.getByText(/if an account with that email exists/i)).toBeInTheDocument()
    );
  });
});

describe("sign-in submit", () => {
  it("redirects home on successful sign-in", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "jane@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("offers account creation on failure instead of guessing why it failed", async () => {
    const user = userEvent.setup();
    signInWithPasswordMock.mockResolvedValue({ error: { message: "Invalid credentials" } });
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "jane@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByText(/new here\? create an account below/i)).toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("sign-up submit", () => {
  async function switchToSignUp(user: ReturnType<typeof userEvent.setup>) {
    signInWithPasswordMock.mockResolvedValue({ error: { message: "Invalid credentials" } });
    await user.type(screen.getByLabelText("Email"), "new.user@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument());
  }

  it("redirects home immediately when email confirmation is off", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await switchToSignUp(user);
    signUpMock.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });

    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
  });

  it("shows a check-your-email notice when confirmation is required", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await switchToSignUp(user);
    signUpMock.mockResolvedValue({ data: { session: null }, error: null });

    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(screen.getByText(/check your email to confirm/i)).toBeInTheDocument());
  });

  it("shows the backend's error message on sign-up failure", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await switchToSignUp(user);
    signUpMock.mockResolvedValue({ data: { session: null }, error: { message: "Email already registered" } });

    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(screen.getByText("Email already registered")).toBeInTheDocument());
  });
});
