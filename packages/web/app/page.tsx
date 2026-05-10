"use client";

// Apis marketplace landing page.
//
// Positioning: permissionless GPU compute on Solana. Pitch black + Solana
// green + neon violet, hex-grid swarm motif (the project name = bee in
// Latin; PRD §7 "Cyberpunk Swarm" design direction).
//
// Sections: nav → hero (CTA + live stats) → how it works (3 steps) →
// network state (program info, worker online indicator) → why Apis
// (vs centralized AI cloud) → footer.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  getBase58Decoder,
  type Address,
} from "@solana/kit";
import { useSolanaClient, useWalletConnection } from "@solana/react-hooks";

import { APIS_PROGRAM_PROGRAM_ADDRESS } from "@/app/lib/apis-program";
import { PROVIDER_DISCRIMINATOR } from "@/app/lib/generated/apis-program/src/generated/accounts/provider";
import { JOB_DISCRIMINATOR } from "@/app/lib/generated/apis-program/src/generated/accounts/job";
import { explorerAccountUrl } from "@/app/lib/apis";
import { WORKER_PROVIDER_PDA } from "@/app/lib/constants";

type LiveStats = {
  providerCount: number;
  openJobCount: number;
  workerOnline: boolean;
  fetchedAt: number;
};

type StatsState =
  | { kind: "loading" }
  | { kind: "ok"; stats: LiveStats }
  | { kind: "error"; message: string };

const POLL_MS = 30_000;

