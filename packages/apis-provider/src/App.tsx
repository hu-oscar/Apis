// Apis Provider — Sprint 2.1 UI skeleton.
//
// This is the scaffolded shell: top bar with brand + online toggle,
// left rail with provider status + earnings, right pane with worker
// logs, bottom status bar. All data is placeholder for now — Sprint 2.2
// wires the worker subprocess; 2.3 plugs in settings; 2.4 streams the
// real event log; 2.5 reads the on-chain Provider PDA.

import { useState } from "react";
import "./App.css";

function App() {
  const [online, setOnline] = useState(false);

  return (
    <div className="app-shell">
      <TopBar online={online} onToggle={() => setOnline((v) => !v)} />

      <main className="main">
        <aside className="left-col">
          <ProviderCard />
          <EarningsCard />
          <NetworkCard />
        </aside>

        <section className="right-col">
          <LogPanel online={online} />
        </section>
      </main>

      <StatusBar online={online} />
    </div>
  );
}

// ── Top bar ──────────────────────────────────────────────────────────

function TopBar({
  online,
  onToggle,
}: {
  online: boolean;
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
          type="button"
        >
          <span className="dot" />
          {online ? "online" : "offline"}
        </button>
        <button className="settings-btn" title="Settings" type="button">
          ⚙
        </button>
      </div>
    </header>
  );
}

// ── Left-rail cards ──────────────────────────────────────────────────

function ProviderCard() {
  return (
    <div className="card">
      <h3>Provider PDA</h3>
      <div className="kv-row">
        <span className="kv-label">PDA</span>
        <span className="kv-value">— · not registered</span>
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

function LogPanel({ online }: { online: boolean }) {
  return (
    <div className="card log-panel">
      <h3>Worker logs · live</h3>
      <div className="log-output">
        {online ? (
          <>
            <div className="log-line dim">
              [Sprint 2.2 wires the real worker subprocess here]
            </div>
            <div className="log-line event">apis_worker ready</div>
            <div className="log-line dim">waiting for jobs…</div>
          </>
        ) : (
          <div className="log-empty">
            Worker offline. Click "offline" in the top bar to start it.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Status bar ───────────────────────────────────────────────────────

function StatusBar({ online }: { online: boolean }) {
  return (
    <footer className="statusbar">
      <span>
        {online ? "worker · running" : "worker · idle"} · v0.1.0
      </span>
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
