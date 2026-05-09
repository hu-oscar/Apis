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
5. ⏳ Smart contract v0.1: refactor escrow tutorial → Apis-specific `register_provider` + `create_job` instructions + 2 events; deploy to devnet
6. ⏳ Web app v0.1: connect Phantom + 1 page submitting a fake job through the program
7. ⏳ Worker v0.1: Python script subscribes to `JobCreated` events via Helius websocket and logs receipt
8. ⏳ **Sun W1 checkpoint:** submit fake job from web → tx on devnet explorer → worker logs receipt

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

## 🐛 Known Issues & Quirks

*(Log current bugs or weird workarounds here.)*

- **Anchor 1.0.2 vs older training data:** Most Anchor tutorials and Claude's training data lean on 0.30.x. Several APIs and macros changed in 1.0. **Mitigation:** every prompt to Claude must include *"Per Anchor 1.0.2 docs at anchor-lang.com — note 1.0.x has breaking changes vs 0.30.x"*. Cross-reference recent commits in `solana-developers/program-examples`.
- **Phantom desktop has no real deeplink protocol** (unlike mobile). For the Tauri provider app, do not use Phantom — use **Privy embedded wallet** OR a local Stronghold-encrypted keypair (Tech Design §4 F1).
- **Flux.1 Schnell requires `guidance_scale = 0`.** It's a distilled model — non-zero CFG produces garbage. Hard-code in worker. `max_sequence_length` ≤ 256.
- **Tauri 2 permissions system** is stricter than v1 — every plugin command needs an explicit capability JSON entry. Budget ~1 day for the permission wiring during W4.
- **Don't bundle PyTorch + CUDA** in the worker installer (~6-8 GB → AV false positives + bricked installs). Ship a thin installer + first-run model downloader with hash verification (Tech Design §13).
- **EV code signing requires a hardware token** (post-Jun 2023 rule) — defer to Phase 2 (~$200/yr). At hackathon: live with SmartScreen warnings; demo provider runs from dev machine.
- **Solana devnet can lag** during high-traffic periods. **Demo strategy:** pre-record the demo video; do not rely on a live demo during the 3-min hackathon submission (Tech Design §13 risk #2).

## 📜 Completed Phases

- [x] **2026-05-09** — Research Report drafted (`docs/Research-Apis.md` + .pdf, 19 pages)
- [x] **2026-05-09** — PRD drafted (`docs/PRD-Apis-MVP.md` + .pdf, 19 pages)
- [x] **2026-05-09** — Technical Design Document drafted (`docs/TechDesign-Apis-MVP.md` + .pdf, 30 pages)
- [x] **2026-05-09** — GitHub repo `hu-oscar/Apis` created and synced locally
- [x] **2026-05-09** — `AGENTS.md`, `MEMORY.md`, `REVIEW-CHECKLIST.md`, `agent_docs/`, `CLAUDE.md` instantiated from templates
- [ ] **W1 — Foundation: pipeline end-to-end (fake)** ← *we are here*
- [ ] **W2 — Core marketplace: real escrow + Flux Schnell on real GPU**
- [ ] **W3 — Pooling + verification (signatures + spot checks + slashing)**
- [ ] **W4 — Agent + MCP + x402 (the wow demo)** — **HARD NO-GO DATE**
- [ ] **W5 — Polish + submission (README + demo video + live deploy + pitch deck)**
- [ ] **W6 — Buffer / iteration / press push**
