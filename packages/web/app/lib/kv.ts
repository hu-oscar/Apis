// Side-channel storage: KV when deployed, filesystem when local.
//
// The buyer→worker spec channel and worker→buyer result channel both
// need a place to stash JSON keyed by a stable id (spec hash or job
// PDA). On Vercel-deployed prod we use Upstash Redis (Vercel's
// recommended KV partner — `@vercel/kv` itself was deprecated in 2024).
// On local `pnpm dev` we fall back to /tmp/<dir>/<key>.json so dev
// flow works without KV credentials.
//
// One-shot init: presence of UPSTASH_REDIS_REST_URL +
// UPSTASH_REDIS_REST_TOKEN switches the backing store. Vercel KV
// integration auto-populates these env vars; local dev leaves them
// unset → filesystem.
//
// Keys are namespaced (`spec:<hash>`, `result:<pda>`) so the same KV
// instance can be shared across spec + result channels without
// collision. TTL set to 24h — buyers should confirm or cancel within
// the deadline (max 10 min today), and the worker writes results
// before the chain confirms `submit_completion`. 24h is forgiving.

import { Redis } from "@upstash/redis";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TTL_SECONDS = 60 * 60 * 24; // 24h

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis: Redis | null =
  upstashUrl && upstashToken
    ? new Redis({ url: upstashUrl, token: upstashToken })
    : null;

const FS_BASE = process.env.APIS_FS_KV_DIR ?? "/tmp/apis_kv";

function fsPath(namespace: string, key: string): string {
  return join(FS_BASE, namespace, `${key}.json`);
}

/** Store a JSON-serializable value under `namespace:key`. */
export async function kvSet(
  namespace: string,
  key: string,
  value: unknown,
): Promise<void> {
  if (redis) {
    await redis.set(`${namespace}:${key}`, value, { ex: TTL_SECONDS });
    return;
  }
  const path = fsPath(namespace, key);
  await mkdir(join(FS_BASE, namespace), { recursive: true });
  await writeFile(path, JSON.stringify(value), "utf8");
}

/** Read a JSON value, or null if missing. */
export async function kvGet<T = unknown>(
  namespace: string,
  key: string,
): Promise<T | null> {
  if (redis) {
    return (await redis.get<T>(`${namespace}:${key}`)) ?? null;
  }
  try {
    const text = await readFile(fsPath(namespace, key), "utf8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Whether KV is using the deployed Redis backend (vs local fs). */
export function kvIsRemote(): boolean {
  return redis !== null;
}
