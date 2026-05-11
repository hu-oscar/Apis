// Persistent settings store for the Apis Provider desktop app.
//
// Wraps `@tauri-apps/plugin-store` with a typed schema + a single
// `loadSettings()` / `saveSettings()` pair. All fields are optional —
// the empty string represents "not configured." Empty fields cause
// start_worker to fall back to env-var or built-in defaults.
//
// Sprint 2.3 of Phase 1.5.

import { LazyStore } from "@tauri-apps/plugin-store";

const STORE_FILE = "settings.json";

export type Settings = {
  /** HuggingFace token (Read scope) — required to download FLUX.1-schnell. */
  hfToken: string;
  /** Pinata JWT (Files: Write scope) — required to upload result PNGs. */
  pinataJwt: string;
  /** Vercel API base, e.g. `https://apis-web-five.vercel.app`. Empty
   *  string = local-only mode (no heartbeat, no spec/result HTTP). */
  apisApiBase: string;
  /** Absolute path to a Solana keypair JSON file (worker authority).
   *  Defaults to `~/.config/apis/worker.json` when empty. */
  workerKeypair: string;
  /** Absolute path to the Python interpreter that has `apis_worker`
   *  installed (typically the venv at packages/worker/.venv). Defaults
   *  to `python3` on PATH when empty. */
  pythonPath: string;
  /** Working directory for the spawned worker (typically
   *  packages/worker). Defaults to the host process cwd when empty. */
  workingDir: string;
};

export const DEFAULT_SETTINGS: Settings = {
  hfToken: "",
  pinataJwt: "",
  apisApiBase: "",
  workerKeypair: "",
  pythonPath: "",
  workingDir: "",
};

const ONBOARDED_KEY = "hasOnboarded";

export async function hasOnboarded(): Promise<boolean> {
  const v = await store.get<boolean>(ONBOARDED_KEY);
  return v === true;
}

export async function markOnboarded(): Promise<void> {
  await store.set(ONBOARDED_KEY, true);
  await store.save();
}

// ── Auto-pause on GPU contention (Sprint 2.9) ──────────────────────
//
// Kept as a separate top-level key (not part of Settings) because the
// value is a boolean, not a string env var. The worker subprocess
// doesn't care about this flag — only the React layer's auto-pause
// policy does — so there's no point shoehorning it into the env tuple.

const AUTO_PAUSE_KEY = "autoPauseOnGpuContention";

export async function loadAutoPause(): Promise<boolean> {
  const v = await store.get<boolean>(AUTO_PAUSE_KEY);
  return v === true;
}

export async function saveAutoPause(value: boolean): Promise<void> {
  await store.set(AUTO_PAUSE_KEY, value);
  await store.save();
}

const store = new LazyStore(STORE_FILE);

export async function loadSettings(): Promise<Settings> {
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = await store.get<string>(key);
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}

export async function saveSettings(next: Settings): Promise<void> {
  for (const [key, value] of Object.entries(next)) {
    await store.set(key, value);
  }
  await store.save();
}

/** Convert Settings (+ optional hardware/benchmark context) into the
 *  `env` tuple list that `start_worker` accepts. Skips empty fields so
 *  the spawned worker falls back to whatever's in the host process env
 *  (useful for dev).
 *
 *  The hardware + benchmark fields drive the signed heartbeat payload
 *  the worker posts every 30 s — without them, buyer-facing provider
 *  cards on the web app show no chip / RAM / speed. The desktop app
 *  has all this data natively (it ran `detect_hardware` + the user's
 *  Flux benchmark); we just need to forward it through the spawn. */
export function settingsToWorkerEnv(
  s: Settings,
  extra?: {
    chip?: string;
    ramGb?: number;
    cpuCores?: number;
    secondsPerImage?: number;
    /** USDC base units (6 decimals), as a decimal string to preserve
     *  u64 precision through JSON. */
    suggestedPriceUsdcBase?: string;
  },
): Array<[string, string]> {
  const env: Array<[string, string]> = [];
  if (s.hfToken) env.push(["HF_TOKEN", s.hfToken]);
  if (s.pinataJwt) env.push(["PINATA_JWT", s.pinataJwt]);
  if (s.apisApiBase) env.push(["APIS_API_BASE", s.apisApiBase]);
  if (s.workerKeypair) env.push(["APIS_WORKER_KEYPAIR", s.workerKeypair]);

  if (extra?.chip) env.push(["APIS_PROVIDER_CHIP", extra.chip]);
  if (extra?.ramGb) env.push(["APIS_PROVIDER_RAM_GB", String(extra.ramGb)]);
  if (extra?.cpuCores)
    env.push(["APIS_PROVIDER_CPU_CORES", String(extra.cpuCores)]);
  if (extra?.secondsPerImage)
    env.push([
      "APIS_BENCHMARK_SECONDS_PER_IMAGE",
      extra.secondsPerImage.toFixed(3),
    ]);
  if (extra?.suggestedPriceUsdcBase)
    env.push(["APIS_SUGGESTED_PRICE_USDC_BASE", extra.suggestedPriceUsdcBase]);

  return env;
}
