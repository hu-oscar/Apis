// Thin wrapper around the `set_tray_state` Tauri command — Sprint 2.7.
//
// Kept as a separate module so callers don't have to remember the
// (string-typed) state enum or the invoke key. All errors are
// swallowed: failing to update the tray icon must NEVER prevent the
// worker toggle from happening.

import { invoke } from "@tauri-apps/api/core";

/** Mirrors the Rust `TrayState` enum (serde-renamed to lowercase). */
export type TrayState = "active" | "paused" | "error" | "inactive";

/** Set the macOS menu-bar tray icon to reflect the given state.
 *  Errors are caught + logged to the console — the tray is a hint, not
 *  a critical surface, so failures here shouldn't escape to the UI. */
export async function setTrayState(state: TrayState): Promise<void> {
  try {
    await invoke("set_tray_state", { state });
  } catch (err) {
    console.warn("set_tray_state failed:", err);
  }
}
