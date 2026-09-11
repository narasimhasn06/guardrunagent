import { NextResponse } from "next/server";

import { BackendError, inviteOrgMember, type TeamRole } from "@/lib/backend";

// Proxies the invite form on the Organizations detail page
// (components/admin/org-members-panel.tsx) to the backend -- see
// app/api/rules/route.ts for why this indirection is needed. Real access
// control is the backend's verify_platform_admin (app/auth.py); this
// handler forwards whatever it returns, 403 included.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as { email: string; role: TeamRole };

  try {
    const invite = await inviteOrgMember(id, body.email, body.role);
    return NextResponse.json(invite, { status: 201 });
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
