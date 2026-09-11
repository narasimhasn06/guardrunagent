import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OrgMembersPanel } from "@/components/admin/org-members-panel";
import { OrgsTable } from "@/components/admin/orgs-table";
import type { AdminOrgOut, PendingInviteOut, TeamMemberOut } from "@/lib/backend";

/**
 * Super Admin "Organizations" screen components -- see CLAUDE.md's
 * "Planned, not yet built" entry this closes. Mirrors
 * tests/sessions-components.test.tsx / tests/settings-components.test.tsx's
 * shape.
 */

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
  it("shows a placeholder when there are no members or invites", () => {
    render(<OrgMembersPanel team={[]} pendingInvites={[]} />);
    expect(screen.getByText(/no team members yet/i)).toBeInTheDocument();
  });

  it("lists members and pending invites, read-only (no role toggle or cancel action)", () => {
    render(<OrgMembersPanel team={[makeMember()]} pendingInvites={[makeInvite()]} />);

    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText(/new\.hire@example\.com/)).toBeInTheDocument();
    expect(screen.getByText("(invited)")).toBeInTheDocument();

    // Unlike components/settings/team-section.tsx, this view is read-only
    // -- a platform admin browses another org's team, doesn't manage it.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
