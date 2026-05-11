// Network browse — Sprint 4.0b.
//
// Fetches the live provider list from devnet + their signed heartbeats
// (chip / RAM / Flux speed / suggested price). Mirrors what the web's
// /network page does at packages/web/app/network/page.tsx, but as a
// pure data function so the agent's CLI can present it + Claude can
// reason over it.

import {
  getBase58Decoder,
  type Address,
  type ReadonlyUint8Array,
} from "@solana/kit";

import { PROVIDER_DISCRIMINATOR, getProviderDecoder } from "../generated/apis-program/src/generated/accounts/provider.js";
import { ProviderStatus } from "../generated/apis-program/src/generated/types/providerStatus.js";
import { APIS_API_BASE, APIS_PROGRAM_ADDRESS, rpc } from "./rpc.js";

export type ProviderRow = {
  pda: Address;
  authority: Address;
  activeJobs: number;
  totalJobs: number;
  status: ProviderStatus;
  /** Heartbeat-derived fields. All null when the provider has never
   *  heartbeated or its last heartbeat is older than 90 s. */
  online: boolean;
  ageMs: number | null;
  chip: string | null;
  ramGb: number | null;
  cpuCores: number | null;
  secondsPerImage: number | null;
  suggestedPriceUsdcBase: bigint | null;
};

type WireHeartbeatPayload = {
  at: number;
  version: string;
  capacity: number;
  chip: string;
  ramGb: number;
  cpuCores: number;
  secondsPerImage: string | null;
  suggestedPriceUsdcBase: string | null;
};

type HeartbeatGetResponse = {
  heartbeat?: WireHeartbeatPayload;
  online?: boolean;
  ageMs?: number;
  error?: string;
};

/** Fetch every registered Provider PDA, then fetch each one's most-
 *  recent signed heartbeat in parallel. Returns rows sorted by
 *  speed (faster first) with offline providers last. */
export async function fetchProviders(): Promise<ProviderRow[]> {
  const client = rpc();
  const base58 = getBase58Decoder();
  const providerDiscB58 = base58.decode(PROVIDER_DISCRIMINATOR);

  // getProgramAccounts filter on the Provider discriminator. Identical
  // shape to what the web /network page sends.
  const rawClient = client as unknown as {
    getProgramAccounts: (
      address: Address,
      config: {
        encoding: "base64";
        filters: Array<{
          memcmp: { offset: bigint; bytes: string; encoding: "base58" };
        }>;
      },
    ) => {
      send: () => Promise<
        Array<{ pubkey: Address; account: { data: [string, "base64"] } }>
      >;
    };
  };

  const accounts = await rawClient
    .getProgramAccounts(APIS_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { memcmp: { offset: 0n, bytes: providerDiscB58, encoding: "base58" } },
      ],
    })
    .send();

  const decoder = getProviderDecoder();
  const rows: ProviderRow[] = accounts.map((a) => {
    const bytes = base64ToBytes(a.account.data[0]);
    const d = decoder.decode(bytes);
    return {
      pda: a.pubkey,
      authority: d.authority,
      activeJobs: Number(d.activeJobs),
      totalJobs: Number(d.totalJobs),
      status: d.status,
      online: false,
      ageMs: null,
      chip: null,
      ramGb: null,
      cpuCores: null,
      secondsPerImage: null,
      suggestedPriceUsdcBase: null,
    };
  });

  // Parallel heartbeat fetches — same pattern the web uses. At MVP
  // scale (≤ 20 providers) this is one HTTP call per provider ≈ 200ms
  // total over the existing /api/heartbeat/[pda] route.
  const heartbeats = await Promise.all(rows.map((r) => fetchHeartbeat(r.pda)));
  rows.forEach((row, i) => {
    const hb = heartbeats[i];
    if (!hb) return;
    row.online = hb.online ?? false;
    row.ageMs = hb.ageMs ?? null;
    const p = hb.heartbeat;
    if (p) {
      row.chip = p.chip || null;
      row.ramGb = p.ramGb || null;
      row.cpuCores = p.cpuCores || null;
      row.secondsPerImage = p.secondsPerImage
        ? parseFloat(p.secondsPerImage)
        : null;
      row.suggestedPriceUsdcBase = p.suggestedPriceUsdcBase
        ? safeBigint(p.suggestedPriceUsdcBase)
        : null;
    }
  });

  // Sort: online first, then by speed (faster first), then by
  // suggested price (cheaper first). Offline providers at the bottom.
  rows.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    if (a.secondsPerImage !== null && b.secondsPerImage !== null) {
      return a.secondsPerImage - b.secondsPerImage;
    }
    return a.totalJobs - b.totalJobs;
  });
  return rows;
}

/** Fetch a single provider's heartbeat record. Returns null on
 *  network error or 404; the caller decides what to do with it. */
async function fetchHeartbeat(
  pda: Address,
): Promise<HeartbeatGetResponse | null> {
  try {
    const r = await fetch(`${APIS_API_BASE}/api/heartbeat/${pda}`);
    if (r.status === 404) return null;
    if (!r.ok) return null;
    return (await r.json()) as HeartbeatGetResponse;
  } catch {
    return null;
  }
}

/** Pick a provider for the agent. Strategy:
 *    1. Must be online (recent heartbeat).
 *    2. Must be on-chain Active (not Paused / Slashed).
 *    3. Must have a published Flux speed.
 *    4. Must be within budget (suggestedPrice ≤ maxPriceUsdcBase if given).
 *    5. Among survivors, pick fastest.
 *  Returns null when nobody matches. */
export function pickProvider(
  rows: ProviderRow[],
  opts: { maxPriceUsdcBase?: bigint } = {},
): ProviderRow | null {
  const eligible = rows.filter((r) => {
    if (!r.online) return false;
    if (r.status !== ProviderStatus.Active) return false;
    if (r.secondsPerImage === null) return false;
    if (
      opts.maxPriceUsdcBase != null &&
      r.suggestedPriceUsdcBase != null &&
      r.suggestedPriceUsdcBase > opts.maxPriceUsdcBase
    ) {
      return false;
    }
    return true;
  });
  if (eligible.length === 0) return null;
  // Already sorted fastest-first by fetchProviders().
  return eligible[0] ?? null;
}

function base64ToBytes(b64: string): ReadonlyUint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function safeBigint(s: string): bigint | null {
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}
