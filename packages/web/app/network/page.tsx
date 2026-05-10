"use client";

// Apis network browse page.
//
// Lists every registered Provider PDA + every open Job PDA from
// apis_program devnet. Refreshes every 30s. Read-only — buyers click
// through to the Solana Explorer for any account; submitting a job
// happens on /submit. No wallet connection required.

import { useEffect, useMemo, useState } from "react";
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
import { explorerAccountUrl } from "@/app/lib/apis";
import { WORKER_PROVIDER_PDA, formatUsdc } from "@/app/lib/constants";
import { ApisLogo } from "@/app/components/ui/apis-logo";

type ProviderRow = {
  pda: Address;
  authority: Address;
  activeJobs: number;
  totalJobs: number;
  status: ProviderStatus;
};

type JobRow = {
  pda: Address;
  buyer: Address;
  provider: Address;
  priceLamports: bigint;
  status: JobStatus;
  fundedAt: number;
  deadline: number;
};

type State =
  | { kind: "loading" }
  | { kind: "ok"; providers: ProviderRow[]; jobs: JobRow[]; fetchedAt: number }
  | { kind: "error"; message: string };

const POLL_MS = 30_000;

// We're hardcoding which provider is "ours" so the network page can
// label it with human-readable specs. The on-chain gpu_specs_hash is
// opaque (sha256). Future polish: have providers post a signed JSON
// blob with their specs to a Pinata / Arweave URL referenced via
// endpoint_uri_hash.
const KNOWN_PROVIDERS: Record<string, string> = {
  [WORKER_PROVIDER_PDA]: "Apis worker · M3 Pro 18 GB · MLX (mflux 0.17)",
};

export default function NetworkPage() {
  const client = useSolanaClient();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const base58 = getBase58Decoder();
    const providerDiscB58 = base58.decode(PROVIDER_DISCRIMINATOR);
    const jobDiscB58 = base58.decode(JOB_DISCRIMINATOR);

    const fetchAll = async () => {
      try {
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
              Array<{ pubkey: Address; account: { data: [string, "base64"] } }>
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

        const providers: ProviderRow[] = providerAccts.map((a) => {
          const bytes = base64ToBytes(a.account.data[0]);
          const decoded = providerDecoder.decode(bytes);
          return {
            pda: a.pubkey,
            authority: decoded.authority,
            activeJobs: Number(decoded.activeJobs),
            totalJobs: Number(decoded.totalJobs),
            status: decoded.status,
          };
        });

        const jobs: JobRow[] = jobAccts.map((a) => {
          const bytes = base64ToBytes(a.account.data[0]);
          const decoded = jobDecoder.decode(bytes);
          return {
            pda: a.pubkey,
            buyer: decoded.buyer,
            provider: decoded.provider,
            priceLamports: decoded.priceLamportsUsdc,
            status: decoded.status,
            fundedAt: Number(decoded.fundedAt),
            deadline: Number(decoded.deadline),
          };
        });

        setState({ kind: "ok", providers, jobs, fetchedAt: Date.now() });
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
  }, [client]);

  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#000] text-[#FAFAF9]">
      <HexGridBackground />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
        <Nav />

        <header className="space-y-3 py-12">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#9945FF]">
            apis · live network
          </p>
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            Every Provider, every open Job.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-white/60">
            Read directly from <code>apis_program</code> on Solana devnet via{" "}
            <code>getProgramAccounts</code> with discriminator filter. Auto-refreshes
            every 30 seconds.
          </p>
        </header>

        <section className="space-y-4 pb-12">
          <SectionHeader
            label="Providers"
            count={state.kind === "ok" ? state.providers.length : null}
            sublabel="Registered worker keys with bond escrow"
          />
          {state.kind === "loading" && <LoadingRows n={1} />}
          {state.kind === "error" && (
            <ErrorRow message={state.message} />
          )}
          {state.kind === "ok" && state.providers.length === 0 && (
            <EmptyRow message="No providers registered yet." />
          )}
          {state.kind === "ok" &&
            state.providers.map((p) => <ProviderCard key={p.pda} provider={p} />)}
        </section>

        <section className="space-y-4 pb-12">
          <SectionHeader
            label="Open jobs"
            count={state.kind === "ok" ? state.jobs.length : null}
            sublabel="Jobs in flight (post-create_job, pre-confirm_completion)"
          />
          {state.kind === "loading" && <LoadingRows n={1} />}
          {state.kind === "error" && <ErrorRow message={state.message} />}
          {state.kind === "ok" && state.jobs.length === 0 && (
            <EmptyRow message="No open jobs right now — all settled or cancelled." />
          )}
          {state.kind === "ok" &&
            state.jobs.map((j) => <JobCard key={j.pda} job={j} />)}
        </section>

        <FooterStrip
          fetchedAt={state.kind === "ok" ? state.fetchedAt : null}
        />
      </div>
    </main>
  );
}

