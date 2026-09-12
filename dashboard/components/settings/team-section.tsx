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
 * `isAdmin` gates the invite form, role-toggle button, remove button, and
 * cancel-invite button -- a Member sees the same list read-only. Bug fix:
 * these controls used to render for every org member regardless of role,
 * and nothing on the backend checked role either, so a Member could
 * invite teammates or promote themselves to Admin. This is a UI
 * convenience only; the real gate is the backend's own check (see
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
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  // Bug fix: demoting (or removing) the org's only Admin -- most often
  // an Admin acting on themselves -- used to succeed with no way back:
  // the role toggle is gated on isAdmin, which flips to false the
  // moment their own role does, and removal is permanent regardless.
  // Disabling both for the last admin's own row avoids the situation
  // entirely; the backend rejects it either way (see
  // backend/app/routers/settings.py's update_team_member_role and
  // remove_team_member), for a race between two admins acting at once.
  const adminCount = team.filter((member) => member.role === "admin").length;

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviting(true);
    setInviteError(null);
    setInviteNotice(null);
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
      const invite = (await response.json()) as PendingInviteOut;
      if (invite.invite_email_sent) {
        setInviteNotice(`Invite sent to ${invite.email}.`);
      } else {
        // Most often means this email already has a Supabase account
        // (e.g. previously removed from an org) -- they'll be linked
        // automatically once they just sign in, but no fresh invite
        // email went out, so let the admin know to reach out directly
        // if that matters.
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
    setActionError(null);
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
      setActionError(err instanceof Error ? err.message : "Couldn't change this member's role — try again.");
    } finally {
      setPendingActionId(null);
    }
  }

  async function handleRemoveMember(memberId: string) {
    setPendingActionId(memberId);
    setActionError(null);
    try {
      const response = await fetch(`/api/settings/team/${memberId}`, { method: "DELETE" });
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
            {isAdmin && <th>Actions</th>}
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
                {isAdmin &&
                  (confirmRemoveId === member.id ? (
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
                  ))}
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
              {isAdmin && (
                <td>
                  <button
                    type="button"
                    className="link-button"
                    disabled={pendingActionId === invite.id}
                    onClick={() => handleCancelInvite(invite.id)}
                  >
                    Cancel invite
                  </button>
                </td>
              )}
            </tr>
          ))}
          {team.length === 0 && pendingInvites.length === 0 && (
            <tr>
              <td colSpan={isAdmin ? 3 : 2} className="page-placeholder">
                No team members yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {actionError && <p className="login-error">{actionError}</p>}

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
          {inviteNotice && <p className="login-notice">{inviteNotice}</p>}
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
