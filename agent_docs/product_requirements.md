# Product Requirements

> Distilled from [`docs/PRD-Apis-MVP.md`](../docs/PRD-Apis-MVP.md). Read the full PRD for full context. This file is the agent-facing summary the AI should reference during implementation.

## Vision

> AI developers and autonomous agents pay up to 4× the spot price for cloud GPUs while millions of personal gaming cards sit idle 80% of the day — Apis is a permissionless Solana marketplace where individuals rent out their GPUs directly to AI agents and developers, with payments settled on-chain in seconds.

## Launch Goals (3-tier)

| Tier | Milestone | Targets |
|---|---|---|
| **Tier 1 — Hackathon (Day 0)** | Dev3pack submission | Top 10 Solana track / Top 5 DePIN side. Live devnet demo, 8+ Solana SDKs documented in README, 3+ sponsor integrations, < 3 min demo video. |
| **Tier 2 — Beta (Day 60)** | Public beta | 100 active providers + 100 buyers + $5K GMV in 30 days. D30 retention ≥ 30%. |
| **Tier 3 — Seed-ready (Day 90)** | VC raise | $25K cumulative GMV, 5K Discord, 10K Twitter, ≥1 tier-1 press feature, $1.5M+ pre-seed term sheet. |

## Personas

### Maxime — Provider (supply)
24-year-old gamer, RTX 4080, France/Germany. Software-savvy, crypto-curious. **Wants:** $30-100/month passive earnings, install once and forget, no spyware, paid in something stable.

### Sarah — Indie AI dev (demand, human)
28-year-old indie hacker building a Stable Diffusion product, Lisbon, $40K runway. **Wants:** cheaper compute than Replicate ($120-300/mo), no KYC, pay-per-use, drops into existing Python/Node code.

### Atlas-7 — Autonomous AI agent (demand, machine)
LangGraph / ElizaOS / Virtuals agent with Privy server-wallet on Solana. **Wants:** programmatic discovery (MCP), sub-second settlement (Solana), USDC-native payments (x402), no auth-key management, no KYC.

## Primary User Story

> *As an autonomous AI agent, I want to discover, quote, pay, and use compute without any human in the loop.*

## MVP Features (P0)

### F1 — Provider Earn-While-Idle Desktop App 🎮
- **What:** Tauri 2.x app for Windows. Auto-detects GPU, benchmarks it, registers it on-chain, runs Flux Schnell jobs in background, pauses automatically during gaming.
- **User Story:** *As a gamer, I want to install one app and earn USDC from my idle GPU without thinking about it.*
- **Acceptance criteria:**
  - [ ] Install + benchmark + first job in < 5 minutes after download
  - [ ] App pauses automatically when GPU usage from games > 40%
  - [ ] First USDC payout visible in wallet within 24h of install
  - [ ] Resource usage during idle < 5% CPU + ~95% GPU during jobs only
- **Priority:** P0
- **Build week:** W1-W4 (parallel with F3)

### F2 — Marketplace Web App 🌐
- **What:** Next.js 15 app where consumers connect Phantom, browse providers (price, reputation, location, GPU class), submit jobs with prompts/parameters, track history.
- **User Story:** *As an indie AI dev, I want to submit an inference job and get a result faster and cheaper than Replicate.*
- **Acceptance criteria:**
  - [ ] Submit-job-to-result < 10s for Flux Schnell at 1024×1024
  - [ ] Cost ≤ $0.02 per image (vs ~$0.04 on Replicate)
  - [ ] Browse providers + filter by price/rep in < 2s page load
  - [ ] Mobile-responsive (judges may demo on phone)
- **Priority:** P0
- **Build week:** W2-W3

### F3 — Trustless Escrow Smart Contract ⚓
- **What:** Anchor 1.0.2 program on Solana. Locks USDC on job creation, releases on signed completion, refunds on dispute or timeout. Includes provider stake + slashing logic + 5% spot-check verification.
- **User Story:** *As a buyer, I want my payment to be released only when the work is verifiably done — and as a provider, I want guaranteed payment when I deliver.*
- **Acceptance criteria:**
  - [ ] Deployed to devnet (mandatory) + mainnet-beta if budget permits
  - [ ] Contract addresses published in README
  - [ ] Funds never lost in normal flow (test suite proves this)
  - [ ] Cheating provider gets slashed within 2h dispute window
  - [ ] At least 8 Solana SDKs documented in README (max sponsor bonus)
- **Priority:** P0 — **money-touching code, special review workflow**
- **Build week:** W1-W2

### F4 — AI Agent Compute API (MCP + x402) 🤖
- **What:** Public MCP server at `apis-mcp.fly.dev` exposing tools `list_offers`, `quote_inference`, `submit_job`, `get_status`. Returns HTTP 402 + x402 payment requirements when called without payment. Compatible with Claude/GPT/Cursor/Eliza out of the box.
- **User Story:** *As an autonomous AI agent, I want to discover, quote, pay, and use compute without any human in the loop.*
- **Acceptance criteria:**
  - [ ] Claude Sonnet 4.x agent autonomously buys 1 inference end-to-end in < 60s in the demo video
  - [ ] x402 payment settles via Coinbase facilitator on Solana mainnet (or devnet for demo)
  - [ ] MCP server passes Anthropic's MCP inspector tests
  - [ ] One working example: `@elizaos/plugin-apis` for Eliza agents (~200 lines)
