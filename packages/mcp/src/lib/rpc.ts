// RPC + program addresses — Sprint 4.0a.
//
// Shares the same on-chain identifiers as the web app (see
// packages/web/app/lib/constants.ts). Kept in a separate module here
// so the agent doesn't pull in any Next.js / React baggage from the
// web package.

import { createSolanaRpc, type Address } from "@solana/kit";

export const RPC_URL =
  process.env.APIS_RPC_URL ?? "https://api.devnet.solana.com";

export const APIS_API_BASE =
  process.env.APIS_API_BASE ?? "https://apis-web-five.vercel.app";

export const APIS_PROGRAM_ADDRESS =
  "2qe8YXciSpony5vjwxZAYJZ7WfRzSHKRdRzSiH868mhf" as Address;

export const USDC_MINT =
  "8Lmkrhbc4du7VD7qsK2xGQj3vCqVjvDdRVjFimg6jNsS" as Address;

export const GLOBAL_CONFIG_PDA =
  "CUMeUgPvQNiuc9Th93DD1czTUdEeDR9FCABoN6gyGPg2" as Address;

export const TREASURY =
  "AocVgNfUByYHhipazTLPCUdfnAbDiJQz4mE3BBBL6649" as Address;

export const PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs";

export const USDC_DECIMALS = 6;

/** Lazily-built RPC client. We don't share it as a module-level
 *  singleton because @solana/kit's client holds a fetch-like resource
 *  and the CLI is short-lived anyway. */
export function rpc() {
  return createSolanaRpc(RPC_URL);
}

/** Pretty-print a u64 base-unit USDC amount, mirrors web's formatUsdc. */
export function formatUsdc(lamports: bigint | number): string {
  const n = typeof lamports === "bigint" ? lamports : BigInt(lamports);
  const whole = n / BigInt(10 ** USDC_DECIMALS);
  const frac = n % BigInt(10 ** USDC_DECIMALS);
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

/** Solana Explorer tx URL — defaults to devnet. */
export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

/** Solana Explorer account URL — defaults to devnet. */
export function explorerAccountUrl(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}
