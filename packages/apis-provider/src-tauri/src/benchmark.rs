//! Benchmark runner — Sprint 2.10 of Phase 1.5.
//!
//! Shells out to `python -m apis_worker.benchmark` and parses the
//! single `BENCHMARK_RESULT seconds_per_image=N.NN …` summary line.
//! The benchmark itself owns model loading + image generation; this
//! module's job is solely to invoke + parse + surface errors to the
//! frontend.

use serde::{Deserialize, Serialize};
use tokio::process::Command;

/// Inputs from the React layer. All optional so the frontend can
/// trust the defaults (mirroring `start_worker` / `derive_provider_pda`).
#[derive(Debug, Default, Deserialize)]
pub struct BenchmarkArgs {
    pub python_path: Option<String>,
    pub working_dir: Option<String>,
    /// If true, run the 512x512 fast path (~3-5s on M3 Pro). Default
    /// is the canonical 1024x1024 (~10-15s on M3 Pro).
    #[serde(default)]
    pub quick: bool,
    /// Override quantization (4 or 8). Falls back to mflux default.
    #[serde(default)]
    pub quantize: Option<u8>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BenchmarkResult {
    /// Wall-clock seconds for one generation (the headline number).
    pub seconds_per_image: f64,
    /// Steps used (Flux Schnell is always 4, surfaced for transparency).
    pub steps: u32,
    pub width: u32,
    pub height: u32,
    pub quantize: u32,
    /// Output PNG size in bytes — used by the UI to sanity-check that
    /// generation actually produced a real image.
    pub bytes: u64,
    /// Raw benchmark stdout for the user to read if they want detail.
    pub raw_output: String,
}

#[tauri::command]
pub async fn run_benchmark(args: BenchmarkArgs) -> Result<BenchmarkResult, String> {
    let python = args
        .python_path
        .as_deref()
        .unwrap_or("python3")
        .to_string();

    let mut cmd = Command::new(&python);
    cmd.args(["-m", "apis_worker.benchmark"]);
    if args.quick {
        cmd.arg("--quick");
    }
    if let Some(q) = args.quantize {
        cmd.args(["--quantize", &q.to_string()]);
    }
    if let Some(dir) = args.working_dir.as_ref() {
        cmd.current_dir(dir);
    }
    // mflux-generate downloads from HuggingFace on first run; the
    // worker env wires HF_TOKEN. We forward whatever the user has in
    // the parent process env so the same auth applies.

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("failed to spawn {}: {}", python, e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!(
            "benchmark exited {:?}\nstdout: {}\nstderr: {}",
            output.status.code(),
            stdout.trim(),
            stderr.trim(),
        ));
    }

    parse_benchmark_output(&stdout).ok_or_else(|| {
        format!(
            "couldn't parse benchmark output. stdout: {}\nstderr: {}",
            stdout.trim(),
            stderr.trim(),
        )
    })
}

/// Find the trailing `BENCHMARK_RESULT key=value key=value …` line and
/// decode it into a structured result. Returns None if the marker
/// is missing or any required key fails to parse — the caller turns
/// that into a user-visible error.
fn parse_benchmark_output(stdout: &str) -> Option<BenchmarkResult> {
    let line = stdout
        .lines()
        .rev()
        .find(|l| l.starts_with("BENCHMARK_RESULT "))?;
    let kvs: std::collections::HashMap<&str, &str> = line
        .strip_prefix("BENCHMARK_RESULT ")?
        .split_whitespace()
        .filter_map(|kv| kv.split_once('='))
        .collect();
    Some(BenchmarkResult {
        seconds_per_image: kvs.get("seconds_per_image")?.parse().ok()?,
        steps: kvs.get("steps")?.parse().ok()?,
        width: kvs.get("width")?.parse().ok()?,
        height: kvs.get("height")?.parse().ok()?,
        quantize: kvs.get("quantize")?.parse().ok()?,
        bytes: kvs.get("bytes")?.parse().ok()?,
        raw_output: stdout.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_result_line() {
        let stdout = "running benchmark: prompt=...\n\
                      BENCHMARK_RESULT seconds_per_image=8.43 steps=4 width=1024 height=1024 quantize=8 bytes=1234567\n";
        let r = parse_benchmark_output(stdout).expect("should parse");
        assert!((r.seconds_per_image - 8.43).abs() < 0.001);
        assert_eq!(r.steps, 4);
        assert_eq!(r.width, 1024);
        assert_eq!(r.height, 1024);
        assert_eq!(r.quantize, 8);
        assert_eq!(r.bytes, 1234567);
    }

    #[test]
    fn picks_last_marker_when_multiple() {
        // Defensive: if the benchmark script ever prints two markers
        // (e.g. mid-warmup + final), we want the last one.
        let stdout = "BENCHMARK_RESULT seconds_per_image=99.0 steps=4 width=512 height=512 quantize=8 bytes=1\n\
                      BENCHMARK_RESULT seconds_per_image=8.43 steps=4 width=1024 height=1024 quantize=8 bytes=1234567\n";
        let r = parse_benchmark_output(stdout).expect("should parse");
        assert!((r.seconds_per_image - 8.43).abs() < 0.001);
    }

    #[test]
    fn returns_none_when_marker_missing() {
        assert!(parse_benchmark_output("no result line\n").is_none());
    }

    #[test]
    fn returns_none_when_required_key_missing() {
        let stdout = "BENCHMARK_RESULT steps=4 width=1024 height=1024 quantize=8 bytes=1\n";
        assert!(parse_benchmark_output(stdout).is_none());
    }
}
