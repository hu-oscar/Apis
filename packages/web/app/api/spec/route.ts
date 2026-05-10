// POST /api/spec — buyer→worker spec side-channel.
//
// On-chain Job stores only `spec_hash` (32 bytes); the actual prompt JSON
// has to reach the worker out-of-band. This route mirrors
// apis_worker/spec_channel.py: writes the canonical-JSON spec to
// /tmp/apis_specs/{spec_hash_hex}.json so the worker can read it back
// when its JobCreated subscription fires.
//
// Local-only at hackathon scope — fine for demo recordings (web + worker
// on the same box). For Vercel deployment in W5, swap this for a Pinata
// upload + a "{spec_hash} → cid" registry; W4 (dropped) was supposed to
// own that channel via MCP/x402.
//
// Returns 400 on malformed input, 500 on FS errors. The web client must
// call this BEFORE submitting create_job: if the worker decodes a
// JobCreated event and finds no matching spec, it logs a warning and
// skips the job.

import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SPEC_DIR = process.env.APIS_SPEC_DIR ?? "/tmp/apis_specs";

export const runtime = "nodejs"; // need fs.

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
    await mkdir(SPEC_DIR, { recursive: true });
    const path = join(SPEC_DIR, `${body.specHash}.json`);
    // Pretty-print for inspection during the demo. The worker re-hashes
    // the spec contents (not the file bytes) so formatting doesn't
    // affect the chain ↔ disk ↔ worker round-trip.
    await writeFile(path, JSON.stringify(body.spec, null, 2), "utf8");
    return NextResponse.json({ ok: true, path });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to persist spec: ${err}` },
      { status: 500 },
    );
  }
}
