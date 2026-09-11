import { notFound } from "next/navigation";
import Link from "next/link";

import { OrgMembersPanel } from "@/components/admin/org-members-panel";
import { BackendError, getAdminOrgMembers } from "@/lib/backend";

export default async function AdminOrgDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let org;
  try {
    org = await getAdminOrgMembers(id);
  } catch (err) {
    if (err instanceof BackendError && err.status === 404) {
      notFound();
    }
    const message = err instanceof BackendError ? err.message : "Unexpected error loading this organization.";
    return (
      <div>
        <h1 className="page-title">Organization</h1>
        <p className="login-error">Couldn&apos;t load this organization: {message}</p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <Link href="/admin/orgs" className="link-button">
        ← All organizations
      </Link>
      <h1 className="page-title">{org.org_name}</h1>
      <OrgMembersPanel team={org.team} pendingInvites={org.pending_invites} />
    </div>
  );
}
