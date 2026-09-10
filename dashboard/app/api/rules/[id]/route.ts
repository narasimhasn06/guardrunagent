import { NextResponse } from "next/server";

import { BackendError, updateRule, type RuleUpdateIn } from "@/lib/backend";

// Proxies the Enabled toggle and any other rule edit from the Rules table
// (components/rules/rules-table.tsx) to the backend -- see the comment in
// app/api/rules/route.ts for why this indirection is needed.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as RuleUpdateIn;

  try {
    const rule = await updateRule(id, body);
    return NextResponse.json(rule, { status: 200 });
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
