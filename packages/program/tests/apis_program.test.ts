// Test suite for apis_program — W1 instructions (register_provider,
// create_job) plus W2's escrow lifecycle (initialize_config, USDC-locking
// create_job, accept_job, submit_completion, confirm_completion,
// cancel_job).
//
// Uses solana-bankrun (in-process validator) — no surfpool, no
// solana-test-validator required. Per AGENTS.md, every instruction has
// a happy-path + at least one malicious-input test.
//
// Coverage:
//   initialize_config  — fee-bps-bound + happy + duplicate-init
//   register_provider  — happy + duplicate-PDA + zero-hash
//   create_job         — happy (locks USDC) + zero-spec_hash
//                        + zero-deadline + zero-price
//   accept_job         — happy (Funded → Started) + double-accept
//                        + wrong-provider
//   submit_completion  — happy (Started → Completed) + zero-proof
//                        + Funded-state-rejected

import { createHash, randomBytes } from "node:crypto";

import anchor from "@anchor-lang/core";
const BN = anchor.BN;

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { makeKeypairs } from "@solana-developers/helpers";
import { BankrunProvider } from "anchor-bankrun";
import { assert, expect } from "chai";
import { type ProgramTestContext, startAnchor } from "solana-bankrun";

import IDL from "../target/idl/apis_program.json" with { type: "json" };
import type { ApisProgram } from "../target/types/apis_program";

const PROGRAM_ID = new PublicKey(IDL.address);

const ZERO_HASH = new Uint8Array(32);
const USDC_DECIMALS = 6;

const sha256 = (s: string): Buffer => createHash("sha256").update(s).digest();

const findConfigPda = (): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];

const findProviderPda = (authority: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("provider"), authority.toBuffer()],
    PROGRAM_ID,
  )[0];

const findJobPda = (buyer: PublicKey, id: anchor.BN): PublicKey =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("job"), buyer.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  )[0];

const fundSol = async (
  bankrunProvider: BankrunProvider,
  to: PublicKey,
  sol = 5,
): Promise<void> => {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: bankrunProvider.publicKey,
      toPubkey: to,
      lamports: sol * LAMPORTS_PER_SOL,
    }),
  );
  await bankrunProvider.sendAndConfirm(tx);
};

const errMsg = (err: unknown): string =>
  err instanceof Error ? `${err.message}` : `${err}`;

