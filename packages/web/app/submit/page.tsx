"use client";

// Apis buyer submit page.
//
// Flow:
//   1. Read wallet from useWalletConnection.
//   2. Read selected provider from `?provider=<pda>` URL param (set by
//      a click on /network or /provider/[pda]). Fetch the Provider PDA
//      on-chain to confirm it exists.
//   3. Derive the buyer's USDC ATA against the test mint and read the
//      balance — gate "Submit" on having ≥ price USDC.
//   4. POST the spec to /api/spec so the worker can read the prompt
//      once JobCreated fires.
//   5. Build + sign create_job targeting the selected provider; redirect
//      to /job/[jobPda].
//
// The matched worker picks up JobCreated events filtered to its own
// Provider PDA, accepts the job, runs the workload, uploads to IPFS,
// and submits completion. The /job/[id] page polls until done.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  useSendTransaction,
  useSolanaClient,
  useWalletConnection,
  useWalletSession,
} from "@solana/react-hooks";
import { createWalletTransactionSigner } from "@solana/client";
import { ArrowRight } from "lucide-react";
import type { Address, TransactionSigner } from "@solana/kit";

import {
  fetchMaybeProvider,
  findJobPda,
  getCreateJobInstructionAsync,
} from "@/app/lib/apis-program";
import { ProviderStatus } from "@/app/lib/generated/apis-program/src/generated/types/providerStatus";
import {
  explorerAccountUrl,
  findAssociatedTokenAddress,
  randomJobId,
  sha256,
  tryReadTokenBalance,
} from "@/app/lib/apis";
import {
  DEFAULT_DEADLINE_SECS,
  USDC_DECIMALS,
  USDC_MINT,
  formatUsdc,
} from "@/app/lib/constants";
import {
  loadHistory,
  recordJob,
  type JobHistoryEntry,
} from "@/app/lib/job-history";

// W2 spec passed to the worker via the file-based side-channel. Keys must
// match what apis_worker/inference.py expects.
type Spec = {
  prompt: string;
  model: "flux-schnell";
  steps: number;
  width: number;
  height: number;
  seed: number;
};

const DEFAULT_PROMPT =
  "An astronaut riding a horse on Mars, photorealistic, golden hour";

