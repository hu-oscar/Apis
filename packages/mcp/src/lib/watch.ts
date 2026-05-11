// Job-status polling — Sprint 4.0d.
//
// Polls /api/jobs/{pda} on the same cadence the web app's /job/[id]
// page uses (1.5s), reporting transitions through Funded → Started →
// Completed. Returns the terminal `JobSnapshot` so the caller can
// decide whether to call confirm_completion.

import { APIS_API_BASE } from "./rpc.js";

export type JobStatus =
  | "Created"
  | "Funded"
  | "Started"
  | "Completed"
  | "Disputed"
  | "Refunded"
  | "Slashed";

export type JobSnapshot = {
  status: JobStatus | "Settled";
  deadlineUnixSec: number | null;
  providerAuthority: string | null;
  resultCid: string | null;
  resultProofHashHex: string | null;
  resultCompletedAt: number | null;
  /** True once the on-chain Job account is gone (confirm/cancel closed
   *  it). Mutually exclusive with the others. */
  settled: boolean;
};

type ApiJobResponse = {
  pda: string;
  onChain: {
    statusName: JobStatus;
    deadline: number;
    providerAuthority: string | null;
  } | null;
  result: {
    cid: string;
    proof_hash_hex: string;
    completed_at: number;
  } | null;
  settled: boolean;
};

const POLL_MS = 1500;

/** Poll until the job reaches a terminal state — Completed, Refunded,
 *  Slashed, or settled (account closed). Calls `onTransition` each
 *  time the status changes so callers can pretty-print progress. */
export async function watchJob(
  jobPda: string,
  opts: {
    timeoutMs?: number;
    onTransition?: (s: JobSnapshot, prev: JobSnapshot | null) => void;
  } = {},
): Promise<JobSnapshot> {
  const { timeoutMs = 600_000, onTransition } = opts;
  const start = Date.now();
  let prev: JobSnapshot | null = null;

  while (Date.now() - start < timeoutMs) {
    let snap: JobSnapshot;
    try {
      snap = await fetchJobSnapshot(jobPda);
    } catch {
      // Transient fetch failure — wait + retry.
      await sleep(POLL_MS);
      continue;
    }

    const transitioned =
      prev === null ||
      snap.status !== prev.status ||
      snap.settled !== prev.settled ||
      (!prev.resultCid && snap.resultCid);
    if (transitioned && onTransition) {
      onTransition(snap, prev);
    }
    prev = snap;

    if (isTerminal(snap)) return snap;
    await sleep(POLL_MS);
  }
  throw new Error(`watchJob: timed out after ${timeoutMs}ms`);
}

function isTerminal(s: JobSnapshot): boolean {
  if (s.settled) return true;
  if (
    s.status === "Refunded" ||
    s.status === "Slashed" ||
    s.status === "Disputed"
  ) {
    return true;
  }
  // Completed is terminal as far as the agent's *fetch* loop goes —
  // but the agent still needs to call confirm_completion. The caller
  // decides what to do.
  if (s.status === "Completed") return true;
  return false;
}

async function fetchJobSnapshot(jobPda: string): Promise<JobSnapshot> {
  const r = await fetch(`${APIS_API_BASE}/api/jobs/${jobPda}`);
  if (!r.ok) {
    throw new Error(`GET /api/jobs/${jobPda} returned ${r.status}`);
  }
  const body = (await r.json()) as ApiJobResponse;
  if (body.settled) {
    return {
      status: "Settled",
      deadlineUnixSec: null,
      providerAuthority: null,
      resultCid: body.result?.cid ?? null,
      resultProofHashHex: body.result?.proof_hash_hex ?? null,
      resultCompletedAt: body.result?.completed_at ?? null,
      settled: true,
    };
  }
  if (!body.onChain) {
    throw new Error("job has no on-chain state and isn't settled — broken API response");
  }
  return {
    status: body.onChain.statusName,
    deadlineUnixSec: body.onChain.deadline,
    providerAuthority: body.onChain.providerAuthority,
    resultCid: body.result?.cid ?? null,
    resultProofHashHex: body.result?.proof_hash_hex ?? null,
    resultCompletedAt: body.result?.completed_at ?? null,
    settled: false,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
