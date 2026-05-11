// Global loading state — Sprint 3.4.
//
// Renders for the brief window between when a navigation starts and
// the destination page's client bundle hydrates. Without it, the
// browser shows a stale view of the previous page with the URL
// changed; with it, a tiny "loading…" hint surfaces instead.
//
// Most routes are statically prerendered, so this rarely shows in
// production — but it's the right escape hatch for dynamic routes
// (/job/[id], /provider/[pda]) on slow networks.

import { ApisLogo } from "@/app/components/ui/apis-logo";

export default function Loading() {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-[#000] text-[#FAFAF9]">
      <div className="flex items-center gap-3" role="status" aria-live="polite">
        <ApisLogo size={26} className="animate-pulse" />
        <span className="font-mono text-xs uppercase tracking-[0.22em] text-white/55">
          loading
          <span className="ml-1 inline-flex">
            <span className="animate-pulse">·</span>
            <span className="animate-pulse [animation-delay:200ms]">·</span>
            <span className="animate-pulse [animation-delay:400ms]">·</span>
          </span>
        </span>
      </div>
    </main>
  );
}
