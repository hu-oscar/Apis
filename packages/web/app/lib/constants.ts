// W2 hard-coded marketplace constants.
//
// At hackathon scope there's a single registered worker (the Python
// `apis_worker` running on the dev box) and a single test SPL mint that
// `bootstrap_devnet.py` created. Both stay constant for the duration of
// the demo, so a typed `lib/constants.ts` is simpler than a registry-fetch
// dance. Replace with on-chain provider browsing in W3 polish.

import type { Address } from "@solana/kit";

/** Worker's Provider PDA, derived from the worker keypair at
 *  ~/.config/apis/worker.json. Registered via
 *  packages/worker/scripts/register_provider.py. */
export const WORKER_PROVIDER_PDA: Address =
  "4hhpQuy559Ky427pGianWckXC6BTW5tkWAbRn2qvauEA" as Address;

/** Worker keypair pubkey — also the Provider's `authority` field, which
 *  `confirm_completion` uses as the SPL ATA owner for the payout. We
 *  could fetch this from the on-chain Provider account, but it's stable
 *  for the W2 demo so the constant saves a round-trip. */
export const WORKER_PROVIDER_AUTHORITY: Address =
  "BS6jKLUZdoviJWNno9ScnTPqLVqgW59GLJBZy7AN94BW" as Address;

/** Test SPL mint created by scripts/bootstrap_devnet.py (decimals = 6,
 *  authority = devnet deployer = also `treasury` in GlobalConfig). */
export const USDC_MINT: Address =
  "8Lmkrhbc4du7VD7qsK2xGQj3vCqVjvDdRVjFimg6jNsS" as Address;

/** GlobalConfig PDA — derived from [b"config"] under apis_program.
 *  We hard-code it here so the page can short-circuit `findConfigPda()`. */
export const GLOBAL_CONFIG_PDA: Address =
  "CUMeUgPvQNiuc9Th93DD1czTUdEeDR9FCABoN6gyGPg2" as Address;

/** Treasury wallet that earns fee_bps of every confirmed job. The same
 *  address as the deployer for hackathon scope (set by
 *  initialize_config). */
export const TREASURY: Address =
  "AocVgNfUByYHhipazTLPCUdfnAbDiJQz4mE3BBBL6649" as Address;

/** Pinata public IPFS gateway. CIDs uploaded by the worker render via
 *  `${PINATA_GATEWAY}/${cid}`. No auth required for public CIDs. */
export const PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs";

/** Default deadline for a job (seconds after funding). After this elapses
 *  without a `submit_completion`, the buyer can `cancel_job` for a full
 *  refund. 600s = 10 minutes; comfortable for a 4-step Flux Schnell
 *  inference + IPFS upload + tx confirmation. */
export const DEFAULT_DEADLINE_SECS = BigInt(600);

/** Default price (1 USDC = 1_000_000 base units, 6 decimals). */
export const DEFAULT_PRICE_LAMPORTS_USDC = BigInt(1_000_000);

/** USDC decimals — matches the spl-token mint created by
 *  bootstrap_devnet.py. */
export const USDC_DECIMALS = 6;

/** Pretty-print a u64 base-unit USDC amount as `1.234567 USDC`. */
export function formatUsdc(lamports: bigint | number): string {
  const n = typeof lamports === "bigint" ? lamports : BigInt(lamports);
  const whole = n / BigInt(10 ** USDC_DECIMALS);
  const frac = n % BigInt(10 ** USDC_DECIMALS);
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}