describe("apis_program", () => {
  let context: ProgramTestContext;
  let bankrunProvider: BankrunProvider;
  let program: anchor.Program<ApisProgram>;

  // Stand-in USDC mint created in bankrun. Set in `before()`; reused by
  // `initialize_config` (stored as `config.usdc_mint`) and `create_job`
  // (used as the actual mint for the buyer ATA + escrow vault).
  let paymentMint: PublicKey;

  before(async () => {
    context = await startAnchor(
      "",
      [{ name: "apis_program", programId: PROGRAM_ID }],
      [],
    );
    bankrunProvider = new BankrunProvider(context);
    program = new anchor.Program<ApisProgram>(
      IDL as ApisProgram,
      bankrunProvider,
    );

    // Create the test "USDC" mint. The bankrun provider's wallet is
    // the mint authority — we use it to mint balances to test users.
    const [mintKp] = makeKeypairs(1);
    paymentMint = mintKp.publicKey;
    const tx = new Transaction()
      .add(
        SystemProgram.createAccount({
          fromPubkey: bankrunProvider.publicKey,
          newAccountPubkey: paymentMint,
          space: MINT_SIZE,
          lamports: 1_500_000, // ~ rent for an 82-byte mint
          programId: TOKEN_PROGRAM_ID,
        }),
      )
      .add(
        createInitializeMint2Instruction(
          paymentMint,
          USDC_DECIMALS,
          bankrunProvider.publicKey, // mint authority
          null, // no freeze authority
          TOKEN_PROGRAM_ID,
        ),
      );
    await bankrunProvider.sendAndConfirm(tx, [mintKp]);
  });

  /** Create + fund a user's USDC ATA. Returns the ATA address. */
  const fundUsdc = async (
    owner: PublicKey,
    amount: number | bigint,
  ): Promise<PublicKey> => {
    const ata = getAssociatedTokenAddressSync(
      paymentMint,
      owner,
      false,
      TOKEN_PROGRAM_ID,
    );
    const tx = new Transaction()
      .add(
        createAssociatedTokenAccountIdempotentInstruction(
          bankrunProvider.publicKey,
          ata,
          owner,
          paymentMint,
          TOKEN_PROGRAM_ID,
        ),
      )
      .add(
        createMintToInstruction(
          paymentMint,
          ata,
          bankrunProvider.publicKey,
          amount,
          [],
          TOKEN_PROGRAM_ID,
        ),
      );
    await bankrunProvider.sendAndConfirm(tx);
    return ata;
  };

  // ────────────────────────────────────────────────────────────
  // initialize_config — singleton GlobalConfig PDA
  //
  // Test order matters: the malicious "fee_bps > 10_000" case must run
  // BEFORE the happy path. After happy creates the config, the `init`
  // constraint blocks every subsequent attempt with "already in use" —
  // the require!() inside the handler never gets a chance to fire.
  // ────────────────────────────────────────────────────────────

  describe("initialize_config", () => {
    const configPda = findConfigPda();

    it("malicious: fee_bps > 10_000 → ApisError::FeeBpsTooHigh (6005)", async () => {
      // Runs first (see describe-block comment). Config doesn't exist
      // yet — the `init` succeeds, then the handler's require!() trips.
      const [tooGreedy] = makeKeypairs(1);
      await fundSol(bankrunProvider, tooGreedy.publicKey);

      try {
        await program.methods
          .initializeConfig(paymentMint, 10_001)
          .accountsPartial({
            admin: tooGreedy.publicKey,
            config: configPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([tooGreedy])
          .rpc();
        assert.fail("expected FeeBpsTooHigh");
      } catch (err) {
        const m = errMsg(err);
        assert.match(
          m,
          /FeeBpsTooHigh|0x1775|6005/,
          `expected FeeBpsTooHigh, got: ${m}`,
        );
      }
    });

    it("happy path: first caller becomes admin + treasury; W3 fields zeroed", async () => {
      const [admin] = makeKeypairs(1);
      await fundSol(bankrunProvider, admin.publicKey);

      await program.methods
        .initializeConfig(paymentMint, 50) // 0.5%
        .accountsPartial({
          admin: admin.publicKey,
          config: configPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      const cfg = await program.account.globalConfig.fetch(configPda);
      assert.isTrue(cfg.admin.equals(admin.publicKey));
      assert.isTrue(cfg.treasury.equals(admin.publicKey));
      assert.isTrue(cfg.usdcMint.equals(paymentMint));
      assert.equal(cfg.feeBps, 50);
      // W3 fields default to zero in W2.
      assert.equal(cfg.minBondLamports.toNumber(), 0);
      assert.equal(cfg.disputeWindowSecs.toNumber(), 0);
      assert.equal(cfg.slashSplitBps, 0);
      assert.equal(cfg.paused, false);
    });

    it("malicious: re-initializing fails (PDA already in use)", async () => {
      const [imposter] = makeKeypairs(1);
      await fundSol(bankrunProvider, imposter.publicKey);

      try {
        await program.methods
          .initializeConfig(paymentMint, 100)
          .accountsPartial({
            admin: imposter.publicKey,
            config: configPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([imposter])
          .rpc();
        assert.fail("expected re-initialize to fail");
      } catch (err) {
        const m = errMsg(err);
        assert.match(
          m,
          /already in use|0x0|account.*already|custom program error: 0x0/i,
          `expected init/already-in-use error, got: ${m}`,
        );
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // register_provider
  // ────────────────────────────────────────────────────────────

  describe("register_provider", () => {
    it("happy path: creates Provider with TD-canonical W1 defaults", async () => {
      const [alice] = makeKeypairs(1);
      await fundSol(bankrunProvider, alice.publicKey);

      const gpuHash = sha256("RTX 4080 24GB / CUDA 12.4");
      const endpointHash = sha256("wss://alice.example.com:8787");
      const providerPda = findProviderPda(alice.publicKey);

      const beforeTs = Math.floor(Date.now() / 1000);
      await program.methods
        .registerProvider([...gpuHash], [...endpointHash])
        .accountsPartial({
          authority: alice.publicKey,
          provider: providerPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([alice])
        .rpc();

      const acct = await program.account.provider.fetch(providerPda);
      assert.isTrue(
        acct.authority.equals(alice.publicKey),
        "authority should be alice",
      );
      expect([...acct.gpuSpecsHash]).to.deep.equal([...gpuHash]);
      expect([...acct.endpointUriHash]).to.deep.equal([...endpointHash]);
      // W1 invariants: bond_vault zeroed, counters at 0, status Active.
      assert.isTrue(
        acct.bondVault.equals(PublicKey.default),
        "bond_vault should be Pubkey::default() in W1",
      );
      assert.equal(acct.activeJobs.toNumber(), 0);
      assert.equal(acct.totalJobs.toNumber(), 0);
      assert.deepEqual(acct.status, { active: {} });
      assert.isAtLeast(acct.registeredAt.toNumber(), beforeTs);
    });

    it("malicious: re-registering the same authority fails (PDA already in use)", async () => {
      const [bob] = makeKeypairs(1);
      await fundSol(bankrunProvider, bob.publicKey);

      const gpuHash = sha256("RTX 5090");
      const endpointHash = sha256("wss://bob.example.com");
      const bobPda = findProviderPda(bob.publicKey);

      // First registration succeeds.
      await program.methods
        .registerProvider([...gpuHash], [...endpointHash])
        .accountsPartial({
          authority: bob.publicKey,
          provider: bobPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([bob])
        .rpc();

      // Advance the chain so the next tx (identical signer/accounts/args)
      // doesn't tie its signature to the same blockhash as the first
      // call. Without this, Solana's replay-protection rejects the dup
      // as "already processed" before our `init` constraint fires.
      await fundSol(bankrunProvider, bob.publicKey, 0.001);

      // Second must fail — Anchor's `init` constraint prevents re-creating
      // an existing PDA. Surfaces from the system program as
      // "already in use" / 0x0.
      try {
        await program.methods
          .registerProvider([...gpuHash], [...endpointHash])
          .accountsPartial({
            authority: bob.publicKey,
            provider: bobPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([bob])
          .rpc();
        assert.fail("expected re-registration to fail");
      } catch (err) {
        const m = errMsg(err);
        assert.match(
          m,
          /already in use|0x0|account.*already|custom program error: 0x0/i,
          `expected init/already-in-use error, got: ${m}`,
        );
      }
    });

    it("malicious: zero gpu_specs_hash → ApisError::GpuSpecsHashZero (6000)", async () => {
      const [carol] = makeKeypairs(1);
      await fundSol(bankrunProvider, carol.publicKey);
      const carolPda = findProviderPda(carol.publicKey);

      try {
        await program.methods
          .registerProvider([...ZERO_HASH], [...sha256("endpoint")])
          .accountsPartial({
            authority: carol.publicKey,
            provider: carolPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([carol])
          .rpc();
        assert.fail("expected GpuSpecsHashZero");
      } catch (err) {
        const m = errMsg(err);
        assert.match(
          m,
          /GpuSpecsHashZero|0x1770|6000/,
          `expected GpuSpecsHashZero, got: ${m}`,
        );
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // create_job — locks USDC into a per-job EscrowVault (W2-1b)
  // ────────────────────────────────────────────────────────────

  describe("create_job", () => {
    let buyer: anchor.web3.Keypair;
    let providerOwner: anchor.web3.Keypair;
    let providerPda: PublicKey;
    let buyerUsdcAta: PublicKey;
    const configPda = findConfigPda();

    before(async () => {
      [buyer, providerOwner] = makeKeypairs(2);
      await fundSol(bankrunProvider, buyer.publicKey);
      await fundSol(bankrunProvider, providerOwner.publicKey);

      providerPda = findProviderPda(providerOwner.publicKey);
      await program.methods
        .registerProvider(
          [...sha256("RTX 4090")],
          [...sha256("wss://provider-owner.example.com")],
        )
        .accountsPartial({
          authority: providerOwner.publicKey,
          provider: providerPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([providerOwner])
        .rpc();

      // Mint 1000 USDC (1e9 base units at 6 decimals) to the buyer.
      buyerUsdcAta = await fundUsdc(buyer.publicKey, 1_000_000_000);
    });

    const buildAccounts = (jobPda: PublicKey, escrowVault: PublicKey) => ({
      buyer: buyer.publicKey,
      config: configPda,
      provider: providerPda,
      usdcMint: paymentMint,
      buyerUsdcAta,
      job: jobPda,
      escrowVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    });

    it("happy: locks 1 USDC, status=Funded, vault.amount==price", async () => {
      const id = new BN(randomBytes(8));
      const specHash = sha256("prompt + flux-schnell + steps=4 + cfg=0 + seed=42");
      const deadlineOffset = new BN(600);
      const price = new BN(1_000_000); // 1.000000 USDC
      const jobPda = findJobPda(buyer.publicKey, id);
      const escrowVault = getAssociatedTokenAddressSync(
        paymentMint,
        jobPda,
        true, // owner is a PDA → allowOwnerOffCurve
        TOKEN_PROGRAM_ID,
      );

      const beforeTs = Math.floor(Date.now() / 1000);
      await program.methods
        .createJob(id, [...specHash], deadlineOffset, price)
        .accountsPartial(buildAccounts(jobPda, escrowVault))
        .signers([buyer])
        .rpc();

      // Job state.
      const job = await program.account.job.fetch(jobPda);
      assert.equal(job.id.toString(), id.toString());
      assert.isTrue(job.buyer.equals(buyer.publicKey));
      assert.isTrue(job.provider.equals(providerPda));
      assert.equal(job.priceLamportsUsdc.toNumber(), price.toNumber());
      expect([...job.specHash]).to.deep.equal([...specHash]);
      assert.deepEqual(job.status, { funded: {} }); // W2: jumps straight to Funded
      assert.isAtLeast(job.fundedAt.toNumber(), beforeTs);
      assert.equal(job.deadline.toNumber(), job.fundedAt.toNumber() + 600);
      assert.isNull(job.completionProofHash);

      // Vault must hold exactly the locked price.
      const vaultAcct = await getAccount(
        bankrunProvider.connection,
        escrowVault,
        "processed",
        TOKEN_PROGRAM_ID,
      );
      assert.equal(vaultAcct.amount.toString(), price.toString());
      assert.isTrue(vaultAcct.owner.equals(jobPda)); // PDA-owned
    });

    it("malicious: zero spec_hash → ApisError::SpecHashZero (6002)", async () => {
      const id = new BN(randomBytes(8));
      const jobPda = findJobPda(buyer.publicKey, id);
      const escrowVault = getAssociatedTokenAddressSync(
        paymentMint,
        jobPda,
        true,
        TOKEN_PROGRAM_ID,
      );

      try {
        await program.methods
          .createJob(id, [...ZERO_HASH], new BN(600), new BN(1_000_000))
          .accountsPartial(buildAccounts(jobPda, escrowVault))
          .signers([buyer])
          .rpc();
        assert.fail("expected SpecHashZero");
      } catch (err) {
        const m = errMsg(err);
        assert.match(
          m,
          /SpecHashZero|0x1772|6002/,
          `expected SpecHashZero, got: ${m}`,
        );
      }
    });

    it("malicious: deadline_offset_secs = 0 → ApisError::InvalidDeadline (6004)", async () => {
      const id = new BN(randomBytes(8));
      const jobPda = findJobPda(buyer.publicKey, id);
      const escrowVault = getAssociatedTokenAddressSync(
        paymentMint,
        jobPda,
        true,
        TOKEN_PROGRAM_ID,
      );

      try {
        await program.methods
          .createJob(id, [...sha256("spec")], new BN(0), new BN(1_000_000))
          .accountsPartial(buildAccounts(jobPda, escrowVault))
          .signers([buyer])
          .rpc();
        assert.fail("expected InvalidDeadline");
      } catch (err) {
        const m = errMsg(err);
        assert.match(
          m,
          /InvalidDeadline|0x1774|6004/,
          `expected InvalidDeadline, got: ${m}`,
        );
      }
    });

    it("malicious: zero price → ApisError::ZeroPrice", async () => {
      const id = new BN(randomBytes(8));
      const jobPda = findJobPda(buyer.publicKey, id);
      const escrowVault = getAssociatedTokenAddressSync(
        paymentMint,
        jobPda,
        true,
        TOKEN_PROGRAM_ID,
      );

      try {
        await program.methods
          .createJob(id, [...sha256("spec")], new BN(600), new BN(0))
          .accountsPartial(buildAccounts(jobPda, escrowVault))
          .signers([buyer])
          .rpc();
        assert.fail("expected ZeroPrice");
      } catch (err) {
        const m = errMsg(err);
        assert.match(m, /ZeroPrice/, `expected ZeroPrice, got: ${m}`);
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // accept_job — Funded → Started (W2-1c)
  // ────────────────────────────────────────────────────────────

  describe("accept_job", () => {
    let buyer: anchor.web3.Keypair;
    let providerOwner: anchor.web3.Keypair;
    let providerPda: PublicKey;
    let jobId: anchor.BN;
    let jobPda: PublicKey;

    before(async () => {
      [buyer, providerOwner] = makeKeypairs(2);
      await fundSol(bankrunProvider, buyer.publicKey);
      await fundSol(bankrunProvider, providerOwner.publicKey);

      providerPda = findProviderPda(providerOwner.publicKey);
      await program.methods
        .registerProvider(
          [...sha256("RTX 4090 / accept_job test")],
          [...sha256("wss://accept-test.example.com")],
        )
        .accountsPartial({
          authority: providerOwner.publicKey,
          provider: providerPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([providerOwner])
        .rpc();

      const buyerUsdcAta = await fundUsdc(buyer.publicKey, 10_000_000);
      jobId = new BN(randomBytes(8));
      jobPda = findJobPda(buyer.publicKey, jobId);
      const escrowVault = getAssociatedTokenAddressSync(
        paymentMint,
        jobPda,
        true,
        TOKEN_PROGRAM_ID,
      );

      await program.methods
        .createJob(
          jobId,
          [...sha256("accept_job spec")],
          new BN(600),
          new BN(1_000_000),
        )
        .accountsPartial({
          buyer: buyer.publicKey,
          config: findConfigPda(),
          provider: providerPda,
          usdcMint: paymentMint,
          buyerUsdcAta,
          job: jobPda,
          escrowVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();
    });

    it("happy: Funded → Started", async () => {
      await program.methods
        .acceptJob()
        .accountsPartial({
          authority: providerOwner.publicKey,
          provider: providerPda,
          job: jobPda,
        })
        .signers([providerOwner])
        .rpc();

      const job = await program.account.job.fetch(jobPda);
      assert.deepEqual(job.status, { started: {} });
    });

    it("malicious: double-accept (already Started) → JobNotFunded", async () => {
      // The previous test sent an identical tx (same signer, same
      // accounts, same args). Solana's replay protection would reject
      // a second copy as "already processed" before the program even
      // runs. Advance the chain with a throwaway SOL transfer so this
      // tx hashes differently.
      await fundSol(bankrunProvider, providerOwner.publicKey, 0.001);

      try {
        await program.methods
          .acceptJob()
          .accountsPartial({
            authority: providerOwner.publicKey,
            provider: providerPda,
            job: jobPda,
          })
          .signers([providerOwner])
          .rpc();
        assert.fail("expected JobNotFunded");
      } catch (err) {
        const m = errMsg(err);
        assert.match(m, /JobNotFunded/, `expected JobNotFunded, got: ${m}`);
      }
    });

    it("malicious: a different provider can't accept → WrongProvider", async () => {
      // Register a separate provider, then try to accept the job that
      // was assigned to the original provider.
      const [otherOwner] = makeKeypairs(1);
      await fundSol(bankrunProvider, otherOwner.publicKey);
      const otherPda = findProviderPda(otherOwner.publicKey);
      await program.methods
        .registerProvider(
          [...sha256("interloper RTX 4080")],
          [...sha256("wss://interloper.example.com")],
        )
        .accountsPartial({
          authority: otherOwner.publicKey,
          provider: otherPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([otherOwner])
        .rpc();

      // Need a fresh Funded job for the test (the existing one is
      // Started, which would trigger JobNotFunded first).
      const buyerUsdcAta = getAssociatedTokenAddressSync(
        paymentMint,
        buyer.publicKey,
        false,
        TOKEN_PROGRAM_ID,
      );
      const freshId = new BN(randomBytes(8));
      const freshJobPda = findJobPda(buyer.publicKey, freshId);
      const freshVault = getAssociatedTokenAddressSync(
        paymentMint,
        freshJobPda,
        true,
        TOKEN_PROGRAM_ID,
      );
      await program.methods
        .createJob(
          freshId,
          [...sha256("fresh job for wrong-provider test")],
          new BN(600),
          new BN(1_000_000),
        )
        .accountsPartial({
          buyer: buyer.publicKey,
          config: findConfigPda(),
          provider: providerPda, // job targets the ORIGINAL provider
          usdcMint: paymentMint,
          buyerUsdcAta,
          job: freshJobPda,
          escrowVault: freshVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();

      // Other authority tries to accept it.
      try {
        await program.methods
          .acceptJob()
          .accountsPartial({
            authority: otherOwner.publicKey,
            provider: otherPda,
            job: freshJobPda,
          })
          .signers([otherOwner])
          .rpc();
        assert.fail("expected WrongProvider");
      } catch (err) {
        const m = errMsg(err);
        assert.match(m, /WrongProvider/, `expected WrongProvider, got: ${m}`);
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // submit_completion — Started → Completed (W2-1d)
  //
  // Test order matters again: the malicious zero-proof case must run
  // BEFORE the happy case. After happy moves the job to Completed,
  // any further submit attempt fails on the `status == Started`
  // constraint (JobNotStarted) before the require!() proof check fires.
  // ────────────────────────────────────────────────────────────

  describe("submit_completion", () => {
    let buyer: anchor.web3.Keypair;
    let providerOwner: anchor.web3.Keypair;
    let providerPda: PublicKey;
    let jobPdaStarted: PublicKey; // accepted in before(); Started state
    let jobPdaFunded: PublicKey; // created but not accepted; Funded state
    const configPda = findConfigPda();

    before(async () => {
      [buyer, providerOwner] = makeKeypairs(2);
      await fundSol(bankrunProvider, buyer.publicKey);
      await fundSol(bankrunProvider, providerOwner.publicKey);

      providerPda = findProviderPda(providerOwner.publicKey);
      await program.methods
        .registerProvider(
          [...sha256("RTX 4090 / submit_completion test")],
          [...sha256("wss://submit-test.example.com")],
        )
        .accountsPartial({
          authority: providerOwner.publicKey,
          provider: providerPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([providerOwner])
        .rpc();

      const buyerUsdcAta = await fundUsdc(buyer.publicKey, 10_000_000);

      // jobStarted: created + accepted → ends at Started.
      const idStarted = new BN(randomBytes(8));
      jobPdaStarted = findJobPda(buyer.publicKey, idStarted);
      const vaultStarted = getAssociatedTokenAddressSync(
        paymentMint,
        jobPdaStarted,
        true,
        TOKEN_PROGRAM_ID,
      );
      await program.methods
        .createJob(
          idStarted,
          [...sha256("started job for submit_completion")],
          new BN(600),
          new BN(1_000_000),
        )
        .accountsPartial({
          buyer: buyer.publicKey,
          config: configPda,
          provider: providerPda,
          usdcMint: paymentMint,
          buyerUsdcAta,
          job: jobPdaStarted,
          escrowVault: vaultStarted,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();
      await program.methods
        .acceptJob()
        .accountsPartial({
          authority: providerOwner.publicKey,
          provider: providerPda,
          job: jobPdaStarted,
        })
        .signers([providerOwner])
        .rpc();

      // jobFunded: created only → stays Funded.
      const idFunded = new BN(randomBytes(8));
      jobPdaFunded = findJobPda(buyer.publicKey, idFunded);
      const vaultFunded = getAssociatedTokenAddressSync(
        paymentMint,
        jobPdaFunded,
        true,
        TOKEN_PROGRAM_ID,
      );
      await program.methods
        .createJob(
          idFunded,
          [...sha256("funded job for submit_completion")],
          new BN(600),
          new BN(1_000_000),
        )
        .accountsPartial({
          buyer: buyer.publicKey,
          config: configPda,
          provider: providerPda,
          usdcMint: paymentMint,
          buyerUsdcAta,
          job: jobPdaFunded,
          escrowVault: vaultFunded,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();
    });

    it("malicious: zero proof_hash → ApisError::ProofHashZero", async () => {
      try {
        await program.methods
          .submitCompletion([...ZERO_HASH])
          .accountsPartial({
            authority: providerOwner.publicKey,
            provider: providerPda,
            job: jobPdaStarted,
          })
          .signers([providerOwner])
          .rpc();
        assert.fail("expected ProofHashZero");
      } catch (err) {
        const m = errMsg(err);
        assert.match(m, /ProofHashZero/, `expected ProofHashZero, got: ${m}`);
      }
    });

    it("happy: Started → Completed; proof_hash recorded", async () => {
      const proofHash = sha256("inference result tensor hash");

      await program.methods
        .submitCompletion([...proofHash])
        .accountsPartial({
          authority: providerOwner.publicKey,
          provider: providerPda,
          job: jobPdaStarted,
        })
        .signers([providerOwner])
        .rpc();

      const job = await program.account.job.fetch(jobPdaStarted);
      assert.deepEqual(job.status, { completed: {} });
      assert.isNotNull(job.completionProofHash, "proof_hash should be Some");
      expect([...(job.completionProofHash as number[])]).to.deep.equal([
        ...proofHash,
      ]);
    });

    it("malicious: submitting on a Funded job → JobNotStarted", async () => {
      try {
        await program.methods
          .submitCompletion([...sha256("any proof")])
          .accountsPartial({
            authority: providerOwner.publicKey,
            provider: providerPda,
            job: jobPdaFunded,
          })
          .signers([providerOwner])
          .rpc();
        assert.fail("expected JobNotStarted");
      } catch (err) {
        const m = errMsg(err);
        assert.match(m, /JobNotStarted/, `expected JobNotStarted, got: ${m}`);
      }
    });
  });
});
