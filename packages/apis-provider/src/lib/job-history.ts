// Persistent job-completion history — Sprint 2.8 of Phase 1.5.
//
// The on-chain `Job.price_lamports_usdc` is 0 until the escrow lands
// in Sprint 4, so we can't reconstruct earnings purely from RPC. The
// `JobCreated` stdout event from `apis_worker`, however, already
// carries the buyer-specified price. We persist a small append-only
// log of completed jobs (last 100) to the Tauri Store and use it as
// the source of truth for both the earnings dashboard and the
// "recent jobs" panel.
//
// Trade-offs:
//   - Persistence is per-installation. If the user reinstalls or wipes
//     app data, history is lost. That's acceptable for a hackathon-tier
//     MVP — once escrow lands, on-chain becomes the canonical source.
//   - We cap at 100 to keep store reads fast; older entries roll off.
//   - Prices are serialized as decimal strings since JSON has no bigint.

import { LazyStore } from "@tauri-apps/plugin-store";

const STORE_FILE = "settings.json";
const HISTORY_KEY = "jobHistory";
const MAX_ENTRIES = 100;

/** One persisted completion. `priceUsdcBase` is a decimal string of
 *  USDC base units (6 decimals); the caller converts to bigint on use. */
export type HistoryEntry = {
  shortPda: string;
  completedAt: number; // unix ms
  priceUsdcBase: string; // u64 in decimal
  buyer: string;
  resultUrl?: string;
  submitTxUrl?: string;
  proofHashHex?: string;
};

// Reuse the same store file as settings.ts — Tauri's LazyStore handles
// the multi-key sharing under the hood. Keeping one file makes app-data
// backup / wipe trivially atomic.
const store = new LazyStore(STORE_FILE);

export async function loadHistory(): Promise<HistoryEntry[]> {
  const raw = await store.get<HistoryEntry[]>(HISTORY_KEY);
  if (!Array.isArray(raw)) return [];
  // Defensive copy + shape check — guard against forward-compat
  // garbage written by a future version.
  return raw.filter(
    (e): e is HistoryEntry =>
      e !== null &&
      typeof e === "object" &&
      typeof (e as HistoryEntry).shortPda === "string" &&
      typeof (e as HistoryEntry).completedAt === "number" &&
      typeof (e as HistoryEntry).priceUsdcBase === "string" &&
      typeof (e as HistoryEntry).buyer === "string",
  );
}

/** Overwrite the persisted history with the given list (caller is
 *  responsible for ordering newest-first + capping). */
export async function saveHistory(entries: HistoryEntry[]): Promise<void> {
  const capped = entries.slice(0, MAX_ENTRIES);
  await store.set(HISTORY_KEY, capped);
  await store.save();
}

/** Compute aggregate earnings from a history list and the live
 *  in-flight timeline. Lifetime + last-24h come from completed jobs;
 *  pending is the sum of buyer-specified prices for jobs whose
 *  on-chain submit_completion hasn't landed yet.
 *
 *  Pure — takes `nowMs` rather than calling Date.now() so it can be
 *  used inside useMemo without violating React 19's purity rule. */
export function aggregateEarnings(
  history: HistoryEntry[],
  inFlightPrices: bigint[],
  nowMs: number,
): { lifetime: bigint; last24h: bigint; pending: bigint } {
  let lifetime = 0n;
  let last24h = 0n;
  const cutoff = nowMs - 24 * 60 * 60 * 1000;
  for (const e of history) {
    let p: bigint;
    try {
      p = BigInt(e.priceUsdcBase);
    } catch {
      continue;
    }
    lifetime += p;
    if (e.completedAt > cutoff) last24h += p;
  }
  let pending = 0n;
  for (const p of inFlightPrices) pending += p;
  return { lifetime, last24h, pending };
}
