// Apis Provider — Sprint 2.2 wires the worker subprocess.
//
// The top-bar online toggle now actually starts and stops the
// apis_worker child process. Worker stdout/stderr stream into the
// right-pane log via Tauri events.
//
// Subsequent sprints layer on top of this:
//   2.3 — settings drawer for HF_TOKEN, PINATA_JWT, APIS_API_BASE,
//         keypair path; populates the env passed to start_worker
//   2.4 — parse stdout for JobCreated / accept_job / submit_completion
//         and render a tidy event timeline alongside the raw log
//   2.5 — read the on-chain Provider PDA and surface registered/active
//         + active_jobs counters in the left rail
//   2.6 — bundle as a .app + first-launch onboarding wizard

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type LogEntry = {
  stream: "stdout" | "stderr";
  line: string;
  at: number;
};

// Wire log entries to a coarse severity for colorization. Matches the
// apis_worker log format which uses `[INFO]` / `[WARN]` / `[ERROR]` /
// `[DEBUG]` brackets. Anything from stderr we treat as at least warn.
function severityFor(entry: LogEntry): "event" | "warn" | "error" | "dim" {
  const line = entry.line;
  if (entry.stream === "stderr" && /Traceback|Error/i.test(line)) return "error";
  if (/\b\[ERROR\]\b/.test(line)) return "error";
  if (/\b\[WARN(ING)?\]\b/.test(line)) return "warn";
  if (entry.stream === "stderr") return "warn";
  if (/JobCreated|accept_job|submit_completion|confirm_completion|✓/.test(line))
    return "event";
  return "dim";
}

const MAX_LOG_LINES = 1000;

function App() {
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logScrollRef = useRef<HTMLDivElement>(null);

  // Subscribe to worker-log events from Rust. Tauri's listen returns a
  // promise resolving to an unlisten fn; we collect it and call on
  // cleanup so React strict-mode mounts/unmounts don't double-subscribe.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      const off = await listen<LogEntry>("worker-log", (event) => {
        setLogs((prev) => {
          const next = [...prev, event.payload];
          // Cap the buffer so a long-running worker doesn't bloat memory.
          return next.length > MAX_LOG_LINES
            ? next.slice(next.length - MAX_LOG_LINES)
            : next;
        });
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
  }, []);

  // Auto-scroll the log pane to the bottom on new lines.
  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [logs]);

  // Reconcile UI state with actual worker state every 5 s — catches
  // the case where the child died on its own (HF auth, GPU panic, etc).
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const alive = await invoke<boolean>("worker_status");
        if (!cancelled) setOnline(alive);
      } catch {
        /* swallow — UI shows current cached state */
      }
    };
    void probe();
    const id = setInterval(probe, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const handleToggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (online) {
        await invoke("stop_worker");
        setOnline(false);
      } else {
        await invoke("start_worker", {
          config: {
            // Sprint 2.3 will replace these with values from a settings
            // store. For 2.2 we hardcode the dev-machine layout — the
            // worker venv next to the Tauri app under packages/worker.
            python_path: null,
            working_dir: null,
            env: [],
          },
        });
        setOnline(true);
        setLogs((prev) => [
          ...prev,
          {
            stream: "stdout",
            line: "── starting worker subprocess ──",
            at: Date.now(),
          },
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOnline(false);
    } finally {
      setBusy(false);
    }
  }, [busy, online]);

  return (
    <div className="app-shell">
      <TopBar online={online} busy={busy} onToggle={handleToggle} />

      <main className="main">
        <aside className="left-col">
          <ProviderCard />
          <EarningsCard />
          <NetworkCard />
        </aside>

        <section className="right-col">
          <LogPanel logs={logs} error={error} scrollRef={logScrollRef} />
        </section>
      </main>

      <StatusBar online={online} />
    </div>
  );
}

// ── Top bar ──────────────────────────────────────────────────────────

function TopBar({
  online,
  busy,
  onToggle,
}: {
  online: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <img src="/icon.svg" alt="apis" />
        <span className="brand-name">apis · provider</span>
        <span className="brand-tag">devnet</span>
      </div>

      <div className="topbar-actions">
        <button
          className={online ? "online-toggle is-online" : "online-toggle"}
          onClick={onToggle}
          disabled={busy}
          type="button"
        >
          <span className="dot" />
          {busy ? "…" : online ? "online" : "offline"}
        </button>
        <button className="settings-btn" title="Settings" type="button">
          ⚙
        </button>
      </div>
    </header>
  );
}

// ── Left-rail cards (placeholder — wired in Sprints 2.5 / 2.4) ──────

function ProviderCard() {
  return (
    <div className="card">
      <h3>Provider PDA</h3>
      <div className="kv-row">
        <span className="kv-label">PDA</span>
        <span className="kv-value dim">not registered</span>
      </div>
      <div className="kv-row">
        <span className="kv-label">Authority</span>
        <span className="kv-value dim">no keypair loaded</span>
      </div>
      <div className="kv-row">
        <span className="kv-label">Status</span>
        <span className="kv-value dim">—</span>
      </div>
      <div className="kv-row">
        <span className="kv-label">Active jobs</span>
        <span className="kv-value">0</span>
      </div>
      <div className="kv-row">
        <span className="kv-label">Total served</span>
        <span className="kv-value">0</span>
      </div>
    </div>
  );
}

function EarningsCard() {
  return (
    <div className="card">
      <h3>Earnings</h3>
      <div className="kv-row">
        <span className="kv-label">Lifetime</span>
        <span className="kv-value green">0.00 USDC</span>
      </div>
      <div className="kv-row">
        <span className="kv-label">Last 24h</span>
        <span className="kv-value">0.00 USDC</span>
      </div>
      <div className="kv-row">
        <span className="kv-label">Pending (escrow)</span>
        <span className="kv-value violet">0.00 USDC</span>
      </div>
    </div>
  );
}

function NetworkCard() {
  return (
    <div className="card">
      <h3>Network</h3>
      <div className="kv-row">
        <span className="kv-label">Cluster</span>
        <span className="kv-value">devnet</span>
      </div>
      <div className="kv-row">
        <span className="kv-label">Program</span>
        <span className="kv-value">2qe8YXc…SiH868mhf</span>
      </div>
      <div className="kv-row">
        <span className="kv-label">RPC</span>
        <span className="kv-value dim">public devnet</span>
      </div>
    </div>
  );
}

// ── Logs ─────────────────────────────────────────────────────────────

function LogPanel({
  logs,
  error,
  scrollRef,
}: {
  logs: LogEntry[];
  error: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="card log-panel">
      <h3>Worker logs · live</h3>
      <div className="log-output" ref={scrollRef}>
        {error && <div className="log-line error">[error] {error}</div>}
        {logs.length === 0 && !error && (
          <div className="log-empty">
            Worker hasn't run yet. Click "offline" in the top bar to start it.
          </div>
        )}
        {logs.map((e, i) => (
          <div key={i} className={`log-line ${severityFor(e)}`}>
            {e.line}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Status bar ───────────────────────────────────────────────────────

function StatusBar({ online }: { online: boolean }) {
  return (
    <footer className="statusbar">
      <span>{online ? "worker · running" : "worker · idle"} · v0.1.0</span>
      <a
        href="https://apis-web-five.vercel.app"
        target="_blank"
        rel="noreferrer"
      >
        apis-web-five.vercel.app ↗
      </a>
    </footer>
  );
}

export default App;
