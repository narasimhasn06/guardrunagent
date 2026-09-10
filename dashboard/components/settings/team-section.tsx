"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { PendingInviteOut, TeamMemberOut, TeamRole } from "@/lib/backend";

const ROLE_LABELS: Record<TeamRole, string> = { admin: "Admin", member: "Member" };

/** Team section per docs/04-ui-ux-design.md Section 3.6: "simple list +
 * invite-by-email, role toggle (Admin/Member)." Invited rows show
 * alongside members, distinguished as pending, with a way to cancel a
 * mistaken invite -- not explicitly asked for in the doc, but without it
 * a bad invite (typo'd email, wrong role) would be permanently stuck. */
export function TeamSection({
  team,
  pendingInvites,
}: {
  team: TeamMemberOut[];
  pendingInvites: PendingInviteOut[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

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
    try {
      const response = await fetch(`/api/settings/team/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: member.role === "admin" ? "member" : "admin" }),
      });
      if (!response.ok) throw new Error();
      router.refresh();
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
          {team.map((member) => (
            <tr key={member.id}>
              <td>{member.email}</td>
              <td>
                <button
                  type="button"
                  className="role-toggle"
                  aria-label={`Change ${member.email}'s role (currently ${ROLE_LABELS[member.role]})`}
                  disabled={pendingActionId === member.id}
                  onClick={() => handleToggleRole(member)}
                >
                  {ROLE_LABELS[member.role]}
                </button>
              </td>
            </tr>
          ))}
          {pendingInvites.map((invite) => (
            <tr key={invite.id}>
              <td>
                {invite.email} <span className="page-placeholder">(invited)</span>
              </td>
              <td className="team-invite-role-cell">
                <span className="mono">{ROLE_LABELS[invite.role]}</span>
                <button
                  type="button"
                  className="link-button"
                  disabled={pendingActionId === invite.id}
                  onClick={() => handleCancelInvite(invite.id)}
                >
                  Cancel invite
                </button>
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
    </section>
  );
}
