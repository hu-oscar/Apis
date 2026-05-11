//! macOS GPU utilization sampler — Sprint 2.9 of Phase 1.5.
//!
//! Runs a background task that polls the system's GPU utilization
//! every `SAMPLE_INTERVAL` and emits a `gpu-status` event with the
//! current percentage. The Tauri shell publishes the raw signal; the
//! React layer owns the auto-pause policy (rolling average, hysteresis,
//! "is a job in flight"). Splitting it this way keeps Rust dumb and
//! lets us iterate on UX without recompiling.
//!
//! Source: `ioreg -l -r -c IOAccelerator -d 1`. This works on Apple
//! Silicon without sudo and exposes a `PerformanceStatistics` dict
//! whose `Device Utilization %` (or `Renderer Utilization %` on
//! older OS builds) is the running-average device-wide GPU load.
//!
//! Caveats:
//!   - Intel Macs use a different IOAccelerator schema; the parser
//!     returns None and the UI degrades to "unavailable". Apis
//!     Provider is macOS-Apple-Silicon-only per Sprint 2 scope cut,
//!     so this is fine.
//!   - The reading is a coarse running average — it lags real GPU
//!     pressure by a few seconds. That's actually what we want for
//!     auto-pause: instantaneous spikes shouldn't bounce the worker
//!     on/off.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::process::Command;

const SAMPLE_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize)]
pub struct GpuStatusEvent {
    /// Current device-wide GPU utilization in percent (0..=100).
    /// `None` when the parser couldn't extract a value (unsupported
    /// hardware, missing key, parse failure, process error).
    pub percent: Option<u8>,
    /// Unix ms of the sample.
    pub at: u64,
}

/// Sample once and return the GPU utilization percentage (or None if
/// unavailable). Pulled out as a free fn so the parser is unit-
/// testable without spawning `ioreg`.
pub async fn sample_gpu_percent() -> Option<u8> {
    let output = Command::new("ioreg")
        .args(["-l", "-r", "-c", "IOAccelerator", "-d", "1"])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_utilization(&stdout)
}

/// Pull the first numeric value paired with a recognized utilization
/// key. Order matters: prefer `Device Utilization %` (the rolled-up
/// number the system uses everywhere else), fall back to renderer-
/// only on older builds.
fn parse_utilization(ioreg_out: &str) -> Option<u8> {
    for key in ["\"Device Utilization %\"=", "\"Renderer Utilization %\"="] {
        if let Some(idx) = ioreg_out.find(key) {
            let after = &ioreg_out[idx + key.len()..];
            let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(n) = digits.parse::<u32>() {
                return Some(n.min(100) as u8);
            }
        }
    }
    None
}

/// Start the background sampler. Spawns a tokio task that runs until
/// the process exits — there's no stop handle because the cost is a
/// `ioreg` exec every 5s and we always want the latest reading.
pub fn start_monitor<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let percent = sample_gpu_percent().await;
            let _ = app.emit(
                "gpu-status",
                GpuStatusEvent {
                    percent,
                    at: now_ms(),
                },
            );
            tokio::time::sleep(SAMPLE_INTERVAL).await;
        }
    });
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_device_utilization() {
        let sample = r#"
        | |   "PerformanceStatistics" = {"Device Utilization %"=42,"Renderer Utilization %"=11,...}
        "#;
        assert_eq!(parse_utilization(sample), Some(42));
    }

    #[test]
    fn falls_back_to_renderer_when_device_missing() {
        let sample = r#"
        | |   "PerformanceStatistics" = {"Renderer Utilization %"=88,"TilerUtilization %"=2}
        "#;
        assert_eq!(parse_utilization(sample), Some(88));
    }

    #[test]
    fn returns_none_when_keys_absent() {
        assert_eq!(parse_utilization("no utilization key here"), None);
    }

    #[test]
    fn caps_at_100_when_kernel_overshoots() {
        // ioreg has been observed reporting 101 in edge cases; clamp.
        let sample = r#""Device Utilization %"=250"#;
        assert_eq!(parse_utilization(sample), Some(100));
    }

    #[test]
    fn zero_is_a_valid_reading() {
        let sample = r#""Device Utilization %"=0,"#;
        assert_eq!(parse_utilization(sample), Some(0));
    }
}