// ─── Cards ──────────────────────────────────────────────────────────────

function ProviderCard({ provider }: { provider: ProviderRow }) {
  const knownLabel = KNOWN_PROVIDERS[provider.pda];
  const statusName = providerStatusName(provider.status);
  const isActive = provider.status === ProviderStatus.Active;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="space-y-1">
          {knownLabel && (
            <p className="text-sm font-semibold text-[#14F195]">{knownLabel}</p>
          )}
          <a
            href={explorerAccountUrl(provider.pda)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-white/60 underline-offset-2 hover:text-[#14F195] hover:underline"
          >
            {provider.pda}
          </a>
        </div>
        <StatusBadge label={statusName} active={isActive} />
      </div>
      <div className="grid grid-cols-2 gap-4 text-xs md:grid-cols-3">
        <Cell label="Authority">
          <a
            href={explorerAccountUrl(provider.authority)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-white/70 hover:text-[#14F195]"
          >
            {provider.authority.slice(0, 6)}…{provider.authority.slice(-4)}
          </a>
        </Cell>
        <Cell label="Active jobs">
          <span className="font-mono text-white/85">{provider.activeJobs}</span>
        </Cell>
        <Cell label="Total served">
          <span className="font-mono text-white/85">{provider.totalJobs}</span>
        </Cell>
      </div>
    </motion.div>
  );
}

function JobCard({ job }: { job: JobRow }) {
  const knownProvider = KNOWN_PROVIDERS[job.provider];
  const statusName = jobStatusName(job.status);
  const accent = jobStatusAccent(job.status);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="space-y-1">
          <Link
            href={`/job/${job.pda}`}
            className="font-mono text-sm text-white/85 underline-offset-2 hover:text-[#14F195] hover:underline"
          >
            {job.pda.slice(0, 12)}…{job.pda.slice(-4)}
          </Link>
          <p className="font-mono text-[10px] uppercase tracking-wider text-white/40">
            click to view + confirm
          </p>
        </div>
        <span
          className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider"
          style={{
            color: accent,
            backgroundColor: `${accent}1f`,
            border: `1px solid ${accent}40`,
          }}
        >
          {statusName}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 text-xs md:grid-cols-4">
        <Cell label="Price">
          <span className="font-mono text-[#14F195]">
            {formatUsdc(job.priceLamports)} USDC
          </span>
        </Cell>
        <Cell label="Buyer">
          <a
            href={explorerAccountUrl(job.buyer)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-white/70 hover:text-[#14F195]"
          >
            {job.buyer.slice(0, 6)}…{job.buyer.slice(-4)}
          </a>
        </Cell>
        <Cell label="Provider">
          <span className="font-mono text-white/70">
            {knownProvider ? "apis worker" : `${job.provider.slice(0, 6)}…${job.provider.slice(-4)}`}
          </span>
        </Cell>
        <Cell label="Deadline">
          <span className="font-mono text-white/70">
            {timeUntil(job.deadline)}
          </span>
        </Cell>
      </div>
    </motion.div>
  );
}

function StatusBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={
        active
          ? "inline-flex items-center gap-2 rounded-full border border-[#14F195]/40 bg-[#14F195]/[0.08] px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-[#14F195]"
          : "inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-white/50"
      }
    >
      {active && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#14F195] shadow-[0_0_8px_rgba(20,241,149,0.8)]" />
      )}
      {label}
    </span>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="font-mono text-[10px] uppercase tracking-wider text-white/35">
        {label}
      </p>
      {children}
    </div>
  );
}

// ─── Misc UI ────────────────────────────────────────────────────────────

function SectionHeader({
  label,
  count,
  sublabel,
}: {
  label: string;
  count: number | null;
  sublabel: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-white/10 pb-3">
      <div className="space-y-0.5">
        <h2 className="text-2xl font-semibold tracking-tight">
          {label}
          {count != null && (
            <span className="ml-3 font-mono text-base text-white/40">
              ({count})
            </span>
          )}
        </h2>
        <p className="font-mono text-[10px] uppercase tracking-wider text-white/35">
          {sublabel}
        </p>
      </div>
    </div>
  );
}

function LoadingRows({ n }: { n: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          className="h-[100px] animate-pulse rounded-xl border border-white/5 bg-white/[0.02]"
        />
      ))}
    </div>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-transparent p-8 text-center font-mono text-xs text-white/40">
      {message}
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="space-y-2 rounded-xl border border-[#FF3B5C]/30 bg-[#FF3B5C]/[0.05] p-5">
      <p className="font-mono text-xs uppercase tracking-wider text-[#FF3B5C]">
        RPC error
      </p>
      <pre className="overflow-auto rounded bg-black/60 p-3 text-xs text-white/70">
        {message}
      </pre>
    </div>
  );
}

