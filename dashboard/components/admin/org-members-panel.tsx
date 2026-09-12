"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { PendingInviteOut, TeamMemberOut, TeamRole } from "@/lib/backend";

const ROLE_LABELS: Record<TeamRole, string> = { admin: "Admin", member: "Member" };

/**
 * "Organizations" screen's drill-in view (Super Admin role) -- one org's
 * team and pending invites. The member list itself stays mostly
 * read-only (no role toggle or cancel-invite action here) -- a platform
 * admin views another org's team to support/debug it, not take over
 * running it day-to-day; those actions stay with that org's own admins
 * in their normal Settings -> Team.
 *
 * Invite (added once real usage showed a genuine need for it -- see
 * CLAUDE.md's decisions log) and Remove (added directly in response to
 * there being no way to do this except editing org_members by hand via
 * the Supabase SQL Editor) are the two exceptions. Both create/consume
 * the same rows an org admin's own actions would (see
 * backend/app/invites.py's create_pending_invite and
 * backend/app/org_members.py's ensure_not_last_admin), so that org's own
 * Settings -> Team sees and can act on either one too.
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
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const adminCount = team.filter((member) => member.role === "admin").length;

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviting(true);
    setInviteError(null);
    setInviteNotice(null);
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
      const invite = (await response.json()) as PendingInviteOut;
      if (!invite.invite_email_sent) {
        setInviteNotice(`No email was sent to ${invite.email} — they may already have an account. Let them know directly.`);
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

  async function handleRemoveMember(memberId: string) {
    setPendingActionId(memberId);
    setActionError(null);
    try {
      const response = await fetch(`/api/admin/orgs/${orgId}/members/${memberId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Couldn't remove this member — try again.");
      }
      setConfirmRemoveId(null);
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't remove this member — try again.");
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
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {team.map((member) => {
            const isLastAdmin = member.role === "admin" && adminCount === 1;
            return (
              <tr key={member.id}>
                <td>{member.email}</td>
                <td>{ROLE_LABELS[member.role]}</td>
                {confirmRemoveId === member.id ? (
                  <td className="team-invite-role-cell">
                    <span>Remove {member.email}?</span>
                    <button
                      type="button"
                      className="link-button"
                      disabled={pendingActionId === member.id}
                      onClick={() => handleRemoveMember(member.id)}
                    >
                      Yes, remove
                    </button>
                    <button type="button" className="link-button" onClick={() => setConfirmRemoveId(null)}>
                      Cancel
                    </button>
                  </td>
                ) : (
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      disabled={isLastAdmin}
                      title={isLastAdmin ? "Every organization needs at least one Admin" : undefined}
                      onClick={() => setConfirmRemoveId(member.id)}
                    >
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
          {pendingInvites.map((invite) => (
            <tr key={invite.id}>
              <td>
                {invite.email} <span className="page-placeholder">(invited)</span>
                {!invite.invite_email_sent && (
                  <span className="page-placeholder" title="They may already have an account — let them know directly.">
                    {" "}
                    (no email sent)
                  </span>
                )}
              </td>
              <td className="mono">{ROLE_LABELS[invite.role]}</td>
              <td />
            </tr>
          ))}
          {team.length === 0 && pendingInvites.length === 0 && (
            <tr>
              <td colSpan={3} className="page-placeholder">
                No team members yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {actionError && <p className="login-error">{actionError}</p>}

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
        {inviteNotice && <p className="login-notice">{inviteNotice}</p>}
        <div className="new-rule-form-actions">
          <button type="submit" className="btn btn-primary" disabled={inviting}>
            {inviting ? "Inviting…" : "Invite"}
          </button>
        </div>
      </form>
    </section>
  );
}
