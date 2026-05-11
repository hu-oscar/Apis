// Provider liveness heartbeat — Sprint 1.5 / 1.6.
//
//   POST /api/heartbeat/{pda}  — worker writes {at, version, capacity}
//                                 every ~30s. Updates the KV record.
//   GET  /api/heartbeat/{pda}  — UI reads the latest heartbeat to compute
//                                 "is this provider online right now?"
//                                 (fresh = within last 90s).
//
// Stored in the same Pinata-backed KV used by /api/spec and
// /api/results, under namespace "heartbeat". TTL-style staleness is
// computed at read time — we don't actively delete stale records.

import { NextResponse } from "next/server";
import { kvGet, kvSet } from "@/app/lib/kv";

export const runtime = "nodejs";

type HeartbeatBody = {
  at: number;
  version: string;
  capacity?: number;
};

function isJobPda(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ pda: string }> },
): Promise<Response> {
  const { pda } = await context.params;
  if (!isJobPda(pda)) {
    return NextResponse.json({ error: "invalid provider PDA" }, { status: 400 });
  }

  let body: HeartbeatBody;
  try {
    body = (await request.json()) as HeartbeatBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (typeof body.at !== "number" || typeof body.version !== "string") {
    return NextResponse.json(
      { error: "body must include `at` (number) and `version` (string)" },
      { status: 400 },
    );
  }

  try {
    await kvSet("heartbeat", pda, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to persist heartbeat: ${err}` },
      { status: 500 },
    );
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ pda: string }> },
): Promise<Response> {
  const { pda } = await context.params;
  if (!isJobPda(pda)) {
    return NextResponse.json({ error: "invalid provider PDA" }, { status: 400 });
  }
  const hb = await kvGet<HeartbeatBody>("heartbeat", pda);
  if (hb == null) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const ageMs = Date.now() - hb.at;
  // "Online" if heartbeat is within ~3× the emit interval (30s × 3 = 90s)
  // — gives one missed heartbeat of slack before flagging the provider as
  // offline.
  const online = ageMs < 90_000;
  return NextResponse.json({ heartbeat: hb, online, ageMs });
}
