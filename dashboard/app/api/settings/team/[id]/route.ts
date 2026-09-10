import { NextResponse } from "next/server";

import { BackendError, updateTeamMemberRole, type TeamRole } from "@/lib/backend";

// Proxies the role toggle in the Team list (components/settings/team-section.tsx)
// to the backend -- see app/api/rules/route.ts for why this indirection is needed.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as { role: TeamRole };

  try {
    const member = await updateTeamMemberRole(id, body.role);
    return NextResponse.json(member, { status: 200 });
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
