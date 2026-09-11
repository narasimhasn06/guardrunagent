import { NextResponse } from "next/server";

import { BackendError, updateFailMode, type FailMode } from "@/lib/backend";

// Proxies the fail-open/fail-closed toggle (components/settings/fail-mode-section.tsx)
// to the backend -- see app/api/rules/route.ts for why this indirection is needed.
export async function PUT(request: Request) {
  const body = (await request.json()) as { fail_mode: FailMode };

  try {
    const result = await updateFailMode(body.fail_mode);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
