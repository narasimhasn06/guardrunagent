import { NextResponse } from "next/server";

import { BackendError, cancelInvite } from "@/lib/backend";

// Proxies the "Cancel" button on a pending invite to the backend -- see
// app/api/rules/route.ts for why this indirection is needed.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    await cancelInvite(id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
