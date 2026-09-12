"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { PendingInviteOut, TeamMemberOut, TeamRole } from "@/lib/backend";

const ROLE_LABELS: Record<TeamRole, string> = { admin: "Admin", member: "Member" };

/** Team section per docs/04-ui-ux-design.md Section 3.6: "simple list +
 * invite-by-email, role toggle (Admin/Member)." Invited rows show
 * alongside members, distinguished as pending, with a way to cancel a
 * mistaken invite -- not explicitly asked for in the doc, but without it
 * a bad invite (typo'd email, wrong role) would be permanently stuck.
 *
 * `isAdmin` gates the invite form, role-toggle button, and cancel-invite
 * button -- a Member sees the same list read-only. Bug fix: these
 * controls used to render for every org member regardless of role, and
 * nothing on the backend checked role either, so a Member could invite
 * teammates or promote themselves to Admin. This is a UI convenience
 * only; the real gate is the backend's own check (see
 * backend/app/routers/settings.py's _require_admin) -- never rely on
 * this prop alone for security. */
export function TeamSection({
  team,
  pendingInvites,
  isAdmin,
}: {
  team: TeamMemberOut[];
  pendingInvites: PendingInviteOut[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  // Bug fix: demoting the org's only Admin (most often an Admin
  // demoting themselves) used to succeed with no way back -- the role
  // toggle is gated on isAdmin, which flips to false the moment their
  // own role does. Disabling the toggle for the last admin's own row
  // avoids the situation entirely; backend/app/routers/settings.py's
  // update_team_member_role rejects it either way, for a race between
  // two admins acting at once.
  const adminCount = team.filter((member) => member.role === "admin").length;

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviting(true);
    setInviteError(null);
    try {
      const response = await fetch("/api/settings/team/invite", {
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

  async function handleCancelInvite(id: string) {
    setPendingActionId(id);
    try {
      const response = await fetch(`/api/settings/team/invites/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      router.refresh();
    } finally {
      setPendingActionId(null);
    }
  }

  async function handleToggleRole(member: TeamMemberOut) {
    setPendingActionId(member.id);
    setRoleError(null);
    try {
      const response = await fetch(`/api/settings/team/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: member.role === "admin" ? "member" : "admin" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Couldn't change this member's role — try again.");
      }
      router.refresh();
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : "Couldn't change this member's role — try again.");
    } finally {
      setPendingActionId(null);
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
          {team.map((member) => {
            const isLastAdmin = member.role === "admin" && adminCount === 1;
            return (
              <tr key={member.id}>
                <td>{member.email}</td>
                <td>
                  {isAdmin ? (
                    <button
                      type="button"
                      className="role-toggle"
                      aria-label={`Change ${member.email}'s role (currently ${ROLE_LABELS[member.role]})`}
                      disabled={pendingActionId === member.id || isLastAdmin}
                      title={isLastAdmin ? "Every organization needs at least one Admin" : undefined}
                      onClick={() => handleToggleRole(member)}
                    >
                      {ROLE_LABELS[member.role]}
                    </button>
                  ) : (
                    ROLE_LABELS[member.role]
                  )}
                </td>
              </tr>
            );
          })}
          {pendingInvites.map((invite) => (
            <tr key={invite.id}>
              <td>
                {invite.email} <span className="page-placeholder">(invited)</span>
              </td>
              <td className="team-invite-role-cell">
                <span className="mono">{ROLE_LABELS[invite.role]}</span>
                {isAdmin && (
                  <button
                    type="button"
                    className="link-button"
                    disabled={pendingActionId === invite.id}
                    onClick={() => handleCancelInvite(invite.id)}
                  >
                    Cancel invite
                  </button>
                )}
              </td>
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

      {roleError && <p className="login-error">{roleError}</p>}

      {isAdmin && (
        <form onSubmit={handleInvite} className="new-rule-form">
          <div className="new-rule-form-field">
            <label className="login-label" htmlFor="invite-email">
              Invite by email
            </label>
            <input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="new-rule-form-field">
            <label className="login-label" htmlFor="invite-role">
              Role
            </label>
            <select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as TeamRole)}>
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
      )}
    </section>
  );
}
