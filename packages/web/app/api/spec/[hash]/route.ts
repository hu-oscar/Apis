// GET /api/spec/{hash} — worker fetches the prompt JSON for a spec_hash.
//
// Mirrors what the worker used to do via direct filesystem read in
// apis_worker/spec_channel.lookup_spec(). Now the worker (running on
// the user's Mac) can fetch from the deployed Vercel API instead, which
// lets the buyer drive the flow via apis-mvp.vercel.app while the
// worker still lives locally.
//
// 200 + JSON spec on hit, 404 on miss.

import { NextResponse } from "next/server";
import { kvGet } from "@/app/lib/kv";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ hash: string }> },
): Promise<Response> {
  const { hash } = await context.params;
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return NextResponse.json(
      { error: "hash must be a lower-case 64-char hex string" },
      { status: 400 },
    );
  }
  const spec = await kvGet<unknown>("spec", hash);
  if (spec == null) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ spec });
}
