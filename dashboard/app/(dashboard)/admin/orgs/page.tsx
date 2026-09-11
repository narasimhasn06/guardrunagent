import { OrgsTable } from "@/components/admin/orgs-table";
import { BackendError, getAdminOrgs } from "@/lib/backend";

/**
 * Super Admin "Organizations" screen -- every org on the platform. Only
 * reachable (in the sidebar) when GET /me reports is_platform_admin; the
 * real access control is the backend's verify_platform_admin
 * (app/auth.py), which 403s anyone else, surfaced here the same way any
 * other backend error is. See CLAUDE.md's "Planned, not yet built" entry
 * this closes.
 */
export default async function AdminOrgsPage() {
  let orgs;
  try {
    ({ orgs } = await getAdminOrgs());
  } catch (err) {
    const message = err instanceof BackendError ? err.message : "Unexpected error loading organizations.";
    return (
      <div>
        <h1 className="page-title">Organizations</h1>
        <p className="login-error">Couldn&apos;t load organizations: {message}</p>
      </div>
    );
  }

  return (
    <div className="sessions-page">
      <h1 className="page-title">Organizations</h1>
      <OrgsTable orgs={orgs} />
    </div>
  );
}
