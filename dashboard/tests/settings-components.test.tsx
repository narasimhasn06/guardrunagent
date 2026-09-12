import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiKeySection } from "@/components/settings/api-key-section";
import { FailModeSection } from "@/components/settings/fail-mode-section";
import { SlackSection } from "@/components/settings/slack-section";
import { TeamSection } from "@/components/settings/team-section";
import type { PendingInviteOut, TeamMemberOut } from "@/lib/backend";

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
  vi.unstubAllGlobals();
});

function makeMember(overrides: Partial<TeamMemberOut> = {}): TeamMemberOut {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    email: "jane@example.com",
    role: "admin",
    created_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

function makeInvite(overrides: Partial<PendingInviteOut> = {}): PendingInviteOut {
  return {
    id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    email: "new.hire@example.com",
    role: "member",
    created_at: "2026-09-10T10:00:00Z",
    invite_email_sent: true,
    ...overrides,
  };
}

describe("ApiKeySection", () => {
  it("shows a masked placeholder, never the real key, before regenerating", () => {
    render(<ApiKeySection />);
    expect(screen.getByText("••••••••••••••••••••••••••••••••")).toBeInTheDocument();
    expect(screen.queryByText(/copy this key now/i)).not.toBeInTheDocument();
  });

  it("asks for confirmation before regenerating", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<ApiKeySection />);
    await user.click(screen.getByRole("button", { name: "Regenerate" }));

    expect(screen.getByText(/regenerating breaks existing sdk installs/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancelling the confirmation does nothing", async () => {
    const user = userEvent.setup();
    render(<ApiKeySection />);
    await user.click(screen.getByRole("button", { name: "Regenerate" }));

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(/regenerating breaks/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
  });

  it("confirming regenerates and reveals the new key exactly once", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ api_key: "grk_newsecret123" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<ApiKeySection />);
    await user.click(screen.getByRole("button", { name: "Regenerate" }));
    await user.click(screen.getByRole("button", { name: "Yes, regenerate" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/settings/api-key/regenerate", { method: "POST" });
    await waitFor(() => expect(screen.getByText("grk_newsecret123")).toBeInTheDocument());
    expect(screen.queryByText("••••••••••••••••••••••••••••••••")).not.toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("shows an error when regeneration fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    render(<ApiKeySection />);
    await user.click(screen.getByRole("button", { name: "Regenerate" }));
    await user.click(screen.getByRole("button", { name: "Yes, regenerate" }));

    await waitFor(() => expect(screen.getByText(/couldn't regenerate the api key/i)).toBeInTheDocument());
  });
});

describe("SlackSection", () => {
  it("pre-fills the saved webhook URL", () => {
    render(<SlackSection initialWebhookUrl="https://hooks.slack.example/services/xyz" />);
    expect(screen.getByLabelText("Webhook URL")).toHaveValue("https://hooks.slack.example/services/xyz");
  });

  it("disables the test button when nothing is configured", () => {
    render(<SlackSection initialWebhookUrl={null} />);
    expect(screen.getByRole("button", { name: /send test alert/i })).toBeDisabled();
  });

  it("disables the test button once the input is edited but not yet saved", async () => {
    const user = userEvent.setup();
    render(<SlackSection initialWebhookUrl="https://hooks.slack.example/services/xyz" />);

    await user.type(screen.getByLabelText("Webhook URL"), "/extra");

    expect(screen.getByRole("button", { name: /send test alert/i })).toBeDisabled();
    expect(screen.getByText(/save your changes before sending a test alert/i)).toBeInTheDocument();
  });

  it("saves the webhook URL", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ slack_webhook_configured: true, slack_webhook_url: "https://hooks.slack.example/new" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SlackSection initialWebhookUrl={null} />);
    await user.type(screen.getByLabelText("Webhook URL"), "https://hooks.slack.example/new");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/slack-webhook",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ webhook_url: "https://hooks.slack.example/new" }),
      })
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("sends an empty save as null to clear the integration", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ slack_webhook_configured: false, slack_webhook_url: null }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SlackSection initialWebhookUrl="https://hooks.slack.example/services/xyz" />);
    await user.clear(screen.getByLabelText("Webhook URL"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/slack-webhook",
      expect.objectContaining({ body: JSON.stringify({ webhook_url: null }) })
    );
  });

  it("sends a test alert and reports success", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ delivered: true }) }));

    render(<SlackSection initialWebhookUrl="https://hooks.slack.example/services/xyz" />);
    await user.click(screen.getByRole("button", { name: /send test alert/i }));

    await waitFor(() => expect(screen.getByText("Test alert delivered.")).toBeInTheDocument());
  });

  it("reports when the test alert fails to deliver", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ delivered: false }) }));

    render(<SlackSection initialWebhookUrl="https://hooks.slack.example/services/xyz" />);
    await user.click(screen.getByRole("button", { name: /send test alert/i }));

    await waitFor(() => expect(screen.getByText(/couldn't be delivered/i)).toBeInTheDocument());
  });
});

