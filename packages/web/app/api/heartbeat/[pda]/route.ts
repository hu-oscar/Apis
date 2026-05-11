// Signed provider liveness heartbeat — Sprint 3.1.
//
//   POST /api/heartbeat/{pda}  — worker signs + posts every ~30s.
//     Body: { payload: {...}, signature: <base58>, publicKey: <base58> }
//     We verify:
//       1. Ed25519 signature is valid for canonicalJson(payload).
//       2. publicKey equals the on-chain Provider.authority for `pda`.
//       3. payload.at is within ±300s of server clock (replay window).
//     On success: store `payload` under KV namespace "heartbeat".
//
//   GET /api/heartbeat/{pda}   — UI reads the latest payload + a
//     computed `online` flag (record < 90s old = online). The 90s
//     threshold is 3× the worker's 30s emit interval, giving one
//     missed heartbeat of slack.
//
// Stored value mirrors the signed `payload` shape exactly so consumers
// (heartbeat-client.ts) can rely on a stable schema.

import { NextResponse } from "next/server";
import { createSolanaRpc, type Address } from "@solana/kit";
import nacl from "tweetnacl";
import bs58 from "bs58";

import { fetchMaybeProvider } from "@/app/lib/apis-program";
import { kvGet, kvSet } from "@/app/lib/kv";

export const runtime = "nodejs";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

// Replay window — reject heartbeats whose `at` is further than this
// from the server's wall clock. 5min covers reasonable clock skew +
// network latency without giving an attacker a useful replay budget.
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

/** The signed payload schema. Matches `_build_payload` in
 *  packages/worker/apis_worker/heartbeat.py exactly.
 *
 *  Note: `secondsPerImage` is a decimal-string (e.g. "12.500"), not a
 *  number — Python's `json.dumps` and JS's `JSON.stringify` disagree
 *  on integer-valued floats ("12.0" vs "12"), which would break
 *  signature verification. Strings serialize identically across both. */
export type HeartbeatPayload = {
  at: number;
  version: string;
  capacity: number;
  chip: string;
  ramGb: number;
  cpuCores: number;
  secondsPerImage: string | null;
  suggestedPriceUsdcBase: string | null;
};

type SignedBody = {
  payload: HeartbeatPayload;
  signature: string;
  publicKey: string;
};

function isJobPda(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

/** Canonical JSON encoder matching Python's
 *  `json.dumps(payload, sort_keys=True, separators=(",", ":"),
 *  ensure_ascii=False)`. Keys are sorted ASCII-lexicographic; null
 *  → "null"; numbers serialized as-is; strings JSON-escaped. The
 *  worker side produces UTF-8 bytes; we match by passing through
 *  TextEncoder.
 *
 *  Only handles the flat payload shape we actually sign — nested
 *  objects/arrays would need recursion, intentionally not included
 *  to keep the surface tight. */
function canonicalJson(payload: HeartbeatPayload): Uint8Array {
  const keys = Object.keys(payload).sort();
  const parts = keys.map((k) => {
    const v = payload[k as keyof HeartbeatPayload];
    return JSON.stringify(k) + ":" + JSON.stringify(v);
  });
  const str = "{" + parts.join(",") + "}";
  return new TextEncoder().encode(str);
}

function isHeartbeatPayload(v: unknown): v is HeartbeatPayload {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.at === "number" &&
    typeof o.version === "string" &&
    typeof o.capacity === "number" &&
    typeof o.chip === "string" &&
    typeof o.ramGb === "number" &&
    typeof o.cpuCores === "number" &&
    (o.secondsPerImage === null || typeof o.secondsPerImage === "string") &&
    (o.suggestedPriceUsdcBase === null ||
      typeof o.suggestedPriceUsdcBase === "string")
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ pda: string }> },
): Promise<Response> {
  const { pda } = await context.params;
  if (!isJobPda(pda)) {
    return NextResponse.json(
      { error: "invalid provider PDA" },
      { status: 400 },
    );
  }

  let body: SignedBody;
  try {
    body = (await request.json()) as SignedBody;
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  if (!isHeartbeatPayload(body?.payload)) {
    return NextResponse.json(
      { error: "payload missing required fields" },
      { status: 400 },
    );
  }
  if (
    typeof body.signature !== "string" ||
    typeof body.publicKey !== "string"
  ) {
    return NextResponse.json(
      { error: "signature and publicKey must be base58 strings" },
      { status: 400 },
    );
  }

  // 1. Replay window: refuse anything outside ±5min of server clock.
  //    Cheap pre-flight before the more expensive RPC + crypto.
  const skew = Math.abs(Date.now() - body.payload.at);
  if (skew > REPLAY_WINDOW_MS) {
    return NextResponse.json(
      { error: `payload.at outside replay window (skew ${skew}ms)` },
      { status: 400 },
    );
  }

  // 2. Decode signature + public key. Both must be valid base58 and
  //    the exact expected byte lengths (64 / 32). Any decode error is
  //    a bad request, not a server error.
  let signatureBytes: Uint8Array;
  let publicKeyBytes: Uint8Array;
  try {
    signatureBytes = bs58.decode(body.signature);
    publicKeyBytes = bs58.decode(body.publicKey);
  } catch (err) {
    return NextResponse.json(
      { error: `couldn't decode base58: ${err}` },
      { status: 400 },
    );
  }
  if (signatureBytes.length !== 64) {
    return NextResponse.json(
      { error: `signature must be 64 bytes, got ${signatureBytes.length}` },
      { status: 400 },
    );
  }
  if (publicKeyBytes.length !== 32) {
    return NextResponse.json(
      { error: `publicKey must be 32 bytes, got ${publicKeyBytes.length}` },
      { status: 400 },
    );
  }

  // 3. Cryptographic verify against the canonical payload bytes.
  const message = canonicalJson(body.payload);
  const sigOk = nacl.sign.detached.verify(
    message,
    signatureBytes,
    publicKeyBytes,
  );
  if (!sigOk) {
    return NextResponse.json(
      { error: "signature did not verify against payload + publicKey" },
      { status: 401 },
    );
  }

  // 4. Confirm publicKey actually owns this Provider on-chain. Without
  //    this step, anyone with any valid keypair could heartbeat for
  //    any PDA. The on-chain Provider.authority is the only ground
  //    truth — by binding the signer to that field, we guarantee
  //    heartbeats come from the wallet that registered the provider.
  const rpc = createSolanaRpc(RPC_URL);
  const maybeProvider = await fetchMaybeProvider(rpc, pda as Address);
  if (!maybeProvider.exists) {
    return NextResponse.json(
      { error: `no Provider account at ${pda}` },
      { status: 404 },
    );
  }
  if (maybeProvider.data.authority !== body.publicKey) {
    return NextResponse.json(
      {
        error: "publicKey does not match on-chain Provider.authority",
        expected: maybeProvider.data.authority,
        received: body.publicKey,
      },
      { status: 401 },
    );
  }

  // All four checks passed — persist the payload. We store the bare
  // payload (no sig / pubkey) since downstream readers only need the
  // verified facts; the verification status is implicit.
  try {
    await kvSet("heartbeat", pda, body.payload);
    return NextResponse.json({ ok: true, verified: true });
  } catch (err) {
    return NextResponse.json(
      { error: `failed to persist heartbeat: ${err}` },
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
    return NextResponse.json(
      { error: "invalid provider PDA" },
      { status: 400 },
    );
  }
  const hb = await kvGet<HeartbeatPayload>("heartbeat", pda);
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
