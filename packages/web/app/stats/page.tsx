"use client";

// /stats — public network telemetry page (Sprint 3.2).
//
// Honest numbers, all derived from on-chain state + the signed
// heartbeat KV. No indexer, no fancy time-series, no GMV-from-tx-
// history (settled jobs close their accounts so historical price
// data is gone from chain). What we can show truthfully:
//
//   - Total registered providers + how many are heartbeat-live.
//   - Open jobs in flight (status not in Completed/Refunded/Slashed).
//   - Total inferences served (sum of Provider.total_jobs).
//   - Total escrow USDC locked right now (sum of open Job prices).
//   - Average benchmark speed across online providers (when published).
//
// One `getProgramAccounts` request per account type + a heartbeat
// fetch per provider, polled every 30s — same shape as /network.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  getBase58Decoder,
  type Address,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { useSolanaClient } from "@solana/react-hooks";

import { APIS_PROGRAM_PROGRAM_ADDRESS } from "@/app/lib/apis-program";
import {
  PROVIDER_DISCRIMINATOR,
  getProviderDecoder,
} from "@/app/lib/generated/apis-program/src/generated/accounts/provider";
import {
  JOB_DISCRIMINATOR,
  getJobDecoder,
} from "@/app/lib/generated/apis-program/src/generated/accounts/job";
import { ProviderStatus } from "@/app/lib/generated/apis-program/src/generated/types/providerStatus";
import { JobStatus } from "@/app/lib/generated/apis-program/src/generated/types/jobStatus";
import { formatUsdc } from "@/app/lib/constants";
import { NavBar } from "@/app/components/ui/navbar";
import {
  fetchHeartbeat,
  type HeartbeatRecord,
  type HeartbeatStatus,
} from "@/app/lib/heartbeat-client";

type StatsSnapshot = {
  providersTotal: number;
  providersActive: number;
  providersOnline: number;
  jobsOpen: number;
  jobsFunded: number;
  jobsStarted: number;
  lifetimeInferences: number;
  escrowLockedUsdcBase: bigint;
  /** Average seconds/image across online providers that have run the
   *  benchmark. null when no provider has published a number yet. */
  avgSecondsPerImage: number | null;
  /** Online provider rows we render in the mini-leaderboard (top 5 by
   *  total_jobs). */
  topProviders: Array<{
    pda: Address;
    chip: string;
    totalJobs: number;
    secondsPerImage: number | null;
    suggestedPriceUsdcBase: bigint | null;
    online: boolean;
  }>;
};

type State =
  | { kind: "loading" }
  | { kind: "ok"; snap: StatsSnapshot; fetchedAt: number }
  | { kind: "error"; message: string };

const POLL_MS = 30_000;

