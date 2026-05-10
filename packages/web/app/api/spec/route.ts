// POST /api/spec — buyer→worker spec side-channel.
//
// On-chain Job stores only `spec_hash` (32 bytes); the actual prompt JSON
// has to reach the worker out-of-band. We stash it in our KV (Upstash
// Redis when deployed; /tmp/apis_kv on local dev). The worker reads it
// back via GET /api/spec/{hash}.
//
// Returns 400 on malformed input, 500 on storage errors. The web client
// must call this BEFORE submitting create_job: if the worker decodes a
// JobCreated event and finds no matching spec, it logs a warning and
// skips the job.

import { NextResponse } from "next/server";
import { kvSet } from "@/app/lib/kv";

export const runtime = "nodejs"; // KV backend uses node modules.

type Body = {
  /** Hex-encoded sha256(canonical_json(spec)). Lower-case, no 0x. */
  specHash: string;
  /** The spec object (prompt + model + steps + width + height + seed). */
  spec: unknown;
};

function isHex64(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
}

export async function POST(request: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (!isHex64(body.specHash)) {
    return NextResponse.json(
      { error: "specHash must be a lower-case 64-char hex string" },
      { status: 400 },
    );
  }
  if (typeof body.spec !== "object" || body.spec === null) {
    return NextResponse.json(
      { error: "spec must be a non-null object" },
      { status: 400 },
    );
  }

  try {
    await kvSet("spec", body.specHash, body.spec);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to persist spec: ${err}` },
      { status: 500 },
    );
  }
}
