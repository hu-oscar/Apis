// Apis Provider — Sprints 2.1 → 2.3.
//
//   2.1 — Cyberpunk Swarm UI shell (top bar / left rail / log pane / status bar)
//   2.2 — start_worker / stop_worker / worker-log event streaming
//   2.3 — persistent settings store (Tauri Store plugin) + settings drawer;
//         settings flow into the env passed to start_worker.
//
// Coming up:
//   2.4 — parse stdout for JobCreated / accept_job / submit_completion
//         and render an event timeline.
//   2.5 — read the on-chain Provider PDA and render real registered/
//         active status + counters in the left rail.
//   2.6 — `tauri build` → unsigned .dmg + first-launch onboarding wizard.

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  settingsToWorkerEnv,
  type Settings,
} from "./lib/settings";

type LogEntry = {
  stream: "stdout" | "stderr";
  line: string;
  at: number;
};

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

  // Settings: loaded on mount, edited in the drawer, saved via the
  // Tauri Store plugin (writes JSON to the app's local data dir).
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await loadSettings();
      if (!cancelled) setSettings(s);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to worker-log events.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      const off = await listen<LogEntry>("worker-log", (event) => {
        setLogs((prev) => {
          const next = [...prev, event.payload];
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

  // Reconcile UI state with actual worker state every 5 s.
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const alive = await invoke<boolean>("worker_status");
        if (!cancelled) setOnline(alive);
      } catch {
        /* swallow */
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
            python_path: settings.pythonPath || null,
            working_dir: settings.workingDir || null,
            env: settingsToWorkerEnv(settings),
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
  }, [busy, online, settings]);

  return (
    <div className="app-shell">
      <TopBar
        online={online}
        busy={busy}
        onToggle={handleToggle}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="main">
        <aside className="left-col">
          <ProviderCard />
          <EarningsCard />
          <NetworkCard apiBase={settings.apisApiBase} />
        </aside>

        <section className="right-col">
          <LogPanel logs={logs} error={error} scrollRef={logScrollRef} />
        </section>
      </main>

      <StatusBar online={online} />

      {settingsOpen && (
        <SettingsDrawer
          initial={settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={(next) => {
            setSettings(next);
            setSettingsOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ── Top bar ──────────────────────────────────────────────────────────

function TopBar({
  online,
  busy,
  onToggle,
  onOpenSettings,
}: {
  online: boolean;
  busy: boolean;
  onToggle: () => void;
  onOpenSettings: () => void;
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
        <button
          className="settings-btn"
          title="Settings"
          type="button"
          onClick={onOpenSettings}
        >
          ⚙
        </button>
      </div>
    </header>
  );
}

// ── Settings drawer ──────────────────────────────────────────────────

function SettingsDrawer({
  initial,
  onClose,
  onSaved,
}: {
  initial: Settings;
  onClose: () => void;
  onSaved: (next: Settings) => void;
}) {
  const [draft, setDraft] = useState<Settings>(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const setField =
    (key: keyof Settings) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((d) => ({ ...d, [key]: e.target.value }));

  const handleSave = async () => {
    setStatus("saving");
    setErrorMsg(null);
    try {
      await saveSettings(draft);
      setStatus("saved");
      // Close after a tiny delay so the "saved ✓" registers visually.
      setTimeout(() => onSaved(draft), 200);
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="settings-backdrop" onClick={onClose} />
      <aside
        className="settings-drawer"
        role="dialog"
        aria-label="Settings"
      >
        <header className="settings-header">
          <h2>Settings</h2>
          <button
            className="settings-close"
            onClick={onClose}
            aria-label="Close"
            type="button"
          >
            ×
          </button>
        </header>

        <div className="settings-body">
          <Field
            label="HuggingFace token"
            value={draft.hfToken}
            onChange={setField("hfToken")}
            placeholder="hf_…"
            hint={
              <>
                Required to download <code>FLUX.1-schnell</code>. Create one at{" "}
                <code>huggingface.co/settings/tokens</code> with Read scope.
              </>
            }
          />
          <Field
            label="Pinata JWT"
            value={draft.pinataJwt}
            onChange={setField("pinataJwt")}
            placeholder="eyJhbGciOi…"
            hint={
              <>
                Required to upload result PNGs to IPFS. Files: Write scope at{" "}
                <code>app.pinata.cloud/developers/api-keys</code>.
              </>
            }
          />
          <Field
            label="Apis API base"
            value={draft.apisApiBase}
            onChange={setField("apisApiBase")}
            placeholder="https://apis-web-five.vercel.app"
            hint={
              <>
                URL of the deployed Apis web app. Worker fetches specs +
                posts results + posts heartbeat here. Leave empty for local-only.
              </>
            }
          />
          <Field
            label="Worker keypair path"
            value={draft.workerKeypair}
            onChange={setField("workerKeypair")}
            placeholder="~/.config/apis/worker.json"
            hint={
              <>
                Solana keypair for the worker. Generate via{" "}
                <code>solana-keygen new --outfile ~/.config/apis/worker.json</code>.
              </>
            }
          />
          <Field
            label="Python interpreter"
            value={draft.pythonPath}
            onChange={setField("pythonPath")}
            placeholder="(empty = python3 on PATH)"
            hint={
              <>
                Path to a Python that has <code>apis_worker</code> installed —
                typically <code>packages/worker/.venv/bin/python</code>.
              </>
            }
          />
          <Field
            label="Working directory"
            value={draft.workingDir}
            onChange={setField("workingDir")}
            placeholder="(empty = current dir)"
            hint={
              <>
                Working dir for the spawned worker, usually{" "}
                <code>packages/worker</code>.
              </>
            }
          />
        </div>

        <footer className="settings-footer">
          <span
            className={
              status === "saved"
                ? "settings-status ok"
                : status === "error"
                  ? "settings-status error"
                  : "settings-status"
            }
          >
            {status === "saving" && "Saving…"}
            {status === "saved" && "Saved ✓"}
            {status === "error" && (errorMsg ?? "Save failed")}
            {status === "idle" && "Persisted to app data dir"}
          </span>
          <button
            className="settings-save"
            onClick={handleSave}
            disabled={status === "saving"}
            type="button"
          >
            {status === "saving" ? "Saving…" : "Save"}
          </button>
        </footer>
      </aside>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="settings-field">
      <label>{label}</label>
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

// ── Left-rail cards ──────────────────────────────────────────────────

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

function NetworkCard({ apiBase }: { apiBase: string }) {
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
        <span className="kv-label">API base</span>
        <span className={apiBase ? "kv-value" : "kv-value dim"}>
          {apiBase ? prettyHost(apiBase) : "local-only"}
        </span>
      </div>
    </div>
  );
}

function prettyHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
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
