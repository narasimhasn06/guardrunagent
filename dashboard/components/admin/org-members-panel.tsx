import type { PendingInviteOut, TeamMemberOut } from "@/lib/backend";

const ROLE_LABELS: Record<"admin" | "member", string> = { admin: "Admin", member: "Member" };

/**
 * "Organizations" screen's drill-in view (Super Admin role) -- one org's
 * team and pending invites, read-only. Deliberately not the same
 * component as components/settings/team-section.tsx: a platform admin
 * views another org's team to support/debug it, not manage it -- no
 * invite form, role toggle, or cancel-invite action here. See
 * CLAUDE.md's "Planned, not yet built" entry this closes.
 */
export function OrgMembersPanel({
  team,
  pendingInvites,
}: {
  team: TeamMemberOut[];
  pendingInvites: PendingInviteOut[];
}) {
  return (
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
  );
}
