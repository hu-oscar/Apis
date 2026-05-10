"use client";

// Apis W1 fake-job submit page.
//
// Flow:
//   1. Read wallet from useWalletConnection (already wired in app/components/providers).
//   2. Derive the buyer's Provider PDA. Fetch its account; if missing, show
//      "Register as provider"; otherwise show the job-submit form.
//   3. register_provider — single click, stub gpu/endpoint hashes (W1 demo only).
//   4. create_job — sha256(prompt) → on-chain spec_hash; 600s deadline; price=0.
//   5. After each tx, surface the signature with a Solana Explorer link.
//
// W1 has no USDC escrow — all transactions only pay rent + tx fees from the
// connected Phantom wallet.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  useSendTransaction,
  useSolanaClient,
  useWalletConnection,
  useWalletSession,
} from "@solana/react-hooks";
import { createWalletTransactionSigner } from "@solana/client";
import type { Address, TransactionSigner } from "@solana/kit";

import {
  fetchMaybeProvider,
  findJobPda,
  findProviderPda,
  getCreateJobInstructionAsync,
  getRegisterProviderInstructionAsync,
} from "@/app/lib/apis-program";
import { explorerAccountUrl, explorerTxUrl, randomJobId, sha256 } from "@/app/lib/apis";

type ProviderState =
  | { kind: "loading" }
  | { kind: "no-wallet" }
  | { kind: "missing"; pda: Address }
  | { kind: "registered"; pda: Address };

type FetchResult = { authority: Address; pda: Address; exists: boolean };

const DEMO_GPU_SPECS = "Apis demo provider — RTX 4080 24GB / CUDA 12.4";
const DEMO_ENDPOINT_URI = "wss://demo.local:8787";
const DEFAULT_PROMPT =
  "An astronaut riding a horse on Mars, photorealistic, golden hour";
const DEADLINE_SECS = BigInt(600);

