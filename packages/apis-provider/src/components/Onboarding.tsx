// First-launch onboarding wizard — Sprint 2.6.
//
// Three steps:
//   1. Keypair path (with sensible default)
//   2. HuggingFace token + Pinata JWT
//   3. API base URL (optional) — picker between "deployed" and "local-only"
//      and a Register provider button that immediately runs the
//      register_provider_subprocess command.
//
// The wizard is shown on the first launch (when settings.hasOnboarded
// is missing or false). On finish, it saves the draft and flips the
// hasOnboarded flag in the store so subsequent launches skip it. A
// "Skip" link at each step bails out without marking it complete —
// the user can resume from Settings any time.

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_SETTINGS, type Settings } from "../lib/settings";

const DEFAULT_KEYPAIR_PATH = "~/.config/apis/worker.json";
const PRODUCTION_API_BASE = "https://apis-web-five.vercel.app";

type Step = 0 | 1 | 2;

export function Onboarding({
  initial,
  onComplete,
  onSkip,
}: {
  initial: Settings;
  /** Persist + mark hasOnboarded=true + close. */
  onComplete: (next: Settings) => Promise<void>;
  /** Close without marking complete; reachable again from Settings. */
  onSkip: () => void;
}) {
  const [step, setStep] = useState<Step>(0);
  const [draft, setDraft] = useState<Settings>({
    ...DEFAULT_SETTINGS,
    ...initial,
    workerKeypair: initial.workerKeypair || DEFAULT_KEYPAIR_PATH,
  });
  const [registerState, setRegisterState] = useState<{
    status: "idle" | "running" | "ok" | "error";
    message?: string;
  }>({ status: "idle" });

  const setField =
    (key: keyof Settings) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((d) => ({ ...d, [key]: e.target.value }));

  const handleRegisterNow = async () => {
    if (registerState.status === "running") return;
    setRegisterState({ status: "running" });
    try {
      // We need to persist the draft first so the existing
      // register_provider_subprocess path can pick up the right
      // keypair via env. Persist-as-you-go: save the partial draft
      // so a crash mid-register doesn't lose work.
      await onComplete(draft); // saves + marks hasOnboarded
      const result = await invoke<string>("register_provider_subprocess", {
        pythonPath: draft.pythonPath || null,
        workingDir: draft.workingDir || null,
        keypairPath: draft.workerKeypair,
      });
      setRegisterState({ status: "ok", message: result });
    } catch (err) {
      setRegisterState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleFinishWithoutRegister = async () => {
    await onComplete(draft);
  };

  return (
    <div className="onboarding-backdrop">
      <div className="onboarding-modal" role="dialog" aria-label="Welcome">
        <header className="onboarding-header">
          <h1>Welcome to Apis Provider</h1>
          <p>
            Configure the three things this app needs to run a worker on your
            machine. Takes about a minute.
          </p>
          <Steps current={step} />
        </header>

        <div className="onboarding-body">
          {step === 0 && (
            <Step1Keypair value={draft.workerKeypair} onChange={setField("workerKeypair")} />
          )}
          {step === 1 && (
            <Step2Tokens
              hfToken={draft.hfToken}
              pinataJwt={draft.pinataJwt}
              onHfChange={setField("hfToken")}
              onPinataChange={setField("pinataJwt")}
            />
          )}
          {step === 2 && (
            <Step3Network
              apiBase={draft.apisApiBase}
              onApiBaseChange={(v) =>
                setDraft((d) => ({ ...d, apisApiBase: v }))
              }
              registerState={registerState}
              onRegisterNow={handleRegisterNow}
              onFinishWithoutRegister={handleFinishWithoutRegister}
            />
          )}
        </div>

        <footer className="onboarding-footer">
          <button
            type="button"
            className="onboarding-skip"
            onClick={onSkip}
          >
            Skip for now
          </button>
          <div className="onboarding-nav">
            {step > 0 && (
              <button
                type="button"
                className="onboarding-back"
                onClick={() => setStep((s) => Math.max(0, s - 1) as Step)}
              >
                ← Back
              </button>
            )}
            {step < 2 && (
              <button
                type="button"
                className="onboarding-next"
                onClick={() => setStep((s) => Math.min(2, s + 1) as Step)}
              >
                Next →
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

// ── Step indicator ──────────────────────────────────────────────────

function Steps({ current }: { current: Step }) {
  return (
    <ol className="onboarding-steps">
      <li className={current >= 0 ? "active" : ""}>1 · keypair</li>
      <li className={current >= 1 ? "active" : ""}>2 · tokens</li>
      <li className={current >= 2 ? "active" : ""}>3 · network</li>
    </ol>
  );
}

// ── Step 1: keypair ────────────────────────────────────────────────

function Step1Keypair({
  value,
  onChange,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="onboarding-step">
      <h2>Worker keypair</h2>
      <p>
        The worker signs <code>accept_job</code> and{" "}
        <code>submit_completion</code> transactions on your behalf. Point us at
        a Solana keypair JSON file — if you don't have one yet, create it
        first:
      </p>
      <pre className="onboarding-code">
        solana-keygen new --outfile {DEFAULT_KEYPAIR_PATH}
      </pre>
      <p>
        Then fund it with ~0.05 SOL on devnet so it can pay tx fees:
      </p>
      <pre className="onboarding-code">
        solana airdrop 5 $(solana address --keypair {DEFAULT_KEYPAIR_PATH}) --url devnet
      </pre>
      <label className="settings-field">
        <span>Path to keypair JSON</span>
        <input
          type="text"
          value={value}
          onChange={onChange}
          placeholder={DEFAULT_KEYPAIR_PATH}
          spellCheck={false}
        />
      </label>
    </div>
  );
}

// ── Step 2: tokens ──────────────────────────────────────────────────

function Step2Tokens({
  hfToken,
  pinataJwt,
  onHfChange,
  onPinataChange,
}: {
  hfToken: string;
  pinataJwt: string;
  onHfChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPinataChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="onboarding-step">
      <h2>Service tokens</h2>
      <p>
        The worker fetches the Flux Schnell model from HuggingFace and pins
        generated PNGs to IPFS via Pinata. Both require API tokens — free
        tiers are enough for hackathon-scale traffic.
      </p>
      <label className="settings-field">
        <span>HuggingFace token (Read scope)</span>
        <input
          type="text"
          value={hfToken}
          onChange={onHfChange}
          placeholder="hf_…"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <div className="hint">
          Create at <code>huggingface.co/settings/tokens</code>. You'll also
          need to accept the FLUX.1-schnell repo terms on first use.
        </div>
      </label>
      <label className="settings-field">
        <span>Pinata JWT (Files: Write scope)</span>
        <input
          type="text"
          value={pinataJwt}
          onChange={onPinataChange}
          placeholder="eyJhbGciOi…"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <div className="hint">
          Create at <code>app.pinata.cloud/developers/api-keys</code>.
        </div>
      </label>
    </div>
  );
}

// ── Step 3: network + register ──────────────────────────────────────

function Step3Network({
  apiBase,
  onApiBaseChange,
  registerState,
  onRegisterNow,
  onFinishWithoutRegister,
}: {
  apiBase: string;
  onApiBaseChange: (v: string) => void;
  registerState: { status: "idle" | "running" | "ok" | "error"; message?: string };
  onRegisterNow: () => void;
  onFinishWithoutRegister: () => void;
}) {
  return (
    <div className="onboarding-step">
      <h2>Connect to the network</h2>
      <p>Pick how this worker talks to the rest of the marketplace.</p>

      <div className="onboarding-options">
        <label
          className={
            apiBase === PRODUCTION_API_BASE
              ? "onboarding-option active"
              : "onboarding-option"
          }
        >
          <input
            type="radio"
            name="api-base"
            checked={apiBase === PRODUCTION_API_BASE}
            onChange={() => onApiBaseChange(PRODUCTION_API_BASE)}
          />
          <div>
            <strong>Deployed marketplace</strong>
            <div className="onboarding-option-hint">
              Buyers find you via <code>apis-web-five.vercel.app</code>. Worker
              posts heartbeat + reads job specs via the Vercel API.
            </div>
          </div>
        </label>
        <label
          className={
            apiBase === "" ? "onboarding-option active" : "onboarding-option"
          }
        >
          <input
            type="radio"
            name="api-base"
            checked={apiBase === ""}
            onChange={() => onApiBaseChange("")}
          />
          <div>
            <strong>Local-only</strong>
            <div className="onboarding-option-hint">
              For dev — runs a buyer web app locally. No heartbeat to the
              public network.
            </div>
          </div>
        </label>
      </div>

      <div className="onboarding-register-row">
        {registerState.status === "idle" && (
          <>
            <button
              type="button"
              className="onboarding-register"
              onClick={onRegisterNow}
            >
              Register provider + start
            </button>
            <span className="onboarding-or">or</span>
            <button
              type="button"
              className="onboarding-finish-later"
              onClick={onFinishWithoutRegister}
            >
              Finish — register later
            </button>
          </>
        )}
        {registerState.status === "running" && (
          <p className="onboarding-status">
            Registering on devnet… (one create + register_provider tx).
          </p>
        )}
        {registerState.status === "ok" && (
          <p className="onboarding-status ok">
            ✓ Registered. You can close this and flip "offline" → "online".
          </p>
        )}
        {registerState.status === "error" && (
          <p className="onboarding-status error">
            Registration failed: {registerState.message}
          </p>
        )}
      </div>
    </div>
  );
}
