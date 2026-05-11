// Build, sign, and send the agent's x402 payment tx — Sprint 4.7.
//
// The ONLY Solana tx the agent signs once MCP is in the loop. Two
// instructions in one versioned tx:
//   1. SPL Token TransferChecked  — agent USDC ATA → server USDC ATA,
//                                    amount = quoted price, USDC mint
//   2. Memo                       — text = payment_id (the server
//                                    looks for this exact string when
//                                    verifying the payment)
//
// Returns the tx signature so the agent can pass it to submit_job.

import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";
import { getTransferCheckedInstruction } from "@solana-program/token";

import { rpc, USDC_DECIMALS, USDC_MINT } from "./rpc.js";
import { waitForConfirmation } from "./submit.js";

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
const ASSOCIATED_TOKEN_PROGRAM_ID =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address;
const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" as Address;

export type PayQuoteArgs = {
  agentSigner: KeyPairSigner;
  recipientAta: Address;
  amountBase: bigint;
  memo: string;
};

/** Derive an Associated Token Account address — same math the
 *  server's deriveUsdcAta uses. Pure, no RPC. */
export async function deriveUsdcAta(owner: Address): Promise<Address> {
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    seeds: [enc.encode(owner), enc.encode(TOKEN_PROGRAM_ID), enc.encode(USDC_MINT)],
  });
  return pda;
}

/** Construct a memo instruction by hand. The Memo program takes a
 *  single account (the signer) + the memo text as instruction data.
 *  No high-level builder needed — easier than pulling in
 *  @solana-program/memo just for this. */
function buildMemoInstruction(signer: Address, memo: string) {
  const data = new TextEncoder().encode(memo);
  return {
    programAddress: MEMO_PROGRAM_ID,
    accounts: [{ address: signer, role: 2 as const }],
    data,
  };
}

export async function payQuote(args: PayQuoteArgs): Promise<Signature> {
  const { agentSigner, recipientAta, amountBase, memo } = args;
  const client = rpc();

  const sourceAta = await deriveUsdcAta(agentSigner.address);

  const transferIx = getTransferCheckedInstruction({
    source: sourceAta,
    mint: USDC_MINT,
    destination: recipientAta,
    authority: agentSigner,
    amount: amountBase,
    decimals: USDC_DECIMALS,
  });

  const memoIx = buildMemoInstruction(agentSigner.address, memo);

  const { value: latestBlockhash } = await client.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(agentSigner, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstruction(transferIx, m),
    (m) => appendTransactionMessageInstruction(memoIx, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const wire = getBase64EncodedWireTransaction(signed);
  const signature = getSignatureFromTransaction(signed);

  await client
    .sendTransaction(wire, {
      encoding: "base64",
      preflightCommitment: "confirmed",
      skipPreflight: false,
    })
    .send();
  await waitForConfirmation(client, signature);

  return signature;
}
