//! Worker lifecycle — spawn / monitor / stop the apis_worker Python
//! subprocess from the Tauri shell.
//!
//! Sprint 2.2 of Phase 1.5.
//!
//! Architecture
//! ─────────────
//! - `WorkerState` holds at most one running child process behind a
//!   tokio `Mutex<Option<Child>>`.
//! - `start_worker` spawns the subprocess, takes the stdout/stderr
//!   pipes out of the Child, hands each pipe to a dedicated reader
//!   task, then parks the Child itself in `WorkerState` for later
//!   `kill()` / `try_wait()`.
//! - The reader tasks emit one `worker-log` event per line to the
//!   frontend (subscribed via `@tauri-apps/api/event::listen`).
//! - `stop_worker` takes the Child out of the slot and SIGKILLs it.
//! - `worker_status` reads the slot + `try_wait()`s the child to
//!   distinguish "still running" from "exited naturally and is now a
//!   zombie waiting to be reaped" — the latter case clears the slot.
//!
//! This is the simplest pattern that satisfies "stop + status from
//! arbitrary call sites" without splitting Child ownership across
//! tasks.

use std::process::Stdio;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

/// Mutable state holding the worker subprocess (if any).
pub struct WorkerState {
    child: Mutex<Option<Child>>,
}

impl WorkerState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

/// Configuration accepted from the frontend's `start_worker` call.
#[derive(Debug, Deserialize, Default)]
pub struct WorkerConfig {
    /// Absolute path to the Python interpreter that has `apis_worker`
    /// installed. Defaults to `python3` on PATH.
    #[serde(default)]
    pub python_path: Option<String>,
    /// Working directory to launch the worker from (typically
    /// packages/worker). Defaults to the host process's cwd.
    #[serde(default)]
    pub working_dir: Option<String>,
    /// Extra environment variables forwarded to the subprocess —
    /// HF_TOKEN, PINATA_JWT, APIS_API_BASE, APIS_WORKER_KEYPAIR, etc.
    /// (Sprint 2.3 wires the UI fields that populate this.)
    #[serde(default)]
    pub env: Vec<(String, String)>,
}

/// One line of worker output, emitted as a `worker-log` event.
#[derive(Debug, Serialize, Clone)]
pub struct WorkerLogEvent {
    pub stream: &'static str, // "stdout" | "stderr"
    pub line: String,
    pub at: u64, // unix ms
}

/// Spawn the worker. Returns Err if a worker is already running.
#[tauri::command]
pub async fn start_worker(
    app: AppHandle,
    state: State<'_, Arc<WorkerState>>,
    config: WorkerConfig,
) -> Result<(), String> {
    let mut guard = state.child.lock().await;
    if guard.is_some() {
        return Err("worker already running".to_string());
    }

    let python = config
        .python_path
        .unwrap_or_else(|| "python3".to_string());

    let mut cmd = Command::new(&python);
    cmd.args(["-m", "apis_worker"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    if let Some(dir) = config.working_dir.as_ref() {
        cmd.current_dir(dir);
    }
    for (k, v) in &config.env {
        cmd.env(k, v);
    }
    // hf-transfer enables parallel HF downloads — see apis_worker docs.
    cmd.env("HF_HUB_ENABLE_HF_TRANSFER", "1");

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn {}: {}", python, e))?;

    // Pipe stdout + stderr into the event stream. We take the streams
    // out of the Child before parking it in the state — that way the
    // reader tasks own *only* the pipes (not the Child), so the Child
    // can still be killed / waited on by other commands.
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "spawned worker has no stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "spawned worker has no stderr".to_string())?;

    let app_stdout = app.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_stdout.emit(
                "worker-log",
                WorkerLogEvent {
                    stream: "stdout",
                    line,
                    at: now_ms(),
                },
            );
        }
    });

    let app_stderr = app.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_stderr.emit(
                "worker-log",
                WorkerLogEvent {
                    stream: "stderr",
                    line,
                    at: now_ms(),
                },
            );
        }
    });

    *guard = Some(child);
    Ok(())
}

/// Stop the worker (SIGKILL on Unix). No-op if no worker is running.
#[tauri::command]
pub async fn stop_worker(
    state: State<'_, Arc<WorkerState>>,
) -> Result<(), String> {
    let mut guard = state.child.lock().await;
    if let Some(mut child) = guard.take() {
        let _ = child.kill().await;
        // Reap to avoid leaving a zombie.
        let _ = child.wait().await;
    }
    Ok(())
}

/// Whether the worker is currently running. Side-effect: if the
/// process has exited naturally, clears the slot so a subsequent
/// `start_worker` can spawn a fresh one.
#[tauri::command]
pub async fn worker_status(
    state: State<'_, Arc<WorkerState>>,
) -> Result<bool, String> {
    let mut guard = state.child.lock().await;
    let still_alive = if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(None) => true,
            Ok(Some(_)) => false, // exited
            Err(_) => false,
        }
    } else {
        false
    };
    if !still_alive {
        *guard = None;
    }
    Ok(still_alive)
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