function FooterStrip({ fetchedAt }: { fetchedAt: number | null }) {
  return (
    <div className="mt-auto border-t border-white/10 pt-6 pb-4 font-mono text-xs text-white/40">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href="/" className="hover:text-[#14F195]">
          ← home
        </Link>
        <span>·</span>
        <Link href="/submit" className="hover:text-[#14F195]">
          submit a job →
        </Link>
        <span className="ml-auto text-white/30">
          {fetchedAt ? `synced ${new Date(fetchedAt).toLocaleTimeString()}` : "syncing…"}
        </span>
      </div>
    </div>
  );
}

function Nav() {
  return (
    <nav className="flex items-center justify-between pb-8">
      <Link href="/" className="flex items-center gap-2.5 group">
        <ApisLogo size={26} className="transition group-hover:scale-105" />
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
          className="font-mono text-xs uppercase tracking-wider text-[#14F195]"
        >
          network
        </Link>
        <Link
          href="/submit"
          className="font-mono text-xs uppercase tracking-wider text-white/60 transition hover:text-[#14F195]"
        >
          submit
        </Link>
      </div>
    </nav>
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

// ─── Helpers ────────────────────────────────────────────────────────────

function base64ToBytes(b64: string): ReadonlyUint8Array {
  // atob is available in browsers + Node 18+. Returns binary string;
  // we map char codes back to bytes for the codama decoder.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function providerStatusName(s: ProviderStatus): string {
  return ProviderStatus[s] ?? `Unknown(${s})`;
}

function jobStatusName(s: JobStatus): string {
  return JobStatus[s] ?? `Unknown(${s})`;
}

function jobStatusAccent(s: JobStatus): string {
  switch (s) {
    case JobStatus.Funded:
      return "#9945FF"; // violet
    case JobStatus.Started:
      return "#9945FF";
    case JobStatus.Completed:
      return "#14F195"; // green
    case JobStatus.Disputed:
      return "#FFC857"; // amber
    case JobStatus.Refunded:
    case JobStatus.Slashed:
      return "#FF3B5C"; // red
    default:
      return "#FFFFFF";
  }
}

function timeUntil(unixSec: number): string {
  const sec = unixSec - Math.round(Date.now() / 1000);
  if (sec <= 0) return "expired";
  if (sec < 60) return `in ${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `in ${min}m`;
  const hr = Math.round(min / 60);
  return `in ${hr}h`;
}
