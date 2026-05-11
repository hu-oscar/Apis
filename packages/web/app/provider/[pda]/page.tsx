"use client";

// Per-provider details page.
//
// Reads the Provider PDA from the URL, fetches the on-chain Provider
// account, and lists every Job (open or settled) currently on-chain that
// targets it. Buyers reach this page from /network ("Use this provider")
// or directly by URL; the "Submit a job here" CTA forwards to
// /submit?provider=<pda> for the actual job-posting flow.
//
// Sprint 1.2 of Phase 1.5.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  getBase58Decoder,
  type Address,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { useSolanaClient } from "@solana/react-hooks";
import { ArrowRight } from "lucide-react";

import {
  APIS_PROGRAM_PROGRAM_ADDRESS,
  fetchMaybeProvider,
} from "@/app/lib/apis-program";
import {
  JOB_DISCRIMINATOR,
  getJobDecoder,
} from "@/app/lib/generated/apis-program/src/generated/accounts/job";
import { ProviderStatus } from "@/app/lib/generated/apis-program/src/generated/types/providerStatus";
import { JobStatus } from "@/app/lib/generated/apis-program/src/generated/types/jobStatus";
import { explorerAccountUrl } from "@/app/lib/apis";
import { WORKER_PROVIDER_PDA, formatUsdc } from "@/app/lib/constants";
import { ApisLogo } from "@/app/components/ui/apis-logo";
import {
  fetchHeartbeat,
  type HeartbeatRecord,
  type HeartbeatStatus,
} from "@/app/lib/heartbeat-client";

type ProviderInfo = {
  pda: Address;
  authority: Address;
  bondVault: Address;
  status: ProviderStatus;
  activeJobs: number;
  totalJobs: number;
};

type JobRow = {
  pda: Address;
  buyer: Address;
  priceLamports: bigint;
  status: JobStatus;
  fundedAt: number;
  deadline: number;
};

type ProviderState =
  | { kind: "loading" }
  | {
      kind: "ok";
      info: ProviderInfo;
      jobs: JobRow[];
      heartbeat: HeartbeatStatus;
      fetchedAt: number;
    }
  | { kind: "missing" }
  | { kind: "error"; message: string };

const POLL_MS = 30_000;

// Byte offset of `Job.provider` in the on-chain layout:
//   discriminator(8) + id(8) + buyer(32) = 48
const JOB_PROVIDER_OFFSET = 48;

// Hardcoded display labels for known reference providers. Same map as
// /network — kept in sync until W6 brings on-chain provider metadata.
const KNOWN_PROVIDERS: Record<string, string> = {
  [WORKER_PROVIDER_PDA]: "Apis worker · M3 Pro 18 GB · MLX (mflux 0.17)",
};