export default function SubmitPage() {
  const { status: walletStatus } = useWalletConnection();
  const session = useWalletSession();
  const client = useSolanaClient();
  const sendTx = useSendTransaction();

  // Stored fetch result tagged with the wallet that produced it; the
  // derived `providerState` below treats a stale tag as "loading" so wallet
  // switches don't briefly render the previous wallet's state.
  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [busy, setBusy] = useState<string | null>(null);
  const [registerSig, setRegisterSig] = useState<string | null>(null);
  const [submittedJob, setSubmittedJob] = useState<
    { jobPda: Address; signature: string } | null
  >(null);
  const [opError, setOpError] = useState<string | null>(null);

  // Wrap the connected WalletSession into a kit-style TransactionSigner.
  // `signer` implements signAndSendTransactions, which is what Codama's
  // *_InstructionAsync builders + useSendTransaction expect.
  const buyerSigner: TransactionSigner | undefined = useMemo(() => {
    if (!session) return undefined;
    return createWalletTransactionSigner(session).signer;
  }, [session]);
  const buyerAddress = session?.account.address;

  // Effect only triggers the async fetch — no synchronous setState (React 19
  // discourages cascading-render setState in effect bodies). The "loading" /
  // "no-wallet" / etc. UI state is derived below via useMemo.
  useEffect(() => {
    if (walletStatus !== "connected" || !buyerAddress) return;
    let cancelled = false;
    (async () => {
      const [pda] = await findProviderPda({ authority: buyerAddress });
      const acct = await fetchMaybeProvider(client.runtime.rpc, pda);
      if (cancelled) return;
      setFetchResult({ authority: buyerAddress, pda, exists: acct.exists });
    })().catch((err) => {
      if (cancelled) return;
      console.error("Provider PDA fetch failed", err);
      setOpError(`Failed to read provider state: ${err}`);
    });
    return () => {
      cancelled = true;
    };
  }, [walletStatus, buyerAddress, client]);

  const providerState = useMemo<ProviderState>(() => {
    if (walletStatus !== "connected" || !buyerAddress) {
      return { kind: "no-wallet" };
    }
    // Stale tag (from a previous wallet) → treat as still loading.
    if (!fetchResult || fetchResult.authority !== buyerAddress) {
      return { kind: "loading" };
    }
    return fetchResult.exists
      ? { kind: "registered", pda: fetchResult.pda }
      : { kind: "missing", pda: fetchResult.pda };
  }, [walletStatus, buyerAddress, fetchResult]);

  const handleRegister = async () => {
    if (!buyerSigner || !buyerAddress) return;
    setBusy("Registering provider…");
    setOpError(null);
    sendTx.reset();
    try {
      const [gpuSpecsHash, endpointUriHash] = await Promise.all([
        sha256(DEMO_GPU_SPECS),
        sha256(DEMO_ENDPOINT_URI),
      ]);
      const ix = await getRegisterProviderInstructionAsync({
        authority: buyerSigner,
        gpuSpecsHash,
        endpointUriHash,
      });
      const signature = await sendTx.send({
        instructions: [ix],
        feePayer: buyerSigner,
      });
      setRegisterSig(signature);
      const [pda] = await findProviderPda({ authority: buyerAddress });
      setFetchResult({ authority: buyerAddress, pda, exists: true });
    } catch (err) {
      setOpError(`register_provider failed: ${err}`);
    } finally {
      setBusy(null);
    }
  };

  const handleSubmitJob = async () => {
    if (
      !buyerSigner ||
      !buyerAddress ||
      providerState.kind !== "registered"
    ) {
      return;
    }
    setBusy("Submitting job…");
    setOpError(null);
    sendTx.reset();
    try {
      const id = randomJobId();
      const specHash = await sha256(prompt);
      const [jobPda] = await findJobPda({ buyer: buyerAddress, id });
      const ix = await getCreateJobInstructionAsync({
        buyer: buyerSigner,
        provider: providerState.pda,
        id,
        specHash,
        deadlineOffsetSecs: DEADLINE_SECS,
      });
      const signature = await sendTx.send({
        instructions: [ix],
        feePayer: buyerSigner,
      });
      setSubmittedJob({ jobPda, signature });
    } catch (err) {
      setOpError(`create_job failed: ${err}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#000] text-[#FAFAF9]">
      <HexGridBackground />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-16">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#9945FF]">
            Apis · W1 demo
          </p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Submit a fake job to{" "}
            <span className="text-[#14F195]">apis_program</span> on devnet
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-white/60">
            Connect Phantom (devnet), self-register as a provider, then submit
            an inference job. No USDC moves yet — W1 is wiring only. Real
            escrow lands in W2.
          </p>
        </header>

        <WalletStatusBanner walletStatus={walletStatus} address={buyerAddress} />

        <AnimatePresence mode="wait">
          {providerState.kind === "loading" && walletStatus === "connected" && (
            <Card key="loading">
              <p className="text-sm text-white/70">
                Reading provider state from devnet…
              </p>
            </Card>
          )}

          {providerState.kind === "missing" && (
            <Card key="missing">
              <SectionTitle>Step 1 / 2 · Register as provider</SectionTitle>
              <p className="text-sm text-white/70">
                Your wallet has no <code>Provider</code> PDA yet. We&apos;ll
                register one with stub GPU specs (
                <code>{DEMO_GPU_SPECS}</code>) so you can target it from the job
                form below. Pays rent only.
              </p>
              <PdaRow label="Provider PDA" address={providerState.pda} />
              <NeonButton
                onClick={handleRegister}
                disabled={!!busy || sendTx.isSending}
                primary
              >
                {busy ?? "Register as provider"}
              </NeonButton>
              {registerSig && (
                <TxResult
                  label="Registration tx"
                  signature={registerSig}
                />
              )}
            </Card>
          )}

          {providerState.kind === "registered" && (
            <Card key="registered">
              <SectionTitle>Step 2 / 2 · Submit a fake job</SectionTitle>
              <p className="text-sm text-white/70">
                Your <code>Provider</code> PDA exists on devnet. Submit an
                inference job — the prompt is hashed off-chain into{" "}
                <code>spec_hash</code>; W1 stores no buyer prompts on-chain.
              </p>
              <PdaRow
                label="Provider PDA (target)"
                address={providerState.pda}
              />

              <label className="flex flex-col gap-2 text-sm">
                <span className="text-xs uppercase tracking-wider text-white/50">
                  Prompt (max 256 chars)
                </span>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value.slice(0, 256))}
                  maxLength={256}
                  rows={4}
                  className="w-full rounded-lg border border-[#14F195]/20 bg-black/60 p-3 font-mono text-sm text-white placeholder-white/40 outline-none ring-0 transition focus:border-[#14F195]/60 focus:shadow-[0_0_20px_-2px_rgba(20,241,149,0.4)]"
                  placeholder={DEFAULT_PROMPT}
                />
                <span className="text-right font-mono text-xs text-white/40">
                  {prompt.length}/256
                </span>
              </label>

              <NeonButton
                onClick={handleSubmitJob}
                disabled={!!busy || sendTx.isSending || prompt.trim().length === 0}
                primary
              >
                {busy ?? "Submit fake job"}
              </NeonButton>

              {submittedJob && (
                <div className="space-y-3 rounded-lg border border-[#14F195]/30 bg-[#14F195]/[0.04] p-4">
                  <p className="font-mono text-xs uppercase tracking-wider text-[#14F195]">
                    ✓ Job created
                  </p>
                  <PdaRow label="Job PDA" address={submittedJob.jobPda} />
                  <TxResult
                    label="create_job tx"
                    signature={submittedJob.signature}
                  />
                </div>
              )}
            </Card>
          )}
        </AnimatePresence>

        {opError && (
          <Card>
            <p className="font-mono text-xs uppercase tracking-wider text-[#FF3B5C]">
              Error
            </p>
            <pre className="overflow-auto rounded bg-black/60 p-3 text-xs text-white/70">
              {opError}
            </pre>
          </Card>
        )}
      </div>
    </main>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function WalletStatusBanner({
  walletStatus,
  address,
}: {
  walletStatus: string;
  address: Address | undefined;
}) {
  if (walletStatus !== "connected" || !address) {
    return (
      <Card>
        <p className="text-sm text-white/70">
          Wallet not connected. Open the{" "}
          <Link href="/" className="text-[#14F195] underline underline-offset-2">
            home page
          </Link>{" "}
          to connect Phantom (set to devnet) before submitting.
        </p>
      </Card>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 font-mono text-xs">
      <span className="rounded-full bg-[#14F195]/15 px-3 py-1 uppercase tracking-wider text-[#14F195]">
        Connected
      </span>
      <code className="break-all text-white/70">{address}</code>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="space-y-4 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.03] to-white/[0.01] p-6 shadow-[0_30px_120px_-60px_rgba(20,241,149,0.25)]"
    >
      {children}
    </motion.section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
  );
}

function NeonButton({
  onClick,
  disabled,
  primary,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      whileHover={disabled ? {} : { scale: 1.02 }}
      whileTap={disabled ? {} : { scale: 0.98 }}
      onClick={onClick}
      disabled={disabled}
      className={
        primary
          ? "inline-flex items-center justify-center rounded-lg bg-[#14F195] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider text-black shadow-[0_0_30px_-5px_rgba(20,241,149,0.6)] transition disabled:cursor-not-allowed disabled:bg-[#14F195]/30 disabled:shadow-none"
          : "inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/[0.02] px-5 py-2.5 font-mono text-sm uppercase tracking-wider text-white/80 transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-40"
      }
    >
      {children}
    </motion.button>
  );
}

function PdaRow({ label, address }: { label: string; address: Address }) {
  return (
    <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
      <span className="text-white/50">{label}</span>
      <a
        href={explorerAccountUrl(address)}
        target="_blank"
        rel="noreferrer"
        className="break-all rounded bg-black/60 px-2 py-1 text-white/80 underline-offset-2 hover:text-[#14F195] hover:underline"
      >
        {address}
      </a>
    </div>
  );
}

function TxResult({ label, signature }: { label: string; signature: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
      <span className="text-white/50">{label}</span>
      <a
        href={explorerTxUrl(signature)}
        target="_blank"
        rel="noreferrer"
        className="break-all rounded bg-black/60 px-2 py-1 text-[#14F195] underline-offset-2 hover:underline"
      >
        {signature.slice(0, 12)}…{signature.slice(-12)} ↗
      </a>
    </div>
  );
}

function HexGridBackground() {
  return useMemo(
    () => (
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.04] mix-blend-screen"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="hex"
            width="56"
            height="48.5"
            patternUnits="userSpaceOnUse"
            patternTransform="scale(0.9)"
          >
            <path
              d="M28 0 L56 16.17 L56 32.33 L28 48.5 L0 32.33 L0 16.17 Z"
              fill="none"
              stroke="#14F195"
              strokeWidth="0.6"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hex)" />
      </svg>
    ),
    [],
  );
}