// Canonical-JSON encode (sorted keys, no whitespace) so the worker hashes
// the same bytes we did. Mirrors json.dumps(sort_keys=True, separators=…)
// in apis_worker/spec_channel.py + scripts/test_create_job.py.
function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return JSON.stringify(obj);
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(",")}}`;
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
}

// Shape of the provider we resolved from the URL param.
type ProviderInfo = {
  pda: Address;
  authority: Address;
  status: ProviderStatus;
  activeJobs: number;
  totalJobs: number;
};

type ProviderState =
  | { kind: "none" }
  | { kind: "loading"; pda: Address }
  | { kind: "ok"; info: ProviderInfo }
  | { kind: "missing"; pda: Address }
  | { kind: "error"; pda: Address; message: string };

// useSearchParams needs a Suspense boundary for static prerender. The
// inner component holds all the logic; the default export wraps it.
export default function SubmitPage() {
  return (
    <Suspense
      fallback={
        <main className="relative min-h-screen overflow-x-clip bg-[#000] text-[#FAFAF9]">
          <div className="relative z-10 mx-auto flex min-h-screen max-w-3xl items-center justify-center px-6 py-16">
            <p className="font-mono text-xs uppercase tracking-wider text-white/40">
              Loading…
            </p>
          </div>
        </main>
      }
    >
      <SubmitPageInner />
    </Suspense>
  );
}

function SubmitPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const providerParam = searchParams.get("provider");
  const { status: walletStatus } = useWalletConnection();
  const session = useWalletSession();
  const client = useSolanaClient();
  const sendTx = useSendTransaction();

  // Form state.
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [steps, setSteps] = useState(4);
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [seed, setSeed] = useState(42);
  // Price as user-entered USDC string ("1.0"); converted to base units on submit.
  const [priceUsdc, setPriceUsdc] = useState("1.0");

  // Async/derived state.
  const [busy, setBusy] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  // Tagged with the buyer it was fetched for; if the wallet swaps, the
  // tag-mismatch makes the derived `balance` go back to "loading" — no
  // synchronous setState in the effect (React 19 strict pattern).
  const [balanceFetch, setBalanceFetch] = useState<{
    forBuyer: Address;
    amount: bigint;
  } | null>(null);
  // Same tagging trick for the localStorage-backed job history so
  // switching wallets doesn't briefly show the previous wallet's jobs.
  const [historyFetch, setHistoryFetch] = useState<{
    forBuyer: Address;
    entries: JobHistoryEntry[];
  } | null>(null);

  // Provider lookup from URL param. Tagged with the param it was fetched
  // for so a URL change doesn't briefly show stale data.
  const [providerFetch, setProviderFetch] = useState<{
    forParam: string;
    state: ProviderState;
  } | null>(null);

  // Fetch the Provider account whenever the URL param changes. If the
  // param is absent we leave any prior fetch in place (the derived
  // `providerState` below filters it out by tag-mismatch) so the
  // effect body has no synchronous setState — React 19 strict pattern.
  useEffect(() => {
    if (!providerParam) return;
    let cancelled = false;
    void (async () => {
      setProviderFetch({
        forParam: providerParam,
        state: { kind: "loading", pda: providerParam as Address },
      });
      try {
        const maybeProvider = await fetchMaybeProvider(
          client.runtime.rpc,
          providerParam as Address,
        );
        if (cancelled) return;
        if (!maybeProvider.exists) {
          setProviderFetch({
            forParam: providerParam,
            state: { kind: "missing", pda: providerParam as Address },
          });
          return;
        }
        const p = maybeProvider.data;
        setProviderFetch({
          forParam: providerParam,
          state: {
            kind: "ok",
            info: {
              pda: providerParam as Address,
              authority: p.authority,
              status: p.status,
              activeJobs: Number(p.activeJobs),
              totalJobs: Number(p.totalJobs),
            },
          },
        });
      } catch (err) {
        if (cancelled) return;
        setProviderFetch({
          forParam: providerParam,
          state: {
            kind: "error",
            pda: providerParam as Address,
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providerParam, client]);

  // Derived: only show provider state if it matches the current URL param.
  const providerState: ProviderState =
    providerFetch && providerFetch.forParam === providerParam
      ? providerFetch.state
      : providerParam
        ? { kind: "loading", pda: providerParam as Address }
        : { kind: "none" };

  const buyerSigner: TransactionSigner | undefined = useMemo(() => {
    if (!session) return undefined;
    return createWalletTransactionSigner(session).signer;
  }, [session]);
  const buyerAddress = session?.account.address;

  // Read buyer's USDC balance whenever the wallet changes.
  useEffect(() => {
    if (walletStatus !== "connected" || !buyerAddress) return;
    let cancelled = false;
    (async () => {
      const ata = await findAssociatedTokenAddress(buyerAddress, USDC_MINT);
      const bal = await tryReadTokenBalance(client.runtime.rpc, ata);
      if (cancelled) return;
      setBalanceFetch({
        forBuyer: buyerAddress,
        amount: bal ? bal.amount : BigInt(0),
      });
    })().catch((err) => {
      if (cancelled) return;
      console.error("Balance fetch failed", err);
      setBalanceFetch({ forBuyer: buyerAddress, amount: BigInt(0) });
    });
    return () => {
      cancelled = true;
    };
  }, [walletStatus, buyerAddress, client]);

  // Derived: only show balance if it's for the currently-connected buyer.
  const balance =
    balanceFetch && balanceFetch.forBuyer === buyerAddress
      ? { amount: balanceFetch.amount }
      : null;

  // Load this wallet's recorded jobs. Async-wrapped so the setState
  // happens after a microtask boundary (React 19 strict pattern bans
  // synchronous setState in an effect body).
  useEffect(() => {
    if (!buyerAddress) return;
    let cancelled = false;
    void (async () => {
      const entries = loadHistory(buyerAddress);
      if (cancelled) return;
      setHistoryFetch({ forBuyer: buyerAddress, entries });
    })();
    return () => {
      cancelled = true;
    };
  }, [buyerAddress]);

  const history =
    historyFetch && historyFetch.forBuyer === buyerAddress
      ? historyFetch.entries
      : [];

  const priceLamports = useMemo<bigint | null>(() => {
    const trimmed = priceUsdc.trim();
    if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
    const [whole, frac = ""] = trimmed.split(".");
    const fracPadded = (frac + "000000").slice(0, USDC_DECIMALS);
    return BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(fracPadded || 0);
  }, [priceUsdc]);

  const insufficient =
    balance != null &&
    priceLamports != null &&
    balance.amount < priceLamports;

  const canSubmit =
    !!buyerSigner &&
    walletStatus === "connected" &&
    !busy &&
    !sendTx.isSending &&
    prompt.trim().length > 0 &&
    priceLamports != null &&
    priceLamports > BigInt(0) &&
    !insufficient &&
    providerState.kind === "ok";

  const handleSubmit = async () => {
    if (
      !buyerSigner ||
      !buyerAddress ||
      !priceLamports ||
      providerState.kind !== "ok"
    ) {
      return;
    }
    const selectedProvider = providerState.info.pda;
    setBusy("Preparing job…");
    setOpError(null);
    sendTx.reset();
    try {
      const id = randomJobId();
      const spec: Spec = {
        prompt: prompt.trim(),
        model: "flux-schnell",
        steps,
        width,
        height,
        seed,
      };
      const specCanonical = canonicalJson(spec);
      const specHash = await sha256(specCanonical);
      const specHashHex = bytesToHex(specHash);

      // 1. Stash the spec server-side BEFORE the on-chain tx — the
      // worker may pick up JobCreated within ~1 second of confirmation
      // and need to read the prompt right away.
      setBusy("Storing spec…");
      const r = await fetch("/api/spec", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ specHash: specHashHex, spec }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `spec POST failed (${r.status})`);
      }

      // 2. Build + sign + send create_job.
      const [jobPda] = await findJobPda({ buyer: buyerAddress, id });
      setBusy(`Submitting create_job (${formatUsdc(priceLamports)} USDC)…`);
      const ix = await getCreateJobInstructionAsync({
        buyer: buyerSigner,
        provider: selectedProvider,
        usdcMint: USDC_MINT,
        id,
        specHash,
        deadlineOffsetSecs: DEFAULT_DEADLINE_SECS,
        priceLamportsUsdc: priceLamports,
      });
      await sendTx.send({
        instructions: [ix],
        feePayer: buyerSigner,
      });

      // 3. Stash the job in the buyer's local history so they can find
      // it from /submit if they navigate away from /job/[id].
      recordJob(buyerAddress, {
        pda: jobPda,
        specHashHex,
        promptPreview: spec.prompt.slice(0, 80),
        priceLamportsUsdc: priceLamports.toString(),
        createdAt: Date.now(),
      });

      // 4. Off to the result page — it'll subscribe + render when the
      // worker finishes.
      router.push(`/job/${jobPda}`);
    } catch (err) {
      setOpError(`Submit failed: ${err instanceof Error ? err.message : err}`);
      setBusy(null);
    }
  };

  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#000] text-[#FAFAF9]">
      <HexGridBackground />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-16">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#9945FF]">
            Apis · W2 buyer
          </p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Buy 1 inference from{" "}
            <span className="text-[#14F195]">apis_program</span>
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-white/60">
            Pay devnet USDC into a per-job escrow vault. The registered
            worker picks up your job, runs Flux Schnell on Apple Silicon,
            uploads the result to IPFS, and posts the proof hash on-chain.
            Then you settle to release the payment.
          </p>
        </header>

        <WalletStatusBanner walletStatus={walletStatus} address={buyerAddress} />

        {history.length > 0 && walletStatus === "connected" && (
          <JobHistorySection entries={history} />
        )}

        <ProviderPicker state={providerState} />

        <AnimatePresence mode="wait">
          {walletStatus === "connected" && providerState.kind === "ok" && (
            <Card key="form">
              <SectionTitle>Job spec</SectionTitle>
              <p className="text-sm text-white/70">
                Targeting provider{" "}
                <code className="text-[#14F195]">
                  {providerState.info.pda.slice(0, 8)}…
                </code>
                . Spec keys are hashed into <code>spec_hash</code> on-chain;
                the prompt itself is delivered to the worker via the
                Pinata-backed side-channel.
              </p>

              <label className="flex flex-col gap-2 text-sm">
                <span className="text-xs uppercase tracking-wider text-white/50">
                  Prompt
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

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <NumberField label="Steps" value={steps} setValue={setSteps} min={1} max={10} />
                <NumberField label="Width" value={width} setValue={setWidth} min={256} max={1024} step={64} />
                <NumberField label="Height" value={height} setValue={setHeight} min={256} max={1024} step={64} />
                <NumberField label="Seed" value={seed} setValue={setSeed} />
              </div>

              <label className="flex flex-col gap-2 text-sm">
                <span className="text-xs uppercase tracking-wider text-white/50">
                  Price (USDC)
                </span>
                <div className="flex items-baseline gap-3">
                  <input
                    type="text"
                    value={priceUsdc}
                    onChange={(e) => setPriceUsdc(e.target.value)}
                    inputMode="decimal"
                    className="w-32 rounded-lg border border-[#14F195]/20 bg-black/60 p-2 font-mono text-sm text-white outline-none transition focus:border-[#14F195]/60"
                  />
                  <span className="font-mono text-xs text-white/50">
                    Balance: {balance ? formatUsdc(balance.amount) : "…"} USDC
                  </span>
                </div>
                {insufficient && (
                  <FaucetRow
                    pubkey={buyerAddress}
                    onSuccess={(amt) =>
                      setBalanceFetch({
                        forBuyer: buyerAddress!,
                        amount: (balance?.amount ?? BigInt(0)) + amt,
                      })
                    }
                  />
                )}
                {priceLamports == null && (
                  <span className="font-mono text-xs text-[#FF3B5C]">
                    Invalid amount (max 6 decimals)
                  </span>
                )}
              </label>

              <NeonButton
                onClick={handleSubmit}
                disabled={!canSubmit}
                primary
              >
                {busy ?? "Submit & lock USDC"}
              </NeonButton>
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

function ProviderPicker({ state }: { state: ProviderState }) {
  // No provider in URL → CTA pointing at /network.
  if (state.kind === "none") {
    return (
      <Card>
        <SectionTitle>Pick a provider</SectionTitle>
        <p className="text-sm text-white/70">
          Submitting a job targets a specific registered provider — the
          worker that will accept and run your inference. Browse the live
          provider directory and pick one before posting.
        </p>
        <Link
          href="/network"
          className="inline-flex items-center gap-2 self-start rounded-lg bg-[#14F195] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider text-black shadow-[0_0_30px_-5px_rgba(20,241,149,0.6)] transition hover:scale-[1.02]"
        >
          Browse providers
          <ArrowRight className="h-4 w-4" strokeWidth={2} />
        </Link>
      </Card>
    );
  }

  // Fetching.
  if (state.kind === "loading") {
    return (
      <Card>
        <p className="font-mono text-xs uppercase tracking-wider text-white/40">
          Resolving provider {state.pda.slice(0, 8)}…
        </p>
      </Card>
    );
  }

  // Param points at a non-existent / non-Provider account.
  if (state.kind === "missing") {
    return (
      <Card>
        <p className="font-mono text-xs uppercase tracking-wider text-[#FF3B5C]">
          Provider not found
        </p>
        <p className="text-sm text-white/65">
          The URL points at{" "}
          <code className="text-white/85">{state.pda}</code> but no
          Provider PDA exists at that address. It may have been deregistered.
        </p>
        <Link
          href="/network"
          className="inline-flex items-center gap-2 self-start font-mono text-xs uppercase tracking-wider text-[#14F195] underline-offset-2 hover:underline"
        >
          Browse providers <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </Card>
    );
  }

  if (state.kind === "error") {
    return (
      <Card>
        <p className="font-mono text-xs uppercase tracking-wider text-[#FF3B5C]">
          Couldn&apos;t resolve provider
        </p>
        <pre className="overflow-auto rounded bg-black/60 p-3 text-xs text-white/70">
          {state.message}
        </pre>
      </Card>
    );
  }

  // OK — show the selected provider.
  const { info } = state;
  const statusName = ProviderStatus[info.status] ?? `Unknown(${info.status})`;
  const isActive = info.status === ProviderStatus.Active;
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <SectionTitle>Selected provider</SectionTitle>
        <Link
          href="/network"
          className="font-mono text-[10px] uppercase tracking-wider text-white/45 underline-offset-2 hover:text-[#14F195] hover:underline"
        >
          change
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
        <Row
          label="Provider PDA"
          value={info.pda}
          link={explorerAccountUrl(info.pda)}
        />
        <Row
          label="Authority"
          value={info.authority}
          link={explorerAccountUrl(info.authority)}
        />
        <Row label="Status" value={statusName} highlight={isActive} />
        <Row
          label="Jobs (active / total)"
          value={`${info.activeJobs} / ${info.totalJobs}`}
        />
      </div>
      {!isActive && (
        <p className="font-mono text-xs text-[#FF3B5C]">
          This provider is not in Active status — your job may not be picked
          up. Consider choosing a different provider.
        </p>
      )}
    </Card>
  );
}

function Row({
  label,
  value,
  link,
  highlight,
}: {
  label: string;
  value: string;
  link?: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 font-mono">
      <span className="text-white/40">{label}</span>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className={
            highlight
              ? "break-all text-[#14F195] underline-offset-2 hover:underline"
              : "break-all text-white/80 underline-offset-2 hover:text-[#14F195] hover:underline"
          }
        >
          {value}
        </a>
      ) : (
        <span
          className={highlight ? "break-all text-[#14F195]" : "break-all text-white/80"}
        >
          {value}
        </span>
      )}
    </div>
  );
}

function FaucetRow({
  pubkey,
  onSuccess,
}: {
  pubkey: Address | undefined;
  onSuccess: (amountBaseUnits: bigint) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const handleClick = async () => {
    if (!pubkey || busy) return;
    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      const r = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pubkey }),
      });
      const body = (await r.json()) as {
        ok?: boolean;
        amountBaseUnits?: string;
        amountUsdc?: string;
        signature?: string;
        error?: string;
        retryAfterSeconds?: number;
      };
      if (!r.ok || !body.ok) {
        if (r.status === 429 && body.retryAfterSeconds != null) {
          const hr = Math.ceil(body.retryAfterSeconds / 3600);
          throw new Error(
            `Already dripped — try again in ~${hr} hour${hr === 1 ? "" : "s"}`,
          );
        }
        throw new Error(body.error ?? `Faucet returned ${r.status}`);
      }
      onSuccess(BigInt(body.amountBaseUnits ?? "0"));
      setOkMsg(`Dripped ${body.amountUsdc} USDC ✓`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#9945FF]/30 bg-[#9945FF]/[0.05] p-3 text-xs">
      <span className="font-mono uppercase tracking-wider text-[#9945FF]">
        Out of test USDC?
      </span>
      <motion.button
        whileHover={busy ? {} : { scale: 1.02 }}
        whileTap={busy ? {} : { scale: 0.98 }}
        onClick={handleClick}
        disabled={busy || !pubkey}
        className="rounded-md bg-[#9945FF] px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-white shadow-[0_0_24px_-6px_rgba(153,69,255,0.6)] transition disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Dripping…" : "Get 10 USDC"}
      </motion.button>
      {okMsg && <span className="font-mono text-[#14F195]">{okMsg}</span>}
      {err && <span className="font-mono text-[#FF3B5C]">{err}</span>}
    </div>
  );
}

function JobHistorySection({ entries }: { entries: JobHistoryEntry[] }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-5"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-xs uppercase tracking-wider text-white/60">
          Your jobs ({entries.length})
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-white/30">
          local cache
        </span>
      </div>
      <ul className="space-y-2">
        {entries.slice(0, 5).map((e) => (
          <li key={e.pda}>
            <Link
              href={`/job/${e.pda}`}
              className="group flex items-center justify-between gap-4 rounded-lg border border-white/5 bg-black/40 px-4 py-3 transition hover:border-[#14F195]/40 hover:bg-[#14F195]/[0.04]"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate text-sm text-white/85">
                  {e.promptPreview || <span className="italic text-white/40">no preview</span>}
                </p>
                <p className="font-mono text-[10px] text-white/40">
                  {e.pda.slice(0, 8)}…{e.pda.slice(-4)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-xs text-[#14F195]">
                  {(BigInt(e.priceLamportsUsdc) / BigInt(1_000_000)).toString() + "."
                    + (BigInt(e.priceLamportsUsdc) % BigInt(1_000_000)).toString().padStart(6, "0").replace(/0+$/, "") || "0"} USDC
                </p>
                <p className="font-mono text-[10px] text-white/40">
                  {timeAgo(e.createdAt)}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}

function timeAgo(unixMs: number): string {
  const sec = Math.round((Date.now() - unixMs) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function NumberField({
  label,
  value,
  setValue,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  setValue: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-white/50">
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setValue(Number(e.target.value))}
        className="rounded-lg border border-[#14F195]/20 bg-black/60 p-2 font-mono text-sm text-white outline-none transition focus:border-[#14F195]/60"
      />
    </label>
  );
}

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
      <a
        href={explorerAccountUrl(address)}
        target="_blank"
        rel="noreferrer"
        className="break-all text-white/70 underline-offset-2 hover:text-[#14F195] hover:underline"
      >
        {address}
      </a>
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