export default function Home() {
  const client = useSolanaClient();
  const [stats, setStats] = useState<StatsState>({ kind: "loading" });

  // Live network stats — count Providers + open Jobs via getProgramAccounts
  // filtered by Anchor discriminator. Re-poll every 30s. We only need the
  // count, so dataSlice: 0 bytes returned.
  useEffect(() => {
    let cancelled = false;
    const base58 = getBase58Decoder();
    const providerDiscB58 = base58.decode(PROVIDER_DISCRIMINATOR);
    const jobDiscB58 = base58.decode(JOB_DISCRIMINATOR);
    const programAddress: Address = APIS_PROGRAM_PROGRAM_ADDRESS;

    const fetchStats = async () => {
      try {
        const rpc = client.runtime.rpc as unknown as {
          getProgramAccounts: (
            address: Address,
            config: {
              encoding: "base64";
              dataSlice: { offset: number; length: number };
              filters: Array<
                | { memcmp: { offset: bigint; bytes: string; encoding: "base58" } }
              >;
            },
          ) => { send: () => Promise<Array<{ pubkey: Address }>> };
        };
        const [providers, jobs] = await Promise.all([
          rpc
            .getProgramAccounts(programAddress, {
              encoding: "base64",
              dataSlice: { offset: 0, length: 0 },
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
            .getProgramAccounts(programAddress, {
              encoding: "base64",
              dataSlice: { offset: 0, length: 0 },
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
        const workerOnline = providers.some((p) => p.pubkey === WORKER_PROVIDER_PDA);
        setStats({
          kind: "ok",
          stats: {
            providerCount: providers.length,
            openJobCount: jobs.length,
            workerOnline,
            fetchedAt: Date.now(),
          },
        });
      } catch (err) {
        if (cancelled) return;
        setStats({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    void fetchStats();
    const id = setInterval(() => void fetchStats(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [client]);

  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#000] text-[#FAFAF9]">
      <HexGridBackground />
      <SwarmGlow />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
        <Nav />

        <Hero stats={stats} />

        <HowItWorks />

        <NetworkPanel stats={stats} />

        <WhyApis />

        <Footer />
      </div>
    </main>
  );
}

// ─── Nav ────────────────────────────────────────────────────────────────

function Nav() {
  return (
    <nav className="flex items-center justify-between pb-8">
      <Link href="/" className="flex items-center gap-2 group">
        <span className="text-2xl">🐝</span>
        <span className="font-mono text-lg font-bold tracking-tight text-[#FAFAF9] group-hover:text-[#14F195] transition">
          apis
        </span>
        <span className="rounded bg-[#9945FF]/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[#9945FF]">
          devnet
        </span>
      </Link>
      <div className="flex items-center gap-4">
        <Link
          href="/network"
          className="hidden font-mono text-xs uppercase tracking-wider text-white/60 transition hover:text-[#14F195] sm:block"
        >
          network
        </Link>
        <Link
          href="/submit"
          className="hidden font-mono text-xs uppercase tracking-wider text-white/60 transition hover:text-[#14F195] sm:block"
        >
          submit
        </Link>
        <NavWalletButton />
      </div>
    </nav>
  );
}

function NavWalletButton() {
  const { wallet, status, connectors, connect, disconnect } =
    useWalletConnection();
  const address = wallet?.account.address;

  if (status === "connected" && address) {
    return (
      <button
        onClick={() => disconnect()}
        className="rounded-lg border border-[#14F195]/30 bg-[#14F195]/[0.05] px-3 py-1.5 font-mono text-xs text-[#14F195] transition hover:bg-[#14F195]/[0.1]"
      >
        {address.slice(0, 4)}…{address.slice(-4)} ✕
      </button>
    );
  }

  // Pick the first available connector (Phantom usually). If none, the user
  // needs a wallet extension.
  const phantom = connectors.find((c) => c.name.toLowerCase().includes("phantom"));
  const target = phantom ?? connectors[0];

  return (
    <button
      onClick={() => target && connect(target.id)}
      disabled={!target || status === "connecting"}
      className="rounded-lg bg-[#14F195] px-4 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-black shadow-[0_0_24px_-6px_rgba(20,241,149,0.6)] transition hover:bg-[#14F195]/90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {status === "connecting" ? "Connecting…" : "Connect wallet"}
    </button>
  );
}

// ─── Hero ───────────────────────────────────────────────────────────────

function Hero({ stats }: { stats: StatsState }) {
  return (
    <section className="flex flex-col items-start gap-8 py-20">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="space-y-6"
      >
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#9945FF]">
          permissionless · open · on-chain
        </p>
        <h1 className="text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl lg:text-7xl">
          The GPU compute
          <br />
          marketplace,
          <br />
          <span className="bg-gradient-to-r from-[#14F195] via-[#14F195] to-[#9945FF] bg-clip-text text-transparent">
            on Solana.
          </span>
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-white/70">
          Pay USDC. Get IPFS results. Settled on Solana via an open Anchor
          program. No accounts, no middleman, no vendor lock-in. Buyers post
          jobs, registered workers pick them up — escrow releases on proof.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut", delay: 0.15 }}
        className="flex flex-wrap gap-3"
      >
        <Link
          href="/submit"
          className="inline-flex items-center justify-center rounded-lg bg-[#14F195] px-6 py-3 font-mono text-sm font-semibold uppercase tracking-wider text-black shadow-[0_0_40px_-8px_rgba(20,241,149,0.7)] transition hover:scale-[1.02]"
        >
          Buy 1 inference →
        </Link>
        <Link
          href="/network"
          className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/[0.02] px-6 py-3 font-mono text-sm uppercase tracking-wider text-white/80 transition hover:border-white/30 hover:text-white"
        >
          View network
        </Link>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.3 }}
        className="grid w-full grid-cols-2 gap-4 border-t border-white/10 pt-8 md:grid-cols-4"
      >
        <StatCell label="Providers" value={renderStatCount(stats, "providerCount")} />
        <StatCell label="Open jobs" value={renderStatCount(stats, "openJobCount")} />
        <StatCell label="Settlement" value="USDC" sublabel="6 decimals" />
        <StatCell label="Worker" value={<WorkerStatusInline stats={stats} />} />
      </motion.div>
    </section>
  );
}

function renderStatCount(
  stats: StatsState,
  field: "providerCount" | "openJobCount",
): React.ReactNode {
  if (stats.kind === "ok") return stats.stats[field].toString();
  if (stats.kind === "error") return <span className="text-[#FF3B5C]">—</span>;
  return <span className="text-white/30">…</span>;
}

function WorkerStatusInline({ stats }: { stats: StatsState }) {
  if (stats.kind === "ok") {
    return stats.stats.workerOnline ? (
      <span className="inline-flex items-center gap-2 text-[#14F195]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#14F195] shadow-[0_0_10px_rgba(20,241,149,0.8)]" />
        live
      </span>
    ) : (
      <span className="inline-flex items-center gap-2 text-white/40">
        <span className="h-2 w-2 rounded-full bg-white/20" />
        offline
      </span>
    );
  }
  return <span className="text-white/30">…</span>;
}

function StatCell({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: React.ReactNode;
  sublabel?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="font-mono text-[10px] uppercase tracking-wider text-white/40">
        {label}
      </p>
      <p className="font-mono text-2xl font-semibold tracking-tight text-white">
        {value}
      </p>
      {sublabel && (
        <p className="font-mono text-[10px] uppercase tracking-wider text-white/30">
          {sublabel}
        </p>
      )}
    </div>
  );
}

// ─── How It Works ───────────────────────────────────────────────────────

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Lock USDC",
      body: "You submit a prompt + price from /submit. The Anchor program escrows your USDC into a per-job vault and emits JobCreated.",
      tag: "create_job",
    },
    {
      n: "02",
      title: "Provider runs",
      body: "A registered worker watches for JobCreated targeting its Provider PDA. It accepts the job, runs Flux Schnell, uploads to IPFS, posts the proof hash on-chain.",
      tag: "submit_completion",
    },
    {
      n: "03",
      title: "Settle",
      body: "You confirm in /job/[id]. The escrow releases — provider gets paid (minus protocol fee), Job + vault accounts close, rent refunded.",
      tag: "confirm_completion",
    },
  ];
  return (
    <section className="border-t border-white/10 py-20">
      <div className="mb-10 flex items-baseline justify-between">
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
          How it works
        </h2>
        <p className="font-mono text-xs uppercase tracking-wider text-white/40">
          end-to-end in ~60s
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {steps.map((s, i) => (
          <motion.div
            key={s.n}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-20%" }}
            transition={{ duration: 0.4, delay: i * 0.08 }}
            className="space-y-4 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-6"
          >
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-xs text-[#9945FF]">{s.n}</span>
              <code className="rounded bg-[#14F195]/[0.06] px-2 py-0.5 font-mono text-[10px] text-[#14F195]/80">
                {s.tag}
              </code>
            </div>
            <h3 className="text-xl font-semibold tracking-tight">{s.title}</h3>
            <p className="text-sm leading-relaxed text-white/60">{s.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ─── Network panel ──────────────────────────────────────────────────────

function NetworkPanel({ stats }: { stats: StatsState }) {
  return (
    <section className="border-t border-white/10 py-20">
      <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
        <div className="space-y-4">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            One program. <br />
            One open ledger.
          </h2>
          <p className="text-sm leading-relaxed text-white/60">
            Apis is a single Anchor program on Solana devnet. Provider
            registry, job lifecycle, USDC escrow, fee distribution — all
            on-chain, all auditable. No off-chain matchmaker, no privileged
            operator role.
          </p>
          <Link
            href="/network"
            className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-[#14F195] underline-offset-2 hover:underline"
          >
            Browse the live network →
          </Link>
        </div>
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-6 font-mono text-xs">
          <PanelRow label="Program" value={shortAddress(APIS_PROGRAM_PROGRAM_ADDRESS)} link={explorerAccountUrl(APIS_PROGRAM_PROGRAM_ADDRESS)} />
          <PanelRow label="Cluster" value="devnet" />
          <PanelRow
            label="Providers"
            value={stats.kind === "ok" ? stats.stats.providerCount.toString() : "…"}
          />
          <PanelRow
            label="Open jobs"
            value={stats.kind === "ok" ? stats.stats.openJobCount.toString() : "…"}
          />
          <PanelRow
            label="Worker"
            value={
              stats.kind === "ok"
                ? stats.stats.workerOnline
                  ? "M3 Pro · MLX (online)"
                  : "M3 Pro · MLX (offline)"
                : "…"
            }
            link={explorerAccountUrl(WORKER_PROVIDER_PDA)}
          />
          <PanelRow label="Last poll" value={renderTimeAgo(stats)} />
        </div>
      </div>
    </section>
  );
}

function PanelRow({
  label,
  value,
  link,
}: {
  label: string;
  value: string;
  link?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 py-2 last:border-0">
      <span className="text-white/40">{label}</span>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="text-white/80 underline-offset-2 hover:text-[#14F195] hover:underline"
        >
          {value}
        </a>
      ) : (
        <span className="text-white/80">{value}</span>
      )}
    </div>
  );
}

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function renderTimeAgo(stats: StatsState): string {
  if (stats.kind !== "ok") return "…";
  const sec = Math.round((Date.now() - stats.stats.fetchedAt) / 1000);
  return sec < 5 ? "just now" : `${sec}s ago`;
}

// ─── Why Apis ───────────────────────────────────────────────────────────

function WhyApis() {
  return (
    <section className="border-t border-white/10 py-20">
      <h2 className="mb-10 text-3xl font-bold tracking-tight md:text-4xl">
        Why a marketplace?
      </h2>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ComparisonCard
          title="Centralized AI cloud"
          dim
          rows={[
            "Account + KYC required",
            "Credit card billing",
            "Single point of failure",
            "Vendor lock-in",
            "Opaque pricing",
            "Trust the operator",
          ]}
        />
        <ComparisonCard
          title="Apis"
          rows={[
            "Just a Solana wallet",
            "USDC, settled on-chain",
            "Permissionless provider set",
            "Open Anchor program",
            "Per-job market price",
            "Trust the contract",
          ]}
        />
      </div>
    </section>
  );
}

function ComparisonCard({
  title,
  rows,
  dim,
}: {
  title: string;
  rows: string[];
  dim?: boolean;
}) {
  return (
    <div
      className={
        dim
          ? "space-y-4 rounded-2xl border border-white/10 bg-white/[0.01] p-6"
          : "space-y-4 rounded-2xl border border-[#14F195]/30 bg-[#14F195]/[0.03] p-6 shadow-[0_30px_120px_-60px_rgba(20,241,149,0.4)]"
      }
    >
      <h3
        className={
          dim
            ? "text-lg font-semibold tracking-tight text-white/60"
            : "text-lg font-semibold tracking-tight text-[#14F195]"
        }
      >
        {title}
      </h3>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r}
            className={
              dim
                ? "flex items-center gap-2 text-sm text-white/40"
                : "flex items-center gap-2 text-sm text-white/85"
            }
          >
            <span
              className={
                dim
                  ? "h-1 w-1 rounded-full bg-white/30"
                  : "h-1 w-1 rounded-full bg-[#14F195]"
              }
            />
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Footer ─────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="mt-auto border-t border-white/10 pt-8 pb-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs">
          <span className="text-white/40">apis · MIT</span>
          <a
            href="https://github.com/hu-oscar/Apis"
            target="_blank"
            rel="noreferrer"
            className="text-white/60 underline-offset-2 hover:text-[#14F195] hover:underline"
          >
            github
          </a>
          <span className="text-white/40">built for dev3pack</span>
        </div>
        <p className="font-mono text-xs text-white/30">
          phase 1 · hackathon mvp · devnet only · no real-money exposure
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-white/25">
        <span>anchor 1.0</span>
        <span>·</span>
        <span>flux schnell (apache 2.0)</span>
        <span>·</span>
        <span>mlx</span>
        <span>·</span>
        <span>pinata ipfs</span>
        <span>·</span>
        <span>usdc</span>
      </div>
    </footer>
  );
}

// ─── Decorative backgrounds ─────────────────────────────────────────────

function HexGridBackground() {
  return useMemo(
    () => (
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.05] mix-blend-screen"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="hex"
            width="56"
            height="48.5"
            patternUnits="userSpaceOnUse"
            patternTransform="scale(1.1)"
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

function SwarmGlow() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-[#14F195]/[0.08] blur-[120px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-32 -right-40 h-[600px] w-[600px] rounded-full bg-[#9945FF]/[0.10] blur-[140px]"
      />
    </>
  );
}
