// POST /api/faucet — mint test USDC to a Solana wallet (devnet only).
//
// Hackathon judges hit /submit, click "Connect wallet", and immediately
// see "Insufficient — fund this wallet" because the Phantom they just
// connected has zero of our test mint. This endpoint solves that: POST
// the wallet pubkey, get 10 test USDC dropped into its ATA.
//
// Guarded by:
//   - **Balance gate** (replaces the 24h KV rate limit): if the
//     recipient's USDC ATA already holds ≥ FAUCET_AMOUNT, refuse —
//     they don't need a drip. The recipient can spend it down (e.g.
//     by submitting jobs) before re-dripping. Slightly weaker than a
//     hard time limit, but acceptable on a devnet test mint and
//     removes the only reason we needed an external KV.
//   - Hardcoded amount + mint — caller can't choose what or how much.
//   - APIS_DEPLOYER_KEYPAIR env var must be set; without it the route
//     returns 503 instead of leaking the absence of mint authority.
//
// Devnet test mint owned by the deployer has no real-money value, so
// the env-var-stored keypair is acceptable for the hackathon. Rotate
// post-submission.

import { NextResponse } from "next/server";
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getAddressEncoder,
  getProgramDerivedAddress,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  getBase64EncodedWireTransaction,
  type Address,
} from "@solana/kit";
import { getMintToInstruction } from "@solana-program/token";
import { getCreateAssociatedTokenIdempotentInstructionAsync } from "@solana-program/token";

export const runtime = "nodejs";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

const USDC_MINT: Address =
  "8Lmkrhbc4du7VD7qsK2xGQj3vCqVjvDdRVjFimg6jNsS" as Address;
const TOKEN_PROGRAM: Address =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
const ASSOCIATED_TOKEN_PROGRAM: Address =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address;

const FAUCET_AMOUNT_BASE_UNITS = 10_000_000n; // 10 test USDC (6 decimals)

type Body = { pubkey: string };

function isBase58Pubkey(s: unknown): s is string {
  return typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

async function findAta(owner: Address, mint: Address): Promise<Address> {
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [enc.encode(owner), enc.encode(TOKEN_PROGRAM), enc.encode(mint)],
  });
  return pda;
}

export async function POST(request: Request): Promise<Response> {
  const rawKp = process.env.APIS_DEPLOYER_KEYPAIR;
  if (!rawKp) {
    return NextResponse.json(
      { error: "Faucet not configured (no deployer keypair in env)" },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!isBase58Pubkey(body.pubkey)) {
    return NextResponse.json(
      { error: "pubkey must be a base58 Solana address" },
      { status: 400 },
    );
  }
  const recipient = body.pubkey as Address;

  // Balance gate: if the recipient already holds enough test USDC, refuse.
  // Cheaper than an external KV rate limit, and self-paced: spend before
  // re-dripping. We probe getTokenAccountBalance and treat any error
  // (e.g. ATA doesn't exist) as "balance == 0" → drip allowed.
  const ata = await findAta(recipient, USDC_MINT);
  const rpc = createSolanaRpc(RPC_URL);
  let priorBalance = 0n;
  try {
    const resp = await rpc.getTokenAccountBalance(ata).send();
    priorBalance = BigInt(resp.value.amount);
  } catch {
    priorBalance = 0n;
  }
  if (priorBalance >= FAUCET_AMOUNT_BASE_UNITS) {
    return NextResponse.json(
      {
        error:
          "You already have enough test USDC. Spend some by submitting a job, then come back.",
        currentBalanceBaseUnits: priorBalance.toString(),
      },
      { status: 429 },
    );
  }

  // Load the deployer keypair (mint authority + fee payer).
  let deployer;
  try {
    const arr = JSON.parse(rawKp) as number[];
    if (!Array.isArray(arr) || arr.length !== 64) {
      throw new Error("APIS_DEPLOYER_KEYPAIR must be a 64-byte JSON array");
    }
    deployer = await createKeyPairSignerFromBytes(new Uint8Array(arr));
  } catch (err) {
    return NextResponse.json(
      { error: `Bad APIS_DEPLOYER_KEYPAIR: ${err}` },
      { status: 500 },
    );
  }

  try {
    const ataIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
      payer: deployer,
      owner: recipient,
      mint: USDC_MINT,
    });
    const mintIx = getMintToInstruction({
      mint: USDC_MINT,
      token: ata,
      mintAuthority: deployer,
      amount: FAUCET_AMOUNT_BASE_UNITS,
    });

    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const tx = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(deployer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions([ataIx, mintIx], m),
    );
    const signed = await signTransactionMessageWithSigners(tx);
    const signature = getSignatureFromTransaction(signed);
    const wire = getBase64EncodedWireTransaction(signed);
    await rpc
      .sendTransaction(wire, { encoding: "base64", preflightCommitment: "confirmed" })
      .send();

    return NextResponse.json({
      ok: true,
      recipient,
      ata,
      amountBaseUnits: FAUCET_AMOUNT_BASE_UNITS.toString(),
      amountUsdc: "10.0",
      signature,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Faucet drip failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 },
    );
  }
}
