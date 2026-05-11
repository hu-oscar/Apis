# Building the Apis Provider desktop app

macOS-only for now (Sprint 2 scope cut). Windows + Linux land in Phase 2.

## Dev loop

```bash
# From the repo root
pnpm install
pnpm --filter apis-provider tauri dev
```

Tauri opens a window backed by the Vite dev server (`pnpm dev` runs in
parallel via `tauri.conf.json`'s `beforeDevCommand`). Hot-reload works
for both the React side and most of the Rust side; cargo recompiles
when you save a `.rs` file.

## Production .app + .dmg

```bash
pnpm --filter apis-provider tauri build
```

Outputs (first build is slow because cargo compiles all transitive
crates from scratch — ~10-15 min; subsequent builds are ~1-2 min):

```
src-tauri/target/release/bundle/macos/Apis Provider.app
src-tauri/target/release/bundle/dmg/Apis Provider_0.1.0_aarch64.dmg
```

`.app` is the runnable bundle; `.dmg` is the distributable installer
disk image.

## Distribution caveats

The bundle is **unsigned**. macOS Gatekeeper will refuse to open it
on first launch with a "cannot verify the developer" warning. Users
have two workarounds:

- **Right-click → Open** (instead of double-click). Gatekeeper then
  shows an extra-permissive dialog with an "Open" button. After this
  one-time bypass macOS remembers the app.
- Or strip the quarantine attribute from the command line:
  ```bash
  xattr -d com.apple.quarantine "/Applications/Apis Provider.app"
  ```

Real signing requires an Apple Developer Program account ($99/yr) and
a Developer ID Application certificate. We'll set this up in Phase 2.

## Architecture notes

- The bundled `.app` is **just the Tauri shell**. The Python worker
  (`apis_worker`) is **not** bundled inside it — the desktop app
  shells out to `python -m apis_worker` on the user's machine,
  reading the venv path from the settings store.
- Bundling Python is a Phase 2 deliverable (Tauri Sidecar pattern with
  a relocatable Python build + pre-installed `apis_worker` wheel).
- For Sprint 2 the user has to run `pip install -e packages/worker`
  in their own venv before launching the desktop app — the onboarding
  wizard documents the exact commands.