export default function ProviderDetailsPage() {
  const params = useParams<{ pda: string }>();
  const pda = params.pda as Address;
  const client = useSolanaClient();
  const [state, setState] = useState<ProviderState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const base58 = getBase58Decoder();

    const fetchAll = async () => {
      try {
        const rpc = client.runtime.rpc;

        // 1. Provider account.
        const maybe = await fetchMaybeProvider(rpc, pda);
        if (cancelled) return;
        if (!maybe.exists) {
          setState({ kind: "missing" });
          return;
        }
        const info: ProviderInfo = {
          pda,
          authority: maybe.data.authority,
          bondVault: maybe.data.bondVault,
          status: maybe.data.status,
          activeJobs: Number(maybe.data.activeJobs),
          totalJobs: Number(maybe.data.totalJobs),
        };

        // 2. Jobs targeting this provider — getProgramAccounts with
        //    two memcmp filters (discriminator + provider field).
        const programRpc = rpc as unknown as {
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
        const jobAccts = await programRpc
          .getProgramAccounts(APIS_PROGRAM_PROGRAM_ADDRESS, {
            encoding: "base64",
            filters: [
              {
                memcmp: {
                  offset: 0n,
                  bytes: base58.decode(JOB_DISCRIMINATOR),
                  encoding: "base58",
                },
              },
              {
                memcmp: {
                  offset: BigInt(JOB_PROVIDER_OFFSET),
                  bytes: pda,
                  encoding: "base58",
                },
              },
            ],
          })
          .send();
        if (cancelled) return;

        const jobDecoder = getJobDecoder();
        const jobs: JobRow[] = jobAccts.map((a) => {
          const bytes = base64ToBytes(a.account.data[0]);
          const decoded = jobDecoder.decode(bytes);
          return {
            pda: a.pubkey,
            buyer: decoded.buyer,
            priceLamports: decoded.priceLamportsUsdc,
            status: decoded.status,
            fundedAt: Number(decoded.fundedAt),
            deadline: Number(decoded.deadline),
          };
        });

        // 3. Liveness heartbeat (Sprint 1.5/1.6).
        const heartbeat = await fetchHeartbeat(pda);
        if (cancelled) return;

        setState({
          kind: "ok",
          info,
          jobs,
          heartbeat,
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
  }, [pda, client]);

  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#000] text-[#FAFAF9]">
      <HexGridBackground />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
        <Nav />

        <header className="space-y-3 py-12">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#9945FF]">
            provider
          </p>
          <h1 className="break-all text-3xl font-bold tracking-tight md:text-5xl">
            {pda.slice(0, 12)}…{pda.slice(-6)}
          </h1>
          <p className="font-mono text-xs text-white/45">
            {KNOWN_PROVIDERS[pda] ?? "Unknown / unlabeled provider"}
          </p>
        </header>

        {state.kind === "loading" && (
          <Card>
            <p className="font-mono text-xs text-white/40">
              Reading on-chain state…
            </p>
          </Card>
        )}

        {state.kind === "missing" && (
          <Card>
            <p className="font-mono text-xs uppercase tracking-wider text-[#FF3B5C]">
              Provider not found
            </p>
            <p className="text-sm text-white/60">
              No Provider PDA exists at this address. It may have been
              deregistered, or the address is wrong.
            </p>
            <Link
              href="/network"
              className="inline-flex items-center gap-2 self-start font-mono text-xs uppercase tracking-wider text-[#14F195] underline-offset-2 hover:underline"
            >
              Browse the network <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Card>
        )}

        {state.kind === "error" && (
          <Card>
            <p className="font-mono text-xs uppercase tracking-wider text-[#FF3B5C]">
              Couldn&apos;t load
            </p>
            <pre className="overflow-auto rounded bg-black/60 p-3 text-xs text-white/70">
              {state.message}
            </pre>
          </Card>
        )}

        {state.kind === "ok" && (
          <ProviderBody
            info={state.info}
            jobs={state.jobs}
            heartbeat={state.heartbeat}
            fetchedAt={state.fetchedAt}
          />
        )}
      </div>
    </main>
  );
}

// ─── Body when the Provider exists ─────────────────────────────────────

function ProviderBody({
  info,
  jobs,
  heartbeat,
  fetchedAt,
}: {
  info: ProviderInfo;
  jobs: JobRow[];
  heartbeat: HeartbeatStatus;
  fetchedAt: number;
}) {
  const statusName = ProviderStatus[info.status] ?? `Unknown(${info.status})`;
  const isActive = info.status === ProviderStatus.Active;
  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <SectionTitle>On-chain identity</SectionTitle>
            <StatusBadge label={statusName} active={isActive} />
            <LivenessBadge heartbeat={heartbeat} />
          </div>
          <Link
            href={`/submit?provider=${info.pda}`}
            className={
              isActive
                ? "inline-flex items-center gap-2 rounded-lg bg-[#14F195] px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-wider text-black shadow-[0_0_30px_-5px_rgba(20,241,149,0.6)] transition hover:scale-[1.02]"
                : "inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.03] px-5 py-2.5 font-mono text-xs uppercase tracking-wider text-white/55 transition hover:border-white/30"
            }
          >
            Submit a job here
            <ArrowRight className="h-4 w-4" strokeWidth={2} />
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
          <Row label="Provider PDA" value={info.pda} link={explorerAccountUrl(info.pda)} />
          <Row label="Authority" value={info.authority} link={explorerAccountUrl(info.authority)} />
          <Row label="Bond vault" value={info.bondVault} link={explorerAccountUrl(info.bondVault)} />
          <Row label="Active jobs" value={info.activeJobs.toString()} />
          <Row label="Total served" value={info.totalJobs.toString()} />
          <Row
            label="Last synced"
            value={new Date(fetchedAt).toLocaleTimeString()}
          />
        </div>
        {!isActive && (
          <p className="rounded-md border border-[#FF3B5C]/30 bg-[#FF3B5C]/[0.05] px-3 py-2 font-mono text-xs text-[#FF3B5C]">
            Provider status is <strong>{statusName}</strong>. Jobs targeting
            it may not be accepted.
          </p>
        )}
      </Card>

      <HardwareCard heartbeat={heartbeat} />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between border-b border-white/10 pb-3">
          <h2 className="text-2xl font-semibold tracking-tight">
            Jobs on this provider
            <span className="ml-3 font-mono text-base text-white/40">
              ({jobs.length})
            </span>
          </h2>
          <p className="font-mono text-[10px] uppercase tracking-wider text-white/35">
            currently open on-chain
          </p>
        </div>
        {jobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 p-8 text-center font-mono text-xs text-white/40">
            No open jobs right now. Settled jobs close their accounts on-chain;
            historical settlement data lives in Solana Explorer&apos;s tx history.
          </div>
        ) : (
          jobs
            .sort((a, b) => b.fundedAt - a.fundedAt)
            .map((j) => <JobLine key={j.pda} job={j} />)
        )}
      </section>
    </div>
  );
}

