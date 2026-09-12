import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrgMembersPanel } from "@/components/admin/org-members-panel";
import { OrgsTable } from "@/components/admin/orgs-table";
import type { AdminOrgOut, PendingInviteOut, TeamMemberOut } from "@/lib/backend";

/**
 * Super Admin "Organizations" screen components -- see CLAUDE.md's
 * "Planned, not yet built" entry this closes. Mirrors
 * tests/sessions-components.test.tsx / tests/settings-components.test.tsx's
 * shape.
 */

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
  vi.unstubAllGlobals();
});

function makeOrg(overrides: Partial<AdminOrgOut> = {}): AdminOrgOut {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Acme Inc",
    created_at: "2026-09-01T10:00:00Z",
    member_count: 3,
    ...overrides,
  };
}

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

describe("OrgsTable", () => {
  it("shows a placeholder when there are no organizations", () => {
    render(<OrgsTable orgs={[]} />);
    expect(screen.getByText(/no organizations yet/i)).toBeInTheDocument();
  });

  it("lists each org with its member count, linking to its detail page", () => {
    render(<OrgsTable orgs={[makeOrg(), makeOrg({ id: "org-2", name: "Widgets Co", member_count: 1 })]} />);

    expect(screen.getByText("Acme Inc")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Acme Inc" });
    expect(link).toHaveAttribute("href", "/admin/orgs/11111111-1111-1111-1111-111111111111");

    expect(screen.getByRole("link", { name: "Widgets Co" })).toHaveAttribute("href", "/admin/orgs/org-2");
  });
});

describe("OrgMembersPanel", () => {
  const ORG_ID = "11111111-1111-1111-1111-111111111111";

  it("shows a placeholder when there are no members or invites", () => {
    render(<OrgMembersPanel orgId={ORG_ID} team={[]} pendingInvites={[]} />);
    expect(screen.getByText(/no team members yet/i)).toBeInTheDocument();
  });

  it("lists members and pending invites -- no role toggle or cancel action, but Remove is present", () => {
    render(<OrgMembersPanel orgId={ORG_ID} team={[makeMember()]} pendingInvites={[makeInvite()]} />);

    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    const memberRow = screen.getByText("jane@example.com").closest("tr")!;
    expect(within(memberRow).getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText(/new\.hire@example\.com/)).toBeInTheDocument();
    expect(screen.getByText("(invited)")).toBeInTheDocument();

    // A platform admin can add a new member to this org and remove an
    // existing one (see the invite-form and removing-a-member tests
    // below) -- but still can't toggle an existing member's role or
    // cancel a pending invite. Those stay with that org's own admins in
    // their normal Settings -> Team.
    expect(screen.queryByRole("button", { name: /'s role/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel invite" })).not.toBeInTheDocument();
    expect(within(memberRow).getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  // Added directly in response to there being no way to remove a member
  // except editing org_members by hand via the Supabase SQL Editor. See
  // backend/app/routers/admin.py's remove_org_member.
  describe("removing a member", () => {
    it("asks for confirmation before removing", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      render(
        <OrgMembersPanel
          orgId={ORG_ID}
          team={[makeMember({ role: "admin" }), makeMember({ id: "other-id", email: "other@example.com", role: "member" })]}
          pendingInvites={[]}
        />
      );
      await user.click(screen.getAllByRole("button", { name: "Remove" })[1]);

      expect(screen.getByText("Remove other@example.com?")).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("removes the member after confirming, scoped to this org", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      render(<OrgMembersPanel orgId={ORG_ID} team={[makeMember({ role: "member" })]} pendingInvites={[]} />);
      await user.click(screen.getByRole("button", { name: "Remove" }));
      await user.click(screen.getByRole("button", { name: "Yes, remove" }));

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/admin/orgs/${ORG_ID}/members/33333333-3333-3333-3333-333333333333`,
        { method: "DELETE" }
      );
      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    });

    it("disables Remove for the organization's only admin", () => {
      render(<OrgMembersPanel orgId={ORG_ID} team={[makeMember({ role: "admin" })]} pendingInvites={[]} />);
      expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
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

      render(
        <OrgMembersPanel
          orgId={ORG_ID}
          team={[makeMember({ role: "admin" }), makeMember({ id: "other-id", email: "other@example.com", role: "admin" })]}
          pendingInvites={[]}
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

  // Added after the initial read-only build -- see CLAUDE.md's decisions
  // log. Submits to the same-origin Route Handler
  // (app/api/admin/orgs/[id]/invite/route.ts) via plain fetch, exactly
  // like components/settings/team-section.tsx's own invite form -- not
  // lib/backend.ts's inviteOrgMember, which is server-only.
  describe("invite form", () => {
    it("submits a new invite scoped to this org and resets the form", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => makeInvite() });
      vi.stubGlobal("fetch", fetchMock);

      render(<OrgMembersPanel orgId={ORG_ID} team={[]} pendingInvites={[]} />);
      await user.type(screen.getByLabelText("Invite by email"), "teammate@example.com");
      await user.selectOptions(screen.getByLabelText("Role"), "admin");
      await user.click(screen.getByRole("button", { name: "Invite" }));

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/admin/orgs/${ORG_ID}/invite`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "teammate@example.com", role: "admin" }),
        })
      );
      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    });

    it("shows a success notice when the invite email was sent", async () => {
      const user = userEvent.setup();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => makeInvite() }));

      render(<OrgMembersPanel orgId={ORG_ID} team={[]} pendingInvites={[]} />);
      await user.type(screen.getByLabelText("Invite by email"), "new.hire@example.com");
      await user.click(screen.getByRole("button", { name: "Invite" }));

      await waitFor(() => expect(screen.getByText("Invite sent to new.hire@example.com.")).toBeInTheDocument());
    });

    it("shows a notice when the invite was created but no email was sent", async () => {
      const user = userEvent.setup();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, json: async () => makeInvite({ invite_email_sent: false }) })
      );

      render(<OrgMembersPanel orgId={ORG_ID} team={[]} pendingInvites={[]} />);
      await user.type(screen.getByLabelText("Invite by email"), "new.hire@example.com");
      await user.click(screen.getByRole("button", { name: "Invite" }));

      await waitFor(() =>
        expect(screen.getByText(/no email was sent to new\.hire@example\.com/i)).toBeInTheDocument()
      );
    });

    it("marks a pending invite that never got an email", () => {
      render(
        <OrgMembersPanel orgId={ORG_ID} team={[]} pendingInvites={[makeInvite({ invite_email_sent: false })]} />
      );
      expect(screen.getByText("(no email sent)")).toBeInTheDocument();
    });

    it("shows the backend's error message when an invite fails", async () => {
      const user = userEvent.setup();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "This email has already been invited" }) })
      );

      render(<OrgMembersPanel orgId={ORG_ID} team={[]} pendingInvites={[]} />);
      await user.type(screen.getByLabelText("Invite by email"), "dup@example.com");
      await user.click(screen.getByRole("button", { name: "Invite" }));

      await waitFor(() => expect(screen.getByText("This email has already been invited")).toBeInTheDocument());
    });
  });
});
