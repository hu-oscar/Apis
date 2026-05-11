// Client-side helper for reading a provider's liveness heartbeat
// (Sprint 1.6, extended in Sprint 3.1). Used by /, /network,
// /provider/[pda], etc. to render the real "online" indicator backed
// by the worker's signed 30-second heartbeat. The enriched payload
// also carries hardware/benchmark metadata the desktop app now
// publishes — see HeartbeatRecord for the full shape.

import type { Address } from "@solana/kit";

/** Mirrors the Python worker's `_build_payload()` exactly. Bumped
 *  past the original {at, version, capacity?} in Sprint 3.1 to
 *  include the desktop-detected hardware + benchmark fields. All
 *  optional values use `null` rather than `undefined` so the
 *  canonical-JSON encoding (used for signature verification) is
 *  stable. */
export type HeartbeatRecord = {
  at: number;
  version: string;
  capacity: number;
  /** Apple Silicon chip string, e.g. "Apple M3 Pro". Empty when the
   *  worker was launched standalone (no desktop app to detect it). */
  chip: string;
  /** Installed RAM in GB. 0 when undetected. */
  ramGb: number;
  /** Logical CPU cores. 0 when undetected. */
  cpuCores: number;
  /** Most-recent Flux Schnell benchmark (seconds per image), as a
   *  3-decimal string e.g. "12.500". String rather than number so the
   *  canonical-JSON used for signature verification is identical
   *  across Python and JS encoders. Null until the provider has run
   *  the in-app benchmark at least once. Consumers do
   *  `parseFloat(secondsPerImage)` for arithmetic / display. */
  secondsPerImage: string | null;
  /** Suggested per-job price in USDC base units (6 decimals) at the
   *  "fair" $1/hr tier, derived from `secondsPerImage`. Sent as a
   *  decimal string because JSON numbers lose precision past 2^53. */
  suggestedPriceUsdcBase: string | null;
};

export type HeartbeatStatus =
  | { kind: "online"; record: HeartbeatRecord; ageMs: number }
  | { kind: "offline"; lastSeen: HeartbeatRecord | null; ageMs: number | null }
  | { kind: "loading" }
  | { kind: "error"; message: string };

/** Fetch the most-recent heartbeat for `pda`. Treats 404 as "never
 *  heartbeated" — different from "stale heartbeat" (which is offline
 *  with a `lastSeen` record). */
export async function fetchHeartbeat(pda: Address): Promise<HeartbeatStatus> {
  try {
    const r = await fetch(`/api/heartbeat/${pda}`, { cache: "no-store" });
    if (r.status === 404) {
      return { kind: "offline", lastSeen: null, ageMs: null };
    }
    if (!r.ok) {
      return { kind: "error", message: `HTTP ${r.status}` };
    }
    const body = (await r.json()) as {
      heartbeat: HeartbeatRecord;
      online: boolean;
      ageMs: number;
    };
    return body.online
      ? { kind: "online", record: body.heartbeat, ageMs: body.ageMs }
      : { kind: "offline", lastSeen: body.heartbeat, ageMs: body.ageMs };
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
