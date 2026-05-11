"use client";

// Apis W2 buyer result page.
//
// Polls /api/jobs/{pda} every 3s until Job.status reaches a terminal
// state. Renders status-driven UI:
//   Funded     → "Waiting for worker to accept…"
//   Started    → "Generating image…" (worker is running mflux now)
//   Completed  → IPFS image + "Confirm & release USDC" button
//   Refunded   → red banner (cancel_job ran)
//   Slashed    → red banner (worker missed deadline)
//   settled    → "Settlement complete" (Job account closed by confirm_completion)
//
// Confirm button calls confirm_completion via Codama; on success the Job
// + EscrowVault accounts close and the worker / treasury get paid.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  useSendTransaction,
  useWalletConnection,
  useWalletSession,
} from "@solana/react-hooks";
import { createWalletTransactionSigner } from "@solana/client";
import type { Address, TransactionSigner } from "@solana/kit";

import {
  getCancelJobInstructionAsync,
  getConfirmCompletionInstructionAsync,
} from "@/app/lib/apis-program";
import { HexSwarm } from "@/app/components/ui/hex-swarm";
import { explorerAccountUrl, explorerTxUrl } from "@/app/lib/apis";
import {
  PINATA_GATEWAY,
  TREASURY,
  USDC_MINT,
  formatUsdc,
} from "@/app/lib/constants";

type ApiResp = {
  pda: string;
  onChain: {
    id: string;
    buyer: Address;
    provider: Address;
    /** Provider.authority — needed as the SPL ATA owner for the payout
     *  during confirm_completion. Server resolves this from the
     *  on-chain Provider account so the page doesn't need to. */
    providerAuthority: Address | null;
    priceLamportsUsdc: string;
    specHashHex: string;
    status: number;
    statusName: string;
    fundedAt: number;
    deadline: number;
    completionProofHashHex: string | null;
  } | null;
  result: {
    cid: string;
    proof_hash_hex: string;
    completed_at: number;
  } | null;
  settled: boolean;
};

// Faster than before (was 3s) so the buyer sees "Funded → Started"
// snap quickly when the worker picks up. We're under the public
// devnet RPC's rate limit at 1.5s per page, and Vercel's serverless
// function billing only kicks in past ~600 invocations / min — well
// outside hackathon load.
const POLL_MS = 1500;

// JobStatus enum values (must match programs/apis_program/src/state.rs).
const STATUS = {
  Created: 0,
  Funded: 1,
  Started: 2,
  Completed: 3,
  Disputed: 4,
  Refunded: 5,
  Slashed: 6,
} as const;

