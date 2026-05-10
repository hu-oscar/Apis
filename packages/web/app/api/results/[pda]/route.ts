// Worker→buyer result side-channel (KV-backed).
//
//   POST  /api/results/{job_pda}  — worker writes (cid, proof_hash) after
//                                   uploading the PNG to Pinata.
//   GET   /api/results/{job_pda}  — buyer's /job/[id] reads to resolve the
//                                   IPFS CID (we don't store CIDs on-chain).
//
// Both are JSON. Same KV namespace ("result") as kvGet/kvSet — local
// dev still works with the /tmp filesystem fallback when KV creds are
// unset.

import { NextResponse } from "next/server";
import { kvGet, kvSet } from "@/app/lib/kv";

export const runtime = "nodejs";

type ResultBody = {
  cid: string;
  proof_hash_hex: string;
  completed_at: number;
};

function isJobPda(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

function isHex64(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ pda: string }> },
): Promise<Response> {
  const { pda } = await context.params;
  if (!isJobPda(pda)) {
    return NextResponse.json({ error: "invalid job PDA" }, { status: 400 });
  }

  let body: ResultBody;
  try {
    body = (await request.json()) as ResultBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (typeof body.cid !== "string" || body.cid.length < 10) {
    return NextResponse.json({ error: "missing or invalid cid" }, { status: 400 });
  }
  if (!isHex64(body.proof_hash_hex)) {
    return NextResponse.json(
      { error: "proof_hash_hex must be a lower-case 64-char hex string" },
      { status: 400 },
    );
  }
  if (typeof body.completed_at !== "number") {
    return NextResponse.json(
      { error: "completed_at must be a number (unix seconds)" },
      { status: 400 },
    );
  }

  try {
    await kvSet("result", pda, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to persist result: ${err}` },
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
    return NextResponse.json({ error: "invalid job PDA" }, { status: 400 });
  }
  const result = await kvGet<ResultBody>("result", pda);
  if (result == null) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ result });
}