function JobLine({ job }: { job: JobRow }) {
  const statusName = JobStatus[job.status] ?? `Unknown(${job.status})`;
  const accent = jobStatusAccent(job.status);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="grid grid-cols-1 gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs md:grid-cols-[2fr_1fr_1fr_1fr_auto]"
    >
      <Link
        href={`/job/${job.pda}`}
        className="truncate font-mono text-white/85 underline-offset-2 hover:text-[#14F195] hover:underline"
      >
        {job.pda.slice(0, 16)}…{job.pda.slice(-6)}
      </Link>
      <span className="font-mono text-[#14F195]">
        {formatUsdc(job.priceLamports)} USDC
      </span>
      <span className="font-mono text-white/60">
        from {job.buyer.slice(0, 4)}…{job.buyer.slice(-4)}
      </span>
      <span className="font-mono text-white/45">{timeUntil(job.deadline)}</span>
      <span
        className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
        style={{
          color: accent,
          backgroundColor: `${accent}1f`,
          border: `1px solid ${accent}40`,
        }}
      >
        {statusName}
      </span>
    </motion.div>
  );
}

// ─── Small primitives ──────────────────────────────────────────────────

function LivenessBadge({ heartbeat }: { heartbeat: HeartbeatStatus }) {
  if (heartbeat.kind === "online") {
    const age = Math.max(0, Math.round(heartbeat.ageMs / 1000));
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-[#14F195]/40 bg-[#14F195]/[0.08] px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-[#14F195]">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#14F195] shadow-[0_0_8px_rgba(20,241,149,0.8)]" />
        live · {age}s ago
      </span>
    );
  }
  if (heartbeat.kind === "offline") {
    const detail =
      heartbeat.lastSeen && heartbeat.ageMs != null
        ? `last seen ${formatDuration(heartbeat.ageMs)} ago`
        : "never seen";
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-white/50">
        <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
        offline · {detail}
      </span>
    );
  }
  if (heartbeat.kind === "error") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-[#FF3B5C]/30 bg-[#FF3B5C]/[0.05] px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-[#FF3B5C]">
        liveness probe failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-white/40">
      checking liveness…
    </span>
  );
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

// ── Hardware + throughput card (Sprint 3.1b) ────────────────────────
//
// Surfaces the desktop-published fields the worker carries in its
// signed heartbeat: chip, RAM, CPU cores, capacity (max concurrent
// jobs), most-recent Flux Schnell benchmark, and the provider's
// self-suggested per-job price. When the provider has never sent a
// heartbeat the card collapses to a short hint; when the heartbeat is
// stale we still show the last-known values with a "from N min ago"
// label, since the hardware shape doesn't change between restarts.

