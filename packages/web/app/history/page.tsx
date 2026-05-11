"use client";

// /history — buyer's job history page (Sprint 3.2).
//
// PRD §F2 requires a "history" surface. Today the only place a buyer
// sees their past jobs is the top-of-/submit cache (last 5 visible).
// This page hydrates the full localStorage history (last 25 per
// wallet), joins each entry with its current on-chain Job state, and
// classifies it as still-open, settled, or stale-unknown.
//
// Why localStorage rather than a server-side index of "all jobs by
// buyer": Anchor closes the Job account on settle/cancel, so once a
// job completes the on-chain footprint is gone. We could rebuild the
// list from getSignaturesForAddress on the buyer's wallet — that's
// the Phase 2 indexer story. For MVP scope the localStorage cache
// is the source of truth for "what jobs has this wallet ever
// created"; current on-chain state is the source of truth for "what's
// happening with each one right now."

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useWalletConnection } from "@solana/react-hooks";
import type { Address } from "@solana/kit";

import {
  fetchMaybeJob,
  JobStatus,
} from "@/app/lib/apis-program";
import { useSolanaClient } from "@solana/react-hooks";
import { formatUsdc } from "@/app/lib/constants";
import { explorerAccountUrl } from "@/app/lib/apis";
import { loadHistory, type JobHistoryEntry } from "@/app/lib/job-history";
import { NavBar } from "@/app/components/ui/navbar";

type HistoryRow = JobHistoryEntry & {
  /** On-chain status if the Job account still exists; null when the
   *  account is gone (settled/cancelled — settled jobs close their
   *  PDA, rent refunds to the buyer). */
  onChainStatus: JobStatus | null;
  /** Resolved provider PDA from chain — useful for linking back to
   *  the provider profile from the row. Null when the account is
   *  gone or hasn't been fetched yet. */
  providerPda: Address | null;
};

type State =
  | { kind: "wallet-disconnected" }
  | { kind: "loading" }
  | { kind: "ok"; rows: HistoryRow[]; fetchedAt: number }
  | { kind: "error"; message: string };

const POLL_MS = 30_000;

export default function HistoryPage() {
  const { wallet } = useWalletConnection();
  const client = useSolanaClient();
  const buyer = wallet?.account.address ?? null;
  const [state, setState] = useState<State>({ kind: "loading" });
  // Manual-retry trigger — bumped by the error-state retry button.
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!buyer) {
      setState({ kind: "wallet-disconnected" });
      return;
    }
    let cancelled = false;

    const fetchAll = async () => {
      const entries = loadHistory(buyer);
      if (entries.length === 0) {
        if (!cancelled)
          setState({
            kind: "ok",
            rows: [],
            fetchedAt: Date.now(),
          });
        return;
      }

      // Resolve every entry's current on-chain state in parallel. The
      // localStorage cache has the historical metadata (prompt, price,
      // created time); the chain has the *current* status. Joining
      // them gives us "what jobs has this wallet created + what's
      // each one doing right now."
      const rows: HistoryRow[] = await Promise.all(
        entries.map(async (e): Promise<HistoryRow> => {
          try {
            const maybe = await fetchMaybeJob(
              client.runtime.rpc,
              e.pda as Address,
            );
            if (maybe.exists) {
              return {
                ...e,
                onChainStatus: maybe.data.status,
                providerPda: maybe.data.provider,
              };
            }
            return { ...e, onChainStatus: null, providerPda: null };
          } catch {
            return { ...e, onChainStatus: null, providerPda: null };
          }
        }),
      );

      if (!cancelled)
        setState({ kind: "ok", rows, fetchedAt: Date.now() });
    };

    void fetchAll().catch((err) => {
      if (!cancelled)
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
    });

    // Refresh on-chain state every 30s in case the user leaves the
    // page open while a job progresses.
    const id = setInterval(() => void fetchAll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [buyer, client, retryNonce]);

  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#000] text-[#FAFAF9]">
      <HexGridBackground />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
        <NavBar active="history" />

        <header className="space-y-3 py-12">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#9945FF]">
            apis · your jobs
          </p>
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            Job history
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-white/60">
            Every job this wallet has submitted. Open jobs link through
            to live status; settled ones to their on-chain settlement.
            The list is wallet-scoped + cached in your browser — last 25
            per wallet.
          </p>
        </header>

        {state.kind === "wallet-disconnected" && <WalletGate />}
        {state.kind === "loading" && <LoadingRows n={3} />}
        {state.kind === "error" && (
          <div className="space-y-4 rounded-xl border border-[#FF3B5C]/30 bg-[#FF3B5C]/[0.05] p-6 font-mono text-xs text-[#FF3B5C]">
            <p>
              Failed to load history:{" "}
              <span className="text-white/70">{state.message}</span>
            </p>
            <button
              type="button"
              onClick={() => {
                setState({ kind: "loading" });
                setRetryNonce((n) => n + 1);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#FF3B5C]/40 bg-[#FF3B5C]/[0.1] px-3 py-1.5 uppercase tracking-wider text-[#FF3B5C] transition hover:bg-[#FF3B5C]/[0.18]"
            >
              Try again
            </button>
          </div>
        )}
        {state.kind === "ok" && state.rows.length === 0 && <EmptyState />}
        {state.kind === "ok" && state.rows.length > 0 && (
          <HistoryList rows={state.rows} fetchedAt={state.fetchedAt} />
        )}
      </div>
    </main>
  );
}

