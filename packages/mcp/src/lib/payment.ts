// x402-flavored payment verification — Sprint 4.4.
//
// We don't use Coinbase's official x402 facilitator (queued as
// optional Phase-2 polish; see README). Instead the server verifies
// the agent's USDC transfer directly against the chain:
//
//   1. Agent calls quote_inference → server returns a payment_id,
//      the server's USDC ATA, the exact price in USDC base units, and
//      a memo to attach to the transfer.
//   2. Agent signs + sends an SPL transfer (USDC, amount = price,
//      recipient = server ATA) plus a memo instruction with the
//      payment_id as the memo string.
//   3. Agent calls submit_job with {payment_id, payment_signature}.
//   4. THIS MODULE verifies the signature on-chain: the tx exists,
//      it's recent, the SPL transfer goes to our ATA, the amount
//      meets the quote, and the memo matches payment_id.
//
// Same security shape as Coinbase x402 — the agent proves payment
// before the server does its (more expensive) on-chain work. Just
// self-rolled, no external facilitator.

import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Signature,
} from "@solana/kit";

import { rpc, USDC_DECIMALS, USDC_MINT } from "./rpc.js";

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
const ASSOCIATED_TOKEN_PROGRAM_ID =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address;
const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" as Address;

const PAYMENT_MAX_AGE_MS = 5 * 60 * 1000; // 5 min replay window
const PAYMENT_MAX_FUTURE_MS = 60 * 1000; // 60s clock skew tolerance

export type PaymentRequirement = {
  pay_to_ata: string;
  pay_to_owner: string;
  pay_amount_usdc_base: string;
  pay_amount_usdc: string;
  pay_memo: string;
  pay_mint: string;
  pay_expires_at_unix_ms: number;
};

/** Derive the classic-Token associated token account for (owner,
 *  USDC_MINT). Same math the web's findAssociatedTokenAddress uses.
 *  Pure, no RPC. */
export async function deriveUsdcAta(owner: Address): Promise<Address> {
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    seeds: [enc.encode(owner), enc.encode(TOKEN_PROGRAM_ID), enc.encode(USDC_MINT)],
  });
  return pda;
}

export type VerifyPaymentArgs = {
  paymentSignature: Signature;
  expectedRecipientAta: Address;
  expectedAmountBase: bigint;
  expectedMemo: string;
};

export type VerifyPaymentResult =
  | { ok: true; payerAddress: Address }
  | { ok: false; reason: string };

/** Look up the agent's USDC transfer on chain and verify it matches
 *  the quote. The agent gave us the signature; we go look it up, find
 *  the SPL transfer + memo instructions, and confirm:
 *
 *    - The tx exists and isn't reverted.
 *    - It's within the replay window (< 5 min old).
 *    - The transfer goes to our USDC ATA.
 *    - The mint is USDC_MINT.
 *    - The amount ≥ what we quoted (overpayment is allowed).
 *    - A memo instruction in the same tx carries the expected
 *      payment_id as its memo string.
 *
 *  Returns {ok: false, reason} on any failure so the caller can
 *  surface a specific error to the agent. */