function HardwareCard({ heartbeat }: { heartbeat: HeartbeatStatus }) {
  const record =
    heartbeat.kind === "online"
      ? heartbeat.record
      : heartbeat.kind === "offline"
        ? heartbeat.lastSeen
        : null;

  if (!record) {
    return (
      <Card>
        <SectionTitle>Hardware & throughput</SectionTitle>
        <p className="font-mono text-xs text-white/45">
          No heartbeat received yet — this provider hasn't reported its
          hardware. Cards refresh every 30 s once the worker comes online.
        </p>
      </Card>
    );
  }

  const hasHardware = record.chip || record.ramGb > 0 || record.cpuCores > 0;
  const seconds =
    record.secondsPerImage != null
      ? parseFloat(record.secondsPerImage)
      : null;
  const jobsPerHour =
    seconds && seconds > 0 ? Math.round(3600 / seconds) : null;
  const suggested =
    record.suggestedPriceUsdcBase != null
      ? safeBigint(record.suggestedPriceUsdcBase)
      : null;

  const ageHint =
    heartbeat.kind === "online"
      ? "live"
      : heartbeat.kind === "offline" && heartbeat.ageMs != null
        ? `from ${formatDuration(heartbeat.ageMs)} ago`
        : "stale";

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <SectionTitle>Hardware & throughput</SectionTitle>
        <span className="font-mono text-[10px] uppercase tracking-wider text-white/40">
          worker v{record.version} · {ageHint}
        </span>
      </div>

      {!hasHardware ? (
        <p className="font-mono text-xs text-white/45">
          Worker is running standalone — no desktop app to publish chip /
          RAM details. The provider can still accept jobs; you just won't
          see machine info here.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
          {record.chip && (
            <HardwareCell label="Chip" value={record.chip} accent="green" />
          )}
          {record.ramGb > 0 && (
            <HardwareCell label="Memory" value={`${record.ramGb} GB`} />
          )}
          {record.cpuCores > 0 && (
            <HardwareCell
              label="CPU cores"
              value={record.cpuCores.toString()}
            />
          )}
          <HardwareCell
            label="Concurrent jobs"
            value={record.capacity.toString()}
          />
        </div>
      )}

      {(seconds !== null || suggested !== null) && (
        <div className="grid grid-cols-2 gap-3 border-t border-white/5 pt-4 text-xs md:grid-cols-3">
          {seconds !== null && (
            <HardwareCell
              label="Flux Schnell"
              value={`${seconds.toFixed(2)}s / image`}
              accent="violet"
            />
          )}
          {jobsPerHour !== null && (
            <HardwareCell
              label="Throughput"
              value={`~${jobsPerHour} images/hr`}
            />
          )}
          {suggested !== null && (
            <HardwareCell
              label="Suggested price"
              value={`${formatUsdc(suggested)} USDC`}
              accent="green"
            />
          )}
        </div>
      )}
    </Card>
  );
}

function HardwareCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "green" | "violet";
}) {
  const colorClass =
    accent === "green"
      ? "text-[#14F195]"
      : accent === "violet"
        ? "text-[#9945FF]"
        : "text-white/85";
  return (
    <div className="space-y-1">
      <p className="font-mono text-[10px] uppercase tracking-wider text-white/40">
        {label}
      </p>
      <p className={`font-mono text-sm ${colorClass}`}>{value}</p>
    </div>
  );
}

/** Defensive bigint parser — the heartbeat field is a string from KV
 *  so a malformed entry shouldn't crash the page. */
function safeBigint(s: string): bigint | null {
  try {
    return BigInt(s);
  } catch {
    return null;
  }
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
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="space-y-4 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-6"
    >
      {children}
    </motion.section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold tracking-tight">{children}</h2>;
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
          href="/stats"
          className="font-mono text-xs uppercase tracking-wider text-white/60 transition hover:text-[#14F195]"
        >
          stats
        </Link>
        <Link
          href="/history"
          className="font-mono text-xs uppercase tracking-wider text-white/60 transition hover:text-[#14F195]"
        >
          history
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

// ─── Helpers ───────────────────────────────────────────────────────────

function base64ToBytes(b64: string): ReadonlyUint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function jobStatusAccent(s: JobStatus): string {
  switch (s) {
    case JobStatus.Funded:
    case JobStatus.Started:
      return "#9945FF";
    case JobStatus.Completed:
      return "#14F195";
    case JobStatus.Disputed:
      return "#FFC857";
    case JobStatus.Refunded:
    case JobStatus.Slashed:
      return "#FF3B5C";
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
