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
import { useSolanaClient } from "@solana/react-hooks";
import { ArrowRight, Cpu, Wallet } from "lucide-react";

import { APIS_PROGRAM_PROGRAM_ADDRESS } from "@/app/lib/apis-program";
import { PROVIDER_DISCRIMINATOR } from "@/app/lib/generated/apis-program/src/generated/accounts/provider";
import { JOB_DISCRIMINATOR } from "@/app/lib/generated/apis-program/src/generated/accounts/job";
import { explorerAccountUrl } from "@/app/lib/apis";
import { WORKER_PROVIDER_PDA } from "@/app/lib/constants";
import { fetchHeartbeat, type HeartbeatStatus } from "@/app/lib/heartbeat-client";
import { AnomalousMatterHero } from "@/app/components/ui/anomalous-matter-hero";
import { NavBar } from "@/app/components/ui/navbar";
import { Globe } from "@/app/components/ui/cobe-globe";
import { MarketplaceFlow } from "@/app/components/marketplace-flow";

type LiveStats = {
  providerCount: number;
  openJobCount: number;
  /** True iff the reference worker's Provider PDA is registered on-chain.
   *  Note: registration is permanent; this does NOT mean the worker
   *  process is running right now. For that, see `workerLiveness`. */
  workerRegistered: boolean;
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
  // Liveness for the reference worker. Polled every POLL_MS independently
  // of the on-chain stats so a missed network round doesn't tank the
  // whole indicator. "online" ↔ heartbeat within the last 90s.
  const [workerLiveness, setWorkerLiveness] = useState<HeartbeatStatus>({
    kind: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      const hb = await fetchHeartbeat(WORKER_PROVIDER_PDA);
      if (!cancelled) setWorkerLiveness(hb);
    };
    void probe();
    const id = setInterval(() => void probe(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

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
        const workerRegistered = providers.some(
          (p) => p.pubkey === WORKER_PROVIDER_PDA,
        );
        setStats({
          kind: "ok",
          stats: {
            providerCount: providers.length,
            openJobCount: jobs.length,
            workerRegistered,
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
        topSlot={
          <div className="mx-auto max-w-5xl px-6 pt-8">
            <NavBar active="home" />
          </div>
        }
        eyebrow="Permissionless · open · settled on Solana"
        title={
          <>
            Buy compute power from
            <br />
            <span className="bg-gradient-to-r from-[#14F195] via-[#14F195] to-[#9945FF] bg-clip-text text-transparent">
              individual GPU owners.
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

        <WhyApis />

        <NetworkGlobeSection stats={stats} workerLiveness={workerLiveness} />

        <NetworkPanel stats={stats} workerLiveness={workerLiveness} />

        <Footer />
      </div>
    </main>
  );
}


// ─── Network globe ─────────────────────────────────────────────────────

function workerLivenessLabel(h: HeartbeatStatus): string {
  if (h.kind === "online") return "live";
  if (h.kind === "offline") return "offline";
  if (h.kind === "error") return "—";
  return "…";
}

function NetworkGlobeSection({
  stats,
  workerLiveness,
}: {
  stats: StatsState;
  workerLiveness: HeartbeatStatus;
}) {
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
              value={workerLivenessLabel(workerLiveness)}
              highlight={workerLiveness.kind === "online"}
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

function NetworkPanel({
  stats,
  workerLiveness,
}: {
  stats: StatsState;
  workerLiveness: HeartbeatStatus;
}) {
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
              workerLiveness.kind === "online"
                ? "M3 Pro · MLX · live"
                : workerLiveness.kind === "offline"
                  ? "M3 Pro · MLX · offline"
                  : workerLiveness.kind === "error"
                    ? "M3 Pro · MLX · liveness probe failed"
                    : "M3 Pro · MLX · checking…"
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
      <div className="mb-10 max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#9945FF]">
          the price gap
        </p>
        <h2 className="mt-3 text-3xl font-bold leading-[1.05] tracking-tight md:text-5xl lg:text-6xl">
          Up to{" "}
          <span className="bg-gradient-to-r from-[#14F195] to-[#9945FF] bg-clip-text text-transparent">
            80% lower
          </span>{" "}
          than AWS.
          <br />
          <span className="text-white/85">0.5% fee, not 30%.</span>
        </h2>
        <p className="mt-5 text-base leading-relaxed text-white/65">
          Hyperscaler GPU rental, plus aggregator margin (Replicate, Fal,
          Together) — and you end up paying ~5× what the GPU actually costs
          to run. Apis routes USDC straight from buyer to whoever owns the
          silicon. Protocol takes <strong className="font-semibold text-white">0.5%</strong>.
          That&apos;s the only middleman.
        </p>
      </div>

      <PriceStack />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ComparisonCard
          title="Centralized AI cloud"
          dim
          rows={[
            { label: "$3–4/hr per A100 on-demand", emphasis: true },
            { label: "30–50% aggregator margin", emphasis: true },
            { label: "Account + KYC required" },
            { label: "Credit card billing" },
            { label: "Single point of failure" },
            { label: "Vendor lock-in" },
            { label: "Trust the operator" },
          ]}
        />
        <ComparisonCard
          title="Apis"
          rows={[
            { label: "Buyer sets the price per job", emphasis: true },
            { label: "0.5% protocol fee. No middleman.", emphasis: true },
            { label: "Just a Solana wallet" },
            { label: "USDC, settled on-chain" },
            { label: "Permissionless provider set" },
            { label: "Open Anchor program (audit it)" },
            { label: "Trust the contract" },
          ]}
        />
      </div>
    </section>
  );
}

// Stacked-margin visualization: shows how a buyer's $1.00 splits across
// the value chain on a centralized aggregator vs. Apis. Pure CSS bars,
// percentages annotated. Quick eyeful, lands the "0.5% vs 30%" point.
function PriceStack() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-15%" }}
      transition={{ duration: 0.5 }}
      className="mb-10 grid grid-cols-1 gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-6 md:grid-cols-2"
    >
      <div className="space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-white/40">
          $1 spent on a centralized AI API
        </p>
        <div className="flex h-7 overflow-hidden rounded-full bg-white/[0.04]">
          <div
            className="flex items-center justify-center text-[10px] font-semibold text-black/85"
            style={{ width: "60%", backgroundColor: "#FF7A6E" }}
          >
            60% hyperscaler
          </div>
          <div
            className="flex items-center justify-center text-[10px] font-semibold text-black/85"
            style={{ width: "35%", backgroundColor: "#FFC857" }}
          >
            35% aggregator
          </div>
          <div
            className="flex items-center justify-center text-[10px] font-semibold text-white/85"
            style={{ width: "5%", backgroundColor: "#3a3a3a" }}
          />
        </div>
        <p className="font-mono text-[10px] text-white/40">
          5% trickles back to the actual GPU operator.
        </p>
      </div>

      <div className="space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-[#14F195]/85">
          $1 spent on apis
        </p>
        <div className="flex h-7 overflow-hidden rounded-full bg-white/[0.04]">
          <div
            className="flex items-center justify-center text-[10px] font-semibold text-black/90"
            style={{ width: "99.5%", backgroundColor: "#14F195" }}
          >
            99.5% to GPU provider
          </div>
          <div
            className="flex items-center justify-center text-[8px] font-semibold text-white/85"
            style={{ width: "0.5%", backgroundColor: "#9945FF" }}
          />
        </div>
        <p className="font-mono text-[10px] text-[#14F195]/85">
          0.5% protocol fee → treasury. That&apos;s it.
        </p>
      </div>
    </motion.div>
  );
}

function ComparisonCard({
  title,
  rows,
  dim,
}: {
  title: string;
  rows: { label: string; emphasis?: boolean }[];
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
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li
            key={r.label}
            className={
              dim
                ? r.emphasis
                  ? "flex items-center gap-2 text-sm font-semibold text-white/70"
                  : "flex items-center gap-2 text-sm text-white/40"
                : r.emphasis
                  ? "flex items-center gap-2 text-sm font-semibold text-white"
                  : "flex items-center gap-2 text-sm text-white/85"
            }
          >
            <span
              className={
                dim
                  ? r.emphasis
                    ? "h-1.5 w-1.5 rounded-full bg-[#FF7A6E]"
                    : "h-1 w-1 rounded-full bg-white/30"
                  : r.emphasis
                    ? "h-1.5 w-1.5 rounded-full bg-[#14F195]"
                    : "h-1 w-1 rounded-full bg-[#14F195]"
              }
            />
            {r.label}
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
