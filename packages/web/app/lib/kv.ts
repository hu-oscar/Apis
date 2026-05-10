// Side-channel storage abstraction.
//
// Public API (kvSet / kvGet / kvIsRemote) is unchanged from when it
// was backed by Upstash — every existing API route keeps working.
// Internally we now delegate to Pinata-by-name when PINATA_JWT is set,
// else fall back to /tmp/<dir>/<key>.json for local dev.
//
// Why we moved off Upstash: see app/lib/pinata-store.ts. TL;DR — fewer
// services, we already had Pinata for the worker's PNG uploads.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  pinataGetByName,
  pinataIsConfigured,
  pinataPutJson,
} from "./pinata-store";

const FS_BASE = process.env.APIS_FS_KV_DIR ?? "/tmp/apis_kv";

function fsPath(namespace: string, key: string): string {
  return join(FS_BASE, namespace, `${key}.json`);
}

function pinataName(namespace: string, key: string): string {
  return `${namespace}:${key}`;
}

/** Store a JSON-serializable value under `namespace:key`. */
export async function kvSet(
  namespace: string,
  key: string,
  value: unknown,
): Promise<void> {
  if (pinataIsConfigured()) {
    await pinataPutJson(pinataName(namespace, key), value);
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
  if (pinataIsConfigured()) {
    return await pinataGetByName<T>(pinataName(namespace, key));
  }
  try {
    const text = await readFile(fsPath(namespace, key), "utf8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Whether KV is using the deployed Pinata backend (vs local fs). */
export function kvIsRemote(): boolean {
  return pinataIsConfigured();
}
