//! Apple Silicon hardware probe — Sprint 2.10 of Phase 1.5.
//!
//! Reads chip name, RAM, and core count from `sysctl` — no Apple
//! private frameworks, no `system_profiler` (it's slow), no crate
//! dependencies. The detected chip + RAM feed two downstream UX
//! decisions:
//!   1. The BenchmarkCard shows the user *what hardware they have*
//!      before they run a benchmark, so they can sanity-check the
//!      observed speed against their expectations.
//!   2. RAM gates whether we can run Flux Schnell (needs ~16 GB
//!      unified memory). Below threshold the UI warns instead of
//!      pretending the worker will succeed.

use serde::Serialize;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct HardwareInfo {
    /// e.g. "Apple M3 Pro", "Apple M2 Max". Empty when sysctl fails.
    pub chip: String,
    /// Installed RAM in gigabytes, rounded down. 0 on failure.
    pub ram_gb: u32,
    /// Number of logical CPU cores. 0 on failure.
    pub cpu_cores: u32,
    /// Whether this machine has enough unified memory to run
    /// FLUX.1-schnell comfortably (≥16 GB). Below the threshold the
    /// worker may OOM during the first inference pass.
    pub flux_supported: bool,
}

/// Run a single `sysctl -n` and return the trimmed string output, or
/// None if sysctl errored or the key was missing.
async fn sysctl_string(key: &str) -> Option<String> {
    let output = Command::new("sysctl")
        .args(["-n", key])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

async fn sysctl_u64(key: &str) -> Option<u64> {
    sysctl_string(key).await?.parse::<u64>().ok()
}

/// Tauri command — bundle the three sysctl reads and return one
/// `HardwareInfo`. Always succeeds: a failure on any field returns
/// the default (empty string / 0) so the UI degrades gracefully
/// rather than tripping the catch-all error path.
#[tauri::command]
pub async fn detect_hardware() -> HardwareInfo {
    let chip = sysctl_string("machdep.cpu.brand_string")
        .await
        .unwrap_or_default();
    let ram_bytes = sysctl_u64("hw.memsize").await.unwrap_or(0);
    let cpu_cores = sysctl_u64("hw.ncpu").await.unwrap_or(0) as u32;
    let ram_gb = (ram_bytes / (1024 * 1024 * 1024)) as u32;
    HardwareInfo {
        chip,
        ram_gb,
        cpu_cores,
        flux_supported: ram_gb >= 16,
    }
}
