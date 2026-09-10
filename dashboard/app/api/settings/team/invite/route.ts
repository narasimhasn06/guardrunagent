import { NextResponse } from "next/server";

import { BackendError, inviteTeamMember, type TeamRole } from "@/lib/backend";

// Proxies the "Invite" form (components/settings/team-section.tsx) to the
// backend -- see app/api/rules/route.ts for why this indirection is needed.
export async function POST(request: Request) {
  const body = (await request.json()) as { email: string; role: TeamRole };

  try {
    const invite = await inviteTeamMember(body.email, body.role);
    return NextResponse.json(invite, { status: 201 });
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
