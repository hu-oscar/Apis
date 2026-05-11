"use client";

// Global error boundary — Sprint 3.4.
//
// Next.js renders this when any client component in the tree throws
// during render. Without it, React unmounts the whole route and shows
// either a white page (prod build) or the default red Next overlay
// (dev). Both are bad — the user has no way back and no idea what
// happened.
//
// The page itself is wrapped in `Providers` (wallet connect, RPC), so
// hitting "Try again" usually fixes transient errors like a flaky RPC
// without forcing a full reload.

import { useEffect } from "react";
import Link from "next/link";
import { ApisLogo } from "@/app/components/ui/apis-logo";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error to the console so the user can copy-paste it
    // into a bug report. We don't ship a remote error pipeline yet
    // (Sentry / OTel queued for Phase 2).
    // eslint-disable-next-line no-console
    console.error("Apis client error:", error);
  }, [error]);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#000] text-[#FAFAF9]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 30% 30%, rgba(255,59,92,0.35) 0%, transparent 45%), radial-gradient(circle at 80% 70%, rgba(153,69,255,0.3) 0%, transparent 45%)",
        }}
      />
      <div className="relative z-10 mx-auto max-w-lg space-y-6 px-6 text-center">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 group"
          aria-label="Apis home"
        >
          <ApisLogo size={26} className="transition group-hover:scale-105" />
          <span className="font-mono text-lg font-bold tracking-tight text-[#FAFAF9] transition group-hover:text-[#14F195]">
            apis
          </span>
        </Link>

        <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#FF3B5C]">
          something broke
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Couldn&apos;t render this page.
        </h1>
        <p className="text-sm leading-relaxed text-white/60">
          A client-side error stopped the page from loading. Try again —
          most of these are flaky RPCs and clear on retry. If it keeps
          happening, the details below are useful in a bug report.
        </p>

        <details className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-left font-mono text-xs text-white/55">
          <summary className="cursor-pointer text-white/75">
            Show error details
          </summary>
          <pre className="mt-3 overflow-auto whitespace-pre-wrap break-all text-[10px] text-white/60">
            {error.message}
            {error.digest && `\n\ndigest: ${error.digest}`}
          </pre>
        </details>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#14F195] px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-wider text-black shadow-[0_0_30px_-5px_rgba(20,241,149,0.6)] transition hover:scale-[1.02]"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.02] px-5 py-2.5 font-mono text-xs uppercase tracking-wider text-white/75 transition hover:border-white/30"
          >
            Back home
          </Link>
        </div>
      </div>
    </main>
  );
}
