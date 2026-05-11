// Parse apis_worker stdout into a structured per-job timeline.
//
// Sprint 2.4 of Phase 1.5.
//
// The worker prints semi-structured lines like:
//   JobCreated  tx=ab12cd34…  job=Dn4dd3By…  buyer=BhTNf…  provider=4hhp…  ...
//   06:55:53 [INFO] accepting job Dn4dd3By……
//   06:55:54 [INFO] ✓ accept_job confirmed: 5m73zQvw…
//   06:55:54 [INFO] │  [1/4] accept_job …
//   06:55:54 [INFO] │  [2/4] flux schnell inference …
//   06:58:23 [INFO] │       generated 383538 bytes; proof_hash=ab12cd34…
//   06:58:23 [INFO] │  [3/4] uploading to IPFS …
//   06:58:23 [INFO] │       result at https://gateway.pinata.cloud/ipfs/<cid>
//   06:58:24 [INFO] │  [4/4] submit_completion …
//   06:58:25 [INFO] ✓ submit_completion confirmed: tx=https://explorer.solana.com/tx/...
//   06:58:25 [INFO] └── job Dn4dd3By… done.
//
// We track one JobState per shortened PDA. Sprint 1.4's _job_lock
// guarantees only one job is mid-pipeline at a time, so lines arrive
// in a deterministic order per job (though the JobCreated event for
// job B can arrive while job A is still running — that's fine, we
// just create job B's record in "waiting" phase).

import type { LogEntry } from "./log-types";

export type JobPhase =
  | "waiting" // JobCreated emitted, worker hasn't accepted yet
  | "accepting" // accept_job tx in flight
  | "running" // mflux generating
  | "uploading" // pinning result to Pinata IPFS
  | "completing" // submit_completion tx in flight
  | "completed"
  | "failed";

export type JobState = {
  shortPda: string;
  phase: JobPhase;
  startedAt: number; // unix ms of first sighting
  lastUpdate: number; // unix ms of last log line
  buyer?: string;
  priceLamports?: bigint;
  resultUrl?: string;
  submitTxUrl?: string;
  proofHashHex?: string;
  failureReason?: string;
};

type ParseEffect =
  | { kind: "init"; shortPda: string; phase: JobPhase; fields?: Partial<JobState> }
  | { kind: "update"; shortPda: string; patch: Partial<JobState> };

// Regex patterns — kept verbose for clarity over cleverness.

// `JobCreated  tx=<sig>…  job=<pda>…  buyer=<buyer>…  provider=<prov>…  …  price_lamports_usdc=<n>  …`
const RX_JOB_CREATED =
  /JobCreated.*?job=([^…\s]+)…?.*?buyer=([^…\s]+)…?.*?price_lamports_usdc=(\d+)/;
// `accepting job <pda>……`
const RX_ACCEPTING = /accepting job ([^…\s]+)…/;
// `✓ accept_job confirmed: <sig>…` — no PDA on this line; we attach
// to whatever job is currently in "accepting" phase.
const RX_ACCEPT_CONFIRMED = /✓\s*accept_job confirmed/;
// `│  [2/4] flux schnell inference …`
const RX_INFERENCE_START = /\[2\/4\] flux schnell inference/;
// `│  [3/4] uploading to IPFS …`
const RX_UPLOADING = /\[3\/4\] uploading to IPFS/;
// `│       result at https://...`
const RX_RESULT_URL = /result at (\S+)/;
// `│  [4/4] submit_completion …`
const RX_SUBMITTING = /\[4\/4\] submit_completion/;
// `✓ submit_completion confirmed: tx=https://...`
const RX_SUBMIT_CONFIRMED = /✓\s*submit_completion confirmed: tx=(\S+)/;
// `└── job <pda>… done.`
const RX_JOB_DONE = /└── job ([^…\s]+)…?\s+done/;
// `│  job <pda> pipeline failed: <exc>`
const RX_JOB_FAILED = /job ([^\s]+) pipeline failed:\s*(.*)/;
// `submitting completion: job=<short>… proof_hash=0x<hex>…`
const RX_SUBMITTING_DETAIL =
  /submitting completion: job=([^…\s]+)…?.*?proof_hash=0x([0-9a-f]+)/;