function HistoryList({
  rows,
  fetchedAt,
}: {
  rows: HistoryRow[];
  fetchedAt: number;
}) {
  const sorted = [...rows].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="space-y-3 pb-16">
      {sorted.map((r) => (
        <HistoryRowCard key={r.pda} row={r} />
      ))}
      <p className="border-t border-white/5 pt-6 text-center font-mono text-[10px] uppercase tracking-wider text-white/30">
        last synced{" "}
        {Math.max(0, Math.round((Date.now() - fetchedAt) / 1000))}s ago ·
        refreshes every {Math.round(POLL_MS / 1000)}s
      </p>
    </div>
  );
}

function HistoryRowCard({ row }: { row: HistoryRow }) {
  const label = labelForRow(row);
  const accent = accentForLabel(label.kind);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="grid grid-cols-1 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-5 text-xs md:grid-cols-[2fr_1fr_1fr_auto_auto]"
    >
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm text-white/85">
          {row.promptPreview || (
            <span className="italic text-white/40">no prompt cached</span>
          )}
        </p>
        <Link
          href={`/job/${row.pda}`}
          className="font-mono text-[10px] text-white/45 underline-offset-2 hover:text-[#14F195] hover:underline"
        >
          {row.pda.slice(0, 12)}…{row.pda.slice(-6)}
        </Link>
      </div>
      <span className="font-mono text-[#14F195]">
        {formatUsdc(safeBigint(row.priceLamportsUsdc) ?? 0n)} USDC
      </span>
      <span className="font-mono text-white/55">
        {formatRelative(row.createdAt)}
      </span>
      <span
        className="rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider"
        style={{
          color: accent,
          backgroundColor: `${accent}1f`,
          border: `1px solid ${accent}40`,
        }}
      >
        {label.text}
      </span>
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
        <Link
          href={`/job/${row.pda}`}
          className="rounded-md bg-[#14F195]/10 px-2.5 py-1 uppercase tracking-wider text-[#14F195] transition hover:bg-[#14F195]/20"
        >
          open
        </Link>
        <a
          href={explorerAccountUrl(row.pda)}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-white/15 px-2.5 py-1 uppercase tracking-wider text-white/60 transition hover:border-white/30 hover:text-white"
        >
          explorer ↗
        </a>
      </div>
    </motion.div>
  );
}

type RowLabel = {
  kind: "open" | "running" | "settled" | "unknown" | "failed";
  text: string;
};

function labelForRow(row: HistoryRow): RowLabel {
  // Account gone from chain = settled / closed. We can't tell from
  // chain alone whether it was Completed/Refunded/Slashed since the
  // account is closed; the /job/[id] page reads the result KV to
  // resolve. For the list, "settled" covers all three terminal kinds.
  if (row.onChainStatus === null) {
    return { kind: "settled", text: "settled" };
  }
  switch (row.onChainStatus) {
    case JobStatus.Funded:
      return { kind: "open", text: "waiting" };
    case JobStatus.Started:
      return { kind: "running", text: "running" };
    case JobStatus.Completed:
      return { kind: "settled", text: "ready to confirm" };
    case JobStatus.Refunded:
      return { kind: "failed", text: "refunded" };
    case JobStatus.Slashed:
      return { kind: "failed", text: "slashed" };
    case JobStatus.Disputed:
      return { kind: "failed", text: "disputed" };
    case JobStatus.Created:
      return { kind: "open", text: "created" };
    default:
      return { kind: "unknown", text: "unknown" };
  }
}

function accentForLabel(kind: RowLabel["kind"]): string {
  switch (kind) {
    case "open":
      return "#9945FF"; // violet — waiting for provider
    case "running":
      return "#14F195"; // green — provider working
    case "settled":
      return "#FAFAF9"; // white — terminal-positive
    case "failed":
      return "#FF3B5C"; // red
    case "unknown":
    default:
      return "#FAFAF955";
  }
}

function WalletGate() {
  return (
    <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
      <p className="font-mono text-xs uppercase tracking-wider text-white/55">
        wallet required
      </p>
      <p className="mt-3 max-w-md text-balance text-sm leading-relaxed text-white/65 mx-auto">
        Job history is scoped to your wallet — connect Phantom (or any
        Solana wallet) to load the jobs this address has submitted.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-[#14F195]/15 px-4 py-2 font-mono text-xs uppercase tracking-wider text-[#14F195] transition hover:bg-[#14F195]/25"
      >
        Connect on home page →
      </Link>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-transparent p-12 text-center font-mono text-xs text-white/50">
      <p>No jobs submitted yet from this wallet.</p>
      <Link
        href="/submit"
        className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-[#14F195]/15 px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-[#14F195] transition hover:bg-[#14F195]/25"
      >
        Submit your first job →
      </Link>
    </div>
  );
}

function LoadingRows({ n }: { n: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          className="h-[88px] animate-pulse rounded-xl border border-white/5 bg-white/[0.02]"
        />
      ))}
    </div>
  );
}

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

function safeBigint(s: string): bigint | null {
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

function formatRelative(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}
