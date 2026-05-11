// GPU utilization listener — Sprint 2.9 of Phase 1.5.
//
// Subscribes to the `gpu-status` events emitted by the Rust monitor
// (one every 5 s) and exposes the latest sample + a rolling average
// the auto-pause policy can use to filter out instantaneous spikes.

import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

/** Wire shape emitted by the Rust side. `percent` is null when the
 *  parser couldn't extract a value (unsupported hardware, missing
 *  ioreg key). */
export type GpuStatusEvent = {
  percent: number | null;
  at: number;
};

export type GpuStatus = {
  /** Most recent raw sample (percent or null). */
  current: number | null;
  /** Rolling average over the window, integer percent. Null until at
   *  least one numeric sample has been observed. */
  average: number | null;
  /** Last sample timestamp (unix ms). Null before the first event. */
  at: number | null;
};

const DEFAULT_WINDOW_MS = 60_000;

/** Subscribe to `gpu-status` events and expose the latest sample +
 *  a rolling average over `windowMs` (default 60s). The window is
 *  long enough that a one-off spike doesn't trip the auto-pause but
 *  short enough that sustained pressure is caught quickly. */
export function useGpuStatus(windowMs: number = DEFAULT_WINDOW_MS): GpuStatus {
  const [status, setStatus] = useState<GpuStatus>({
    current: null,
    average: null,
    at: null,
  });
  // Raw samples in a ref so pushing one doesn't force a render — only
  // recomputing `status` does.
  const samples = useRef<GpuStatusEvent[]>([]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      const off = await listen<GpuStatusEvent>("gpu-status", (event) => {
        const ev = event.payload;
        samples.current.push(ev);
        // Prune anything older than the window. Constant-time amortized
        // since events arrive every 5s — shift() loop runs once per
        // tick at most.
        const cutoff = ev.at - windowMs;
        while (samples.current.length > 0 && samples.current[0].at < cutoff) {
          samples.current.shift();
        }
        // Average only the numeric samples — `null` readings (e.g.
        // ioreg blip) shouldn't drag the average down.
        const nums = samples.current
          .map((s) => s.percent)
          .filter((p): p is number => typeof p === "number");
        const avg =
          nums.length > 0
            ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
            : null;
        setStatus({ current: ev.percent, average: avg, at: ev.at });
      });
      if (cancelled) {
        off();
      } else {
        unlisten = off;
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [windowMs]);

  return status;
}
