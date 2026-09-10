import { NextResponse } from "next/server";

import { BackendError, testSlackWebhook } from "@/lib/backend";

// Proxies the "Send test alert" button to the backend -- see
// app/api/rules/route.ts for why this indirection is needed.
export async function POST() {
  try {
    const result = await testSlackWebhook();
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
