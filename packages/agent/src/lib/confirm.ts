// On-chain confirm_completion — Sprint 4.0e.
//
// Mirrors the /job/[id] page's confirm handler: build the Codama
// instruction with the buyer signer + provider PDA + provider
// authority + treasury + USDC mint, then sign + send + confirm via
// the same @solana/kit pipeline submit.ts uses.

import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Address,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";

import { getConfirmCompletionInstructionAsync } from "../generated/apis-program/src/generated/instructions/confirmCompletion.js";
import { rpc, USDC_MINT, TREASURY } from "./rpc.js";
import { waitForConfirmation } from "./submit.js";

export type ConfirmCompletionArgs = {
  buyer: KeyPairSigner;
  jobPda: Address;
  providerPda: Address;
  providerAuthority: Address;
};

export async function confirmCompletion(
  args: ConfirmCompletionArgs,
): Promise<Signature> {
  const { buyer, jobPda, providerPda, providerAuthority } = args;
  const client = rpc();

  const ix = await getConfirmCompletionInstructionAsync({
    buyer,
    job: jobPda,
    provider: providerPda,
    providerAuthority,
    treasury: TREASURY,
    usdcMint: USDC_MINT,
  });

  const { value: latestBlockhash } = await client.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(buyer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstruction(ix, m),
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
