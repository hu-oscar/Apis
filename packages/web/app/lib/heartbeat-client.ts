// Client-side helper for reading a provider's liveness heartbeat
// (Sprint 1.6). Used by /, /network, and /provider/[pda] to render a
// real "online" indicator backed by the worker's 30-second heartbeat
// instead of just "is the Provider PDA registered" (which stays true
// forever once a provider has registered).

import type { Address } from "@solana/kit";

export type HeartbeatRecord = {
  at: number;
  version: string;
  capacity?: number;
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
