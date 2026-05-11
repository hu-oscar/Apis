// MCP server on-chain ops — Sprint 4.3.
//
// The server-side counterparts to the agent's submit.ts / confirm.ts:
// same Codama instruction builders, same @solana/kit pipe, but the
// signer is the *server's* hot wallet, not the buyer's agent wallet.
//
// This lets the agent pay the server via x402 (Sprint 4.4) and the
// server then pays Solana on the agent's behalf — completing the
// "agent never signs a Solana tx directly" story end-to-end.

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

import { getCreateJobInstructionAsync } from "../generated/apis-program/src/generated/instructions/createJob.js";
import { getConfirmCompletionInstructionAsync } from "../generated/apis-program/src/generated/instructions/confirmCompletion.js";
import { findJobPda } from "../generated/apis-program/src/generated/pdas/job.js";
import { rpc, USDC_MINT, TREASURY } from "./rpc.js";
import { randomJobId, specHashBytes, type JobSpec } from "./spec.js";

export type CreateJobResult = {
  signature: Signature;
  jobPda: Address;
  jobId: bigint;
  specHash: Uint8Array;
  priceLamportsUsdc: bigint;
};

export type CreateJobArgs = {
  serverSigner: KeyPairSigner;
  providerPda: Address;
  spec: JobSpec;
  priceLamportsUsdc: bigint;
  deadlineOffsetSecs?: bigint;
};

/** Build, sign, and send a create_job tx from the MCP server's hot
 *  wallet. The server's address ends up as the on-chain `buyer` —
 *  which means the server is the only entity that can later call
 *  confirm_completion. */
export async function createJobAsServer(
  args: CreateJobArgs,
): Promise<CreateJobResult> {
  const {
    serverSigner,
    providerPda,
    spec,
    priceLamportsUsdc,
    deadlineOffsetSecs = 600n,
  } = args;
  const client = rpc();

  const jobId = randomJobId();
  const specHash = specHashBytes(spec);

  const ix = await getCreateJobInstructionAsync({
    buyer: serverSigner,
    provider: providerPda,
    usdcMint: USDC_MINT,
    id: jobId,
    specHash,
    deadlineOffsetSecs,
    priceLamportsUsdc,
  });

  const [jobPda] = await findJobPda({
    buyer: serverSigner.address,
    id: jobId,
  });

  const { value: latestBlockhash } = await client.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(serverSigner, m),
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

  return { signature, jobPda, jobId, specHash, priceLamportsUsdc };
}

export type ConfirmCompletionArgs = {
  serverSigner: KeyPairSigner;
  jobPda: Address;
  providerPda: Address;
  providerAuthority: Address;
};

export async function confirmCompletionAsServer(
  args: ConfirmCompletionArgs,
): Promise<Signature> {
  const { serverSigner, jobPda, providerPda, providerAuthority } = args;
  const client = rpc();

  const ix = await getConfirmCompletionInstructionAsync({
    buyer: serverSigner,
    job: jobPda,
    provider: providerPda,
    providerAuthority,
    treasury: TREASURY,
    usdcMint: USDC_MINT,
  });

  const { value: latestBlockhash } = await client.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(serverSigner, m),
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

/** Polling helper — same shape as agent's, kept inline to avoid
 *  cross-package import gymnastics. */
async function waitForConfirmation(
  client: ReturnType<typeof rpc>,
  signature: Signature,
  timeoutMs = 30_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await client
      .getSignatureStatuses([signature], { searchTransactionHistory: true })
      .send();
    const status = value[0];
    if (status) {
      if (status.err) {
        throw new Error(
          `tx ${signature} failed: ${JSON.stringify(status.err)}`,
        );
      }
      const conf = status.confirmationStatus;
      if (conf === "confirmed" || conf === "finalized") return;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`tx ${signature} not confirmed within ${timeoutMs}ms`);
}
