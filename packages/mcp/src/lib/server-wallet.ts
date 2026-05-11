// MCP server hot wallet — Sprint 4.3.
//
// Distinct from the agent keypair. The server holds its own Solana
// authority that:
//   1. Signs `create_job` on the agent's behalf (the agent paid the
//      server via x402; the server now pays USDC into escrow).
//   2. Signs `confirm_completion` when the worker reports a result.
//      The escrow payout goes to the provider; this signature only
//      authorizes the release.
//
// Path defaults to `~/.config/apis/mcp-server.json`; override with
// `APIS_MCP_SERVER_KEYPAIR`. Must be funded with:
//   - ~0.1 SOL on devnet for tx fees
//   - ≥ ~5 USDC as float for in-flight jobs
//
// On Fly.io we load the keypair from the `APIS_MCP_SERVER_KEYPAIR_JSON`
// env var instead (entire 64-element JSON array as a single string)
// because Fly's filesystem is ephemeral per-deploy.

import {
  createKeyPairSignerFromBytes,
  type KeyPairSigner,
  type Address,
} from "@solana/kit";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const DEFAULT_PATH = resolve(homedir(), ".config", "apis", "mcp-server.json");

export type ServerWallet = {
  signer: KeyPairSigner;
  address: Address;
  source: "file" | "env";
};

export async function loadServerWallet(): Promise<ServerWallet> {
  // Prod path: full JSON array as a single env var. Used on Fly.io
  // where there's no persistent disk.
  const envJson = process.env.APIS_MCP_SERVER_KEYPAIR_JSON;
  if (envJson) {
    return load(envJson, "env");
  }

  const path = process.env.APIS_MCP_SERVER_KEYPAIR ?? DEFAULT_PATH;
  if (!existsSync(path)) {
    throw new Error(
      `MCP server keypair not found at ${path}.\n` +
        `→ either: (a) export APIS_MCP_SERVER_KEYPAIR_JSON=<64-element JSON array>\n` +
        `       or: (b) run "solana-keygen new --outfile ${path}" and fund it.\n` +
        `\nThe server keypair signs create_job + confirm_completion on the agent's behalf.\n` +
        `It needs ~0.1 SOL for tx fees + ≥ 5 USDC float for in-flight jobs (devnet).`,
    );
  }
  return load(readFileSync(path, "utf-8"), "file");
}

async function load(
  rawJson: string,
  source: "file" | "env",
): Promise<ServerWallet> {
  let bytes: Uint8Array;
  try {
    const arr = JSON.parse(rawJson) as number[];
    if (!Array.isArray(arr) || arr.length !== 64) {
      throw new Error(`keypair is not a 64-element JSON array`);
    }
    bytes = new Uint8Array(arr);
  } catch (err) {
    throw new Error(
      `couldn't parse server keypair (${source}): ${
        err instanceof Error ? err.message : err
      }`,
    );
  }
  const signer = await createKeyPairSignerFromBytes(bytes);
  return { signer, address: signer.address, source };
}
