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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import {
  DEFAULT_SETTINGS,
  hasOnboarded,
  loadSettings,
  markOnboarded,
  saveSettings,
  settingsToWorkerEnv,
  type Settings,
} from "./lib/settings";
import { Onboarding } from "./components/Onboarding";
import {
  buildTimeline,
  phaseAccent,
  phaseLabel,
  phaseProgress,
  type JobState,
} from "./lib/event-parser";
import type { LogEntry } from "./lib/log-types";
import {
  ProviderStatus,
  queryProvider,
  type ProviderQueryResult,
} from "./lib/provider-status";
import { setTrayState } from "./lib/tray";
import {
  aggregateEarnings,
  loadHistory,
  saveHistory,
  type HistoryEntry,
} from "./lib/job-history";

type DerivedProvider = { authority: string; pda: string };

type ProviderUiState =
  | { kind: "no-keypair" }
  | { kind: "deriving" }
  | { kind: "derive-error"; message: string }
  | { kind: "querying"; derived: DerivedProvider }
  | {
      kind: "loaded";
      derived: DerivedProvider;
      onChain: ProviderQueryResult;
      fetchedAt: number;
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

  // Persistent job history: hydrated from the Tauri store on mount,
  // appended-to when the live timeline observes a new completion.
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // Set of PDAs we've already persisted, so the timeline observer
  // doesn't double-write on every re-render.
  const persistedPdas = useRef<Set<string>>(new Set());
  // Wall-clock reference for relative-time + 24h bucketing. Tick
  // every 30 s so the EarningsCard stays accurate without burning
  // re-renders on every animation frame.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Settings: loaded on mount, edited in the drawer, saved via the
  // Tauri Store plugin (writes JSON to the app's local data dir).
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [s, onboarded, h] = await Promise.all([
        loadSettings(),
        hasOnboarded(),
        loadHistory(),
      ]);
      if (cancelled) return;
      setSettings(s);
      setShowOnboarding(!onboarded);
      setHistory(h);
      // Seed the dedup set so we don't re-persist what's already on disk.
      for (const e of h) persistedPdas.current.add(e.shortPda);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Wall-clock tick for the 24h bucket + the "Xm ago" labels. 30 s
  // resolution is enough — earnings totals don't change between ticks,
  // only their bucket assignment does.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Provider PDA: derived from the worker keypair (via Python helper)
  // then queried on-chain. Refreshes every 30 s + on settings change.
  const [providerUi, setProviderUi] = useState<ProviderUiState>({
    kind: "no-keypair",
  });
  const [registerBusy, setRegisterBusy] = useState(false);

  useEffect(() => {
    if (!settings.workerKeypair) {
      setProviderUi({ kind: "no-keypair" });
      return;
    }
    let cancelled = false;

    const sync = async () => {
      try {
        if (!cancelled) setProviderUi({ kind: "deriving" });
        const derived = await invoke<DerivedProvider>("derive_provider_pda", {
          pythonPath: settings.pythonPath || null,
          workingDir: settings.workingDir || null,
          keypairPath: settings.workerKeypair,
        });
        if (cancelled) return;
        setProviderUi({ kind: "querying", derived });
        const onChain = await queryProvider(derived.pda);
        if (cancelled) return;
        setProviderUi({
          kind: "loaded",
          derived,
          onChain,
          fetchedAt: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        setProviderUi({
          kind: "derive-error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };
    void sync();
    const id = setInterval(() => void sync(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [settings.workerKeypair, settings.pythonPath, settings.workingDir]);

  const handleRegister = useCallback(async () => {
    if (registerBusy || !settings.workerKeypair) return;
    setRegisterBusy(true);
    try {
      await invoke<string>("register_provider_subprocess", {
        pythonPath: settings.pythonPath || null,
        workingDir: settings.workingDir || null,
        keypairPath: settings.workerKeypair,
      });
      // Force-refresh: bump derive→query immediately so the UI flips.
      const derived = await invoke<DerivedProvider>("derive_provider_pda", {
        pythonPath: settings.pythonPath || null,
        workingDir: settings.workingDir || null,
        keypairPath: settings.workerKeypair,
      });
      const onChain = await queryProvider(derived.pda);
      setProviderUi({
        kind: "loaded",
        derived,
        onChain,
        fetchedAt: Date.now(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegisterBusy(false);
    }
  }, [
    registerBusy,
    settings.workerKeypair,
    settings.pythonPath,
    settings.workingDir,
  ]);

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

  // Live timeline reduced from the in-memory log buffer. Hoisted out
  // of TimelinePanel so the persistence effect + the EarningsCard can
  // share the same memoized list.
  const timeline = useMemo(() => buildTimeline(logs), [logs]);

  // Observe the timeline for newly-completed jobs and append them to
  // the persisted history. Dedup via `persistedPdas` so re-renders
  // (which happen on every log line) don't re-write the same entry.
  useEffect(() => {
    const fresh: HistoryEntry[] = [];
    for (const j of timeline) {
      if (j.phase !== "completed") continue;
      if (persistedPdas.current.has(j.shortPda)) continue;
      persistedPdas.current.add(j.shortPda);
      fresh.push({
        shortPda: j.shortPda,
        completedAt: j.lastUpdate,
        priceUsdcBase: (j.priceLamports ?? 0n).toString(),
        buyer: j.buyer ?? "",
        resultUrl: j.resultUrl,
        submitTxUrl: j.submitTxUrl,
        proofHashHex: j.proofHashHex,
      });
    }
    if (fresh.length === 0) return;
    // Prepend (newest-first) and persist asynchronously. We don't
    // await the save: a transient store failure shouldn't keep the UI
    // out of sync — next completion will retry.
    setHistory((prev) => {
      const next = [...fresh, ...prev];
      void saveHistory(next);
      return next;
    });
  }, [timeline]);

  // Pending = sum of buyer-specified prices for jobs that are still
  // running (any phase before completed/failed).
  const inFlightPrices = useMemo<bigint[]>(
    () =>
      timeline
        .filter((j) => j.phase !== "completed" && j.phase !== "failed")
        .map((j) => j.priceLamports ?? 0n),
    [timeline],
  );

  const earnings = useMemo(
    () => aggregateEarnings(history, inFlightPrices, nowMs),
    [history, inFlightPrices, nowMs],
  );

  // Reconcile UI state with actual worker state every 5 s. Also
  // mirrors the live status to the menu-bar tray so a glance is
  // enough to know whether jobs are still being served — even when
  // the window is hidden.
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const alive = await invoke<boolean>("worker_status");
        if (cancelled) return;
        setOnline(alive);
        void setTrayState(alive ? "active" : "paused");
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
        void setTrayState("paused");
      } else {
        await invoke("start_worker", {
          config: {
            python_path: settings.pythonPath || null,
            working_dir: settings.workingDir || null,
            env: settingsToWorkerEnv(settings),
          },
        });
        setOnline(true);
        void setTrayState("active");
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
      void setTrayState("error");
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
          <ProviderCard
            state={providerUi}
            registerBusy={registerBusy}
            onRegister={handleRegister}
          />
          <EarningsCard earnings={earnings} />
          <JobHistoryCard history={history} nowMs={nowMs} />
          <NetworkCard apiBase={settings.apisApiBase} />
        </aside>

        <section className="right-col">
          <TimelinePanel timeline={timeline} />
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

      {showOnboarding && (
        <Onboarding
          initial={settings}
          onComplete={async (next) => {
            await saveSettings(next);
            await markOnboarded();
            setSettings(next);
            setShowOnboarding(false);
          }}
          onSkip={() => setShowOnboarding(false)}
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

function ProviderCard({
  state,
  registerBusy,
  onRegister,
}: {
  state: ProviderUiState;
  registerBusy: boolean;
  onRegister: () => void;
}) {
  if (state.kind === "no-keypair") {
    return (
      <div className="card">
        <h3>Provider PDA</h3>
        <p className="provider-hint">
          Set a worker keypair path in <strong>Settings ⚙</strong> to derive
          your Provider PDA.
        </p>
      </div>
    );
  }
  if (state.kind === "deriving" || state.kind === "querying") {
    return (
      <div className="card">
        <h3>Provider PDA</h3>
        <p className="provider-hint">
          {state.kind === "deriving"
            ? "Deriving from keypair…"
            : "Reading on-chain state…"}
        </p>
      </div>
    );
  }
  if (state.kind === "derive-error") {
    return (
      <div className="card">
        <h3>Provider PDA</h3>
        <p className="provider-hint error">
          Couldn't derive: {state.message}
        </p>
      </div>
    );
  }

  const { derived, onChain } = state;
  return (
    <div className="card">
      <h3>Provider PDA</h3>
      <div className="kv-row">
        <span className="kv-label">PDA</span>
        <span className="kv-value">
          {derived.pda.slice(0, 6)}…{derived.pda.slice(-4)}
        </span>
      </div>
      <div className="kv-row">
        <span className="kv-label">Authority</span>
        <span className="kv-value">
          {derived.authority.slice(0, 6)}…{derived.authority.slice(-4)}
        </span>
      </div>

      {onChain.kind === "not_registered" && (
        <>
          <div className="kv-row">
            <span className="kv-label">Status</span>
            <span className="kv-value dim">not registered</span>
          </div>
          <button
            className="provider-register-btn"
            onClick={onRegister}
            disabled={registerBusy}
            type="button"
          >
            {registerBusy ? "Registering…" : "Register provider"}
          </button>
          <p className="provider-hint">
            Pays ~0.002 SOL of rent. After this, buyers can target your
            provider for jobs.
          </p>
        </>
      )}

      {onChain.kind === "registered" && (
        <>
          <div className="kv-row">
            <span className="kv-label">Status</span>
            <span
              className={
                onChain.data.status === ProviderStatus.Active
                  ? "kv-value green"
                  : "kv-value dim"
              }
            >
              {providerStatusLabel(onChain.data.status)}
            </span>
          </div>
          <div className="kv-row">
            <span className="kv-label">Active jobs</span>
            <span className="kv-value">{onChain.data.activeJobs.toString()}</span>
          </div>
          <div className="kv-row">
            <span className="kv-label">Total served</span>
            <span className="kv-value">{onChain.data.totalJobs.toString()}</span>
          </div>
        </>
      )}

      {onChain.kind === "error" && (
        <p className="provider-hint error">RPC error: {onChain.message}</p>
      )}
    </div>
  );
}

function providerStatusLabel(s: ProviderStatus): string {
  switch (s) {
    case ProviderStatus.Active:
      return "active";
    case ProviderStatus.Paused:
      return "paused";
    case ProviderStatus.Slashed:
      return "slashed";
  }
}

function EarningsCard({
  earnings,
}: {
  earnings: { lifetime: bigint; last24h: bigint; pending: bigint };
}) {
  return (
    <div className="card">
      <h3>Earnings</h3>
      <div className="kv-row">
        <span className="kv-label">Lifetime</span>
        <span className="kv-value green">{formatUsdcBase(earnings.lifetime)} USDC</span>
      </div>
      <div className="kv-row">
        <span className="kv-label">Last 24h</span>
        <span className="kv-value">{formatUsdcBase(earnings.last24h)} USDC</span>
      </div>
      <div className="kv-row">
        <span className="kv-label">Pending (escrow)</span>
        <span className="kv-value violet">{formatUsdcBase(earnings.pending)} USDC</span>
      </div>
    </div>
  );
}

// ── Job history (persisted) ──────────────────────────────────────────

function JobHistoryCard({
  history,
  nowMs,
}: {
  history: HistoryEntry[];
  nowMs: number;
}) {
  const last10 = history.slice(0, 10);
  return (
    <div className="card">
      <h3>
        <span>Recent jobs</span>
        {history.length > 0 && (
          <span className="count">{history.length} total</span>
        )}
      </h3>
      {last10.length === 0 ? (
        <p className="provider-hint">
          No completed jobs yet. Once you serve one, the last 10 show
          up here across restarts.
        </p>
      ) : (
        <div className="history-list">
          {last10.map((e) => (
            <HistoryRow key={e.shortPda} entry={e} nowMs={nowMs} />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryRow({ entry, nowMs }: { entry: HistoryEntry; nowMs: number }) {
  // BigInt parsing is wrapped because a malformed persisted entry
  // (e.g. an old log written before the price format settled) would
  // crash the whole panel otherwise.
  let price: bigint;
  try {
    price = BigInt(entry.priceUsdcBase);
  } catch {
    price = 0n;
  }
  return (
    <div className="history-row">
      <div className="history-meta">
        <span className="history-pda">{entry.shortPda}…</span>
        <span className="history-detail">
          <span className="green">{formatUsdcBase(price)} USDC</span>
          <span className="dim">·</span>
          <span>{formatRelativeTime(entry.completedAt, nowMs)}</span>
          {entry.resultUrl && (
            <a href={entry.resultUrl} target="_blank" rel="noreferrer">
              result ↗
            </a>
          )}
          {entry.submitTxUrl && (
            <a href={entry.submitTxUrl} target="_blank" rel="noreferrer">
              tx ↗
            </a>
          )}
        </span>
      </div>
    </div>
  );
}

/** Pure relative-time formatter — takes `nowMs` so callers can use
 *  it inside render without violating React 19's purity rule. */
function formatRelativeTime(ts: number, nowMs: number): string {
  const delta = nowMs - ts;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
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

// ── Timeline ─────────────────────────────────────────────────────────

function TimelinePanel({ timeline }: { timeline: JobState[] }) {
  // Newest first.
  const ordered = useMemo(
    () => [...timeline].sort((a, b) => b.startedAt - a.startedAt),
    [timeline],
  );
  const visible = ordered.slice(0, 8);
  const activeCount = ordered.filter(
    (j) => j.phase !== "completed" && j.phase !== "failed",
  ).length;
  return (
    <div className="card timeline-panel">
      <h3>
        <span>Jobs</span>
        <span className="count">
          {activeCount} active · {ordered.length} total
        </span>
      </h3>
      <div className="timeline-list">
        {visible.length === 0 ? (
          <div className="timeline-empty">
            No jobs yet. Once a buyer sends one to this provider, it shows up
            here with live phase progress.
          </div>
        ) : (
          visible.map((j) => <TimelineRow key={j.shortPda} job={j} />)
        )}
      </div>
    </div>
  );
}

function TimelineRow({ job }: { job: JobState }) {
  const isActive = job.phase !== "completed" && job.phase !== "failed";
  const isDone = job.phase === "completed";
  const isFailed = job.phase === "failed";
  const accent = phaseAccent(job.phase);
  return (
    <div
      className={
        "timeline-row " +
        (isActive ? "active" : isDone ? "done" : isFailed ? "failed" : "")
      }
    >
      <div className="timeline-meta">
        <div className="timeline-pda">
          {job.shortPda}
          {job.priceLamports !== undefined && (
            <span style={{ color: "var(--white-40)", marginLeft: 10 }}>
              {formatUsdcBase(job.priceLamports)} USDC
            </span>
          )}
        </div>
        <div className="timeline-detail">
          {job.buyer && <span>buyer {job.buyer.slice(0, 6)}…</span>}
          {job.resultUrl && (
            <a href={job.resultUrl} target="_blank" rel="noreferrer">
              result ↗
            </a>
          )}
          {job.submitTxUrl && (
            <a href={job.submitTxUrl} target="_blank" rel="noreferrer">
              tx ↗
            </a>
          )}
          {job.failureReason && (
            <span style={{ color: "var(--warn-red)" }}>
              {job.failureReason}
            </span>
          )}
        </div>
      </div>
      <span className={`timeline-phase ${accent}`}>{phaseLabel(job.phase)}</span>
      <div className="timeline-bar">
        <div style={{ width: `${phaseProgress(job.phase) * 100}%` }} />
      </div>
    </div>
  );
}

function formatUsdcBase(lamports: bigint): string {
  const whole = lamports / 1_000_000n;
  const frac = (lamports % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
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
