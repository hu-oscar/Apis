"use client";

// Apis marketplace landing page (W5 polish).
//
// Sections, top to bottom:
//   1. Hero          — three.js anomalous-matter wireframe + CTAs
//   2. MarketplaceFlow — animated two-sided diagram (gamer ↔ AI dev)
//   3. NetworkGlobe   — cobe-rendered globe with provider markers
//   4. NetworkPanel   — program addresses, live counters
//   5. WhyApis        — vs centralized AI cloud comparison
//   6. Footer         — license + stack callout

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  getBase58Decoder,
  type Address,
} from "@solana/kit";
import { useSolanaClient, useWalletConnection } from "@solana/react-hooks";
import { ArrowRight, Cpu, Wallet } from "lucide-react";

import { APIS_PROGRAM_PROGRAM_ADDRESS } from "@/app/lib/apis-program";
import { PROVIDER_DISCRIMINATOR } from "@/app/lib/generated/apis-program/src/generated/accounts/provider";
import { JOB_DISCRIMINATOR } from "@/app/lib/generated/apis-program/src/generated/accounts/job";
import { explorerAccountUrl } from "@/app/lib/apis";
import { WORKER_PROVIDER_PDA } from "@/app/lib/constants";
import { AnomalousMatterHero } from "@/app/components/ui/anomalous-matter-hero";
import { ApisLogo } from "@/app/components/ui/apis-logo";
import { Globe } from "@/app/components/ui/cobe-globe";
import { MarketplaceFlow } from "@/app/components/marketplace-flow";

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

// Hardcoded provider locations for the globe — represents the kind of
// distribution we'd expect once providers register from around the world.
// The marker on Cape Town corresponds to no real provider yet; for the
// hackathon submission these are illustrative.
const PROVIDER_MARKERS = [
  { id: "sf", location: [37.7595, -122.4367] as [number, number], label: "San Francisco" },
  { id: "nyc", location: [40.7128, -74.006] as [number, number], label: "New York" },
  { id: "paris", location: [48.8566, 2.3522] as [number, number], label: "Paris" },
  { id: "berlin", location: [52.52, 13.405] as [number, number], label: "Berlin" },
  { id: "tokyo", location: [35.6762, 139.6503] as [number, number], label: "Tokyo" },
  { id: "singapore", location: [1.3521, 103.8198] as [number, number], label: "Singapore" },
  { id: "sao-paulo", location: [-23.5505, -46.6333] as [number, number], label: "São Paulo" },
  { id: "cape-town", location: [-33.9249, 18.4241] as [number, number], label: "Cape Town" },
  { id: "sydney", location: [-33.8688, 151.2093] as [number, number], label: "Sydney" },
];

