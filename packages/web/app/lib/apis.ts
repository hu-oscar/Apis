// Apis-specific helpers that the Codama-generated client doesn't cover.
//
// PDA derivation, instruction builders, and account decoders all come from
// `@/lib/apis-program` (Codama output). This file holds the small extras:
// sha256 hashing for the on-chain spec hashes, a random u64 Job id
// generator, and a Solana Explorer URL formatter for tx-success UIs.

/**
 * sha256 hash of a UTF-8 string, returned as a 32-byte `Uint8Array`.
 *
 * Used to compute the on-chain `gpu_specs_hash`, `endpoint_uri_hash`, and
 * `spec_hash` arguments — we keep raw strings off-chain (privacy + size)
 * and store only the digest. Per Research §4, on-chain `spec_hash` covers
 * the full JobSpec (prompt + model + scheduler + steps + cfg + seed +
 * dtype + resolution + cuda/torch/diffusers versions + gpu_arch_class).
 *
 * Browser-safe (uses Web Crypto API, available in all modern browsers
 * and Edge runtime).
 */
export async function sha256(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

/**
 * Generate a fresh random `u64` to use as a Job id (nonce).
 *
 * The on-chain `Job` PDA seeds are `[b"job", buyer, id_le_bytes]` — using
 * a random nonce per submission lets the same buyer create many jobs
 * without collision. 64 random bits is overkill for the hackathon volume
 * but matches the on-chain field size.
 */
export function randomJobId(): bigint {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return new DataView(bytes.buffer).getBigUint64(0, true); // little-endian
}

export type SolanaCluster = "devnet" | "testnet" | "mainnet-beta";

/**
 * Solana Explorer URL for a transaction signature. Defaults to devnet
 * (matches `app/components/providers.tsx`). Mainnet uses the bare URL
 * with no `?cluster=` query.
 */
export function explorerTxUrl(
  signature: string,
  cluster: SolanaCluster = "devnet",
): string {
  const base = `https://explorer.solana.com/tx/${signature}`;
  return cluster === "mainnet-beta" ? base : `${base}?cluster=${cluster}`;
}

/**
 * Solana Explorer URL for an account address. Same cluster semantics.
 */
export function explorerAccountUrl(
  address: string,
  cluster: SolanaCluster = "devnet",
): string {
  const base = `https://explorer.solana.com/address/${address}`;
  return cluster === "mainnet-beta" ? base : `${base}?cluster=${cluster}`;
}
