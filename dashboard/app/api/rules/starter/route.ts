import { NextResponse } from "next/server";

import { BackendError, enableStarterRules } from "@/lib/backend";

// Proxies the one-click starter-rules button
// (components/rules/starter-rules-button.tsx) to the backend -- see the
// comment in app/api/rules/route.ts for why this indirection is needed.
export async function POST() {
  try {
    const rules = await enableStarterRules();
    return NextResponse.json({ rules }, { status: 201 });
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
