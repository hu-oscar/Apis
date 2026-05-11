// Read the on-chain Provider account directly via Solana JSON-RPC.
//
// We do this from the renderer (browser side of the Tauri shell) so
// the Rust side stays free of solana-sdk dependencies — a single
// fetch() to the devnet RPC + a hand-rolled decode of the 89-relevant-
// bytes Provider layout is much lighter than pulling in the full SDK.
//
// Sprint 2.5 of Phase 1.5.

const DEFAULT_RPC = "https://api.devnet.solana.com";

// Provider account layout (matches programs/apis_program/src/state/provider.rs):
//   discriminator      8
//   authority          32
//   bond_vault         32
//   active_jobs        u64 LE (8)
//   total_jobs         u64 LE (8)
//   status             u8
//   gpu_specs_hash     32
//   endpoint_uri_hash  32
//   bump               u8
// Total: 154 bytes.

export enum ProviderStatus {
  Active = 0,
  Paused = 1,
  Slashed = 2,
}

export type OnChainProvider = {
  activeJobs: bigint;
  totalJobs: bigint;
  status: ProviderStatus;
};

export type ProviderQueryResult =
  | { kind: "registered"; data: OnChainProvider }
  | { kind: "not_registered" }
  | { kind: "error"; message: string };

export async function queryProvider(
  pda: string,
  rpcUrl: string = DEFAULT_RPC,
): Promise<ProviderQueryResult> {
  let resp: Response;
  try {
    resp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [pda, { encoding: "base64" }],
      }),
    });
  } catch (err) {
    return {
      kind: "error",
      message: `RPC fetch failed: ${err instanceof Error ? err.message : err}`,
    };
  }
  if (!resp.ok) {
    return { kind: "error", message: `RPC returned ${resp.status}` };
  }
  type GetAccountInfoResp = {
    result?: {
      value: null | {
        data: [string, "base64"];
      };
    };
    error?: { message: string };
  };
  let body: GetAccountInfoResp;
  try {
    body = (await resp.json()) as GetAccountInfoResp;
  } catch (err) {
    return {
      kind: "error",
      message: `RPC body parse: ${err instanceof Error ? err.message : err}`,
    };
  }
  if (body.error) {
    return { kind: "error", message: body.error.message };
  }
  const value = body.result?.value;
  if (!value) {
    return { kind: "not_registered" };
  }
  const bytes = base64ToBytes(value.data[0]);
  if (bytes.length < 89) {
    return {
      kind: "error",
      message: `Provider account is ${bytes.length} bytes; expected ≥ 89`,
    };
  }
  return {
    kind: "registered",
    data: {
      activeJobs: readU64LE(bytes, 72),
      totalJobs: readU64LE(bytes, 80),
      status: bytes[88] as ProviderStatus,
    },
  };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function readU64LE(b: Uint8Array, offset: number): bigint {
  const view = new DataView(b.buffer, b.byteOffset + offset, 8);
  return view.getBigUint64(0, true);
}
