"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { PendingInviteOut, TeamMemberOut, TeamRole } from "@/lib/backend";

const ROLE_LABELS: Record<TeamRole, string> = { admin: "Admin", member: "Member" };

/**
 * "Organizations" screen's drill-in view (Super Admin role) -- one org's
 * team and pending invites. The member/invite list itself stays
 * read-only (no role toggle or cancel-invite action here) -- a platform
 * admin views another org's team to support/debug it, not take over
 * running it day-to-day; those actions stay with that org's own admins
 * in their normal Settings -> Team.
 *
 * The invite form *is* here, added after the initial read-only build
 * (see CLAUDE.md's decisions log) once real usage showed a genuine need
 * for it -- e.g. onboarding a client org's first user without a platform
 * admin needing to already be a member of that org. It creates the same
 * kind of org_invites row an org admin's own invite would (see
 * backend/app/invites.py's create_pending_invite), so that org's own
 * Settings -> Team shows and can cancel it like any other pending
 * invite.
 */
export function OrgMembersPanel({
  orgId,
  team,
  pendingInvites,
}: {
  orgId: string;
  team: TeamMemberOut[];
  pendingInvites: PendingInviteOut[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviting(true);
    setInviteError(null);
    try {
      const response = await fetch(`/api/admin/orgs/${orgId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Couldn't send the invite — try again.");
      }
      setEmail("");
      setRole("member");
      router.refresh();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Couldn't send the invite — try again.");
    } finally {
      setInviting(false);
    }
  }

  return (
    <section className="home-card settings-section">
      <h2 className="home-card-title">Team</h2>

      <table className="rules-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          {team.map((member) => (
            <tr key={member.id}>
              <td>{member.email}</td>
              <td>{ROLE_LABELS[member.role]}</td>
            </tr>
          ))}
          {pendingInvites.map((invite) => (
            <tr key={invite.id}>
              <td>
                {invite.email} <span className="page-placeholder">(invited)</span>
              </td>
              <td>{ROLE_LABELS[invite.role]}</td>
            </tr>
          ))}
          {team.length === 0 && pendingInvites.length === 0 && (
            <tr>
              <td colSpan={2} className="page-placeholder">
                No team members yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <form onSubmit={handleInvite} className="new-rule-form">
        <div className="new-rule-form-field">
          <label className="login-label" htmlFor="admin-invite-email">
            Invite by email
          </label>
          <input
            id="admin-invite-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="new-rule-form-field">
          <label className="login-label" htmlFor="admin-invite-role">
            Role
          </label>
          <select
            id="admin-invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value as TeamRole)}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {inviteError && <p className="login-error">{inviteError}</p>}
        <div className="new-rule-form-actions">
          <button type="submit" className="btn btn-primary" disabled={inviting}>
            {inviting ? "Inviting…" : "Invite"}
          </button>
        </div>
      </form>
    </section>
  );
}
