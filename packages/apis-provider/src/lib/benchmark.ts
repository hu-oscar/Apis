// Hardware + benchmark types and Tauri Store helpers — Sprint 2.10.
//
// `detectHardware` + `runBenchmark` mirror the Rust commands of the
// same names. The last benchmark result is persisted so a fresh app
// launch can show "your machine does ~10s per image at $1/hr that's
// X USDC" without forcing the user to re-run the slow generation.

import { invoke } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";

const STORE_FILE = "settings.json";
const LAST_BENCHMARK_KEY = "lastBenchmark";

const store = new LazyStore(STORE_FILE);

export type HardwareInfo = {
  /** e.g. "Apple M3 Pro" — empty when sysctl failed. */
  chip: string;
  /** Installed RAM in GB (floor). 0 on failure. */
  ramGb: number;
  cpuCores: number;
  /** Whether RAM ≥ 16 GB (Flux Schnell minimum). */
  fluxSupported: boolean;
};

/** Wire format: matches Rust `BenchmarkResult` (snake_case). The
 *  rest of the app speaks camelCase, so we translate at the boundary. */
type WireBenchmarkResult = {
  seconds_per_image: number;
  steps: number;
  width: number;
  height: number;
  quantize: number;
  bytes: number;
  raw_output: string;
};

export type BenchmarkResult = {
  secondsPerImage: number;
  steps: number;
  width: number;
  height: number;
  quantize: number;
  /** Output PNG size — used to flag silent mflux failures. */
  bytes: number;
  /** Unix ms the result was recorded. Added by the JS wrapper, not
   *  the Rust command — `Date.now()` isn't worth the round-trip. */
  ranAt: number;
  /** Verbatim stdout the Rust command captured. Shown in a collapsed
   *  drawer if the user wants to inspect what mflux actually did. */
  rawOutput: string;
};

export async function detectHardware(): Promise<HardwareInfo> {
  type Wire = {
    chip: string;
    ram_gb: number;
    cpu_cores: number;
    flux_supported: boolean;
  };
  const w = await invoke<Wire>("detect_hardware");
  return {
    chip: w.chip,
    ramGb: w.ram_gb,
    cpuCores: w.cpu_cores,
    fluxSupported: w.flux_supported,
  };
}

export type RunBenchmarkArgs = {
  pythonPath: string | null;
  workingDir: string | null;
  quick: boolean;
  quantize?: number;
};

export async function runBenchmark(
  args: RunBenchmarkArgs,
): Promise<BenchmarkResult> {
  // Match the rest of the codebase: send snake_case keys, mirroring
  // the Rust struct field names (no #[serde(rename_all = "camelCase")]).
  const wire = await invoke<WireBenchmarkResult>("run_benchmark", {
    args: {
      python_path: args.pythonPath,
      working_dir: args.workingDir,
      quick: args.quick,
      quantize: args.quantize,
    },
  });
  return {
    secondsPerImage: wire.seconds_per_image,
    steps: wire.steps,
    width: wire.width,
    height: wire.height,
    quantize: wire.quantize,
    bytes: wire.bytes,
    rawOutput: wire.raw_output,
    ranAt: Date.now(),
  };
}

export async function loadLastBenchmark(): Promise<BenchmarkResult | null> {
  const v = await store.get<BenchmarkResult>(LAST_BENCHMARK_KEY);
  if (
    v &&
    typeof v === "object" &&
    typeof (v as BenchmarkResult).secondsPerImage === "number"
  ) {
    return v as BenchmarkResult;
  }
  return null;
}

export async function saveLastBenchmark(r: BenchmarkResult): Promise<void> {
  await store.set(LAST_BENCHMARK_KEY, r);
  await store.save();
}

/** Suggested per-job prices at three target hourly rates. Returns
 *  USDC base units (6 decimals) so the UI can format consistently
 *  with the EarningsCard. */
export function suggestedPrices(secondsPerImage: number): {
  cheap: bigint;
  fair: bigint;
  premium: bigint;
} {
  // jobs/hour = 3600 / secondsPerImage
  // price_at_X_per_hour_usdc = X / jobs_per_hour
  // → base units = X * secondsPerImage / 3600 * 1_000_000
  // Round to nearest integer base unit.
  const calc = (usdPerHour: number): bigint => {
    if (!Number.isFinite(secondsPerImage) || secondsPerImage <= 0) return 0n;
    const usdc = (usdPerHour * secondsPerImage) / 3600;
    return BigInt(Math.round(usdc * 1_000_000));
  };
  return {
    cheap: calc(0.5),
    fair: calc(1.0),
    premium: calc(2.0),
  };
}
