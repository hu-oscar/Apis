// Per-wallet job history persisted in localStorage.
//
// Fixes the W2-Step-3 Phase G UX gap: if a buyer navigates away from
// /job/[id] mid-flight, there's no way to find their job again from
// /submit. We stash the {pda, prompt, price, createdAt} for each job
// the buyer creates, keyed by wallet address.
//
// Hard cap of MAX_HISTORY rows per wallet (oldest entries are evicted).
// Pre-Vercel polish — once the side-channels migrate to KV (W5-D), this
// stays as the single client-side cache (server has no per-buyer state).

import type { Address } from "@solana/kit";

const MAX_HISTORY = 25;

export type JobHistoryEntry = {
  /** Job PDA (base58). */
  pda: string;
  /** sha256(canonical_json(spec)) — hex. */
  specHashHex: string;
  /** Truncated prompt for display (≤ 80 chars). */
  promptPreview: string;
  /** Price in USDC base units, as string (bigints don't survive JSON.stringify). */
  priceLamportsUsdc: string;
  /** Unix ms when the create_job tx was submitted. */
  createdAt: number;
};

function storageKey(buyer: Address): string {
  return `apis:jobs:${buyer}`;
}

/** Read this wallet's recorded jobs (most recent first). */
export function loadHistory(buyer: Address): JobHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(buyer));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Defensive: filter to entries with the expected shape so a corrupted
    // localStorage write doesn't crash the page on render.
    return parsed.filter(
      (e): e is JobHistoryEntry =>
        typeof e === "object" &&
        e !== null &&
        "pda" in e &&
        typeof (e as { pda: unknown }).pda === "string",
    );
  } catch {
    return [];
  }
}

/** Append a new job to the front of this wallet's history. */
export function recordJob(buyer: Address, entry: JobHistoryEntry): void {
  if (typeof window === "undefined") return;
  const existing = loadHistory(buyer);
  // De-dupe by PDA in case the user re-submits the same job (shouldn't
  // happen with a random nonce, but cheap to guard).
  const filtered = existing.filter((e) => e.pda !== entry.pda);
  const next = [entry, ...filtered].slice(0, MAX_HISTORY);
  try {
    window.localStorage.setItem(storageKey(buyer), JSON.stringify(next));
  } catch {
    // Quota exceeded or storage disabled; ignore — best-effort cache.
  }
}
