# Technical Design Document: Apis MVP

**Version:** 1.0
**Status:** Draft — Ready for Implementation
**Created:** 2026-05-09
**Companion docs:** [`Apis_Research_Report.md`](Apis_Research_Report.md), [`PRD-Apis-MVP.md`](PRD-Apis-MVP.md)
**Owner:** Apis founding team
**Hackathon target:** Dev3pack (Solana track) — submission window ~6 weeks

---

## Table of Contents

1. [How We'll Build It](#1-how-well-build-it)
2. [Alternative Options Compared](#2-alternative-options-compared)
3. [Project Setup Checklist](#3-project-setup-checklist)
4. [Building Your Features](#4-building-your-features)
5. [Design Implementation](#5-design-implementation)
6. [Database & Data Storage](#6-database--data-storage)
7. [Product AI Features](#7-product-ai-features)
8. [AI Assistance Strategy](#8-ai-assistance-strategy)
9. [Deployment Plan](#9-deployment-plan)
10. [Cost Breakdown](#10-cost-breakdown)
11. [Scaling Path](#11-scaling-path)
12. [Maintenance & Updates](#12-maintenance--updates)
13. [Important Limitations](#13-important-limitations)
14. [Learning Resources](#14-learning-resources)
15. [Success Checklist](#15-success-checklist)
16. [Definition of Technical Success](#16-definition-of-technical-success)

---

## 1. How We'll Build It

### Recommended Approach: **AI-assisted full-stack with battle-tested scaffolds**

Apis spans 5 surfaces (smart contract, web app, desktop app, worker, MCP server) and 5 languages (Rust, TypeScript, Python, JS, shell). Building this from blank pages is impossible at vibe-coder pace. The strategy is:

> **Start every component from a vetted scaffold. Use Claude Code to modify, never to write blank-page boilerplate. Read every smart-contract diff line-by-line.**

### Primary recommendation: **Single AI = Claude Code (CLI), Permissive-license scaffolds, Real on-chain testing from W1**

| Layer | Scaffold to start from | License | Effort |
|---|---|---|---|
| **Anchor program** | [`solana-developers/program-examples/tokens/escrow`](https://github.com/solana-developers/program-examples) | Apache-2.0 | Modify, don't write from scratch |
| **Web app** | `npx create-solana-dapp@latest` (official Solana scaffold) | MIT | Customize layout + features |
| **Tauri desktop** | `npx create-tauri-app@latest --template react-ts` (official) | Apache-2.0 / MIT | Add system tray + sidecar pattern |
| **Worker (Python)** | HuggingFace `diffusers` Flux Schnell example + custom Solana glue | Apache-2.0 | Wrap with anchorpy + Pinata + signing |
| **MCP server** | `@modelcontextprotocol/sdk` Node template + Coinbase x402 examples | MIT | Stitch together, no novel infra |

### Why this works for you (vibe-coder posture)

1. **Time-to-MVP:** 5-6 weeks instead of 12+ weeks (research-driven estimate per PRD §10)
2. **Cost:** $20-50/mo (Claude Code subscription + ~$5-20 Anthropic API for testing)
3. **Learning curve:** Rust/Anchor + Tauri are the two new domains. The rest leverages your existing TS/Next.js/Python skills.
4. **Risk profile:** Battle-tested scaffolds eliminate ~80% of the bugs that plague blank-page builds.
5. **Hackathon credibility:** Judges expect ecosystem-standard scaffolds; reinventing patterns signals you don't know the ecosystem.

### Limitations to know

- **Anchor 1.0.2 has breaking changes vs 0.30.x.** Most tutorials and Claude's training data lean on 0.30.x. **Mitigation:** every prompt must include *"Per Anchor 1.0.2 docs at anchor-lang.com — note 1.0.x has breaking changes."*
- **Single-AI workflow loses the second-pair-of-eyes** on money-touching code. **Mitigation:** deterministic safeguards (sealevel-attacks checklist, 80%+ test coverage, invariant assertions) — see §4 F3.
- **Tauri 2.x is recent (stable Oct 2024).** Some patterns are still being formalized. **Mitigation:** stick to first-party `tauri-apps/awesome-tauri` references, avoid GPL-licensed forks.

---

## 2. Alternative Options Compared

### For the smart contract framework

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Anchor 1.0.2** ✅ recommended | Mature, productive, AI-friendly, has IDL+typed clients out of the box | Higher CU per instruction vs lower-level | **Use this** |
| Pinocchio (zero-deps) | Minimal CU, used by Squads/Jito | No DSL for account validation, you re-implement Anchor's safety by hand | Skip — wrong tool for vibe-coder |
| Vanilla `solana-program` | Maximum control | You re-implement everything | Skip |
| Quasar | Newer alternative | Tiny ecosystem, Claude Code unfamiliar | Skip |

### For the web framework

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Next.js 15 via `create-solana-dapp`** ✅ | Standard, AI-friendly, you know it | None at this scale | **Use this** |
| SvelteKit | Smaller bundle | Smaller Solana ecosystem support | Skip |
| Remix | Great DX | Less Solana ecosystem traction | Skip |

### For the desktop framework

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Tauri 2.x** ✅ | ~15 MB binary, Rust shell + web frontend, MIT/Apache | New for you, Rust IPC has a learning curve | **Use this** |
| Electron | Mature, easier IPC | ~150 MB binary, slower startup, gamer audience hates this | Skip |
| Native (Win32 / .NET MAUI / Wails) | Native performance | Rust + low-level Windows = months of work | Skip |

### For the worker stack

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Python + diffusers + bitsandbytes** ✅ | Standard ML stack, all Apache-2.0, you know Python | Packaging on Windows is non-trivial (Nuitka) | **Use this** |
| Rust (candle, mistral.rs) | Faster, single-binary | Models lag 6-12 months behind PyTorch | Skip |
| Node.js + onnx-runtime | JS-native | Limited model support, slower | Skip |

### For the agent payment protocol

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **MCP + x402** ✅ | Native to Claude/GPT, x402 production on Solana with 35M+ tx | Combination not yet a formal SEP | **Use this — this is the wedge** |
| API key + Stripe | Familiar | Defeats the agent-economy thesis (no KYC for agents) | Skip |
| OpenAI function calling only | Built-in | Doesn't expose Apis to non-OpenAI agents | Skip — too narrow |

### For RPC

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Helius free tier** ✅ | 1M credits/mo, 10 RPS, websockets, DAS API, best DX | Free tier credits go fast on hot paths | **Use this for hackathon** |
| Triton One | Lowest p99 latency | Project-priced, no real free tier | Phase 2 if needed |
| QuickNode | 10M credits/mo free, multi-chain | Solana DX behind Helius | Skip |
| Public RPC | Free | Throttled, unreliable, no DAS | Backup only |

---

## 3. Project Setup Checklist

### Step 1: Accounts (Day 1, ~1 hour)

- [ ] **Phantom wallet** — `phantom.com` (gen new keypair, save seed phrase securely)
- [ ] **Solana devnet faucet** — `faucet.solana.com` (airdrop 5-10 SOL)
- [ ] **GitHub repo** — `apis-mvp` (public, MIT license)
- [ ] **Helius dashboard** — `helius.dev` (claim free tier, save API key in `.env`)
- [ ] **Pinata** — `pinata.cloud` (free tier, save API key)
- [ ] **Vercel** — `vercel.com` (link GitHub)
- [ ] **Fly.io** — `fly.io` (free trial $5 credit)
- [ ] **Privy** — `privy.io` (free <500 MAUs, save API key)
- [ ] **Anthropic API** — `console.anthropic.com` (top up $5-10 for testing the demo agent)
- [ ] **Noah AI 5M credits** — claim via Dev3pack form: `forms.gle/LNDjeS8YY8kvqb328`
- [ ] **Coinbase Developer Platform** — `cdp.coinbase.com` (for x402 facilitator)

### Step 2: Local environment (Day 1, ~2-3 hours)

```bash
# 1. Rust + Solana + Anchor toolchain (Mac/Linux/WSL)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 1.0.2 && avm use 1.0.2
anchor --version   # → anchor-cli 1.0.2

# 2. Node.js (for web app + MCP server)
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 22 && fnm use 22

# 3. Python (for worker)
brew install python@3.12  # or apt install python3.12 on Ubuntu

# 4. Tauri prerequisites
# macOS: xcode-select --install
# Windows: install MSVC build tools + WebView2
cargo install create-tauri-app --locked

# 5. Verify Claude Code CLI
claude --version
```

### Step 3: Bootstrap the monorepo (Day 1-2)

```bash
# 1. Create the monorepo
mkdir apis-mvp && cd apis-mvp
pnpm init   # or npm init -y
git init && echo "node_modules\n.env*\ntarget/\ndist/\n.next/\n.tauri/" > .gitignore

# 2. Add the four sub-projects as folders (NOT git submodules — flat monorepo)
#    Each is bootstrapped from its official scaffold.

# 2a. Anchor program
mkdir -p packages/program && cd packages/program
git clone --depth=1 https://github.com/solana-developers/program-examples /tmp/sdp
cp -r /tmp/sdp/tokens/escrow/anchor/. .
# now strip what's not needed and rename to "apis_program"
cd ../..

# 2b. Next.js web app (buyer-side)
pnpm create solana-dapp@latest packages/web --template next
# Choose: TypeScript, Tailwind, App Router, wallet-adapter

# 2c. Tauri provider desktop app
cd packages && cargo create-tauri-app --template react-ts apis-provider
cd ..

# 2d. Python worker
mkdir -p packages/worker && cd packages/worker
python3 -m venv .venv && source .venv/bin/activate
pip install diffusers torch bitsandbytes anchorpy solders solana ipfshttpclient pillow
cd ../..

# 2e. MCP server (Node + Hono + x402)
mkdir -p packages/mcp && cd packages/mcp
pnpm init -y && pnpm add @modelcontextprotocol/sdk hono x402 \
  @solana/web3.js @solana/spl-token @anthropic-ai/sdk
cd ../..

# 3. Push initial commit
git add . && git commit -m "feat: initial monorepo scaffold"
git remote add origin git@github.com:YOUR_USER/apis-mvp.git
git push -u origin main
```

### Step 4: Verify "Hello World" pipeline (Day 2)

- [ ] `anchor build && anchor test` passes from `packages/program` (escrow tutorial)
- [ ] `pnpm dev` from `packages/web` shows the Solana wallet-adapter connect button
- [ ] `pnpm tauri dev` from `packages/apis-provider` opens a hello-world window
- [ ] `python -c "import torch; print(torch.cuda.is_available())"` returns `True` from `packages/worker`
- [ ] `node packages/mcp/index.ts` runs an empty MCP server on `localhost:8787`

When all 5 boxes are checked, you've proven the toolchain works. Now the real building starts.

---

## 4. Building Your Features

This section maps each PRD feature to a concrete implementation plan with Claude Code prompts.

### Feature F3 — Trustless Escrow Smart Contract (build first, in W1-W2)

**Why first:** every other component depends on the program. The program is also the most security-critical and the steepest learning curve, so attack it while you're fresh.

**Complexity:** Hard (Rust learning curve)
**Estimated effort:** 7-10 days

#### Implementation steps

**Step 1 — Reproduce the escrow tutorial 1:1 (Day 1-2)**

Don't write any custom code yet. Just get the example working on your devnet.

```bash
cd packages/program
anchor build
anchor deploy --provider.cluster devnet
anchor test  # confirm escrow flow works
```

If this works, you've cleared the biggest learning hurdle.

**Step 2 — Rename + add Apis-specific accounts (Day 3-4)**

Claude Code prompt template:
```
Per Anchor 1.0.2 docs (note 1.0.x has breaking changes vs 0.30.x), and using the
patterns from solana-developers/program-examples/tokens/escrow as the base:

Refactor my escrow program into "apis_program" with these accounts:
- GlobalConfig (singleton PDA): admin, usdc_mint, fee_bps, paused, bump
- ProviderRegistry (per provider): provider, bond_vault, gpu_specs_hash,
  endpoint_uri_hash, active_jobs, total_jobs, status, bump
- JobRecord (per job): client, provider, nonce, price_lamports_usdc,
  spec_hash, status, funded_at, deadline, completion_proof_hash, bump
- ReputationAccount (per provider): provider, jobs_completed, jobs_failed,
  total_volume, score_ema, last_updated, bump
- DisputeAccount (per job, optional): job, raised_by, raised_at, evidence_hash,
  resolved, resolution, bump

EscrowVault is an SPL Token account (NOT a custom Anchor account) at PDA
["vault", job_record.key()] with authority = JobRecord PDA.

Rules:
1. Use `transfer_checked` everywhere, never `transfer`.
2. Hardcode `Program<'info, Token>` — never accept arbitrary token program.
3. Every PDA validates `seeds = [...]`, `bump`, and uses `has_one = ...` where applicable.
4. Set `overflow-checks = true` in Cargo.toml [profile.release].

Explain your design before writing the code.
```

**Step 3 — Add the 12 instructions (Day 5-7)**

```
Per Anchor 1.0.2 — implement these instructions in apis_program:

1. initialize_config(admin, usdc_mint, fee_bps, min_bond)
2. register_provider(specs_hash, endpoint_uri_hash, bond_amount)
3. deposit_bond(amount), withdraw_bond(amount)
4. create_job(provider, nonce, price, spec_hash, deadline)  // funds escrow
5. accept_job()  // provider signs, status -> Started
6. submit_completion(completion_proof_hash)  // provider signs result
7. confirm_completion()  // client signs, releases funds minus fee
8. auto_release()  // anyone can call after deadline + grace if no dispute
9. cancel_job()  // client only, before accept_job
10. raise_dispute(evidence_hash)  // either party
11. resolve_dispute(resolution)  // admin/multisig only
12. slash_provider(provider, bps)  // admin only

For each instruction:
- Add a #[derive(Accounts)] context with all required validations
- Use checked_add / checked_mul / checked_sub for all math
- Re-read state after every CPI (don't trust cached values)
- Include integration tests that exercise the happy path AND a malicious-input case
- Emit events for off-chain indexers

Explain each instruction's invariants before writing it.
```

**Step 4 — Spot-check + slashing (Day 8-9)**

```
Per the verification stack from the Apis Research Report §4 (Layer 1):

Add spot-check verification. ~5% of jobs are randomly selected via VRF
(use the slot hash as the entropy source for hackathon simplicity, real
VRF in Phase 2). When selected:
- The smart contract emits a SpotCheckRequired event
- An Apis-controlled validator re-runs the job and posts a hash
- If hashes diverge: provider's bond gets slashed 100% of bond_per_job

Add the slashing instruction with these guards:
- Only admin (or DisputeAccount-authorized resolver) can call slash_provider
- Slashed amount is split: 50% to challenger, 50% to fee_treasury
- Provider's status is set to Slashed (cannot accept new jobs)
- 7-day stake unbonding cooldown after withdrawal request

Explain the security model before writing the code.
```

**Step 5 — Test rigorously (Day 10)**

Run the [`coral-xyz/sealevel-attacks`](https://github.com/coral-xyz/sealevel-attacks) checklist manually. For each attack vector:
- Account confusion / type confusion
- Missing signer checks
- Arbitrary CPI
- Rent / close attacks
- Reinitialization
- Integer overflow on payment math
- Missing `has_one` constraints
- Lamport drains via writable account

Write a test that *would* exploit the vulnerability and confirm your code rejects it.

**Acceptance criteria (per PRD §5 F3):**
- [ ] Deployed to devnet with addresses documented in `README.md`
- [ ] Funds never lost in normal flow (test suite proves this)
- [ ] Cheating provider gets slashed within 2h dispute window
- [ ] At least 8 Solana SDKs documented in README

---

### Feature F1 — Provider Earn-While-Idle Desktop App (build in W1-W4 in parallel)

**Complexity:** Medium-Hard (Tauri new for you)
**Estimated effort:** 10-14 days, parallelizable with F3

#### Architecture

```
┌─────────────────────────────────────┐
│ Tauri Webview (React + TS)          │
│ - GPU detection display             │
│ - Earnings dashboard                │
│ - System tray integration           │
└──────────────┬──────────────────────┘
               │ Rust ↔ JS bridge (Tauri commands)
┌──────────────▼──────────────────────┐
│ Tauri Rust shell                    │
│ - System tray controller            │
│ - Wallet keypair (Stronghold)       │
│ - Spawn + monitor Python sidecar    │
│ - GPU detection (nvml-wrapper)      │
└──────────────┬──────────────────────┘
               │ JSON-RPC over local websocket (127.0.0.1)
┌──────────────▼──────────────────────┐
│ Python Worker Sidecar               │
│ - Listen for jobs (Solana websocket)│
│ - Run Flux Schnell                  │
│ - Sign result + upload to IPFS      │
│ - Submit completion to program      │
└─────────────────────────────────────┘
```

#### Implementation steps

**Step 1 — Tauri scaffold + GPU detection (Day 1-2)**

```bash
cd packages/apis-provider
pnpm tauri dev  # confirm hello-world works
```

Claude Code prompt:
```
Using Tauri 2.x (stable since Oct 2024 — note v1 vs v2 differences) with the
React + TypeScript template:

Build a basic UI showing:
- Detected GPU (use nvml-wrapper Rust crate for NVIDIA cards on Windows)
- Available VRAM
- A "Start Hosting" button that's disabled until GPU detected

Implement two Tauri commands:
- detect_gpu() -> GpuInfo { name, vram_gb, cuda_version, driver_version }
- start_hosting(price_lamports_per_job) -> Result<(), String>

Use tauri-plugin-store for persisting user preferences.
Use tauri-plugin-system-tray for the tray icon.

Explain the IPC boundary before writing.
```

**Step 2 — Wallet management with Stronghold (Day 3)**

```
Add a local wallet using tauri-plugin-stronghold for OS-keychain-encrypted
keypair storage. On first launch:
- Generate a new ed25519 keypair (Solana)
- Encrypt it under a user passphrase
- Store the encrypted form in app data dir
- Display the public key to the user
- DO NOT display the private key in any UI

Add a "Show recovery phrase" feature behind a re-enter-passphrase prompt.

Use the @solana/wallet-adapter pattern but adapted to Tauri's local context
(no browser extension).
```

**Step 3 — Spawn Python sidecar (Day 4-5)**

```
Set up the Python sidecar pattern in Tauri 2.x. The sidecar lifecycle:
1. On "Start Hosting" click → Tauri spawns python -m apis_worker on a random
   localhost port via tauri-plugin-shell or tauri-plugin-sidecar.
2. Tauri opens a local websocket connection to the sidecar.
3. JSON-RPC 2.0 over websocket: methods = run_job, get_status, stop.
4. On Tauri quit OR system shutdown → graceful sidecar shutdown via SIGTERM.

For Windows, package the sidecar as a Windows Service via the windows-service
Rust crate so the worker survives the GUI window closing.

Provide a fallback launcher script for users who can't install the service.
```

**Step 4 — System tray + auto-pause during gaming (Day 6-7)**

```
Add system tray functionality:
- Right-click menu: Open dashboard | Pause / Resume | Settings | Quit
- Tray icon changes color based on status (green=hosting, yellow=paused, red=error)

Implement auto-pause:
- Poll GPU usage every 5 seconds via nvml-wrapper
- If non-Apis processes are using >40% GPU → pause Apis worker
- When usage drops below 20% for 5 minutes → resume

Notification on first earning + every $10 milestone.
```

**Step 5 — Earnings dashboard (Day 8-9)**

```
Build the dashboard UI in React showing:
- Today's earnings (USDC)
- All-time earnings
- Jobs completed today
- A live log of incoming jobs (last 10)
- Provider's reputation score (fetched from Solana via @solana/web3.js)

Use shadcn/ui components for the polished look.
Color scheme per PRD §7: pitch black background (#000), Solana green (#14F195)
accents, neon violet (#9945FF) for the "Apis = bee" hex motif on backgrounds.
```

**Acceptance criteria (per PRD §5 F1):**
- [ ] Install + benchmark + first job in <5 min
- [ ] Pauses automatically when game GPU usage >40%
- [ ] First USDC payout visible within 24h
- [ ] CPU usage <5% idle, ~95% GPU during jobs

---

### Feature F4 — AI Agent Compute API (MCP + x402) — THE wedge (build in W4)

**Complexity:** Medium (you know TS/Node)
**Estimated effort:** 4-6 days

This is the demo headliner. Quality must be perfect (Q7 priority).

#### Architecture

```
Agent (Claude Sonnet 4.x via Anthropic SDK)
  │
  ▼
MCP server (Node + Hono + @modelcontextprotocol/sdk)
  │
  ├─→ tools/list, tools/call routes
  ├─→ x402 middleware (Coinbase x402 npm package)
  ├─→ Solana facilitator verification (@solana/web3.js)
  └─→ Solana program calls (anchorpy / @coral-xyz/anchor TS client)
```

#### Implementation steps

**Step 1 — Bare MCP server (Day 1)**

```
Build an MCP server using @modelcontextprotocol/sdk over Streamable HTTP.

Expose 4 tools:
1. list_offers() -> [{provider_id, gpu_class, price_per_inference, reputation}]
2. quote_inference({prompt, model, max_price}) -> {price_usdc, spec_hash}
3. submit_job({spec_hash}) -> 402 Payment Required initially
4. get_job_status({job_id}) -> {status, result_cid?, error?}

Implement only list_offers and quote_inference for now (no payment).
Test with Anthropic's MCP Inspector: npx @modelcontextprotocol/inspector
Confirm the tools are discoverable and callable.
```

**Step 2 — x402 middleware (Day 2)**

```
Wire up Coinbase x402 to the MCP server.

When submit_job is called WITHOUT a valid X-PAYMENT header, return:
HTTP 402 Payment Required
Body: {
  accepts: [{
    scheme: "exact",
    network: "solana-devnet",
    asset: "USDC",
    payTo: APIS_TREASURY_PUBKEY,
    maxAmountRequired: quoted_price,
    description: "Apis inference job " + spec_hash
  }]
}

When called WITH X-PAYMENT, validate the signed SPL transfer authorization
via the Coinbase x402 facilitator API, then proceed to dispatch the job.

Use the official x402 npm package (github.com/coinbase/x402).
Reference: github.com/coinbase/x402/tree/main/examples
```

**Step 3 — Connect MCP to the on-chain program (Day 3)**

```
On a successful submit_job:
1. Build a Solana transaction calling apis_program.create_job(...)
2. The MCP server signs as the buyer's relayer (using the buyer's funded
   USDC wallet — or, if the agent has its own wallet, use the agent's
   pre-signed tx). For the demo: use Privy server-wallet on the agent side.
3. Confirm the tx on devnet, return the job_id to the agent.

Use anchorpy or @coral-xyz/anchor TS client. Reference the IDL exported by
anchor build.
```

**Step 4 — Demo agent (Day 4-5)**

```
Build a demo agent in Node that:
1. Uses Anthropic SDK with Claude Sonnet 4.x.
2. Has a Privy server-wallet on Solana devnet, funded with $5 USDC.
3. System prompt: "You are an AI agent. You have a Solana wallet with $5 USDC.
   Find compute marketplaces via MCP and pay for what you need.
   Do NOT ask for human input."
4. Connects to mcp.apis.fly.dev via MCP.
5. Tool: an HTTP fetch wrapper that handles 402 retries automatically.
6. Test prompt: "Generate 4 hero images for an Apis hackathon landing page.
   Find a GPU marketplace and pay for compute yourself. Budget: $1."

Stream Claude's reasoning to a Next.js demo UI for the video recording.
```

**Step 5 — ElizaOS plugin (W4 stretch)**

```
Build @elizaos/plugin-apis (~200 lines) that exposes a buyCompute(prompt, model)
action. Reference: github.com/elizaOS/eliza/tree/main/packages/plugin-solana

This is a stretch goal that activates the Virtuals/Eliza sponsor angles.
Skip if Day 5 of W4 isn't enough.
```

**Acceptance criteria (per PRD §5 F4):**
- [ ] Claude Sonnet 4.x agent autonomously buys 1 inference end-to-end in <60s
- [ ] x402 payment settles via Coinbase facilitator on Solana devnet
- [ ] MCP server passes Anthropic's MCP Inspector tests
- [ ] One working ElizaOS plugin example

---

### Feature F2 — Marketplace Web App (build in W2-W3)

**Complexity:** Medium (your zone of confidence)
**Estimated effort:** 7-10 days

#### Pages to build

| Page | Path | Purpose |
|---|---|---|
| Landing | `/` | Pitch, "Connect wallet" CTA, live stats |
| Browse providers | `/providers` | Filterable grid + global hex map |
| Submit job | `/submit` | Prompt input, model selector, price quote, pay |
| Job result | `/job/[id]` | Image preview + tx hash + IPFS link + rate provider |
| History | `/history` | User's past jobs |
| Public stats | `/stats` | North-Star metric + GMV + provider count |
| Agent docs | `/agents` | API docs, code snippets, MCP install button |

#### Implementation steps

**Step 1 — Layout + wallet adapter (Day 1)**

```
Per the create-solana-dapp scaffold, set up:
- App Router with the 7 pages above
- @solana/wallet-adapter-react for Phantom/Solflare/Backpack
- shadcn/ui base components
- Theme: pitch black (#000), Solana green (#14F195) primary, neon violet (#9945FF)
  secondary, hex motif (#1A1A1A @ 3% opacity) on backgrounds
- Inter font for UI, JetBrains Mono for code, Space Grotesk for headlines
```

**Step 2 — Provider browse page (Day 2-3)**

```
Build /providers page:
- Fetch all ProviderRegistry accounts from the Apis program (using getProgramAccounts
  with appropriate filters)
- Display in a grid: GPU class, price per inference, reputation score, location
  (derived from connection latency or self-declared), uptime %, status
- Add filters: GPU class (RTX 30xx/40xx/50xx), price range, min reputation
- Show a global map (use react-simple-maps or mapbox-gl-js) with glowing hex tiles
  per provider location. This is a pivotal visual moment.
- Real-time updates via Helius enhanced websockets
```

**Step 3 — Submit job page (Day 4-5)**

```
Build /submit:
- Prompt input (textarea, max 256 chars per Flux Schnell limit)
- Model selector: Flux Schnell (default), Flux Schnell + verified tier (3.5x price)
- Resolution: 512² | 1024² | 2048²
- Optional: provider selection (cheapest | fastest | specific by ID)
- Real-time price quote (calls MCP server's quote_inference under the hood)
- Pay & Submit → builds Solana tx via @coral-xyz/anchor TS client + signs with
  Phantom + waits for confirmation + redirects to /job/[id]

Mobile-responsive (judges may demo on phone).
```

**Step 4 — Job result + history pages (Day 6-7)**

```
Build /job/[id] and /history:
- /job/[id]: subscribes to the JobRecord account via websocket, streams
  status changes (Funded → Started → Completed / Disputed). Shows the
  IPFS-hosted image, tx hash, "Rate provider" 1-5 star button.
- /history: user's past jobs, filterable by status, sortable by date.
```

**Step 5 — Public stats page (Day 8)**

```
Build /stats:
- Real-time North Star: Verified Inferences per Day (large number)
- Global GMV in USDC
- Active providers count + locations (mini map)
- Last 24h job latency p95
- Total slashings
- Refresh every 5s via SWR + Helius webhooks

This is the transparency differentiator vs io.net's opacity. Make it pretty.
```

**Step 6 — Agent docs page (Day 9-10)**

```
Build /agents with:
- Quick-start: 5 lines of TS to call Apis from any agent
- MCP install button (deeplink: claude://mcp/install/...)
- API reference auto-generated from the MCP server schema
- Code snippets in TypeScript, Python, and ElizaOS plugin form
- Cost calculator widget
```

**Acceptance criteria (per PRD §5 F2):**
- [ ] Submit-job-to-result < 10s for Flux Schnell at 1024²
- [ ] Cost ≤ $0.02 per image
- [ ] Browse providers + filter in <2s page load
- [ ] Mobile-responsive

---

### Feature F5 — Multi-GPU Pooling for Batch Jobs (build in W3)

**Complexity:** Medium
**Estimated effort:** 4-5 days

#### Approach: data-parallelism only (NOT model splitting)

When buyer submits a batch of N images, the smart contract creates N sub-jobs and dispatches each to a different provider. Aggregation happens client-side or in the MCP server.

#### Implementation steps

**Step 1 — Smart contract changes (Day 1-2)**

```
Add to apis_program a new instruction:
create_batch_job(provider_ids: Vec<Pubkey>, sub_specs: Vec<[u8;32]>, total_price: u64)

This creates ONE parent BatchJob account + N child JobRecord accounts.
Funds the escrow with total_price. Each sub-job follows the normal lifecycle.
Aggregates payouts on confirm_completion.

If 1 of N sub-jobs fails: the remaining N-1 results are delivered, the
failed sub-job's funds are auto-refunded after grace period.
```

**Step 2 — MCP server batching (Day 3)**

```
In the MCP server, add a new tool:
submit_batch_job({prompts: Vec<String>, model, max_price_per_image})

This:
1. Quotes each prompt
2. Selects N providers minimizing total cost (greedy)
3. Calls create_batch_job on the program
4. Dispatches each sub-job to its provider via websocket
5. Streams partial results to the agent as they arrive
6. Returns the aggregate when all complete (or timeout)
```

**Step 3 — Frontend batch UI (Day 4)**

```
On /submit, add a "Batch mode" toggle. When enabled:
- Multi-prompt input (one per line, up to 20)
- Live preview shows N hex tiles on the global map lighting up as each
  provider picks up a sub-job
- Results arrive in parallel; show them in a 4-column grid

This is THE visual demo moment for the hackathon video.
```

**Step 4 — End-to-end test (Day 5)**

```
Test a 20-image batch with 5 providers:
- Total time should be ≤ 1.5x the time of a single image
- All 20 results returned
- Smart contract correctly tracks 20 sub-jobs and releases payments
- Force one provider to fail mid-job; confirm graceful degradation
```

**Acceptance criteria (per PRD §5 F5):**
- [ ] 20-image batch ≤ 1.5x single-image time
- [ ] Smart contract correctly tracks N sub-jobs + proportional payment
- [ ] Single provider failure handled gracefully
- [ ] Demo shows real-time map of providers lighting up

---

## 5. Design Implementation

### Matching the PRD vibe: **Cyberpunk Swarm**

#### Design tokens (use these everywhere, never raw hex)

```typescript
// packages/web/src/lib/design-tokens.ts
export const colors = {
  background: '#000000',
  surface: '#0F0F0F',
  primary: '#14F195',          // Solana green
  secondary: '#9945FF',         // neon violet
  text: '#FAFAF9',
  hexMotif: 'rgba(26,26,26,0.03)',
  success: '#14F195',
  error: '#FF3B5C',
}

export const typography = {
  ui: 'Inter, system-ui, sans-serif',
  code: '"JetBrains Mono", Monaco, monospace',
  display: '"Space Grotesk", Inter, sans-serif',
}

export const spacing = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  xxl: '4rem',
}
```

#### Differentiation moves (avoid the "generic Solana DePIN" cliché)

1. **Subtle hex grid background** at ~3% opacity on landing + stats pages
2. **Swarm loading animation** — small hex tiles light up around a job in flight
3. **World map** — providers shown as glowing hexagons (not pins)
4. **Page transitions** — subtle scale-fade with the brand colors

### Component library

Use shadcn/ui as the base. Customize with Cyberpunk Swarm tokens. Custom components to build:

| Component | Purpose | Page |
|---|---|---|
| `<HexMap />` | Global provider map with glowing hex tiles | `/`, `/providers`, `/stats` |
| `<JobStreamLog />` | Live log of incoming jobs | Provider dashboard, `/job/[id]` |
| `<PriceQuoteWidget />` | Real-time inference price quote | `/submit` |
| `<NorthStarCounter />` | Animated big-number display | `/stats` |
| `<TxConfirmationOverlay />` | On-chain confirmation animation | All flows |
| `<HexTileGrid />` | Provider grid with hex-tile aesthetic | `/providers` |

### Mobile responsiveness checklist

- [ ] All pages render usably at 375px width
- [ ] Touch-friendly button sizes (min 44px target)
- [ ] No horizontal scrolling
- [ ] Phantom mobile deeplink works
- [ ] Font sizes legible on small screens (min 14px body)
- [ ] Map zoom + pan works on touch

---

## 6. Database & Data Storage

### What lives where

| Data | Storage | Why |
|---|---|---|
| **Marketplace state** (providers, jobs, escrows) | **Solana on-chain** (Anchor accounts) | Source of truth, censorship-resistant |
| **Generated images** | **IPFS via Pinata** | Decentralized, buyer keeps CID |
| **Buyer prompts (during job lifecycle)** | **MCP server in-memory + 7-day Postgres TTL** | Privacy; auto-purged |
| **Indexed history** (for fast queries) | **Postgres on Fly.io** + Helius webhooks | Solana queries are slow at scale |
| **Provider local data** (wallet, settings) | **Stronghold encrypted store** in Tauri | OS-keychain protected |
| **Web analytics** | **PostHog** (self-hosted or cloud) | Anonymous events only |

### Postgres schema (indexer + analytics)

```sql
-- Mirror of on-chain JobRecord for fast queries
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_pubkey TEXT UNIQUE NOT NULL,
    client_pubkey TEXT NOT NULL,
    provider_pubkey TEXT NOT NULL,
    status TEXT NOT NULL,  -- Funded|Started|Completed|Disputed|Refunded|Slashed
    price_usdc BIGINT NOT NULL,
    spec_hash TEXT NOT NULL,
    completion_proof_hash TEXT,
    result_cid TEXT,  -- IPFS CID
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    purge_after TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days')
);

CREATE INDEX idx_jobs_client ON jobs(client_pubkey);
CREATE INDEX idx_jobs_provider ON jobs(provider_pubkey);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_purge ON jobs(purge_after);

-- Aggregated provider metrics (rebuilt nightly)
CREATE TABLE provider_metrics (
    provider_pubkey TEXT PRIMARY KEY,
    jobs_completed_total BIGINT NOT NULL DEFAULT 0,
    jobs_failed_total BIGINT NOT NULL DEFAULT 0,
    total_volume_usdc BIGINT NOT NULL DEFAULT 0,
    uptime_pct_30d DECIMAL(5,2),
    avg_latency_ms INT,
    reputation_score DECIMAL(5,2),
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Spot check audit log
CREATE TABLE spot_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_pubkey TEXT NOT NULL,
    validator_pubkey TEXT NOT NULL,
    expected_hash TEXT NOT NULL,
    observed_hash TEXT NOT NULL,
    matched BOOLEAN NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### TTL purge job

A daily Fly.io cron deletes rows where `purge_after < NOW()`. Privacy commitment per PRD §8: prompts and result metadata are auto-purged after 7 days.

---

## 7. Product AI Features

Per PRD §5 and Q8 validation:

### MVP-required AI integrations

#### Demo Agent (Claude Sonnet 4.x)

- **Provider:** Anthropic API (primary), Noah AI 5M credits (backup)
- **Use case:** F4 demo — agent autonomously buys an inference
- **Privacy:** demo prompts are public, no PII
- **Cost:** ~$0.02-0.05 per full demo run
- **Fallback:** if Anthropic API fails → Noah AI; if both fail → pre-recorded video

#### Flux.1 Schnell on consumer GPUs (the product itself)

- **Provider:** self-hosted on Apis providers (Maxime's RTX 4080, etc.)
- **Use case:** the actual compute work being sold
- **Privacy:** prompts encrypted in transit (TLS), purged after 7 days
- **Cost:** $0 to Apis (provider sets price)
- **Fallback:** if no provider responds in 30s → Replicate API (logged as degraded job)

### MVP-optional (W4 stretch)

#### NSFW classifier on validator side

- **Provider:** self-hosted on Apis validators (HuggingFace `Falconsai/nsfw_image_detection`)
- **Use case:** post-job classification for the public stats dashboard
- **Privacy:** runs on the result hash + a tiny preview, never stored
- **Cost:** ~$0 (validator runs anyway)

#### Provider pricing recommender

- **Provider:** statistical (no LLM)
- **Use case:** suggest fair price during onboarding
- **Cost:** $0

### NOT in MVP (deferred per PRD §5)

- Buyer prompt enhancement
- Smart provider matching via LLM
- Anti-Sybil ML
- Auto-generated tutorials
- LLM-based fraud detection on disputes

### Universal AI privacy commitments

- ✅ No buyer prompt is ever sent to an external LLM
- ✅ Anthropic / Noah AI calls limited to the demo agent's reasoning
- ✅ No user data is used to train any model
- ✅ All AI features documented in `/privacy` before public beta

---

## 8. AI Assistance Strategy

### Single AI tool: **Claude Code (CLI)**

Per Q2 validation, Claude Code is the only AI tool used. No Cursor / Copilot / v0.dev.

### Workflow per layer

| Layer | Working pattern | Rationale |
|---|---|---|
| **Anchor program** | Explain-before-code mode. Read every diff line-by-line. Run tests after each change. | Money-touching code; security-critical. |
| **Tauri Rust shell** | Same as above (Rust learning curve). | New domain. |
| **Next.js + MCP server** | Generate-then-test. Trust Claude on TS code with verification. | Your zone of confidence. |
| **Python worker** | Generate-then-test. Run on a real GPU. | Familiar language. |
| **Tests** | Always AI-generated alongside features, but you read them. Try a deliberately-broken version to confirm the test catches it. | Tests must be real, not theatrical. |

### Effective prompt template for Apis

Every prompt should include this header:

```
Per the Apis Research Report §[X] and PRD §[Y]:

Stack constraints (lock these in):
- Anchor 1.0.2 (note 1.0.x has breaking changes vs 0.30.x)
- Solana devnet (mainnet only post-audit)
- @solana/web3.js + @coral-xyz/anchor TS client
- Helius RPC (free tier, 1M credits/mo)
- Privy server-wallet (agent side)

Quality bar:
- Explicit error handling (no swallowed errors)
- No `any` in TS / no `unwrap()` in Rust without SAFETY comment
- 80%+ test coverage on money-touching paths
- transfer_checked everywhere (never transfer)
- Hardcode Program<'info, Token> never accept arbitrary token program

Now do: [specific request]

Explain your design before writing the code.
```

### Boundaries that protect you (single-AI safeguards)

1. **Smart contract code never ships without:** Anchor test suite passing + sealevel-attacks checklist run + invariant assertions in place
2. **Wallet/key management is hands-off for AI:** AI never sees private keys, seed phrases, admin keypairs. Use `.env.local` + `.gitignore` + `gitleaks` pre-commit hook.
3. **Money-touching code review pattern:** Generate with Claude → read line-by-line → write a test that breaks the assumption → confirm the test catches the bug.
4. **Ground truth is the docs, not the AI:** keep `anchor-lang.com`, `solana.com/docs`, `tauri.app/docs`, `modelcontextprotocol.io/specification` open in tabs.

### Documentation to feed Claude as context

Save these in `agent_docs/` at the repo root and reference them in prompts:

- `agent_docs/anchor-1.0.2-quickref.md` — your distilled Anchor 1.0 notes
- `agent_docs/apis-architecture.md` — high-level diagram + invariants
- `agent_docs/apis-conventions.md` — naming, error types, test patterns
- `agent_docs/security-checklist.md` — sealevel-attacks distilled

---

## 9. Deployment Plan

### Recommended platforms

| Surface | Platform | URL pattern |
|---|---|---|
| Web app | **Vercel (Hobby tier)** | `apis-mvp.vercel.app` |
| MCP server | **Fly.io (free trial → small machine)** | `apis-mcp.fly.dev` |
| Postgres indexer | **Fly.io Postgres** | private |
| Anchor program | **Solana devnet** (mandatory), mainnet-beta optional | program ID in README |
| Provider app installer | **Vercel static download** + Vercel Edge for download counter | `apis-mvp.vercel.app/download` |

### Deployment workflow

```bash
# Web app (push-to-deploy)
git push origin main
# Vercel auto-deploys on push to main, preview deploys on every PR

# MCP server
cd packages/mcp
fly deploy --remote-only
# Auto-rolling deploy with health check

# Anchor program (manual, intentional)
cd packages/program
anchor build
anchor deploy --provider.cluster devnet
# Update README with program ID + IDL URL
anchor idl init <PROGRAM_ID> --filepath target/idl/apis_program.json --provider.cluster devnet
```

### Environment variables

```bash
# packages/web/.env.local
NEXT_PUBLIC_SOLANA_RPC=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
NEXT_PUBLIC_PROGRAM_ID=APiSProgram1111111111111111111111111111111
NEXT_PUBLIC_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU  # devnet USDC
NEXT_PUBLIC_MCP_URL=https://apis-mcp.fly.dev/mcp

# packages/mcp/.env
SOLANA_RPC=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
PROGRAM_ID=APiSProgram1111111111111111111111111111111
ANTHROPIC_API_KEY=sk-ant-...
NOAH_AI_API_KEY=...
PRIVY_APP_ID=...
PRIVY_APP_SECRET=...
COINBASE_X402_FACILITATOR=https://x402.org/facilitator
DATABASE_URL=postgres://...
PINATA_JWT=...
```

### Monitoring

- **Sentry** for error tracking (free tier 5K errors/mo) on web + MCP server
- **Fly.io built-in metrics** (CPU, memory) on MCP server
- **PostHog** for product analytics
- **Solana program logs** streamed via Helius Geyser/Laserstream into Postgres
- **Status page** on `/stats` (eat your own dogfood)

### Rollback plan

- Web app: Vercel one-click rollback to previous deploy
- MCP server: `fly releases rollback` to previous version
- Anchor program: cannot truly rollback; use `emergency_pause` instruction (admin-only, gated by Squads multisig pre-mainnet) to halt new jobs while you patch

---

## 10. Cost Breakdown

> **Note:** Verify all pricing directly with each vendor before budgeting. Last verified: 2026-05-09.

### Phase 1 — Hackathon (Weeks 1-6)

| Service | Free tier / cost | Apis usage |
|---|---|---|
| Claude Code | Pro plan $20/mo | Existing subscription |
| Anchor + Solana CLI + Rust | Free | All program work |
| Solana devnet | Free (faucet) | Deployment + testing |
| Helius RPC (free) | 1M credits/mo, 10 RPS | All RPC calls |
| Phantom wallet | Free | Signing |
| Pinata IPFS | Free 1 GB | Image storage |
| Vercel Hobby | Free | Web hosting |
| Fly.io | $5 trial credit + small machine ~$5/mo | MCP server |
| Privy | Free <500 MAUs | Agent wallet |
| Noah AI | 5M credits free (sponsor) | Demo agent backup |
| Anthropic API | Pay-per-use | Demo agent — ~$5-20 testing |
| GitHub | Free public | Code hosting |
| GitHub Actions | 2K min/mo free | CI |
| PostHog | Free <1M events/mo | Analytics |
| Coinbase x402 facilitator | Free 1k tx/mo | Agent payments |
| Domain | Skipped at hackathon | Use Vercel/Fly URLs |
| Code-signing cert | Skipped at hackathon | Live with SmartScreen |

**Phase 1 realistic spend: $20-50/mo. Hard ceiling: $200.**

### Phase 2 — Beta (Months 2-4)

| Service | Cost | When to upgrade |
|---|---|---|
| Helius Developer | $49/mo | When 1M credits maxes |
| Vercel Pro | $20/mo | When Hobby bandwidth maxes |
| Fly.io scaled | $30-50/mo | When small machine maxes |
| Privy Core | $299/mo | When MAU > 500 |
| SSL.com OV cert | $200/yr ($17/mo) | Before public beta |

**Phase 2: $200-400/mo**

### Phase 3 — Seed-ready (Months 5-9)

One-time funded by VC raise:
- Smart contract audit: $15-30K (Neodyme, OtterSec, Halborn)
- Legal setup: $50-75K (Cayman + French SAS + MiCA memo)
- Bug bounty pool: $10-50K

---

## 11. Scaling Path

### Phase 1 (0-100 users)

Current architecture handles fine. Monitor performance, gather feedback. No scaling work.

### Phase 2 (100-1K users)

- Helius Developer plan
- Add Sentry monitoring
- Optimize hot Solana queries (use indexer, not on-chain reads)
- Add Postgres read replica if indexer queries slow

### Phase 3 (1K-10K users)

- Move MCP server to Fly.io scaled machines (multi-region)
- Add Redis cache (Upstash) in front of Helius for hot accounts
- Consider Triton One RPC for latency-critical paths
- Hire first engineer

### Phase 4 (10K+ users)

- Microservices migration (split MCP / indexer / matchmaking)
- Multi-region Solana infrastructure
- Token launch (per Research §10)
- Audit + mainnet promotion

---

## 12. Maintenance & Updates

- **Dependency updates:** Renovate or Dependabot, weekly auto-PR. Merge after CI green.
- **Anchor 1.0.x patch updates:** track `solana-foundation/anchor` releases. Test in CI before merging.
- **Tauri 2.x updates:** monthly review. Tauri 2.x is recent; expect API stabilization through 2026.
- **Claude Code updates:** new versions of Claude come fast — re-read your `agent_docs/` after every major model update to make sure prompts still produce expected outputs.
- **`agent_docs/` discipline:** update after every architectural decision so Claude has fresh context.

---

## 13. Important Limitations

### What this MVP CAN'T do

| Limitation | Why | Workaround |
|---|---|---|
| **TEE-attested execution on consumer GPUs** | Hardware doesn't support it in 2026 | Phase 2 datacenter-tier via Phala (per Research §4) |
| **Pipeline-parallel inference for huge models** | Bandwidth + latency constraints | Single-GPU Flux Schnell only at v1; Petals-like in Phase 3 |
| **Cross-chain top-up** | Not in scope for v1 | LI.FI integration in Phase 2 |
| **Linux/Mac providers** | Tauri+Python packaging on those is more work | Windows-only at launch; Mac M-series in v2 |
| **zkML-proven inference** | Infeasible in 2026 (per Research §4) | Don't promise; cryptoeconomic security only |
| **Mainnet-beta deployment by hackathon submission** | Risk of bugs on live funds, no time for audit | Devnet only at hackathon, mainnet post-audit |
| **Custodial wallet for buyers** | Defeats permissionless design | Always-on non-custodial |

### When you'll need to upgrade

- **Helius free tier maxed** → Helius Developer ($49/mo)
- **Privy free tier maxed (>500 MAUs)** → Privy Core ($299/mo)
- **Fly.io free trial used up** → small machine ($5-30/mo)
- **First abuse / Sybil attack detected** → add rate limiting + sanction screening
- **First request for $1k+ enterprise contract** → Phase 2 TEE tier via Phala

---

## 14. Learning Resources

### Anchor 1.0.x

- **Official docs:** [anchor-lang.com](https://www.anchor-lang.com/) (check 1.0.x section)
- **Program examples:** [solana-developers/program-examples](https://github.com/solana-developers/program-examples)
- **Solana Cookbook:** [solanacookbook.com](https://solanacookbook.com/)
- **Sealevel-attacks checklist:** [coral-xyz/sealevel-attacks](https://github.com/coral-xyz/sealevel-attacks)

### Solana frontend

- **Wallet adapter:** [anza-xyz/wallet-adapter](https://github.com/anza-xyz/wallet-adapter)
- **create-solana-dapp:** [github.com/solana-developers/create-solana-dapp](https://github.com/solana-developers/create-solana-dapp)
- **Helius blog:** [helius.dev/blog](https://www.helius.dev/blog) — best DePIN/agent content

### Tauri 2.x

- **Official docs:** [tauri.app](https://tauri.app/)
- **Awesome Tauri (filter MIT/Apache):** [awesome-tauri](https://github.com/tauri-apps/awesome-tauri)
- **Sidecar pattern:** [tauri.app/v2/learn/sidecar](https://tauri.app/v2/learn/sidecar/)

### MCP + x402

- **MCP spec:** [modelcontextprotocol.io/specification](https://modelcontextprotocol.io/specification/latest)
- **MCP TypeScript SDK:** [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- **x402 docs:** [docs.cdp.coinbase.com/x402/welcome](https://docs.cdp.coinbase.com/x402/welcome)
- **x402 GitHub examples:** [github.com/coinbase/x402](https://github.com/coinbase/x402)

### Stable Diffusion / Flux

- **HuggingFace diffusers:** [huggingface.co/docs/diffusers](https://huggingface.co/docs/diffusers/)
- **Flux Schnell HF:** [huggingface.co/black-forest-labs/FLUX.1-schnell](https://huggingface.co/black-forest-labs/FLUX.1-schnell)
- **Quantization guide:** [huggingface.co/docs/diffusers/main/en/quantization/overview](https://huggingface.co/docs/diffusers/main/en/quantization/overview)

### Communities

- **Solana Stack Exchange:** [solana.stackexchange.com](https://solana.stackexchange.com)
- **Anchor Discord:** invite via [anchor-lang.com](https://www.anchor-lang.com/)
- **Superteam Discord:** Solana ecosystem hub
- **Dev3pack Telegram:** Hackathon support group

---

## 15. Success Checklist

### Before starting development (Day 0)

- [ ] All accounts created (Step 1 above)
- [ ] Local toolchain verified (Step 2 above)
- [ ] Monorepo bootstrapped with all 5 scaffolds (Step 3 above)
- [ ] "Hello World" pipeline verified end-to-end (Step 4 above)
- [ ] Read PRD + Research Report end-to-end one more time
- [ ] Created `agent_docs/` with the 4 starter files

### During development (Week-by-week)

- [ ] **W1:** Pipeline end-to-end (fake) demonstrable
- [ ] **W2:** Real Flux Schnell job paid via real escrow
- [ ] **W3:** Pooling + signature verification + spot-check slashing
- [ ] **W4:** Claude buys 1 image autonomously in <60s
- [ ] **W5:** README + demo video + live deploy
- [ ] **W6:** Buffer / iteration / submit

### Before hackathon submission

- [ ] All 5 P0 features pass acceptance criteria
- [ ] Pre-recorded demo video <3 min, captioned
- [ ] Live demo URL working (`apis-mvp.vercel.app` + `apis-mcp.fly.dev`)
- [ ] GitHub repo public with README + setup instructions
- [ ] Contract addresses (devnet) documented
- [ ] At least 8 Solana SDKs documented
- [ ] Sponsor activations tagged (Solana, Virtuals, Noah AI minimum)
- [ ] Submission form filled
- [ ] Tweet thread published, all sponsors tagged

---

## 16. Definition of Technical Success

The technical implementation succeeds when:

- [ ] **Reliability:** the agent demo runs ≥5 times in a row without manual intervention
- [ ] **Security:** smart contract test suite passes + sealevel-attacks checklist clean
- [ ] **Performance:** Flux Schnell 1024² delivers <10s end-to-end (p95)
- [ ] **Reproducibility:** any judge can clone the repo, follow the README, and reproduce the agent flow on their own machine
- [ ] **Sponsor activation:** ≥3 sponsors integrated and documented (Solana + Virtuals + Noah AI minimum)
- [ ] **Quality:** no placeholder content, no half-features, no swallowed errors, no `any`/`unwrap` without SAFETY comments
- [ ] **Cost:** monthly spend ≤ $50 during Phase 1 (within $200 ceiling)
- [ ] **Maintainability:** you understand every line in the program; you can debug + extend the codebase yourself

---

*Technical Design for: **Apis MVP***
*Approach: **AI-assisted full-stack with battle-tested scaffolds***
*Single AI tool: **Claude Code (CLI)***
*Estimated time to MVP: **5-6 weeks***
*Estimated cost: **$20-50/month** during Phase 1*
*Status: **Draft — Ready for Implementation***
*Created: 2026-05-09*