export default function Home() {
  const client = useSolanaClient();
  const [stats, setStats] = useState<StatsState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const base58 = getBase58Decoder();
    const providerDiscB58 = base58.decode(PROVIDER_DISCRIMINATOR);
    const jobDiscB58 = base58.decode(JOB_DISCRIMINATOR);
    const programAddress = APIS_PROGRAM_PROGRAM_ADDRESS;

    const fetchStats = async () => {
      try {
        const rpc = client.runtime.rpc as unknown as {
          getProgramAccounts: (
            address: Address,
            config: {
              encoding: "base64";
              dataSlice: { offset: number; length: number };
              filters: Array<{
                memcmp: { offset: bigint; bytes: string; encoding: "base58" };
              }>;
            },
          ) => { send: () => Promise<Array<{ pubkey: Address }>> };
        };
        const [providers, jobs] = await Promise.all([
          rpc
            .getProgramAccounts(programAddress, {
              encoding: "base64",
              dataSlice: { offset: 0, length: 0 },
              filters: [
                { memcmp: { offset: 0n, bytes: providerDiscB58, encoding: "base58" } },
              ],
            })
            .send(),
          rpc
            .getProgramAccounts(programAddress, {
              encoding: "base64",
              dataSlice: { offset: 0, length: 0 },
              filters: [
                { memcmp: { offset: 0n, bytes: jobDiscB58, encoding: "base58" } },
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
    <main className="relative bg-[#000] text-[#FAFAF9]">
      {/* Hero is full-viewport. The nav is rendered inside its topSlot
          so it overlays the canvas without needing a sticky bar. */}
      <AnomalousMatterHero
        topSlot={<Nav />}
        eyebrow="Permissionless · open · settled on Solana"
        title={
          <>
            Buy AI compute.
            <br />
            <span className="bg-gradient-to-r from-[#14F195] via-[#14F195] to-[#9945FF] bg-clip-text text-transparent">
              Sell idle GPUs.
            </span>
          </>
        }
        description={
          <>
            Apis is a permissionless marketplace where individual GPU owners
            earn USDC for the compute they aren&apos;t using, and AI builders
            rent that compute without signing up to a SaaS. Payments and
            proofs settle on Solana — escrow, fee distribution, and dispute
            paths all live in one open Anchor program.
          </>
        }
      >
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/submit"
            className="group inline-flex items-center gap-2 rounded-lg bg-[#14F195] px-6 py-3 font-mono text-sm font-semibold uppercase tracking-wider text-black shadow-[0_0_40px_-8px_rgba(20,241,149,0.7)] transition hover:scale-[1.02]"
          >
            <Wallet className="h-4 w-4" strokeWidth={2} />
            Buy 1 inference
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" strokeWidth={2} />
          </Link>
          <Link
            href="/network"
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.03] px-6 py-3 font-mono text-sm uppercase tracking-wider text-white/85 backdrop-blur-sm transition hover:border-white/30 hover:bg-white/[0.06] hover:text-white"
          >
            <Cpu className="h-4 w-4" strokeWidth={2} />
            View live network
          </Link>
        </div>
      </AnomalousMatterHero>

      <div className="relative z-10 mx-auto max-w-5xl px-6">
        <MarketplaceFlow />

        <NetworkGlobeSection stats={stats} />

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
    <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 pt-8">
      <Link href="/" className="group flex items-center gap-2.5">
        <ApisLogo size={26} className="transition group-hover:scale-105" />
        <span className="font-mono text-lg font-bold tracking-tight text-[#FAFAF9] transition group-hover:text-[#14F195]">
          apis
        </span>
        <span className="rounded bg-[#9945FF]/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[#9945FF]">
          devnet
        </span>
      </Link>
      <div className="flex items-center gap-5">
        <Link
          href="/network"
          className="hidden font-mono text-xs uppercase tracking-wider text-white/65 transition hover:text-[#14F195] sm:inline-block"
        >
          network
        </Link>
        <Link
          href="/submit"
          className="hidden font-mono text-xs uppercase tracking-wider text-white/65 transition hover:text-[#14F195] sm:inline-block"
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

// ─── Network globe ─────────────────────────────────────────────────────

function NetworkGlobeSection({ stats }: { stats: StatsState }) {
  return (
    <section className="border-t border-white/10 py-24">
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-5">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#9945FF]">
            global by default
          </p>
          <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
            One program. <br />
            Anyone, anywhere, can plug in a GPU.
          </h2>
          <p className="text-base leading-relaxed text-white/65">
            Apis has no provider whitelist. Anyone with a Solana wallet, a
            keypair, and ~0.05 SOL for tx fees can register a Provider PDA
            and start accepting jobs. A college student with a gaming
            laptop and a 100-GPU operator post jobs against the same
            program, with the same instruction surface.
          </p>
          <div className="flex flex-wrap gap-4 text-xs text-white/55">
            <Stat
              label="Providers registered"
              value={stats.kind === "ok" ? stats.stats.providerCount.toString() : "…"}
            />
            <Stat
              label="Open jobs"
              value={stats.kind === "ok" ? stats.stats.openJobCount.toString() : "…"}
            />
            <Stat
              label="Reference worker"
              value={stats.kind === "ok" && stats.stats.workerOnline ? "online" : "—"}
              highlight={stats.kind === "ok" && stats.stats.workerOnline}
            />
          </div>
          <Link
            href="/network"
            className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-[#14F195] underline-offset-2 hover:underline"
          >
            Browse the live network <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
          </Link>
        </div>

        <div className="mx-auto aspect-square w-full max-w-md">
          <Globe markers={PROVIDER_MARKERS} />
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <p className="font-mono text-[10px] uppercase tracking-wider text-white/35">
        {label}
      </p>
      <p
        className={
          highlight
            ? "font-mono text-xl font-semibold text-[#14F195]"
            : "font-mono text-xl font-semibold text-white"
        }
      >
        {value}
      </p>
    </div>
  );
}

// ─── Program metadata panel ────────────────────────────────────────────

function NetworkPanel({ stats }: { stats: StatsState }) {
  return (
    <section className="border-t border-white/10 py-24">
      <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
        <div className="space-y-4">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#9945FF]">
            on-chain receipts
          </p>
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Audit it yourself.
          </h2>
          <p className="text-sm leading-relaxed text-white/60">
            No off-chain matchmaker, no privileged operator role. Every
            provider, every job, every USDC transfer is a transaction on
            Solana devnet. Click through to Solana Explorer to verify.
          </p>
        </div>
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-6 font-mono text-xs">
          <PanelRow
            label="Program"
            value={shortAddress(APIS_PROGRAM_PROGRAM_ADDRESS)}
            link={explorerAccountUrl(APIS_PROGRAM_PROGRAM_ADDRESS)}
          />
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
            label="Reference worker"
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

// ─── Why Apis comparison ───────────────────────────────────────────────

function WhyApis() {
  return (
    <section className="border-t border-white/10 py-24">
      <div className="mb-12 max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#9945FF]">
          centralized cloud vs apis
        </p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-5xl">
          Why a marketplace, not a SaaS?
        </h2>
        <p className="mt-4 text-base leading-relaxed text-white/65">
          Centralized AI clouds give you compute, but you trade an account,
          a credit card, and trust in a single operator. Apis gives you the
          same compute with none of those.
        </p>
      </div>
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
            "Open Anchor program (audit it)",
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
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-15%" }}
      transition={{ duration: 0.4 }}
      className={
        dim
          ? "space-y-4 rounded-2xl border border-white/10 bg-white/[0.01] p-6"
          : "space-y-4 rounded-2xl border border-[#14F195]/30 bg-[#14F195]/[0.03] p-6 shadow-[0_30px_120px_-60px_rgba(20,241,149,0.4)]"
      }
    >
      <h3
        className={
          dim
            ? "text-lg font-semibold tracking-tight text-white/55"
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
    </motion.div>
  );
}

// ─── Footer ────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-white/10 pt-10 pb-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
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
        <span>·</span>
        <span>three.js</span>
        <span>·</span>
        <span>cobe</span>
      </div>
    </footer>
  );
}
