// Shared loading panel — Sprint 3.5 patch.
//
// Replaces bare skeleton-row loading states on /network and /stats
// with an on-brand HexSwarm + a friendly label so the user knows
// the page is alive while waiting for the Pinata-backed heartbeat
// fetches to land (~5s per provider on cold cache).
//
// Used inside an existing layout (e.g. main page wrapper), so it
// owns vertical spacing but no horizontal centering — the parent
// controls width.

import { HexSwarm } from "./hex-swarm";

export function LoadingPanel({
  label,
  hint,
}: {
  /** Main label shown next to / under the hex swarm.
   *  Should be lowercase to match the rest of the site's
   *  tracked-out mono aesthetic. */
  label: string;
  /** Optional second-line explainer — e.g. "first load takes ~5s
   *  while heartbeats land". Helps the user not panic when the
   *  fetch is genuinely slow. */
  hint?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.02] py-16"
    >
      <HexSwarm size={22} duration={1.4} label={label} />
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/55">
        {label}
      </p>
      {hint && (
        <p className="max-w-xs text-center font-mono text-[10px] leading-relaxed text-white/35">
          {hint}
        </p>
      )}
    </div>
  );
}