export default function JobPage() {
  const params = useParams<{ id: string }>();
  const jobPda = params.id as Address;

  const { status: walletStatus } = useWalletConnection();
  const session = useWalletSession();
  const sendTx = useSendTransaction();

  const buyerSigner: TransactionSigner | undefined = useMemo(() => {
    if (!session) return undefined;
    return createWalletTransactionSigner(session).signer;
  }, [session]);

  const [data, setData] = useState<ApiResp | null>(null);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [confirmSig, setConfirmSig] = useState<string | null>(null);
  const [cancelSig, setCancelSig] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  // Stable fetcher: hits the API and updates state. Defined outside
  // useEffect so handleConfirm can re-fetch immediately after the
  // confirm tx lands.
  const fetchOnce = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch(`/api/jobs/${jobPda}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as ApiResp;
      setData(body);
      setFetchErr(null);
    } catch (err) {
      setFetchErr(err instanceof Error ? err.message : String(err));
    }
  }, [jobPda]);

  // Initial fetch + polling. Stops once a terminal state is reached.
  // The setState calls happen inside the async fetchOnce continuation
  // (Promise resolution) — never synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      await fetchOnce();
      if (cancelled) return;
      timer = setInterval(() => {
        if (
          data?.settled ||
          data?.onChain?.status === STATUS.Refunded ||
          data?.onChain?.status === STATUS.Slashed
        ) {
          return;
        }
        void fetchOnce();
      }, POLL_MS);
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [fetchOnce, data?.settled, data?.onChain?.status]);

  /**
   * Cancel a Funded (pre-accept) job and refund the buyer's USDC.
   * cancel_job only succeeds before the worker has called accept_job —
   * the on-chain instruction guards on Job.status == Funded. The Job
   * and EscrowVault accounts get closed (rent refunded to the buyer)
   * the same way confirm_completion does at the happy-path end.
   */
  const handleCancel = async () => {
    if (!buyerSigner || !data?.onChain) return;
    if (data.onChain.status !== STATUS.Funded) {
      setOpError(
        "Job can only be cancelled before the worker accepts (Funded state).",
      );
      return;
    }
    setBusy("Cancelling…");
    setOpError(null);
    sendTx.reset();
    try {
      const ix = await getCancelJobInstructionAsync({
        buyer: buyerSigner,
        job: jobPda,
        usdcMint: USDC_MINT,
      });
      const sig = await sendTx.send({
        instructions: [ix],
        feePayer: buyerSigner,
      });
      setCancelSig(sig);
      // Re-fetch immediately — the next poll would catch it too but
      // this keeps the UI snappy.
      fetchOnce();
    } catch (err) {
      setOpError(
        `cancel_job failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      setBusy(null);
    }
  };

  const handleConfirm = async () => {
    if (!buyerSigner || !data?.onChain) return;
    if (!data.onChain.providerAuthority) {
      setOpError(
        "Provider account couldn't be resolved on-chain. Refresh and try again.",
      );
      return;
    }
    setBusy("Confirming…");
    setOpError(null);
    sendTx.reset();
    try {
      const ix = await getConfirmCompletionInstructionAsync({
        buyer: buyerSigner,
        job: jobPda,
        // Dynamic — read from the on-chain Job (and its Provider) so
        // confirm_completion works for any provider, not just the
        // hardcoded reference worker.
        provider: data.onChain.provider,
        providerAuthority: data.onChain.providerAuthority,
        treasury: TREASURY,
        usdcMint: USDC_MINT,
      });
      const sig = await sendTx.send({
        instructions: [ix],
        feePayer: buyerSigner,
      });
      setConfirmSig(sig);
      // Re-fetch immediately so UI flips to "settled".
      fetchOnce();
    } catch (err) {
      setOpError(`confirm_completion failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#000] text-[#FAFAF9]">
      <HexGridBackground />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#9945FF]">
            Apis · job
          </p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Job <span className="text-[#14F195]">{jobPda.slice(0, 8)}…</span>
          </h1>
          <Link
            href={`/submit`}
            className="font-mono text-xs text-white/50 underline-offset-2 hover:text-[#14F195] hover:underline"
          >
            ← submit another job
          </Link>
        </header>

        {fetchErr && !data && (
          <Card>
            <p className="font-mono text-xs uppercase tracking-wider text-[#FF3B5C]">
              Could not load
            </p>
            <pre className="overflow-auto rounded bg-black/60 p-3 text-xs text-white/70">
              {fetchErr}
            </pre>
          </Card>
        )}

        {data && (
          <>
            <JobMeta data={data} jobPda={jobPda} />
            <AnimatePresence mode="wait">
              <PipelineState
                key={data.settled ? "settled" : data.onChain?.status ?? "loading"}
                data={data}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                canOperate={
                  walletStatus === "connected" &&
                  !!buyerSigner &&
                  !busy &&
                  !sendTx.isSending
                }
                busyLabel={busy}
                confirmSig={confirmSig}
                cancelSig={cancelSig}
              />
            </AnimatePresence>
          </>
        )}

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

function JobMeta({ data, jobPda }: { data: ApiResp; jobPda: Address }) {
  return (
    <Card>
      <SectionTitle>On-chain state</SectionTitle>
      <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
        <Row label="Job PDA" value={jobPda} link={explorerAccountUrl(jobPda)} />
        {data.onChain && (
          <>
            <Row
              label="Status"
              value={`${data.onChain.statusName} (${data.onChain.status})`}
            />
            <Row
              label="Price"
              value={`${formatUsdc(BigInt(data.onChain.priceLamportsUsdc))} USDC`}
            />
            <Row
              label="Buyer"
              value={data.onChain.buyer}
              link={explorerAccountUrl(data.onChain.buyer)}
            />
            <Row
              label="Provider"
              value={data.onChain.provider}
              link={explorerAccountUrl(data.onChain.provider)}
            />
            <Row
              label="Funded at"
              value={new Date(data.onChain.fundedAt * 1000).toLocaleString()}
            />
            <Row
              label="Deadline"
              value={new Date(data.onChain.deadline * 1000).toLocaleString()}
            />
          </>
        )}
        {data.settled && (
          <Row
            label="Settled"
            value="Job + EscrowVault closed (rent refunded)"
          />
        )}
      </div>
    </Card>
  );
}

function PipelineState({
  data,
  onConfirm,
  onCancel,
  canOperate,
  busyLabel,
  confirmSig,
  cancelSig,
}: {
  data: ApiResp;
  onConfirm: () => void;
  onCancel: () => void;
  canOperate: boolean;
  busyLabel: string | null;
  confirmSig: string | null;
  cancelSig: string | null;
}) {
  if (data.settled) {
    const cancelled = cancelSig !== null;
    return (
      <Card>
        <SectionTitle>
          {cancelled ? "Job cancelled" : "Settlement complete"}
        </SectionTitle>
        <p className="text-sm text-white/70">
          {cancelled
            ? "USDC refunded to your wallet. The Job and EscrowVault accounts were closed (rent refunded too)."
            : "Worker + treasury paid out. The Job and EscrowVault accounts have been closed; rent was refunded to the buyer."}
        </p>
        {!cancelled && data.result && <ResultImage cid={data.result.cid} />}
        {confirmSig && (
          <TxResult label="confirm_completion tx" signature={confirmSig} />
        )}
        {cancelSig && (
          <TxResult label="cancel_job tx" signature={cancelSig} />
        )}
      </Card>
    );
  }

  const status = data.onChain?.status ?? -1;
  const deadline = data.onChain?.deadline ?? null;

  if (status === STATUS.Funded) {
    return (
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <SectionTitle>Waiting for worker to accept…</SectionTitle>
          {deadline !== null && <DeadlineCountdown deadline={deadline} />}
        </div>
        <HexSwarm />
        <p className="text-sm text-white/60">
          USDC is locked in the escrow vault. The registered worker should
          accept this job within a few seconds. If you change your mind
          before they do, you can cancel for a full refund — worker hasn't
          earned anything yet.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <NeonButton
            onClick={onCancel}
            disabled={!canOperate}
            variant="danger"
          >
            {busyLabel === "Cancelling…" ? busyLabel : "Cancel & refund"}
          </NeonButton>
          {cancelSig && (
            <TxResult label="cancel_job tx" signature={cancelSig} />
          )}
        </div>
      </Card>
    );
  }

  if (status === STATUS.Started) {
    return (
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <SectionTitle>Generating image…</SectionTitle>
          {deadline !== null && <DeadlineCountdown deadline={deadline} />}
        </div>
        <HexSwarm />
        <p className="text-sm text-white/60">
          Worker is running Flux Schnell on Apple Silicon. First-run JIT
          compilation can take a few minutes; warm runs land in ~50s.
          Once they accept_job, only the auto-release path can refund
          you — the cancel button is no longer safe.
        </p>
      </Card>
    );
  }

  if (status === STATUS.Completed) {
    return (
      <Card>
        <SectionTitle>Inference complete — confirm to settle</SectionTitle>
        <p className="text-sm text-white/70">
          Worker uploaded the result to IPFS and posted{" "}
          <code>completion_proof_hash</code> on-chain. Confirming releases
          the escrow to the worker (minus a small protocol fee).
        </p>
        {data.result ? (
          <ResultImage cid={data.result.cid} />
        ) : (
          <p className="font-mono text-xs text-white/40">
            (No local result file yet — worker may be on a different box.)
          </p>
        )}
        <NeonButton
          onClick={onConfirm}
          disabled={!canOperate}
          variant="primary"
        >
          {busyLabel === "Confirming…" ? busyLabel : "Confirm & release USDC"}
        </NeonButton>
        {confirmSig && (
          <TxResult label="confirm_completion tx" signature={confirmSig} />
        )}
      </Card>
    );
  }

  if (status === STATUS.Refunded) {
    return (
      <Card>
        <SectionTitle>Job refunded</SectionTitle>
        <p className="text-sm text-[#FF3B5C]">
          This job was cancelled before the worker accepted it. USDC was
          refunded to your wallet; Job + EscrowVault accounts closed.
        </p>
        {cancelSig && (
          <TxResult label="cancel_job tx" signature={cancelSig} />
        )}
      </Card>
    );
  }

  if (status === STATUS.Slashed) {
    return (
      <Card>
        <SectionTitle>Job slashed</SectionTitle>
        <p className="text-sm text-[#FF3B5C]">
          Worker missed the deadline. Their bond was slashed and your USDC
          was refunded automatically — nothing more for you to do.
        </p>
      </Card>
    );
  }

  if (status === STATUS.Disputed) {
    return (
      <Card>
        <SectionTitle>Job disputed</SectionTitle>
        <p className="text-sm text-[#FF3B5C]">
          A dispute was raised on this job. Both buyer and worker funds
          are locked until the dispute resolves. Dispute resolution UI
          lands in Sprint 4 of the verification layer.
        </p>
      </Card>
    );
  }

  if (status === STATUS.Created) {
    // Rare — create_job locks USDC and transitions directly to Funded.
    // If we see Created in the wild, it's a race between the tx
    // confirmation and our poll. Show a soft "settling" state.
    return (
      <Card>
        <SectionTitle>Job submitted, locking escrow…</SectionTitle>
        <HexSwarm />
        <p className="text-sm text-white/60">
          The <code>create_job</code> tx is confirming. As soon as it
          lands, USDC moves into the escrow vault and the worker can
          accept.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle>Loading…</SectionTitle>
      <HexSwarm />
    </Card>
  );
}

// ── Deadline countdown (Sprint 3.3) ─────────────────────────────────
//
// Ticks every second so the user can see exactly how much time the
// worker has left to accept / complete before the on-chain auto-release
// path could refund them. Three visual states:
//   - >60s left   → muted white, just "expires in Xm Ys"
//   - <60s left   → amber, drawing attention to the imminent timeout
//   - past deadline → red "expired Xm ago"
//
// Pure with respect to the `deadline` prop; only `now` is driven by
// the interval — keeps re-renders cheap.
function DeadlineCountdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = deadline * 1000 - now;
  if (remainingMs <= 0) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-wider text-[#FF3B5C]">
        expired {formatShortDuration(-remainingMs)} ago
      </span>
    );
  }
  const warn = remainingMs < 60_000;
  return (
    <span
      className={
        warn
          ? "font-mono text-[10px] uppercase tracking-wider text-[#FBBF24]"
          : "font-mono text-[10px] uppercase tracking-wider text-white/55"
      }
    >
      expires in {formatShortDuration(remainingMs)}
    </span>
  );
}

function formatShortDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function ResultImage({ cid }: { cid: string }) {
  const url = `${PINATA_GATEWAY}/${cid}`;
  return (
    <div className="space-y-2">
      <a href={url} target="_blank" rel="noreferrer" className="block">
        {/* Plain <img> — the CID is dynamic devnet content; Next/Image
            would need remotePatterns for every Pinata gateway we serve. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Generated by Apis worker"
          className="w-full rounded-lg border border-[#14F195]/30 shadow-[0_30px_120px_-40px_rgba(20,241,149,0.45)]"
        />
      </a>
      <p className="font-mono text-xs text-white/40">
        IPFS CID:{" "}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-white/60 underline-offset-2 hover:text-[#14F195] hover:underline"
        >
          {cid}
        </a>
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  link,
}: {
  label: string;
  value: string;
  link?: string;
}) {
  return (
    <div className="flex items-baseline gap-2 font-mono">
      <span className="text-white/40">{label}</span>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="break-all text-white/80 underline-offset-2 hover:text-[#14F195] hover:underline"
        >
          {value}
        </a>
      ) : (
        <span className="break-all text-white/80">{value}</span>
      )}
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
  return <h2 className="text-lg font-semibold tracking-tight">{children}</h2>;
}

function NeonButton({
  onClick,
  disabled,
  variant,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  /** "primary" = green CTA (Confirm). "danger" = red outline (Cancel).
   *  Omitted = neutral white outline (currently unused but kept for
   *  future buttons). */
  variant?: "primary" | "danger";
  children: React.ReactNode;
}) {
  const cls =
    variant === "primary"
      ? "inline-flex items-center justify-center rounded-lg bg-[#14F195] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider text-black shadow-[0_0_30px_-5px_rgba(20,241,149,0.6)] transition disabled:cursor-not-allowed disabled:bg-[#14F195]/30 disabled:shadow-none"
      : variant === "danger"
        ? "inline-flex items-center justify-center rounded-lg border border-[#FF3B5C]/40 bg-[#FF3B5C]/[0.05] px-5 py-2.5 font-mono text-sm uppercase tracking-wider text-[#FF3B5C] transition hover:border-[#FF3B5C]/70 hover:bg-[#FF3B5C]/[0.1] disabled:cursor-not-allowed disabled:opacity-40"
        : "inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/[0.02] px-5 py-2.5 font-mono text-sm uppercase tracking-wider text-white/80 transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <motion.button
      whileHover={disabled ? {} : { scale: 1.02 }}
      whileTap={disabled ? {} : { scale: 0.98 }}
      onClick={onClick}
      disabled={disabled}
      className={cls}
    >
      {children}
    </motion.button>
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
