//! Status tray icon — Sprint 2.7 of Phase 1.5.
//!
//! The provider runs as a long-lived background process. Closing the
//! window must NOT kill the worker; the user expects to glance at the
//! menu bar to see whether jobs are still being served.
//!
//! What we ship:
//!   - A single tray icon in the macOS menu bar (also wired for the
//!     equivalent surfaces on Windows + Linux, behind feature gates).
//!   - Four state icons (active/paused/error/inactive) embedded at
//!     build time so the bundle stays self-contained.
//!   - A right-click menu: Open / Pause / Resume / Quit.
//!   - A `set_tray_state` Tauri command so the React UI can flip the
//!     icon whenever the online toggle moves.
//!
//! The tray is stored by id rather than as managed state so any
//! caller — sync command, async task, menu callback — can fetch it
//! via `app.tray_by_id(TRAY_ID)` without juggling locks.

use std::sync::Arc;

use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::MenuBuilder;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

use crate::worker::{stop_worker, WorkerState};

/// Stable id we use to look the tray up after the setup closure
/// returns. Anything that calls `app.tray_by_id` must use this.
const TRAY_ID: &str = "main-tray";

// Embed the @2x (44×44) variants at compile time. macOS will
// downscale to its 22pt menu-bar size on non-retina displays; on
// retina we hit the bitmap exactly. Keeping a single resolution
// per icon makes the bundle ~4 KB lighter than shipping both.
const ICON_ACTIVE: &[u8] = include_bytes!("../icons/tray/active@2x.png");
const ICON_PAUSED: &[u8] = include_bytes!("../icons/tray/paused@2x.png");
const ICON_ERROR: &[u8] = include_bytes!("../icons/tray/error@2x.png");
const ICON_INACTIVE: &[u8] = include_bytes!("../icons/tray/inactive@2x.png");

/// Visual states the tray can reflect. Mirrored to the frontend as
/// the lowercase string (`"active"`, `"paused"`, `"error"`,
/// `"inactive"`) so JS callers don't need to know the enum tag.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrayState {
    /// Worker subprocess running, listener heartbeating.
    Active,
    /// User flipped to offline, but the app + worker may still be up.
    Paused,
    /// Worker crashed or a critical command failed.
    Error,
    /// Cold-start default; nothing has been started yet.
    Inactive,
}

impl TrayState {
    fn bytes(self) -> &'static [u8] {
        match self {
            TrayState::Active => ICON_ACTIVE,
            TrayState::Paused => ICON_PAUSED,
            TrayState::Error => ICON_ERROR,
            TrayState::Inactive => ICON_INACTIVE,
        }
    }

    fn image(self) -> tauri::Result<Image<'static>> {
        Image::from_bytes(self.bytes())
    }
}

/// Build + register the tray. Call from the `tauri::Builder::setup`
/// closure. Returns the std `Box<dyn Error>` shape that `setup`
/// expects so failures bubble up at startup rather than getting
/// silently swallowed.
pub fn build_tray<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    let menu = MenuBuilder::new(app)
        .text("open", "Open Dashboard")
        .separator()
        .text("pause", "Pause worker")
        .text("resume", "Resume worker")
        .separator()
        .text("quit", "Quit Apis Provider")
        .build()?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(TrayState::Inactive.image()?)
        .menu(&menu)
        // The right-click menu is the rich surface; left-click is a
        // shortcut for "bring the window back". Showing the menu on
        // left-click as well steals that affordance, so we disable it.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "pause" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(state) = app.try_state::<Arc<WorkerState>>() {
                        let _ = stop_worker(state).await;
                    }
                    let _ = apply_tray_state(&app, TrayState::Paused);
                });
            }
            "resume" => {
                // Resume goes through the React UI's start_worker so
                // the settings → env tuple stays the single source of
                // truth. Bringing the window forward is enough — the
                // user flips the online toggle from there.
                show_main_window(app);
            }
            "quit" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(state) = app.try_state::<Arc<WorkerState>>() {
                        let _ = stop_worker(state).await;
                    }
                    app.exit(0);
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // macOS convention: left-click on the menu-bar icon
            // toggles the primary window forward. We only react to
            // the button-up edge to avoid double-firing during the
            // press → drag → release sequence.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Bring the main window forward (un-hide + un-minimise + focus).
/// Pulled out into a free fn so both the menu and the click handler
/// share the same behavior — including the no-op fallback when the
/// window has been destroyed.
fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn apply_tray_state<R: Runtime>(
    app: &AppHandle<R>,
    state: TrayState,
) -> Result<(), String> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| format!("tray {TRAY_ID} not found"))?;
    let image = state.image().map_err(|e| e.to_string())?;
    tray.set_icon(Some(image)).map_err(|e| e.to_string())?;
    Ok(())
}

/// Flip the tray icon to reflect the given state. Invoked from the
/// React UI whenever the online toggle or worker status changes.
#[tauri::command]
pub fn set_tray_state(app: AppHandle, state: TrayState) -> Result<(), String> {
    apply_tray_state(&app, state)
}
