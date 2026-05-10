// Test suite for apis_program — W1 instructions (register_provider,
// create_job) plus W2's initialize_config (rest of the W2 escrow
// lifecycle lands as further describe() blocks in subsequent commits).
//
// Uses solana-bankrun (in-process validator) — no surfpool, no
// solana-test-validator required. Per AGENTS.md, every instruction has
// a happy-path + at least one malicious-input test.
//
// Coverage:
//   initialize_config — fee-bps-bound + happy + duplicate-init
//   register_provider — happy + duplicate-PDA + zero-hash
//   create_job        — happy + zero-spec_hash + zero-deadline

import { createHash, randomBytes } from "node:crypto";

import anchor from "@anchor-lang/core";
const BN = anchor.BN;

import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { makeKeypairs } from "@solana-developers/helpers";
import { BankrunProvider } from "anchor-bankrun";
import { assert, expect } from "chai";
import { type ProgramTestContext, startAnchor } from "solana-bankrun";

import IDL from "../target/idl/apis_program.json" with { type: "json" };
import type { ApisProgram } from "../target/types/apis_program";

const PROGRAM_ID = new PublicKey(IDL.address);

const ZERO_HASH = new Uint8Array(32);

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
  });

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
    // Synthetic mint pubkey — only used as a stored Pubkey value, no
    // actual mint account needs to exist for initialize_config.
    const [fakeUsdcMintKp] = makeKeypairs(1);
    const fakeUsdcMint = fakeUsdcMintKp.publicKey;

    it("malicious: fee_bps > 10_000 → ApisError::FeeBpsTooHigh (6005)", async () => {
      // Runs first (see describe-block comment). Config doesn't exist
      // yet — the `init` succeeds, then the handler's require!() trips.
      const [tooGreedy] = makeKeypairs(1);
      await fundSol(bankrunProvider, tooGreedy.publicKey);

      try {
        await program.methods
          .initializeConfig(fakeUsdcMint, 10_001)
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
        .initializeConfig(fakeUsdcMint, 50) // 0.5%
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
      assert.isTrue(cfg.usdcMint.equals(fakeUsdcMint));
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
          .initializeConfig(fakeUsdcMint, 100)
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
  // create_job
  // ────────────────────────────────────────────────────────────

  describe("create_job", () => {
    let buyer: anchor.web3.Keypair;
    let providerOwner: anchor.web3.Keypair;
    let providerPda: PublicKey;

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
    });

    it("happy path: creates Job in Created state with W1 defaults", async () => {
      const id = new BN(randomBytes(8));
      const specHash = sha256("prompt + flux-schnell + steps=4 + cfg=0 + seed=42");
      const deadlineOffset = new BN(600); // 10 minutes
      const jobPda = findJobPda(buyer.publicKey, id);

      const beforeTs = Math.floor(Date.now() / 1000);
      await program.methods
        .createJob(id, [...specHash], deadlineOffset)
        .accountsPartial({
          buyer: buyer.publicKey,
          provider: providerPda,
          job: jobPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();

      const acct = await program.account.job.fetch(jobPda);
      assert.equal(acct.id.toString(), id.toString());
      assert.isTrue(acct.buyer.equals(buyer.publicKey));
      assert.isTrue(acct.provider.equals(providerPda));
      assert.equal(acct.priceLamportsUsdc.toNumber(), 0);
      expect([...acct.specHash]).to.deep.equal([...specHash]);
      assert.deepEqual(acct.status, { created: {} });
      assert.isAtLeast(acct.fundedAt.toNumber(), beforeTs);
      assert.equal(
        acct.deadline.toNumber(),
        acct.fundedAt.toNumber() + 600,
        "deadline should equal funded_at + offset",
      );
      // Option<[u8; 32]> serialises as null when None.
      assert.isNull(acct.completionProofHash);
    });

    it("malicious: zero spec_hash → ApisError::SpecHashZero (6002)", async () => {
      const id = new BN(randomBytes(8));
      const jobPda = findJobPda(buyer.publicKey, id);

      try {
        await program.methods
          .createJob(id, [...ZERO_HASH], new BN(600))
          .accountsPartial({
            buyer: buyer.publicKey,
            provider: providerPda,
            job: jobPda,
            systemProgram: SystemProgram.programId,
          })
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

      try {
        await program.methods
          .createJob(id, [...sha256("spec")], new BN(0))
          .accountsPartial({
            buyer: buyer.publicKey,
            provider: providerPda,
            job: jobPda,
            systemProgram: SystemProgram.programId,
          })
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
  });
});