- **Priority:** P0 — **the wedge that wins the hackathon**
- **Build week:** W4 — **HARD NO-GO DATE.** If not working by end of W4, freeze scope and polish what works.

### F5 — Multi-GPU Pooling for Batch Jobs ⚡
- **What:** Data-parallelism: when consumer submits a batch (e.g. "20 images"), Apis splits across N providers in parallel and aggregates results. No model splitting (we are not building Petals).
- **User Story:** *As a buyer, I want to submit a 20-image batch and get all 20 back ~5× faster than a single GPU.*
- **Acceptance criteria:**
  - [ ] 20-image batch completes in ≤ 1.5× the time of a single image (true parallelism)
  - [ ] Smart contract correctly tracks N sub-jobs and releases payments proportionally
  - [ ] If 1 of N providers fails, remaining results still delivered + failed sub-job auto-retried
  - [ ] Demo shows real-time map of providers lighting up worldwide
- **Priority:** P0
- **Build week:** W3

## Stretch Features (Nice-to-have if W4 has time)

- **F6 — TEE-attested Premium Tier** — Phala-hosted H100 nodes for buyers willing to pay 3.5× for hardware-attested execution. *Phase 2 territory; document in pitch as roadmap.*
- **F7 — Solana Mobile Companion App** — manage your hosted GPU + push notifications from your Saga/Seeker. Activates the Solana Mobile sponsor track.
- **F8 — LI.FI Cross-Chain Top-Up** — buyers fund their Apis wallet from any chain. Activates the LI.FI sponsor.

## Explicitly NOT in MVP

| Bucket | Excluded feature | Reason / when to revisit |
|---|---|---|
| **v2 (Months 2-4)** | Mac M-series provider (MLX) | Windows beta hits 100+ active providers |
| | Linux provider | Crypto/AI Linux Discord traction |
| | Reputation NFTs (Bubblegum cNFTs) | First 1k jobs completed |
| | Provider analytics dashboard (advanced charts) | After 50+ providers onboarded |
| | Buyer mobile-optimized UI | Real buyer asks for it |
| | Solana Pay top-up flow | After 100 buyers, when CEX-fund friction is measurable |
| **v3 (Months 6-12)** | More workloads (Whisper, Llama, video gen) | Power-user demand from beta cohort |
| | Pipeline-parallel inference (Petals-style) | Supply has 500+ always-on providers |
| | Training jobs / fine-tuning | After inference is at scale |
| | Provider staking yield + governance | TGE timeline (Month 18-24) |
| | Premium SLA tier with insurance | First $1k+ enterprise contract request |
| | Dispute arbitration UI (Kleros-style) | > 10 disputes/week |
| **Never** | KYC for buyers/providers | Defeats permissionless wedge |
| | Native APIS token at hackathon | Token fatigue + MiCA risk |
| | zkML for Stable Diffusion execution | Infeasible in 2026 |
| | Custodial wallet for buyers | Apis is non-custodial by design |
| | Mining-rig support (>4 GPU rigs) | Mission creep — those are enterprise |
| | Allowlist for providers | Permissionless or nothing |

## Success Metrics

### North Star: **Verified Inferences per Day**

| Milestone | Target |
|---|---|
| Day 0 (hackathon submission) | 100+ verified inferences in demo / staging |
| Day 30 post-hackathon | 1,000/day |
| Day 90 post-hackathon | 10,000/day |
| Day 365 | 1M/day |

### Tier 1 — Hackathon (Day 0)

| Metric | Target |
|---|---|
| Working live demo on devnet | ✅ Pass |
| Solana SDKs documented | ≥ 8 |
| Sponsor integrations | ≥ 3 |
| Demo video views (Twitter/YouTube) | 5K+ in week 1 |
| GitHub stars | 200+ in week 1 |
| Dev3pack ranking | Top 10 Solana track / Top 5 DePIN side |

### Tier 2 — Beta launch (Day 30-60)

| Category | Metric | Target Day 60 |
|---|---|---|
| Acquisition | Providers / buyers signed up | 100 / 100 |
| Activation | Providers w/ ≥1 job in first 7 days | ≥ 60% |
| Activation | Buyers w/ ≥1 inference in first 7 days | ≥ 70% |
| Engagement | Verified inferences per day | 1,000/day |
| Engagement | Jobs per active provider per day | ≥ 5 |
| Retention | Provider D30 retention | ≥ 40% |
| Retention | Buyer D30 retention | ≥ 30% |
| Marketplace health | Job completion latency p95 | < 12s for Flux Schnell 1024² |
| Marketplace health | Provider uptime % | ≥ 80% |
| Marketplace health | Disputes raised per 1000 jobs | ≤ 5 |
| Marketplace health | Slashed providers per week | ≤ 2 |
| Revenue | Total GMV (USDC, cumulative) | $5,000 |
| NPS | Provider / Buyer NPS | ≥ +30 / +40 |

