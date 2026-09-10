import { NextResponse } from "next/server";

import { BackendError, createRule, type RuleCreateIn } from "@/lib/backend";

// Proxies rule creation from the client-side "+ New Rule" form
// (components/rules/new-rule-form.tsx) to the backend. A Route Handler is
// needed rather than calling lib/backend.ts directly from the browser:
// authorizedFetch reads the Supabase session from the request's cookie
// jar server-side, which the browser can't do itself.
export async function POST(request: Request) {
  const body = (await request.json()) as RuleCreateIn;

  try {
    const rule = await createRule(body);
    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
