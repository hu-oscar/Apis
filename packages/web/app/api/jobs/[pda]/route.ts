// GET /api/jobs/{jobPda} — combined snapshot of on-chain Job + the
// worker's local result side-channel.
//
// The page polls this every ~3s until Job.status == Completed (5) or a
// terminal status (Refunded=6, Slashed=7). The worker writes the IPFS
// CID + proof_hash to /tmp/apis_results/{job_pda}.json once it finishes
// inference; this route reads both halves and returns a single JSON the
// client can render in one shot.

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createSolanaRpc,
  type Address,
} from "@solana/kit";
import { fetchMaybeJob, JobStatus } from "@/app/lib/apis-program";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const RESULT_DIR = process.env.APIS_RESULT_DIR ?? "/tmp/apis_results";

export const runtime = "nodejs"; // need fs.

type ResultFile = {
  cid: string;
  proof_hash_hex: string;
  completed_at: number;
};

async function readResultFile(pda: string): Promise<ResultFile | null> {
  try {
    const txt = await readFile(join(RESULT_DIR, `${pda}.json`), "utf8");
    return JSON.parse(txt) as ResultFile;
  } catch {
    return null;
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ pda: string }> },
): Promise<Response> {
  const { pda } = await context.params;

  // Validate the PDA format up-front so a malformed URL doesn't surface
  // as an opaque "couldn't fetch" later.
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pda)) {
    return NextResponse.json(
      { error: "Invalid job PDA (not base58)" },
      { status: 400 },
    );
  }

  const rpc = createSolanaRpc(RPC_URL);
  const maybeJob = await fetchMaybeJob(rpc, pda as Address);
  if (!maybeJob.exists) {
    // Likely already settled (Anchor `close = buyer` removed it). The
    // result file may still be on disk — return that with a hint.
    const result = await readResultFile(pda);
    return NextResponse.json({
      pda,
      onChain: null,
      result,
      settled: true,
    });
  }

  const j = maybeJob.data;
  const result = await readResultFile(pda);

  return NextResponse.json({
    pda,
    onChain: {
      id: j.id.toString(),
      buyer: j.buyer,
      provider: j.provider,
      priceLamportsUsdc: j.priceLamportsUsdc.toString(),
      specHashHex: Array.from(j.specHash, (n) => n.toString(16).padStart(2, "0")).join(""),
      status: j.status,
      statusName: JobStatus[j.status] ?? `Unknown(${j.status})`,
      fundedAt: Number(j.fundedAt),
      deadline: Number(j.deadline),
      completionProofHashHex:
        j.completionProofHash.__option === "Some"
          ? Array.from(j.completionProofHash.value, (n: number) =>
              n.toString(16).padStart(2, "0"),
            ).join("")
          : null,
    },
    result,
    settled: false,
  });
}