### Anti-metrics (explicitly NOT optimized for)

- **Token price** — no token in v1; even after launch, price is vanity not health
- **Total registered providers** — only *active* matters (io.net controversy lesson)
- **Total wallets connected** — Phantom popups ≠ revenue
- **GitHub stars beyond Day 30** — gameable, decoupled from product reality

## Constraints & Non-Functional Requirements

### Budget
- **Phase 1 ceiling: $200 max.** Realistic spend $20-50/month (mostly Claude Code subscription + minor Anthropic API testing). Domain skipped at hackathon (use Vercel/Fly URLs). Code-signing cert deferred to Phase 2.

### Timeline
- **No external deadline.** "All-in, take time to ship the best version."
- **Internal target:** Dev3pack submission in **5-6 weeks** of focused work, **30-40 hours/week**, **solo**.
- **Buffer rule:** every weekly checkpoint has a fallback — if S2 isn't done by Sunday, swap real provider for Replicate API mock and proceed.
- **No-go date:** end of Week 4. If Claude can't autonomously buy 1 inference, **stop adding features and polish what works**.

### Performance targets (p95)

| Metric | Target |
|---|---|
| Web app first contentful paint | < 1.5s |
| Web app time-to-interactive | < 3s |
| Inference latency end-to-end (Flux Schnell 1024²) | < 10s |
| MCP server response (excl. payment + inference) | < 200ms |
| Solana tx confirmation | < 1s |
| Apis Tauri provider app idle CPU | < 5% |
| Provider uptime SLO | ≥ 80% |

### Security & privacy

- ✅ **Non-custodial by design** — Apis program never has authority to sweep escrow funds
- ✅ **No KYC** for providers or buyers (MVP)
- ✅ **OFAC/EU sanction screening** on every wallet (Chainalysis Free API or TRM Labs starter)
- ✅ **Squads v4 multisig** holds program upgrade authority before mainnet
- ✅ **`coral-xyz/sealevel-attacks`** checklist run before any mainnet deploy
- ✅ **Bug bounty** announced on submission (min $500 at hackathon, $50K cap once raised)
- ✅ Apis Provider app collects **GPU specs + heartbeat only**. No game data. No keystrokes. No screenshots. Full source on GitHub.
- ✅ Buyer prompts encrypted in transit (TLS), stored briefly only for retry/dispute. **Auto-purged after 7 days.**
- ✅ Generated images stored on IPFS — buyer controls their CID
- ✅ No user-level analytics until consent UI exists

### Universal AI privacy commitments

- ✅ No buyer prompt is ever sent to an external LLM
- ✅ Anthropic / Noah AI calls limited to the demo agent's reasoning (Atlas-7), not to buyers' content
- ✅ No user data is used to train any model
- ✅ All AI features documented in `/privacy` before public beta

### Platform support

| Surface | Platforms | Browsers/OS |
|---|---|---|
| Provider desktop | Windows 10/11 only at launch | x86_64, NVIDIA RTX 3060+ |
| Buyer web | Desktop-first responsive | Chrome 130+, Safari 17+, Firefox 130+, Edge 130+ |
| Buyer mobile | "Works" but not optimized | iOS 17+, Android 13+ via Phantom mobile |
| Agent API | Any platform speaking HTTP+Solana | Node, Python, Rust SDKs |

## UI/UX Direction: **Cyberpunk Swarm**

- Pitch black `#000000`, Solana green `#14F195` primary, neon violet `#9945FF` secondary
- Subtle hexagonal grid background motif (~3% opacity)
- Swarm-style loading animations
- World map with glowing hex tiles (NOT pins) for providers

## Quality Standards (Anti-Vibe Rules — NON-NEGOTIABLE)

- ❌ Placeholder content in production ("Lorem ipsum", sample images that aren't real)
- ❌ Half-finished features — works or it isn't included
- ❌ Skipped mobile testing before a release
- ❌ Bypassed accessibility basics
- ❌ Bypassed pre-commit hooks
- ❌ `any` in TypeScript without explicit justification comment
- ❌ Swallowed errors — explicit handling or explicit re-throw
- ❌ `unwrap()` in Rust without `// SAFETY:` comment

## Reference Documents

- 📋 [`docs/PRD-Apis-MVP.md`](../docs/PRD-Apis-MVP.md) — full PRD
- 🏗️ [`docs/TechDesign-Apis-MVP.md`](../docs/TechDesign-Apis-MVP.md) — Technical Design Document
- 🔍 [`docs/Research-Apis.md`](../docs/Research-Apis.md) — competitor analysis, sponsor map, validated decisions
- ⚙️ [`tech_stack.md`](tech_stack.md) — stack, versions, setup commands
- 📐 [`code_patterns.md`](code_patterns.md) — implementation patterns
- 🧪 [`testing.md`](testing.md) — testing strategy
- 📌 [`project_brief.md`](project_brief.md) — persistent project rules
