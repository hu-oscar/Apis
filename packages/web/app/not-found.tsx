// Branded 404 — Sprint 3.4.
//
// Next.js renders this for any unmatched route, replacing the default
// generic 404. Stays consistent with the Cyberpunk Swarm aesthetic so
// a user who fat-fingers a URL still feels they're on the Apis site.

import Link from "next/link";
import { ApisLogo } from "@/app/components/ui/apis-logo";

export const metadata = {
  title: "404 — Apis",
};

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#000] text-[#FAFAF9]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgba(20,241,149,0.45) 0%, transparent 40%), radial-gradient(circle at 80% 70%, rgba(153,69,255,0.4) 0%, transparent 40%)",
        }}
      />
      <div className="relative z-10 mx-auto max-w-md space-y-6 px-6 text-center">
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
        <p
          className="font-mono text-7xl font-bold tracking-tight text-[#9945FF]"
          aria-label="404"
        >
          404
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          That page is off-chain.
        </h1>
        <p className="text-sm leading-relaxed text-white/55">
          The URL you followed doesn&apos;t match a route in this app.
          The Apis marketplace lives at <code>/</code>, <code>/network</code>,{" "}
          <code>/stats</code>, <code>/submit</code>, and{" "}
          <code>/job/[id]</code>.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#14F195] px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-wider text-black shadow-[0_0_30px_-5px_rgba(20,241,149,0.6)] transition hover:scale-[1.02]"
          >
            Take me home →
          </Link>
          <Link
            href="/network"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.02] px-5 py-2.5 font-mono text-xs uppercase tracking-wider text-white/75 transition hover:border-white/30"
          >
            Browse providers
          </Link>
        </div>
      </div>
    </main>
  );
}