describe("FailModeSection", () => {
  it("shows the fail-open state and copy by default", () => {
    render(<FailModeSection initialFailMode="open" />);
    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/fail open — let actions through/i)).toBeInTheDocument();
  });

  it("shows the fail-closed state and copy when already set to closed", () => {
    render(<FailModeSection initialFailMode="closed" />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/fail closed — block actions/i)).toBeInTheDocument();
  });

  it("toggles from open to closed and saves it", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ fail_mode: "closed" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<FailModeSection initialFailMode="open" />);
    await user.click(screen.getByRole("switch"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/fail-mode",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ fail_mode: "closed" }) })
    );
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("reports an error and leaves the state unchanged when the save fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    render(<FailModeSection initialFailMode="open" />);
    await user.click(screen.getByRole("switch"));

    await waitFor(() => expect(screen.getByText(/couldn't save this setting/i)).toBeInTheDocument());
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });
});

describe("TeamSection", () => {
  it("shows a placeholder when there are no members or invites", () => {
    render(<TeamSection team={[]} pendingInvites={[]} isAdmin />);
    expect(screen.getByText(/no team members yet/i)).toBeInTheDocument();
  });

  it("lists members with their current role and pending invites marked as invited", () => {
    render(<TeamSection team={[makeMember()]} pendingInvites={[makeInvite()]} isAdmin />);
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /jane@example.com's role/i })).toHaveTextContent("Admin");
    expect(screen.getByText("new.hire@example.com")).toBeInTheDocument();
    expect(screen.getByText("(invited)")).toBeInTheDocument();
  });

  it("toggles a member's role between admin and member", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => makeMember({ role: "member" }) });
    vi.stubGlobal("fetch", fetchMock);

    // Two admins here (not just one) -- toggling jane isn't blocked by
    // the last-admin guard below, which is tested separately.
    render(
      <TeamSection
        team={[makeMember({ role: "admin" }), makeMember({ id: "other-id", email: "other@example.com", role: "admin" })]}
        pendingInvites={[]}
        isAdmin
      />
    );
    await user.click(screen.getByRole("button", { name: /jane@example.com's role/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/team/33333333-3333-3333-3333-333333333333",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ role: "member" }) })
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  // Bug fix: demoting the org's only Admin (most often self-demotion)
  // used to succeed with no way back -- the toggle that would promote
  // them again is gated on isAdmin, which flips to false the moment
  // their own role does. See backend/app/routers/settings.py's
  // update_team_member_role for the server-side guard this mirrors.
  it("disables the role toggle for the organization's only admin", () => {
    render(<TeamSection team={[makeMember({ role: "admin" })]} pendingInvites={[]} isAdmin />);
    expect(screen.getByRole("button", { name: /jane@example.com's role/i })).toBeDisabled();
  });

  it("does not disable the toggle when another admin exists", () => {
    render(
      <TeamSection
        team={[makeMember({ role: "admin" }), makeMember({ id: "other-id", email: "other@example.com", role: "admin" })]}
        pendingInvites={[]}
        isAdmin
      />
    );
    expect(screen.getByRole("button", { name: /jane@example.com's role/i })).not.toBeDisabled();
  });

  it("does not disable a plain Member's toggle even when they're the only team row", () => {
    render(<TeamSection team={[makeMember({ role: "member" })]} pendingInvites={[]} isAdmin />);
    expect(screen.getByRole("button", { name: /jane@example.com's role/i })).not.toBeDisabled();
  });

  it("shows the backend's error message when a role change is rejected", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Every organization needs at least one Admin -- promote someone else first." }),
      })
    );

    // Two admins in props (so the button isn't disabled client-side),
    // simulating a race where the backend's own check still catches it.
    render(
      <TeamSection
        team={[makeMember({ role: "admin" }), makeMember({ id: "other-id", email: "other@example.com", role: "admin" })]}
        pendingInvites={[]}
        isAdmin
      />
    );
    await user.click(screen.getByRole("button", { name: /jane@example.com's role/i }));

    await waitFor(() =>
      expect(screen.getByText("Every organization needs at least one Admin -- promote someone else first.")).toBeInTheDocument()
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // Added directly in response to there being no way to remove a member
  // except editing org_members by hand via the Supabase SQL Editor. See
  // backend/app/routers/settings.py's remove_team_member.
  describe("removing a member", () => {
    it("hides the Actions column entirely for a non-admin", () => {
      render(<TeamSection team={[makeMember()]} pendingInvites={[]} isAdmin={false} />);
      expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    });

    it("asks for confirmation before removing", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      render(
        <TeamSection
          team={[makeMember({ role: "admin" }), makeMember({ id: "other-id", email: "other@example.com", role: "member" })]}
          pendingInvites={[]}
          isAdmin
        />
      );
      await user.click(screen.getAllByRole("button", { name: "Remove" })[1]);

      expect(screen.getByText("Remove other@example.com?")).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("cancelling the confirmation does nothing", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      render(<TeamSection team={[makeMember({ role: "member" })]} pendingInvites={[]} isAdmin />);
      await user.click(screen.getByRole("button", { name: "Remove" }));
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByText(/remove jane@example.com\?/i)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("removes the member after confirming", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      render(<TeamSection team={[makeMember({ role: "member" })]} pendingInvites={[]} isAdmin />);
      await user.click(screen.getByRole("button", { name: "Remove" }));
      await user.click(screen.getByRole("button", { name: "Yes, remove" }));

      expect(fetchMock).toHaveBeenCalledWith("/api/settings/team/33333333-3333-3333-3333-333333333333", {
        method: "DELETE",
      });
      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    });

    it("disables Remove for the organization's only admin", () => {
      render(<TeamSection team={[makeMember({ role: "admin" })]} pendingInvites={[]} isAdmin />);
      expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    });

    it("does not disable Remove when another admin exists", () => {
      render(
        <TeamSection
          team={[makeMember({ role: "admin" }), makeMember({ id: "other-id", email: "other@example.com", role: "admin" })]}
          pendingInvites={[]}
          isAdmin
        />
      );
      expect(screen.getAllByRole("button", { name: "Remove" })[0]).not.toBeDisabled();
    });

    it("shows the backend's error message when removal is rejected", async () => {
      const user = userEvent.setup();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          json: async () => ({ error: "Every organization needs at least one Admin -- promote someone else first." }),
        })
      );

      // Two admins in props (so Remove isn't disabled client-side),
      // simulating a race where the backend's own check still catches it.
      render(
        <TeamSection
          team={[makeMember({ role: "admin" }), makeMember({ id: "other-id", email: "other@example.com", role: "admin" })]}
          pendingInvites={[]}
          isAdmin
        />
      );
      await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);
      await user.click(screen.getByRole("button", { name: "Yes, remove" }));

      await waitFor(() =>
        expect(screen.getByText("Every organization needs at least one Admin -- promote someone else first.")).toBeInTheDocument()
      );
      expect(refreshMock).not.toHaveBeenCalled();
    });
  });

  it("cancels a pending invite", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeamSection team={[]} pendingInvites={[makeInvite()]} isAdmin />);
    await user.click(screen.getByRole("button", { name: "Cancel invite" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/settings/team/invites/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", {
      method: "DELETE",
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("submits a new invite and resets the form", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => makeInvite() });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeamSection team={[]} pendingInvites={[]} isAdmin />);
    await user.type(screen.getByLabelText("Invite by email"), "teammate@example.com");
    await user.selectOptions(screen.getByLabelText("Role"), "admin");
    await user.click(screen.getByRole("button", { name: "Invite" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/team/invite",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "teammate@example.com", role: "admin" }),
      })
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("shows a notice when the invite was created but no email was sent", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => makeInvite({ invite_email_sent: false }) })
    );

    render(<TeamSection team={[]} pendingInvites={[]} isAdmin />);
    await user.type(screen.getByLabelText("Invite by email"), "new.hire@example.com");
    await user.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() =>
      expect(screen.getByText(/no email was sent to new\.hire@example\.com/i)).toBeInTheDocument()
    );
  });

  it("marks a pending invite that never got an email", () => {
    render(<TeamSection team={[]} pendingInvites={[makeInvite({ invite_email_sent: false })]} isAdmin />);
    expect(screen.getByText("(no email sent)")).toBeInTheDocument();
  });

  it("shows the backend's error message when an invite fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "This email has already been invited" }) })
    );

    render(<TeamSection team={[]} pendingInvites={[]} isAdmin />);
    await user.type(screen.getByLabelText("Invite by email"), "dup@example.com");
    await user.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() => expect(screen.getByText("This email has already been invited")).toBeInTheDocument());
  });

  // Bug fix: these controls used to render for every org member
  // regardless of role -- a Member could invite teammates or promote
  // themselves to Admin. isAdmin=false gives a read-only view; the real
  // gate is the backend's own role check (see
  // backend/app/routers/settings.py's _require_admin).
  describe("as a non-admin (Member)", () => {
    it("shows roles as plain text, not a toggle button", () => {
      render(<TeamSection team={[makeMember()]} pendingInvites={[]} isAdmin={false} />);
      expect(screen.getByText("jane@example.com")).toBeInTheDocument();
      expect(screen.getByText("Admin")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /jane@example.com's role/i })).not.toBeInTheDocument();
    });

    it("hides the cancel-invite button on pending invites", () => {
      render(<TeamSection team={[]} pendingInvites={[makeInvite()]} isAdmin={false} />);
      expect(screen.getByText(/new\.hire@example\.com/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cancel invite" })).not.toBeInTheDocument();
    });

    it("hides the invite-by-email form entirely", () => {
      render(<TeamSection team={[]} pendingInvites={[]} isAdmin={false} />);
      expect(screen.queryByLabelText("Invite by email")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Invite" })).not.toBeInTheDocument();
    });
  });
});
