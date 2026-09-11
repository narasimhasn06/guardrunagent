import { NextResponse } from "next/server";

import { BackendError, createOrg } from "@/lib/backend";

// Proxies the "create your organization" form (components/onboarding/create-org-form.tsx)
// to the backend -- see app/api/rules/route.ts for why this indirection is needed.
export async function POST(request: Request) {
  const body = (await request.json()) as { org_name?: string };

  try {
    const org = await createOrg(body.org_name ?? "");
    return NextResponse.json(org, { status: 201 });
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
