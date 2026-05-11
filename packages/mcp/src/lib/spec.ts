// Canonical-JSON spec hashing + POSTing — Sprint 4.0c.
//
// Mirrors the web `/submit` flow: build a stable JSON of the job
// parameters, sha256 it for the on-chain `spec_hash`, and POST the
// raw spec to `/api/spec` so the worker can `GET /api/spec/{hash}`
// to retrieve it.

import { createHash, randomBytes } from "node:crypto";
import { APIS_API_BASE } from "./rpc.js";

export type JobSpec = {
  prompt: string;
  model: "flux-schnell";
  steps: number;
  width: number;
  height: number;
  seed: number;
};

export function buildSpec(prompt: string, overrides?: Partial<JobSpec>): JobSpec {
  return {
    prompt,
    model: "flux-schnell",
    steps: 4,
    width: 1024,
    height: 1024,
    seed: Math.floor(Math.random() * 2 ** 31),
    ...overrides,
  };
}

/** Canonical JSON encoder — keys sorted, no whitespace, ensure_ascii
 *  off. Must produce byte-identical output to the web's
 *  `canonicalJson` in app/submit/page.tsx so the same spec hashes to
 *  the same digest from buyer + agent + worker. */
export function canonicalJson(spec: JobSpec): string {
  const keys = Object.keys(spec).sort();
  const parts = keys.map((k) => {
    const v = (spec as unknown as Record<string, unknown>)[k];
    return JSON.stringify(k) + ":" + JSON.stringify(v);
  });
  return "{" + parts.join(",") + "}";
}

/** sha256(canonical_json(spec)) as a 32-byte Uint8Array — exactly
 *  what `create_job` puts on chain as `spec_hash`. */
export function specHashBytes(spec: JobSpec): Uint8Array {
  const canonical = canonicalJson(spec);
  return new Uint8Array(createHash("sha256").update(canonical).digest());
}

export function specHashHex(spec: JobSpec): string {
  return Array.from(specHashBytes(spec), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** POST the spec to the side-channel API so the worker can fetch it
 *  by hash once it sees JobCreated. The web's `/api/spec` route
 *  validates the hash format and writes to KV. Returns the hash hex. */
export async function postSpec(spec: JobSpec): Promise<string> {
  const hashHex = specHashHex(spec);
  const r = await fetch(`${APIS_API_BASE}/api/spec`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ specHash: hashHex, spec }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`POST /api/spec returned ${r.status}: ${body.slice(0, 200)}`);
  }
  return hashHex;
}

/** Random u64 nonce — matches the web's `randomJobId()`. Used as the
 *  Job PDA's `id` seed so the same buyer can create many jobs without
 *  PDA collision. */
export function randomJobId(): bigint {
  const bytes = randomBytes(8);
  return new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true);
}