export default function StatsPage() {
  const client = useSolanaClient();
  const [state, setState] = useState<State>({ kind: "loading" });
  // Manual-retry trigger — bumped by the error-state retry button.
  // useEffect re-runs whenever it changes, kicking off a fresh fetch
  // cycle. Lets the user recover from a transient RPC failure
  // without reloading the page.
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const base58 = getBase58Decoder();
    const providerDiscB58 = base58.decode(PROVIDER_DISCRIMINATOR);
    const jobDiscB58 = base58.decode(JOB_DISCRIMINATOR);

    const fetchAll = async () => {
      try {
        // Reuse the same RPC handle shape /network uses.
        const rpc = client.runtime.rpc as unknown as {
          getProgramAccounts: (
            address: Address,
            config: {
              encoding: "base64";
              filters: Array<{
                memcmp: { offset: bigint; bytes: string; encoding: "base58" };
              }>;
            },
          ) => {
            send: () => Promise<
              Array<{
                pubkey: Address;
                account: { data: [string, "base64"] };
              }>
            >;
          };
        };

        const [providerAccts, jobAccts] = await Promise.all([
          rpc
            .getProgramAccounts(APIS_PROGRAM_PROGRAM_ADDRESS, {
              encoding: "base64",
              filters: [
                {
                  memcmp: {
                    offset: 0n,
                    bytes: providerDiscB58,
                    encoding: "base58",
                  },
                },
              ],
            })
            .send(),
          rpc
            .getProgramAccounts(APIS_PROGRAM_PROGRAM_ADDRESS, {
              encoding: "base64",
              filters: [
                {
                  memcmp: {
                    offset: 0n,
                    bytes: jobDiscB58,
                    encoding: "base58",
                  },
                },
              ],
            })
            .send(),
        ]);
        if (cancelled) return;

        const providerDecoder = getProviderDecoder();
        const jobDecoder = getJobDecoder();

        // Decode every Provider account.
        const providers = providerAccts.map((a) => {
          const bytes = base64ToBytes(a.account.data[0]);
          const d = providerDecoder.decode(bytes);
          return {
            pda: a.pubkey,
            authority: d.authority,
            activeJobs: Number(d.activeJobs),
            totalJobs: Number(d.totalJobs),
            status: d.status,
          };
        });

        // Decode every open Job + sum escrow.
        const jobs = jobAccts.map((a) => {
          const bytes = base64ToBytes(a.account.data[0]);
          const d = jobDecoder.decode(bytes);
          return {
            pda: a.pubkey,
            price: d.priceLamportsUsdc,
            status: d.status,
          };
        });

        // Pull heartbeats for each provider so we know who's "online".
        // Same parallel pattern /network uses; ≤20 providers ≈ 200ms.
        const heartbeats: Array<HeartbeatStatus> = await Promise.all(
          providers.map((p) =>
            fetchHeartbeat(p.pda).catch(
              (err): HeartbeatStatus => ({
                kind: "error",
                message: err instanceof Error ? err.message : String(err),
              }),
            ),
          ),
        );
        if (cancelled) return;

        // ── Aggregate ───────────────────────────────────────────────
        let providersOnline = 0;
        let providersActive = 0;
        let lifetimeInferences = 0;
        const speedSamples: number[] = [];

        const enriched = providers.map((p, i) => {
          const hb = heartbeats[i];
          const online = hb.kind === "online";
          const record: HeartbeatRecord | null =
            hb.kind === "online"
              ? hb.record
              : hb.kind === "offline"
                ? hb.lastSeen
                : null;
          if (online) providersOnline++;
          if (p.status === ProviderStatus.Active) providersActive++;
          lifetimeInferences += p.totalJobs;
          const seconds =
            record?.secondsPerImage != null
              ? parseFloat(record.secondsPerImage)
              : null;
          if (online && seconds !== null) speedSamples.push(seconds);
          return {
            pda: p.pda,
            chip: record?.chip || "Unknown provider",
            totalJobs: p.totalJobs,
            secondsPerImage: seconds,
            suggestedPriceUsdcBase:
              record?.suggestedPriceUsdcBase != null
                ? safeBigint(record.suggestedPriceUsdcBase)
                : null,
            online,
          };
        });

        // Top 5 by total_jobs served — the truest "leaderboard" given
        // we don't have on-chain reputation yet.
        const topProviders = [...enriched]
          .sort((a, b) => b.totalJobs - a.totalJobs)
          .slice(0, 5);

        // Bucket jobs by lifecycle phase. "Open" = anything not in a
        // terminal state (Completed/Refunded/Slashed).
        let jobsFunded = 0;
        let jobsStarted = 0;
        let escrow = 0n;
        for (const j of jobs) {
          if (j.status === JobStatus.Funded) jobsFunded++;
          if (j.status === JobStatus.Started) jobsStarted++;
          if (
            j.status !== JobStatus.Completed &&
            j.status !== JobStatus.Refunded &&
            j.status !== JobStatus.Slashed
          ) {
            escrow += j.price;
          }
        }
        const jobsOpen = jobsFunded + jobsStarted;

        const avgSeconds =
          speedSamples.length > 0
            ? speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length
            : null;

        setState({
          kind: "ok",
          snap: {
            providersTotal: providers.length,
            providersActive,
            providersOnline,
            jobsOpen,
            jobsFunded,
            jobsStarted,
            lifetimeInferences,
            escrowLockedUsdcBase: escrow,
            avgSecondsPerImage: avgSeconds,
            topProviders,
          },
          fetchedAt: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    void fetchAll();
    const id = setInterval(() => void fetchAll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [client, retryNonce]);

  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#000] text-[#FAFAF9]">
      <HexGridBackground />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
        <NavBar active="stats" />

        <header className="space-y-3 py-12">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#9945FF]">
            apis · network telemetry
          </p>
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            The marketplace, in numbers.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-white/60">
            Counts are computed live from <code>apis_program</code> accounts
            on devnet (no indexer). Settled jobs close their accounts on
            settlement, so historical price data is not retained on-chain
            — what you see is the present moment.
          </p>
        </header>

        {state.kind === "loading" && <LoadingStats />}
        {state.kind === "error" && (
          <ErrorBanner
            message={state.message}
            onRetry={() => {
              setState({ kind: "loading" });
              setRetryNonce((n) => n + 1);
            }}
          />
        )}
        {state.kind === "ok" && (
          <StatsBody snap={state.snap} fetchedAt={state.fetchedAt} />
        )}
      </div>
    </main>
  );
}

function StatsBody({
  snap,
  fetchedAt,
}: {
  snap: StatsSnapshot;
  fetchedAt: number;
}) {
  return (
    <div className="space-y-10 pb-16">
      <NorthStar value={snap.lifetimeInferences} />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <BigStat
          label="Providers online"
          value={`${snap.providersOnline} / ${snap.providersTotal}`}
          accent="green"
          sublabel={`${snap.providersActive} active on-chain`}
        />
        <BigStat
          label="Open jobs"
          value={snap.jobsOpen.toString()}
          accent="violet"
          sublabel={`${snap.jobsFunded} waiting · ${snap.jobsStarted} running`}
        />
        <BigStat
          label="Escrow locked"
          value={`${formatUsdc(snap.escrowLockedUsdcBase)} USDC`}
          sublabel="in flight, not yet settled"
        />
        <BigStat
          label="Avg speed"
          value={
            snap.avgSecondsPerImage !== null
              ? `${snap.avgSecondsPerImage.toFixed(2)}s / img`
              : "—"
          }
          sublabel={
            snap.avgSecondsPerImage !== null
              ? "Flux Schnell across online providers"
              : "no benchmarks published yet"
          }
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between border-b border-white/10 pb-3">
          <h2 className="text-2xl font-semibold tracking-tight">
            Top providers
          </h2>
          <p className="font-mono text-[10px] uppercase tracking-wider text-white/35">
            ranked by lifetime inferences served
          </p>
        </div>
        {snap.topProviders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 p-8 text-center font-mono text-xs text-white/40">
            No providers registered yet. The marketplace is open — anyone
            with a Mac can run the desktop app and start serving.
          </p>
        ) : (
          snap.topProviders.map((p, i) => (
            <TopProviderRow key={p.pda} rank={i + 1} provider={p} />
          ))
        )}
      </section>

      <p className="border-t border-white/5 pt-6 text-center font-mono text-[10px] uppercase tracking-wider text-white/30">
        last synced {Math.max(0, Math.round((Date.now() - fetchedAt) / 1000))}s
        ago · refreshes every {Math.round(POLL_MS / 1000)}s
      </p>
    </div>
  );
}

/** Big animated counter — the headline "lifetime inferences served"
 *  number. Per Tech Design §5 ("NorthStarCounter") — counts up from
 *  the previous value to the new one on every snapshot change, so
 *  the page has real motion every refresh, not just on first paint. */
function NorthStar({ value }: { value: number }) {
  const displayed = useCountUp(value, 1200);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="space-y-3 rounded-2xl border border-[#14F195]/25 bg-[#14F195]/[0.03] p-8 text-center"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#14F195]">
        lifetime inferences served
      </p>
      <p
        className="font-mono text-6xl font-bold tracking-tight text-[#FAFAF9] md:text-7xl"
        aria-live="polite"
      >
        {displayed.toLocaleString()}
      </p>
      <p className="font-mono text-[10px] text-white/40">
        sum of <code>Provider.total_jobs</code> across every registered
        provider · permissionless · on-chain
      </p>
    </motion.div>
  );
}

/** Smoothly animate a numeric value toward `target` over `durationMs`.
 *  Uses requestAnimationFrame so the easing is frame-paced (no
 *  setInterval jitter). Eased with the standard cubic ease-out so it
 *  decelerates into the final value. Re-targets on every prop change,
 *  so polling updates also animate.
 *
 *  Skips the animation entirely when the user has
 *  `prefers-reduced-motion: reduce` set — they get the final number
 *  immediately. */
function useCountUp(target: number, durationMs: number): number {
  const [value, setValue] = useState<number>(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Honor reduced-motion preference.
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setValue(target);
      return;
    }

    const startTs = performance.now();
    const startVal = value;
    const delta = target - startVal;
    if (delta === 0) return;

    const step = (ts: number) => {
      const elapsed = ts - startTs;
      const t = Math.min(1, elapsed / durationMs);
      // ease-out cubic — decelerates as it approaches.
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(startVal + delta * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return value;
}

function BigStat({
  label,
  value,
  sublabel,
  accent,
}: {
  label: string;
  value: string;
  sublabel?: string;
  accent?: "green" | "violet";
}) {
  const colorClass =
    accent === "green"
      ? "text-[#14F195]"
      : accent === "violet"
        ? "text-[#9945FF]"
        : "text-white/85";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-1.5 rounded-xl border border-white/10 bg-white/[0.02] p-5"
    >
      <p className="font-mono text-[10px] uppercase tracking-wider text-white/40">
        {label}
      </p>
      <p className={`font-mono text-xl font-semibold ${colorClass}`}>{value}</p>
      {sublabel && (
        <p className="font-mono text-[10px] text-white/35">{sublabel}</p>
      )}
    </motion.div>
  );
}

function TopProviderRow({
  rank,
  provider,
}: {
  rank: number;
  provider: StatsSnapshot["topProviders"][number];
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className="grid grid-cols-1 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs md:grid-cols-[40px_2fr_1fr_1fr_1fr_auto]"
    >
      <span className="font-mono text-xl font-semibold text-white/35">
        #{rank}
      </span>
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm font-semibold text-[#14F195]">
          {provider.chip}
        </p>
        <Link
          href={`/provider/${provider.pda}`}
          className="block truncate font-mono text-[10px] text-white/40 hover:text-[#14F195]"
        >
          {provider.pda}
        </Link>
      </div>
      <div className="space-y-0.5">
        <p className="font-mono text-[10px] uppercase tracking-wider text-white/35">
          served
        </p>
        <p className="font-mono text-white/85">{provider.totalJobs} jobs</p>
      </div>
      <div className="space-y-0.5">
        <p className="font-mono text-[10px] uppercase tracking-wider text-white/35">
          speed
        </p>
        <p className="font-mono text-[#9945FF]">
          {provider.secondsPerImage !== null
            ? `${provider.secondsPerImage.toFixed(2)}s`
            : "—"}
        </p>
      </div>
      <div className="space-y-0.5">
        <p className="font-mono text-[10px] uppercase tracking-wider text-white/35">
          price
        </p>
        <p className="font-mono text-[#14F195]">
          {provider.suggestedPriceUsdcBase !== null
            ? `${formatUsdc(provider.suggestedPriceUsdcBase)} USDC`
            : "—"}
        </p>
      </div>
      <span
        className={
          provider.online
            ? "inline-flex items-center gap-1.5 rounded-full border border-[#14F195]/40 bg-[#14F195]/[0.08] px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-[#14F195]"
            : "inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-white/50"
        }
      >
        <span
          className={
            provider.online
              ? "h-1.5 w-1.5 animate-pulse rounded-full bg-[#14F195] shadow-[0_0_8px_rgba(20,241,149,0.8)]"
              : "h-1.5 w-1.5 rounded-full bg-white/30"
          }
        />
        {provider.online ? "online" : "offline"}
      </span>
    </motion.div>
  );
}

function LoadingStats() {
  return (
    <div className="space-y-6">
      <div className="h-44 animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl border border-white/5 bg-white/[0.02]"
          />
        ))}
      </div>
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-[#FF3B5C]/30 bg-[#FF3B5C]/[0.05] p-6 font-mono text-xs text-[#FF3B5C]">
      <p>
        Failed to load network stats:{" "}
        <span className="text-white/70">{message}</span>
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-md border border-[#FF3B5C]/40 bg-[#FF3B5C]/[0.1] px-3 py-1.5 uppercase tracking-wider text-[#FF3B5C] transition hover:bg-[#FF3B5C]/[0.18]"
      >
        Try again
      </button>
    </div>
  );
}

// ─── Chrome ────────────────────────────────────────────────────────

function HexGridBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 opacity-[0.05]"
      style={{
        backgroundImage:
          "radial-gradient(circle at 20% 20%, rgba(20,241,149,0.4) 0%, transparent 40%), radial-gradient(circle at 80% 70%, rgba(153,69,255,0.35) 0%, transparent 40%)",
      }}
    />
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

function base64ToBytes(b64: string): ReadonlyUint8Array {
  // Node + browser both expose `atob`. Use it (rather than Buffer) so
  // this file stays edge-runtime compatible if we ever move it.
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function safeBigint(s: string): bigint | null {
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}
