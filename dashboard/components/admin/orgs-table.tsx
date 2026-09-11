import Link from "next/link";

import type { AdminOrgOut } from "@/lib/backend";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * "Organizations" screen's list view (Super Admin role) -- every org on
 * the platform, name/member count/created date, drilling into
 * /admin/orgs/[id] for that org's team and pending invites. New scope,
 * not in the original docs -- see CLAUDE.md's "Planned, not yet built"
 * entry this closes and docs/04-ui-ux-design.md's "Organizations" screen.
 */
export function OrgsTable({ orgs }: { orgs: AdminOrgOut[] }) {
  if (orgs.length === 0) {
    return <p className="page-placeholder">No organizations yet.</p>;
  }

  return (
    <table className="sessions-table">
      <thead>
        <tr>
          <th>Organization</th>
          <th>Members</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {orgs.map((org) => (
          <tr key={org.id}>
            <td>
              <Link href={`/admin/orgs/${org.id}`} className="sessions-table-row-link">
                {org.name}
              </Link>
            </td>
            <td className="mono">{org.member_count.toLocaleString()}</td>
            <td>{formatDate(org.created_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
