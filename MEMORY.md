# System Memory & Context 🧠

<!--
AGENTS: Update this file after every major milestone, structural change, or resolved bug.
DO NOT delete historical context if it is still relevant. Compress older completed items into "Completed Phases".
-->

## 🏗️ Active Phase & Goal

**Current Phase:** **Phase 1 — Hackathon MVP (Weeks 1-6)** per `PRD §1` Tier 1.

**Phase 1 goal:** Submit a working Apis MVP to the **Dev3pack hackathon (Solana track)** with:
- Live devnet demo accessible at `apis-mvp.vercel.app`
- 5 P0 features functional (F1 Provider app · F2 Buyer web · F3 Anchor escrow program · F4 MCP+x402 agent API · F5 multi-GPU pooling)
- ≥ 8 Solana SDKs documented in README
- ≥ 3 sponsor integrations (Solana + Virtuals + Noah AI minimum)
- Pre-recorded demo video < 3 min showing Claude Sonnet 4.x autonomously buying 1 inference end-to-end in under 60s

**Current Task:** **W1 — Foundation: pipeline end-to-end (fake)**

> Goal of W1: get a fake job to flow through Solana devnet → fake worker → fake completion event, with all 5 surfaces talking to each other in their most minimal form. No real Flux Schnell yet, no real verification yet — just prove the wiring works.

**Next Steps (W1 — Foundation):**
1. ✅ Repo cloned and synced locally (done 2026-05-09)
2. ✅ Bootstrap monorepo with 5 sub-packages (done 2026-05-09)
   - `packages/program` — escrow tutorial copied from `solana-developers/program-examples`, Anchor 1.0 compatible
   - `packages/web` — `kit/nextjs` template via `create-solana-dapp` (uses `@solana/kit`, NOT legacy web3.js)
   - `packages/apis-provider` — Tauri 2.x react-ts template, identifier `xyz.apis.provider`
   - `packages/worker` — Python venv with anchorpy 0.21, solders 0.26, solana 0.36, Pillow, imagehash. PyTorch deferred to W2 (huge install, only needed when running real Flux).
   - `packages/mcp` — Node + TypeScript + Hono + `@modelcontextprotocol/sdk` + x402 + Anthropic SDK
3. ✅ Workspace wiring done (`pnpm-workspace.yaml`, root `package.json` with cross-package scripts)
4. ✅ Verify Hello World pipeline (done 2026-05-09): cargo check / typecheck / imports all green for all 5 scaffolds
5. ✅ **Smart contract v0.1** (done 2026-05-09): refactored escrow tutorial → `apis_program` with `register_provider` + `create_job` instructions + `ProviderRegistered` + `JobCreated` events. **Deployed to devnet** at program ID `2qe8YXciSpony5vjwxZAYJZ7WfRzSHKRdRzSiH868mhf`, IDL on-chain via Anchor 1.0 Program Metadata (account `TjXVs7bkreuxEgScjAF83dXBwHRwhtuuxPsPBvCznJ8`, owner `ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S`). Upgrade authority: `AocVgNfUByYHhipazTLPCUdfnAbDiJQz4mE3BBBL6649` (devnet deployer; transfers to Squads multisig pre-mainnet). 6/6 tests passing via `solana-bankrun` (1 happy + 2 malicious-input per instruction). State schema adopts the Tech Design §3 canonical layout — `Provider.bond_vault`, `active_jobs`, `total_jobs`, `JobStatus::Funded/Started/Completed/Disputed/Refunded/Slashed` all declared upfront so W2/W3 are additive (no Anchor account migrations expected through W3).
6. ✅ **Web app v0.1** (done 2026-05-10): `/submit` page wallet-gated by `useWalletConnection`. Self-register flow — buyer first registers a `Provider` PDA against their own wallet (stub gpu_specs_hash + endpoint_uri_hash for W1), then submits a `create_job` tx with `sha256(prompt)` as `spec_hash` and a 600s deadline. Codama-generated TS client at `packages/web/app/lib/generated/apis-program/`; barrel re-export at `app/lib/apis-program.ts`. End-to-end verified on devnet with Phantom wallet `BhTNfGu3amwVFJwykYSPzVgC6xnLnNxPtbxwYiLDsgGM`: both `register_provider` and `create_job` confirmed on Solana Explorer.
7. ✅ **Worker v0.1** (done 2026-05-10): Python `apis_worker` package at `packages/worker/`. Subscribes to devnet via WebSocket (`logsSubscribe` mentions filter on `apis_program`), decodes `Program data:` log lines as Anchor events using borsh layouts mirrored from `programs/apis_program/src/events.rs`. Discriminators are loaded at startup from the on-chain IDL so rebuilds stay in sync. Verified on devnet: a fresh `create_job` tx from `/submit` produced a single-line `JobCreated tx=… job=… buyer=… provider=… spec_hash=… …` log within ~1 second. **Skipped anchorpy** (0.21.0 predates Anchor 1.0 IDL format) — using `borsh-construct` directly.
8. ⏳ **Sun W1 checkpoint:** submit fake job from web → tx on devnet explorer → worker logs receipt (Steps 5+6+7 are integrated; checkpoint = run all three live for the demo recording).

