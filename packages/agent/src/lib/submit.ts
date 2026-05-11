// On-chain create_job — Sprint 4.0c.
//
// Builds the same `create_job` instruction the web's /submit page
// builds (via Codama-generated `getCreateJobInstructionAsync`), then
// signs + sends + confirms via the raw @solana/kit RPC. No React,
// no wallet adapter — agent has its own keypair signer.
//
// The Codama generator emits the *async* builder so it can derive
// PDAs + ATAs internally; we just hand it the high-level inputs.

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
import { findJobPda } from "../generated/apis-program/src/generated/pdas/job.js";
import { rpc, USDC_MINT, APIS_PROGRAM_ADDRESS } from "./rpc.js";
import { randomJobId, specHashBytes, type JobSpec } from "./spec.js";

export type CreateJobResult = {
  signature: Signature;
  jobPda: Address;
  jobId: bigint;
  specHash: Uint8Array;
  priceLamportsUsdc: bigint;
};

export type CreateJobArgs = {
  buyer: KeyPairSigner;
  providerPda: Address;
  spec: JobSpec;
  priceLamportsUsdc: bigint; // USDC base units (6 decimals)
  deadlineOffsetSecs?: bigint;
};

/** Build, sign, send and confirm a `create_job` transaction.
 *  Returns the resulting Job PDA + signature + the resolved spec hash. */
export async function createJob(args: CreateJobArgs): Promise<CreateJobResult> {
  const {
    buyer,
    providerPda,
    spec,
    priceLamportsUsdc,
    deadlineOffsetSecs = 600n,
  } = args;
  const client = rpc();

  const jobId = randomJobId();
  const specHash = specHashBytes(spec);

  const ix = await getCreateJobInstructionAsync({
    buyer,
    provider: providerPda,
    usdcMint: USDC_MINT,
    id: jobId,
    specHash,
    deadlineOffsetSecs,
    priceLamportsUsdc,
  });

  // Resolve the Job PDA locally so we can return it to the caller
  // without an extra RPC roundtrip. Anchor's seeds for Job are
  // [b"job", buyer, id_le_bytes].
  const [jobPda] = await findJobPda({
    buyer: buyer.address,
    id: jobId,
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

  return { signature, jobPda, jobId, specHash, priceLamportsUsdc };
}

/** Poll getSignatureStatuses until the tx hits `confirmed`, or throw
 *  after `timeoutMs`. Avoids depending on WS subscriptions which
 *  would force a second RPC connection from a short-lived CLI. */
export async function waitForConfirmation(
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
    await sleep(800);
  }
  throw new Error(`tx ${signature} not confirmed within ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Re-export for callers that want the raw program ID.
export { APIS_PROGRAM_ADDRESS };
