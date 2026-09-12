import { NextResponse } from "next/server";

import { BackendError, removeOrgMember } from "@/lib/backend";

// Proxies the "Remove" button on the Organizations detail page
// (components/admin/org-members-panel.tsx) to the backend -- see
// app/api/rules/route.ts for why this indirection is needed.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const { id, memberId } = await params;

  try {
    await removeOrgMember(id, memberId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