function classify(line: string): ParseEffect | null {
  let m: RegExpExecArray | null;

  if ((m = RX_JOB_CREATED.exec(line))) {
    const [, shortPda, buyer, price] = m;
    return {
      kind: "init",
      shortPda,
      phase: "waiting",
      fields: {
        buyer: buyer,
        priceLamports: BigInt(price),
      },
    };
  }
  if ((m = RX_ACCEPTING.exec(line))) {
    return { kind: "update", shortPda: m[1], patch: { phase: "accepting" } };
  }
  if (RX_ACCEPT_CONFIRMED.test(line)) {
    // No PDA on this line — return a synthetic effect the reducer
    // applies to the most-recent "accepting" job.
    return { kind: "update", shortPda: "__last_accepting__", patch: { phase: "running" } };
  }
  if (RX_INFERENCE_START.test(line)) {
    return { kind: "update", shortPda: "__last_running__", patch: { phase: "running" } };
  }
  if (RX_UPLOADING.test(line)) {
    return { kind: "update", shortPda: "__last_running__", patch: { phase: "uploading" } };
  }
  if ((m = RX_RESULT_URL.exec(line))) {
    return {
      kind: "update",
      shortPda: "__last_uploading__",
      patch: { resultUrl: m[1] },
    };
  }
  if (RX_SUBMITTING.test(line)) {
    return { kind: "update", shortPda: "__last_uploading__", patch: { phase: "completing" } };
  }
  if ((m = RX_SUBMITTING_DETAIL.exec(line))) {
    return {
      kind: "update",
      shortPda: m[1],
      patch: { proofHashHex: m[2], phase: "completing" },
    };
  }
  if ((m = RX_SUBMIT_CONFIRMED.exec(line))) {
    return {
      kind: "update",
      shortPda: "__last_completing__",
      patch: { submitTxUrl: m[1], phase: "completed" },
    };
  }
  if ((m = RX_JOB_DONE.exec(line))) {
    return { kind: "update", shortPda: m[1], patch: { phase: "completed" } };
  }
  if ((m = RX_JOB_FAILED.exec(line))) {
    return {
      kind: "update",
      shortPda: m[1],
      patch: { phase: "failed", failureReason: m[2] },
    };
  }
  return null;
}

/** Reduce a stream of log entries into a per-job timeline.
 *
 *  Returns jobs in arrival order (newest last). Callers typically
 *  render newest-first. */
export function buildTimeline(entries: LogEntry[]): JobState[] {
  const jobs = new Map<string, JobState>();
  // Track the "last seen" job in each phase so we can resolve the
  // synthetic shortPda markers (e.g. "__last_accepting__") that the
  // classifier uses for lines without an explicit PDA.
  const phaseToLast = new Map<JobPhase, string>();

  for (const entry of entries) {
    const eff = classify(entry.line);
    if (!eff) continue;

    if (eff.kind === "init") {
      if (!jobs.has(eff.shortPda)) {
        jobs.set(eff.shortPda, {
          shortPda: eff.shortPda,
          phase: eff.phase,
          startedAt: entry.at,
          lastUpdate: entry.at,
          ...eff.fields,
        });
      }
      phaseToLast.set(eff.phase, eff.shortPda);
      continue;
    }

    // Resolve synthetic markers.
    let resolved = eff.shortPda;
    if (resolved.startsWith("__last_")) {
      const phaseKey = resolved.slice(7, -2) as JobPhase;
      const last = phaseToLast.get(phaseKey);
      if (!last) continue;
      resolved = last;
    }
    const current = jobs.get(resolved);
    if (!current) continue;
    const next: JobState = {
      ...current,
      ...eff.patch,
      lastUpdate: entry.at,
    };
    jobs.set(resolved, next);
    if (next.phase) {
      phaseToLast.set(next.phase, resolved);
    }
  }

  return Array.from(jobs.values());
}

// Display helpers --------------------------------------------------

export function phaseLabel(p: JobPhase): string {
  switch (p) {
    case "waiting":
      return "queued";
    case "accepting":
      return "accepting";
    case "running":
      return "running flux";
    case "uploading":
      return "uploading IPFS";
    case "completing":
      return "submitting proof";
    case "completed":
      return "completed ✓";
    case "failed":
      return "failed";
  }
}

export function phaseAccent(p: JobPhase): "violet" | "green" | "amber" | "red" | "dim" {
  switch (p) {
    case "waiting":
      return "dim";
    case "accepting":
    case "running":
    case "uploading":
    case "completing":
      return "violet";
    case "completed":
      return "green";
    case "failed":
      return "red";
  }
}

export function phaseProgress(p: JobPhase): number {
  // Linear progress 0..1 used to draw a bar in the timeline card.
  switch (p) {
    case "waiting":
      return 0.05;
    case "accepting":
      return 0.2;
    case "running":
      return 0.55;
    case "uploading":
      return 0.75;
    case "completing":
      return 0.9;
    case "completed":
      return 1;
    case "failed":
      return 1;
  }
}