**Fallback rule (per Tech Design §4):** if Sun W1 checkpoint isn't met, +3 days buffer; if still stuck after that, drop to MVP-minimal (3 features only — F1 + F2 + F3, drop F4 + F5 to stretch).

## 📂 Architectural Decisions

*(Log specific choices made during the build here so future agents respect them.)*

- **2026-05-09** — **Anchor 1.0.2** chosen over Pinocchio / vanilla Rust / Quasar. Reason: vibe-coder posture + AI familiarity + DSL safety. (Tech Design §1)
- **2026-05-09** — **Single AI tool = Claude Code (CLI) only**. No Cursor/Copilot/v0.dev. Compensating safeguards: sealevel-attacks checklist + 80% test coverage + invariant assertions + line-by-line diff review on money-touching code. (Tech Design §8)
- **2026-05-09** — **No custom domain at hackathon.** Use `apis-mvp.vercel.app` and `apis-mcp.fly.dev`. Saves $15 and the Vercel/Fly URLs are common at Solana hackathons. (Tech Design §10)
- **2026-05-09** — **Devnet only at hackathon.** Mainnet deployment deferred to post-audit (Phase 2+). Zero real-money exposure during MVP development. (Tech Design §13)
- **2026-05-09** — **Permissive licenses only.** All scaffolds and dependencies must be MIT/Apache-2.0. Explicitly **NO** GPL/AGPL/SSPL (rules out Authme as Tauri reference; use `tauri-apps/create-tauri-app` + filtered `awesome-tauri` instead). (Tech Design §1, §4)
- **2026-05-09** — **Flux.1 Schnell** chosen as the inference model. Reason: only top-tier text-to-image model that is unambiguously **Apache-2.0** (commercial-OK). 4-step inference, NF4 quantization fits on RTX 3060+. (Research §5, Tech Design §5)
- **2026-05-09** — **MCP + x402** chosen as the agent integration combo. MCP for tool discovery, x402 for HTTP-402 settlement on Solana USDC. The differentiating wedge of the project. (Research §6, Tech Design §4 F4)
- **2026-05-09** — **Privy server-wallet** for the demo agent. Acquired by Stripe June 2025; supports Solana via SDP; free tier <500 MAUs covers hackathon load. (Tech Design §3, §5)
- **2026-05-09** — **No native APIS token at hackathon.** Per token strategy: 0% take rate (M0-9) → points program (M9-18) → TGE only after PMF (M18-24). Avoids token-fatigue risk + MiCA exposure. (Research §10, PRD §10)
- **2026-05-09** — **Verification = Layer 1 only at hackathon.** Signatures + 5% spot checks via VRF + slashing. No TEE (infeasible on consumer GPUs in 2026), no zkML (infeasible for Stable Diffusion in 2026). TEE premium tier (via Phala Network) deferred to Phase 2. (Research §4)
- **2026-05-09** — **Cyberpunk Swarm** design direction (pitch black `#000`, Solana green `#14F195`, neon violet `#9945FF`) with subtle hex/swarm motif to differentiate from generic-Solana-DePIN aesthetic. (PRD §7)
- **2026-05-09** — **W4 hard no-go date.** If Claude can't autonomously buy 1 inference by end of W4, freeze scope and polish what works. No new features past W4 — Weeks 5-6 are exclusively polish, demo video, README. (PRD §10, Tech Design §4)
- **2026-05-09** — Buyer web app uses **`@solana/kit`** template (`kit/nextjs`), NOT legacy `@solana/web3.js`. Reason: Solana Foundation's official current template; modern signer/RPC primitives; aligns with `solana-dev` skill's "kit-first" guidance. Migration patterns to web3.js available via `@solana/web3-compat` if needed. (Updates `agent_docs/tech_stack.md` indirectly — that doc should be refreshed in W5.)
- **2026-05-09** — **5 Solana skills installed** (`.agents/skills/`): solana-dev (official bundle of 9 references including Anchor 1.0 migration guide), solana-anchor-claude-skill, helius, pyth, switchboard. Pinned via `skills-lock.json`.
- **2026-05-09** — **Worth investigating in W4:** `kit-node-solanax402` and `x402-template` and `x402-solana-rust` are official community templates from Solana Foundation. May save days of x402 wiring. (Discovered while listing create-solana-dapp templates.)
- **2026-05-09** — **`apis_program` devnet program ID: `2qe8YXciSpony5vjwxZAYJZ7WfRzSHKRdRzSiH868mhf`.** Auto-generated by Anchor at `programs/apis_program/` rename time; synced to source via `anchor keys sync`. Bumped Anchor `1.0.0-rc.5` → stable `1.0.2` during the same step. (Step 5 of W1.)
- **2026-05-09** — **State schema = TD §3 canonical layout from W1.** `Provider` carries `bond_vault: Pubkey` (= `Pubkey::default()` until W2), `active_jobs`/`total_jobs: u64` (= 0 until W2), `status: ProviderStatus { Active, Paused, Slashed }`. `Job` carries `price_lamports_usdc: u64` (= 0 until W2), `status: JobStatus { Created, Funded, Started, Completed, Disputed, Refunded, Slashed }` (W1 only sets `Created`), `completion_proof_hash: Option<[u8; 32]>` (= `None` until W2), `deadline: i64` (set on creation but unused until W2's `auto_release`). **All W2/W3 fields are declared up front** so the upcoming escrow/dispute/slash instructions only add new accounts + new instruction handlers — zero schema migrations expected (per `AGENTS.md` Protected Areas rule). Borsh 1.x ordinal encoding means the enum-variant ordering is now frozen — variants are append-only henceforth.
- **2026-05-09** — **Test runner = `solana-bankrun` (in-process), not surfpool nor `solana-test-validator`.** Surfpool not installed locally; bankrun is faster (full suite runs in ~120ms) and ships zero external-process surface. Set `[tooling] validator = "solana"` in `Anchor.toml` per migration guide §9 to opt out of Anchor 1.0's surfpool default for any future `anchor test` calls.
- **2026-05-09** — **Suppressed `clippy::diverging_sub_expression` at the `apis_program` crate level** with a targeted `#![allow(...)]` and an inline comment. Anchor 1.0.2's `#[program]` macro under Rust 1.95.0 emits this warning from macro-generated code only — not from anything we wrote. Targeted suppression keeps the rest of `clippy::all` strict (per AGENTS.md "no warnings allowed in new code: cargo clippy --all-targets -- -D warnings").
- **2026-05-10** — **Web app TypeScript client = Codama, not hand-rolled.** `codama` + `@codama/nodes-from-anchor` + `@codama/renderers-js` read the on-chain IDL and generate typed instruction builders (`getRegisterProviderInstructionAsync`, `getCreateJobInstructionAsync`), account fetchers (`fetchMaybeProvider`, `fetchJob`), PDA helpers (`findProviderPda`, `findJobPda`), and error parsers. Re-run `pnpm --filter web codama:generate` after any IDL change. Per the `solana-dev` skill's kit-first guidance.
- **2026-05-10** — **Buyer = self-register flow in W1.** The `/submit` page registers the buyer's own wallet as a `Provider` PDA before letting them submit a job (the job then targets the user's own provider). Simplest path to a working W1 demo without an admin pre-registration step. W2 will introduce real provider matching (browse + select).
- **2026-05-10** — **Web wallet bridging via `createWalletTransactionSigner`.** `useWalletConnection().wallet?.account` only carries `{ address, label, publicKey }` — not the full kit `TransactionSigner`. `createWalletTransactionSigner(session)` from `@solana/client` wraps the wallet session into a kit-compatible signer that Codama's async-instruction builders + `useSendTransaction` accept.
- **2026-05-10** — **`packages/web` TypeScript target bumped ES2017 → ES2020** to allow bigint literals (Codama-generated u64 fields use bigint throughout). Next.js 16 + React 19 already require modern engines so no compatibility concern.
- **2026-05-10** — **`framer-motion` chosen for web animations.** Used on `/submit` for entrance + button-press transitions. PRD §7 "Cyberpunk Swarm" direction starts here — pitch black + Solana green + neon violet + hex-grid SVG overlay; full landing-page treatment (three.js / spline / cobe) deferred to a follow-up after Step 7 worker.
- **2026-05-10** — **`ui-ux-pro-max-skill` installed at `.agents/skills/ui-ux-pro-max-skill/`** (MIT, https://github.com/nextlevelbuilder/ui-ux-pro-max-skill). Auto-loaded mid-session and registered 7 sub-skills (`ui-ux-pro-max`, `design`, `banner-design`, `brand`, `slides`, `ui-styling`, `design-system`) for design guidance going forward. Not yet pinned in `skills-lock.json` — the lock-file format expects a single `SKILL.md` path; this skill uses a different structure.
- **2026-05-10** — **Worker = static borsh layouts + IDL-derived discriminators, not anchorpy.** anchorpy 0.21.0 (latest stable) predates Anchor 1.0's IDL format change so it can't load `apis_program.json`. We hand-roll the JobCreated/ProviderRegistered borsh structs in `apis_worker/decoder.py` (mirroring `programs/apis_program/src/events.rs`) and read the discriminators from the IDL at startup. If anchorpy ships Anchor 1.0 support before W2, swap the decoder layer.
- **2026-05-10** — **Worker subscribes via public `wss://api.devnet.solana.com` for W1.** Helius enhanced WebSocket is the post-W1 default (per Tech Design §3) but adds an env-var dependency. `APIS_RPC_WS` / `APIS_RPC_HTTP` env vars override the public endpoint without code changes when the Helius API key is wired up.

## 🐛 Known Issues & Quirks

*(Log current bugs or weird workarounds here.)*

- **Anchor 1.0.2 vs older training data:** Most Anchor tutorials and Claude's training data lean on 0.30.x. Several APIs and macros changed in 1.0. **Mitigation:** every prompt to Claude must include *"Per Anchor 1.0.2 docs at anchor-lang.com — note 1.0.x has breaking changes vs 0.30.x"*. Cross-reference recent commits in `solana-developers/program-examples`.
- **Phantom desktop has no real deeplink protocol** (unlike mobile). For the Tauri provider app, do not use Phantom — use **Privy embedded wallet** OR a local Stronghold-encrypted keypair (Tech Design §4 F1).
- **Flux.1 Schnell requires `guidance_scale = 0`.** It's a distilled model — non-zero CFG produces garbage. Hard-code in worker. `max_sequence_length` ≤ 256.
- **Tauri 2 permissions system** is stricter than v1 — every plugin command needs an explicit capability JSON entry. Budget ~1 day for the permission wiring during W4.
- **Don't bundle PyTorch + CUDA** in the worker installer (~6-8 GB → AV false positives + bricked installs). Ship a thin installer + first-run model downloader with hash verification (Tech Design §13).
- **EV code signing requires a hardware token** (post-Jun 2023 rule) — defer to Phase 2 (~$200/yr). At hackathon: live with SmartScreen warnings; demo provider runs from dev machine.
- **Solana devnet can lag** during high-traffic periods. **Demo strategy:** pre-record the demo video; do not rely on a live demo during the 3-min hackathon submission (Tech Design §13 risk #2).
- **Solana CLI 3.1.15 is not in AVM's release archive** (only the system installer has it). Anchor 1.0.2 falls back to the AVM-cached **3.1.8** when `[toolchain] solana_version = "3.1.15"` is set. **Mitigation:** pin `solana_version = "3.1.8"` in `Anchor.toml` until AVM publishes 3.1.15. Migration guide §0 recommends 3.1.10+, but 3.1.8 works fine with Anchor 1.0.2 in practice (verified end-to-end: build, test, devnet deploy).
- **`packages/program` is excluded from the pnpm workspace** (per `pnpm-workspace.yaml` comment — "Anchor manages its own JS deps"). Running `pnpm install` from inside the package without `--ignore-workspace` is a no-op. **Use `pnpm install --ignore-workspace`** in `packages/program/` to install the test runner / Anchor TS client deps.
- **Root `.gitignore` had a too-broad `lib/` rule** (Python virtualenv convention) that masked `packages/web/app/lib/`. Anchored to `/lib/` and `/lib64/` (repo root only) on 2026-05-10 — the framework's `app/lib/` and similar dirs are tracked again.

## 📜 Completed Phases

- [x] **2026-05-09** — Research Report drafted (`docs/Research-Apis.md` + .pdf, 19 pages)
- [x] **2026-05-09** — PRD drafted (`docs/PRD-Apis-MVP.md` + .pdf, 19 pages)
- [x] **2026-05-09** — Technical Design Document drafted (`docs/TechDesign-Apis-MVP.md` + .pdf, 30 pages)
- [x] **2026-05-09** — GitHub repo `hu-oscar/Apis` created and synced locally
- [x] **2026-05-09** — `AGENTS.md`, `MEMORY.md`, `REVIEW-CHECKLIST.md`, `agent_docs/`, `CLAUDE.md` instantiated from templates
- [x] **2026-05-09** — **W1 Step 5 done:** `apis_program` v0.1 deployed to devnet (`2qe8YXciSpony5vjwxZAYJZ7WfRzSHKRdRzSiH868mhf`); `register_provider` + `create_job` + 2 events; 6/6 tests passing; IDL on-chain via Program Metadata.
- [x] **2026-05-10** — **W1 Step 6 done:** `/submit` page (Next.js 16 + React 19 + `@solana/react-hooks` + Codama-generated TS client + framer-motion + Cyberpunk Swarm theming). Phantom on devnet → register_provider → create_job → Job PDA visible on Explorer.
- [x] **2026-05-10** — **W1 Step 7 done:** Python worker (`apis_worker`) subscribes to devnet via WebSocket (`logsSubscribe`), decodes `JobCreated` + `ProviderRegistered` events via static borsh layouts + IDL-derived discriminators. Verified end-to-end against a fresh `/submit` job.
- [ ] **W1 — Foundation: pipeline end-to-end (fake)** ← *Step 8 remaining (Sun W1 demo: web → devnet → worker live in one shot)*
- [ ] **W2 — Core marketplace: real escrow + Flux Schnell on real GPU**
- [ ] **W3 — Pooling + verification (signatures + spot checks + slashing)**
- [ ] **W4 — Agent + MCP + x402 (the wow demo)** — **HARD NO-GO DATE**
- [ ] **W5 — Polish + submission (README + demo video + live deploy + pitch deck)**
- [ ] **W6 — Buffer / iteration / press push**