export async function verifyPayment(
  args: VerifyPaymentArgs,
): Promise<VerifyPaymentResult> {
  const client = rpc();
  type ParsedTx = {
    blockTime?: number | null;
    meta?: { err?: unknown } | null;
    transaction?: {
      message?: {
        instructions?: Array<{
          program?: string;
          programId?: string;
          parsed?: { type?: string; info?: Record<string, unknown> };
        }>;
      };
    };
  };

  let resp: ParsedTx | null;
  try {
    // jsonParsed encoding decodes well-known programs (token, memo)
    // into structured `parsed.info` blocks. Saves us from manual
    // borsh decoding of SPL Token instruction data.
    const raw = await (
      client as unknown as {
        getTransaction: (
          sig: string,
          config: {
            encoding: "jsonParsed";
            maxSupportedTransactionVersion: number;
            commitment: string;
          },
        ) => { send: () => Promise<ParsedTx | null> };
      }
    )
      .getTransaction(args.paymentSignature, {
        encoding: "jsonParsed",
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      })
      .send();
    resp = raw;
  } catch (err) {
    return {
      ok: false,
      reason: `couldn't fetch tx ${args.paymentSignature}: ${
        err instanceof Error ? err.message : err
      }`,
    };
  }

  if (!resp) {
    return {
      ok: false,
      reason: `tx ${args.paymentSignature} not found on chain (not yet confirmed, or wrong cluster)`,
    };
  }
  if (resp.meta?.err) {
    return {
      ok: false,
      reason: `tx ${args.paymentSignature} reverted: ${JSON.stringify(resp.meta.err)}`,
    };
  }

  // Replay-window check.
  const blockTime = resp.blockTime;
  if (blockTime) {
    const ageMs = Date.now() - blockTime * 1000;
    if (ageMs > PAYMENT_MAX_AGE_MS) {
      return {
        ok: false,
        reason: `tx is ${Math.round(ageMs / 1000)}s old; max allowed ${PAYMENT_MAX_AGE_MS / 1000}s`,
      };
    }
    if (ageMs < -PAYMENT_MAX_FUTURE_MS) {
      return {
        ok: false,
        reason: `tx blockTime is in the future by ${Math.round(-ageMs / 1000)}s`,
      };
    }
  }

  const instructions = resp.transaction?.message?.instructions ?? [];
  if (instructions.length === 0) {
    return { ok: false, reason: "tx has no instructions" };
  }

  // Walk the instructions: find the SPL Token transfer to our ATA +
  // a memo with the expected payment_id. Both must be in the same tx.
  let foundTransfer:
    | { source: string; destination: string; amount: string; authority?: string }
    | null = null;
  let foundMemo = false;

  for (const ix of instructions) {
    const program = ix.program ?? ix.programId;

    // SPL Token transfer (Transfer or TransferChecked).
    if (
      (program === "spl-token" || program === TOKEN_PROGRAM_ID) &&
      ix.parsed &&
      (ix.parsed.type === "transfer" || ix.parsed.type === "transferChecked")
    ) {
      const info = (ix.parsed.info ?? {}) as Record<string, unknown>;
      const dest = typeof info.destination === "string" ? info.destination : "";
      if (dest === args.expectedRecipientAta) {
        const rawAmount =
          ix.parsed.type === "transferChecked"
            ? (info.tokenAmount as { amount?: string } | undefined)?.amount
            : (info.amount as string | undefined);
        foundTransfer = {
          source: typeof info.source === "string" ? info.source : "",
          destination: dest,
          amount: typeof rawAmount === "string" ? rawAmount : "0",
          authority:
            typeof info.authority === "string" ? info.authority : undefined,
        };
      }
    }

    // Memo instruction.
    if (program === "spl-memo" || program === MEMO_PROGRAM_ID) {
      // Parsed memo instructions surface the memo text either as the
      // `parsed` value directly (older RPC versions) or as
      // `parsed.info` (newer). Accept both. Cast through `unknown`
      // because our wire type doesn't model both shapes.
      const parsed = ix.parsed as unknown;
      let memoText = "";
      if (typeof parsed === "string") {
        memoText = parsed;
      } else if (parsed && typeof parsed === "object" && "info" in parsed) {
        const info = (parsed as { info: unknown }).info;
        if (typeof info === "string") memoText = info;
      }
      if (memoText.includes(args.expectedMemo)) {
        foundMemo = true;
      }
    }
  }

  if (!foundTransfer) {
    return {
      ok: false,
      reason: `tx contains no SPL transfer to ${args.expectedRecipientAta}`,
    };
  }
  if (!foundMemo) {
    return {
      ok: false,
      reason: `tx is missing a memo with payment_id "${args.expectedMemo}"`,
    };
  }

  let paidAmount: bigint;
  try {
    paidAmount = BigInt(foundTransfer.amount);
  } catch {
    return {
      ok: false,
      reason: `couldn't parse transfer amount: ${foundTransfer.amount}`,
    };
  }
  if (paidAmount < args.expectedAmountBase) {
    return {
      ok: false,
      reason: `underpaid: tx transferred ${paidAmount} USDC base units, quote was ${args.expectedAmountBase}`,
    };
  }

  // The "payer" is the authority who signed the transfer.
  const payer = (foundTransfer.authority ?? foundTransfer.source) as Address;
  return { ok: true, payerAddress: payer };
}

/** Format a u64 USDC base-unit amount as a fixed-decimal string. */
export function formatUsdc(amount: bigint): string {
  const whole = amount / BigInt(10 ** USDC_DECIMALS);
  const frac = amount % BigInt(10 ** USDC_DECIMALS);
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}
