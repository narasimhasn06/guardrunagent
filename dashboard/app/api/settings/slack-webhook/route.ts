import { NextResponse } from "next/server";

import { BackendError, updateSlackWebhook } from "@/lib/backend";

// Proxies the Slack webhook save form (components/settings/slack-section.tsx)
// to the backend -- see app/api/rules/route.ts for why this indirection is needed.
export async function PUT(request: Request) {
  const body = (await request.json()) as { webhook_url: string | null };

  try {
    const result = await updateSlackWebhook(body.webhook_url);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
