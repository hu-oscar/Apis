# Product Requirements Document: Apis MVP

**Version:** 1.0
**Status:** Draft — Ready for Technical Design
**Created:** 2026-05-09
**Owner:** Apis founding team
**Hackathon target:** Dev3pack (Solana track) — submission window ~6 weeks

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Who It's For](#2-who-its-for)
3. [The Problem We're Solving](#3-the-problem-were-solving)
4. [User Journey](#4-user-journey)
5. [MVP Features](#5-mvp-features)
6. [How We'll Know It's Working](#6-how-well-know-its-working)
7. [Look & Feel](#7-look--feel)
8. [Technical Considerations](#8-technical-considerations)
9. [Quality Standards](#9-quality-standards-anti-vibe-rules)
10. [Budget & Constraints](#10-budget--constraints)
11. [Open Questions & Assumptions](#11-open-questions--assumptions)
12. [Launch Strategy](#12-launch-strategy)
13. [Definition of Done for MVP](#13-definition-of-done-for-mvp)
14. [Next Steps](#14-next-steps)

---

## 1. Product Overview

**App Name:** Apis

**Tagline:** *Where idle gaming GPUs meet AI agents.*

**One-line problem:**
> AI developers and autonomous agents pay up to 4× the spot price for cloud GPUs while millions of personal gaming cards sit idle 80% of the day — Apis is a permissionless Solana marketplace where individuals rent out their GPUs directly to AI agents and developers, with payments settled on-chain in seconds.

**Launch Goal (three-tier):**

| Tier | Milestone | Target |
|---|---|---|
| **Tier 1 — Hackathon** | Day 0 (submission) | Top 10 Solana track or Top 5 DePIN side track at Dev3pack. Live devnet demo, 8+ Solana SDKs documented, 3+ sponsor integrations. |
| **Tier 2 — Beta launch** | Day 60 post-hackathon | 100 active providers + 100 paying buyers + $5K GMV in 30 days. D30 retention ≥ 30%. |
| **Tier 3 — Seed-ready** | Day 90 post-hackathon | $25K cumulative GMV, 5K Discord, 10K Twitter, ≥1 tier-1 press feature, $1.5M+ pre-seed term sheet. |

**Target Launch:** ~6 weeks of focused work for hackathon submission. No external deadline; "all-in, ship the best possible version."

---

## 2. Who It's For

This is a **two-sided marketplace** plus a forward-looking third user (autonomous AI agents).

### Primary User — Side A (Supply): Maxime, the Gamer-Provider

**Who he is:**
24-year-old gamer in France/Germany. Software dev intern by day, gamer at night. Owns an RTX 4080 Super (24 GB) inside a $2,000 PC build he saved 8 months for.

**Lifestyle:** Plays 3-4 hours/day (CS2, Helldivers, Tarkov). PC is on 12+ hours/day but actively gaming only 25% of that.

**Tech savviness:** **High** for gaming, **medium** for crypto. Owns a Phantom wallet, has bought SOL once or twice on a CEX.

**His current pain:**
- His GPU is idle most of the day while electricity bill creeps up
- Mining ETH used to make sense — post-merge there's no good way to monetize idle GPU
- Tried Salad once, made $5/month, hated the UI, gave up
- Doesn't trust giving his hardware to "some random startup"

**What he needs:**
- Earn $30-100/month passively, install once and forget
- No spyware on his rig
- Get paid in something that doesn't go to zero
- One-click pause when he wants to play

### Primary User — Side B (Demand): Sarah, the Indie AI Developer

**Who she is:**
28-year-old indie hacker building a Stable-Diffusion-based product (e.g., AI thumbnail generator for YouTubers). Quit her job 4 months ago, $40K runway, lives in Lisbon.

**Lifestyle:** Codes 60 h/week. Active on AI Twitter and r/StableDiffusion. Already shipped 2 small SaaS apps before this one.

**Tech savviness:** **High** technical (full-stack TypeScript + Python). **Medium** crypto (has a wallet, bridged USDC once for an NFT mint).

**Her current pain:**
- Replicate / Fal / Together costs **$120-300/month** for her testing-stage volumes
- OpenAI throttles her experimental rate-limits at the worst times
- She's crypto-curious but hates "DeFi yield-farm" projects → wants real utility
- Hates KYC: opening a corporate AWS account took her 2 weeks

**What she needs:**
- Cheaper compute, no KYC, pay-per-use
- Fast enough for her 10s-latency-tolerant batch jobs
- A clean SDK that drops into existing Python/Node code

### Forward-looking User — Side C: Atlas-7, the Autonomous AI Agent

**Who it is:**
A LangGraph / ElizaOS / Virtuals agent with its own Solana wallet (Privy server-wallet). Built by a developer like Sarah, but operates 24/7 on its own once deployed. Manages tasks like generating social-media images, transcribing podcasts, running creative bots.

**Frustration (its operator's):**
- Cannot get an AWS account (no credit card, no KYC, no humans in the loop)
- API keys are bottleneck — rate-limited, leakable, manually rotated
- No marketplace built for M2M payments — agents currently "ask their human" for compute, defeating the autonomy

**What it speaks:** HTTP, MCP (Model Context Protocol rev. 2025-11-25), x402 (HTTP 402 Payment Required, Solana USDC).

**What it needs:** Programmatic discovery, sub-second settlement, USDC-native, no auth-key management, no KYC.

---

## 3. The Problem We're Solving

The AI compute market in 2026 is broken in three directions at once:

1. **Compute is too expensive for indie/agent buyers.** AWS/Azure/GCP run ~700% margins on H100s. Indie devs pay 4-10× spot prices on Replicate/Fal/Together for testing-stage volumes. Autonomous agents can't even open accounts at hyperscalers.
2. **Consumer GPUs are massively wasted.** Hundreds of millions of high-end gaming GPUs sit idle 16-20 hours/day. Post-Ethereum-merge mining is dead. Salad proves there's a million-strong appetite to monetize idle GPUs, but it's centralized and capped.
3. **The agent economy has no payment rails.** AI agents (Claude Operator, Virtuals, ElizaOS) can't pay for anything autonomously — no credit cards, no KYC, no human-in-the-loop. The compute market they need most is the one that doesn't accept their money.

### Why Existing Solutions Fall Short

| Existing solution | Why it's not enough |
|---|---|
| **AWS / Azure / GCP** | Centralized, expensive, KYC-gated, agent-hostile, can de-platform you. |
| **io.net** (Solana) | Markets itself as gamer-friendly but supply is mostly ex-mining farms; controversy in 2024 over ~75% unverifiable GPUs; UX is dev-only. |
| **Akash** (Cosmos) | Trust-based verification, no SLA, supply = small data centers — not consumer. |
| **Render** (Solana) | 3D-rendering specialist; AI pivot is recent and shallow. |
| **Aethir** (Arbitrum) | "Gaming" branding masks an enterprise-DC supply base; no agent rails. |
| **Bittensor** | Not really a marketplace — emission-incentivized AI mining, no buyer-paid invoices. |
| **Salad** (web2) | The only true consumer-GPU network at scale (~1M+ installs), but 100% centralized, USD/Stripe rails, no agent payments, no on-chain settlement. |
| **Vast.ai** (web2) | Centralized, no crypto, ~25% take rate. The price benchmark to beat. |
| **Petals / EXO Labs** | OSS, free, research-grade — proves consumer aggregation is technically feasible but doesn't monetize. |
| **Hyperbolic / Together / Replicate** | Centralized API services; cheaper than AWS, still expensive vs consumer-GPU economics; no agent-native rails. |

**Apis's wedge:** none of the above combines (a) **true consumer-GPU supply**, (b) **on-chain permissionless marketplace**, and (c) **AI-agent-native payment rails** (MCP + x402 on Solana). We are the first.

---

## 4. User Journey

### Maxime's Journey (Provider)

> **Day 1.** Maxime sees a tweet from a Solana DePIN account: *"Your idle RTX is a $50/month side income. Apis turns it on. Install in 60 seconds."* He's been looking for a post-mining play for months.
>
> **Discovery.** He clicks the link. Lands on `apis.xyz`. Sees a "Sign in with Phantom → Earn" button. No KYC form. No credit card. He's in within 30 seconds.
>
> **First install.** He downloads the **Apis Provider app** (Tauri desktop, ~250 MB stub). On launch, it auto-detects his RTX 4080, runs a 60-second benchmark, suggests a fair price ($0.15/hr), and asks for his confirmation. He clicks "Start Hosting." App minimizes to the system tray.
>
> **Core loop.** Over the next 12 hours, Apis routes 14 jobs to his GPU while he sleeps and works. Each job earns him $0.05–$0.30 in USDC, settled instantly on-chain. The app pauses automatically when he opens *Helldivers*.
>
> **Success moment.** Day 7: he opens the app and sees **$22.40 USDC** in his Phantom wallet. He posts a screenshot to his Discord. *"Bro my GPU made me a kebab dinner while I was at the office."* Two friends sign up that week.

### Sarah's Journey (Indie AI Developer)

> **Discovery.** Sarah is debugging a Stable Diffusion pipeline at 2 AM. Replicate just charged her $47 in 4 days. She googles *"cheap SDXL inference Solana"* (she's already crypto-curious). Apis is the second result.
>
> **Onboarding.** She lands on the Apis docs page. Sees a code snippet:
> ```
> npx apis-cli inference "an astronaut riding a horse" --model flux-schnell
> # → image generated in 4.2s for $0.012 USDC
> ```
> She runs it. Apis CLI prompts her to connect Phantom (she has one). She funds her wallet with $5 from a CEX. The image arrives.
>
> **First production use.** She wires Apis into her dev pipeline by replacing one Replicate API call with `apis.inference()`. Total integration time: 12 minutes.
>
> **Core loop.** Over the next 30 days, her testing pipeline runs ~3,000 inferences via Apis. Cost: **$36** vs **$120** on Replicate. Same quality. No throttling.
>
> **Success moment.** Month 2: she ships her product publicly with Apis as the inference backend. She tweets *"I used Apis the entire build. 70% cheaper than Replicate, 100% no KYC. Built different."* — gets 400 likes. 6 indie devs DM her asking how to switch.

### Atlas-7's Journey (Autonomous Agent — the demo headline)

> **Setup (offline).** A developer creates Atlas-7, a daily Twitter agent that posts an AI-generated image with each tweet. Atlas-7 has a **Privy server wallet** funded with $20 USDC on Solana. Its system prompt: *"Find compute marketplaces, pay for what you need, do NOT ask for human input."*
>
> **Discovery (automated).** First time Atlas-7 needs an image, it queries the MCP servers it has access to. One of them is **`mcp.apis.xyz`**. It calls `tools/list` and sees `quote_inference`, `submit_job`, `get_status`.
>
> **Negotiation.** Atlas-7 calls `quote_inference(prompt, model="flux-schnell", max_price=0.05)`. Apis responds: `{ price: 0.012 USDC }`. Atlas-7 calls `submit_job`. Apis returns **HTTP 402** with x402 payment requirements.
>
> **Autonomous payment.** Atlas-7 builds and signs an SPL transfer for 0.012 USDC. Resends the request with the `X-PAYMENT` header. Coinbase x402 facilitator settles in 400 ms. Apis dispatches the job to a provider.
>
> **Job completion.** 4.2 seconds later, the image is uploaded to IPFS. Atlas-7 receives the CID, downloads the image, posts the tweet.
>
> **Success moment.** After 30 days: Atlas-7 has run **412 jobs**, spent $4.94, never asked a human for permission, and the developer's `apis.dashboard` shows a clean transaction history. **No human ever authorized a single payment.** This is what we'll show the Dev3pack jury.

---

## 5. MVP Features

### Must Have for Launch (P0)

#### F1 — Provider Earn-While-Idle Desktop App 🎮

- **What:** Tauri 2.x app for Windows. Auto-detects GPU, benchmarks it, registers it on-chain, runs Flux Schnell jobs in background, pauses automatically during gaming.
- **User Story:** *As a gamer, I want to install one app and earn USDC from my idle GPU without thinking about it.*
- **Success Criteria:**
  - [ ] Install + benchmark + first job in <5 minutes after download
  - [ ] App pauses automatically when GPU usage from games >40%
  - [ ] First USDC payout visible in wallet within 24h of install
  - [ ] Resource usage during idle <5% CPU + ~95% GPU during jobs only
- **Priority:** P0

#### F2 — Marketplace Web App 🌐

- **What:** Next.js 15 app where consumers connect Phantom, browse providers (price, reputation, location, GPU class), submit jobs with prompts/parameters, track history.
- **User Story:** *As an indie AI dev, I want to submit an inference job and get a result faster and cheaper than Replicate.*
- **Success Criteria:**
  - [ ] Submit-job-to-result < 10s for Flux Schnell at 1024×1024
  - [ ] Cost ≤ $0.02 per image (vs ~$0.04 on Replicate)
  - [ ] Browse providers + filter by price/rep in <2s page load
  - [ ] Mobile-responsive (judges may demo on phone)
- **Priority:** P0

#### F3 — Trustless Escrow Smart Contract ⚓

- **What:** Anchor 1.0.2 program on Solana. Locks USDC on job creation, releases on signed completion, refunds on dispute or timeout. Includes provider stake + slashing logic + 5% spot-check verification.
- **User Story:** *As a buyer, I want my payment to be released only when the work is verifiably done — and as a provider, I want guaranteed payment when I deliver.*
- **Success Criteria:**
  - [ ] Deployed to devnet (mandatory) + mainnet-beta if budget permits
  - [ ] Contract addresses published in README
  - [ ] Funds never lost in normal flow (test suite proves this)
  - [ ] Cheating provider gets slashed within 2h dispute window
  - [ ] At least 8 Solana SDKs documented in README (max sponsor bonus)
- **Priority:** P0

#### F4 — AI Agent Compute API (MCP + x402) 🤖

- **What:** Public MCP server at `mcp.apis.xyz` exposing tools `list_offers`, `quote_inference`, `submit_job`, `get_status`. Returns HTTP 402 + x402 payment requirements when called without payment. Compatible with Claude/GPT/Cursor/Eliza out of the box.
- **User Story:** *As an autonomous AI agent, I want to discover, quote, pay, and use compute without any human in the loop.*
- **Success Criteria:**
  - [ ] Claude Sonnet 4.x agent autonomously buys 1 inference end-to-end in <60s in the demo video
  - [ ] x402 payment settles via Coinbase facilitator on Solana mainnet (or devnet for demo)
  - [ ] MCP server passes Anthropic's MCP inspector tests
  - [ ] One working example: `@elizaos/plugin-apis` for Eliza agents (~200 lines)
- **Priority:** P0 — **this is the wedge that wins the hackathon**

#### F5 — Multi-GPU Pooling for Batch Jobs ⚡

- **What:** Data-parallelism: when consumer submits a batch (e.g. "20 images"), Apis splits across N providers in parallel and aggregates results. No model splitting (we're not building Petals).
- **User Story:** *As a buyer, I want to submit a 20-image batch and get all 20 back ~5× faster than a single GPU.*
- **Success Criteria:**
  - [ ] 20-image batch completes in ≤ 1.5× the time of a single image (true parallelism)
  - [ ] Smart contract correctly tracks N sub-jobs and releases payments proportionally
  - [ ] If 1 of N providers fails, remaining results still delivered + failed sub-job auto-retried
  - [ ] Demo shows real-time map of providers lighting up worldwide
- **Priority:** P0

### Nice to Have (Stretch — if time permits)

- **F6 — TEE-attested Premium Tier** — Phala-hosted H100 nodes for buyers willing to pay 3.5× for hardware-attested execution. Phase 2 territory.
- **F7 — Solana Mobile Companion App** — manage your hosted GPU + push notifications from your Saga/Seeker. Activates the Solana Mobile sponsor track.
- **F8 — LI.FI Cross-Chain Top-Up** — buyers fund their Apis wallet from any chain. Activates the LI.FI sponsor.

### NOT in MVP (saved for later)

| Bucket | Feature | Trigger to add |
|---|---|---|
| **v2 (Months 2-4)** | Mac M-series provider (MLX) | Windows beta hits 100+ active providers |
| | Linux provider | Crypto/AI Linux Discord traction |
| | LI.FI cross-chain top-up | Day 30+ if buyers complain about funding friction |
| | Solana Mobile companion app | After hackathon if Mobile prize is targeted separately |
| | Reputation NFTs (Bubblegum cNFTs) | First 1k jobs completed |
| | Provider analytics dashboard (advanced) | After 50+ providers onboarded |
| | Buyer mobile-optimized UI | Real buyer asks for it |
| | Solana Pay top-up flow | After 100 buyers, when CEX-fund friction is measurable |
| **v3 (Months 6-12)** | More workloads (Whisper, Llama, video gen) | Power-user demand from beta cohort |
| | Pipeline-parallel inference (Petals-style) | Supply has 500+ always-on providers |
| | Training jobs / fine-tuning | After inference is at scale |
| | Provider staking yield + governance | TGE timeline (Month 18-24) |
| | Premium SLA tier with insurance | First $1k+ enterprise contract request |
| | Dispute arbitration UI (Kleros-style) | >10 disputes/week |
| | Advanced batching / smart routing | After 1k jobs/day |
| **Never** | KYC for buyers/providers | Defeats permissionless wedge |
| | Native APIS token at hackathon | Token fatigue + MiCA risk |
| | zkML for SD execution | Infeasible in 2026 |
| | Custodial wallet for buyers | Apis is non-custodial by design |
| | Mining-rig support (>4 GPU rigs) | Mission creep — those are enterprise |
| | Allowlist for providers | Permissionless or nothing |

*Why we're waiting:* keeps the MVP focused, shippable in 5-6 weeks, and gives principled answers to jury questions (*"why not X?"*).

---

## 6. How We'll Know It's Working

### North Star Metric

**Verified Inferences per Day.** This single number captures all sides of the marketplace working together (provider online + buyer wants it + USDC clears + spot-check passes).

| Milestone | Target |
|---|---|
| Day 0 (hackathon submission) | 100+ verified inferences in demo / staging |
| Day 30 post-hackathon | 1,000/day |
| Day 90 post-hackathon | 10,000/day |
| Day 365 | 1M/day |

### Tier 1 — Hackathon submission (Day 0)

| Metric | Target | How we measure |
|---|---|---|
| Working live demo on devnet | ✅ Pass | Anyone can run the Apis CLI from README and reproduce the agent flow |
| Solana SDKs documented | ≥ 8 | Count in README (Anchor, SPL Token, Pyth, Helius, etc.) |
| Sponsor integrations | ≥ 3 | Solana + Virtuals + Noah AI minimum; bonus per extra |
| Demo video views (Twitter/YouTube) | 5K+ in week 1 | Native platform analytics |
| GitHub stars | 200+ in week 1 | Public repo |
| Dev3pack ranking | Top 10 Solana track / Top 5 DePIN side track | Colosseum public results |

### Tier 2 — Beta launch (Day 30-60)

| Category | Metric | Target Day 60 |
|---|---|---|
| Acquisition | New providers signed up | 100 |
| Acquisition | New buyers signed up | 100 |
| Activation | Providers who completed ≥ 1 job in first 7 days | ≥ 60% |
| Activation | Buyers who completed ≥ 1 inference in first 7 days | ≥ 70% |
| Engagement | Verified inferences per day | 1,000/day |
| Engagement | Jobs per active provider per day | ≥ 5 |
| Retention | Provider D30 retention | ≥ 40% |
| Retention | Buyer D30 retention | ≥ 30% |
| Marketplace health | Average job completion latency (p95) | < 12s for Flux Schnell 1024² |
| Marketplace health | Provider uptime % | ≥ 80% |
| Marketplace health | Disputes raised per 1000 jobs | ≤ 5 |
| Marketplace health | Slashed providers per week | ≤ 2 |
| Revenue | Total GMV (transacted volume in USDC) | $5,000 cumulative |
| NPS | Provider NPS | ≥ +30 |
| NPS | Buyer NPS | ≥ +40 |

### Tier 3 — Seed-ready (Day 90)

| Category | Metric | Target Day 90 |
|---|---|---|
| Volume | Cumulative GMV | $25K USDC |
| Volume | Verified inferences per day | 10,000/day |
| Community | Discord members | 5K |
| Community | Twitter followers | 10K |
| Press | Tier-1 crypto press features | ≥ 1 (Decrypt / The Block / CoinDesk) |
| Funding | Term sheet signed OR active conversations | $1.5M+ pre-seed |
| Partnerships | Marquee design partner | ≥ 1 (Solana AI project running its inference on Apis) |
| Sponsor activation | Co-marketing announcement | ≥ 1 (Virtuals or Solana Foundation) |

### Anti-metrics (explicitly NOT optimized for)

- **Token price** — no token in v1; even after launch, price is vanity not health
- **Total registered providers** — only *active* matters (io.net controversy lesson)
- **Total wallets connected** — Phantom popups ≠ revenue
- **GitHub stars beyond Day 30** — gameable, decoupled from product reality

### Tracking infrastructure (cheap, day-1)

- **On-chain metrics:** custom Solana indexer (Postgres + Helius webhooks) — all jobs/payments/disputes tracked from genesis
- **Web analytics:** PostHog (free up to 1M events/mo) for funnel + retention
- **Discord/Twitter:** native analytics + Common Room (free tier)
- **Public dashboard:** `apis.xyz/stats` exposes North Star + GMV in real time (transparency = differentiator vs io.net opacity)

---

## 7. Look & Feel

**Design vibe:** *Cyberpunk Swarm.* Dark, neon, fast, agentic — with a swarming hex motif that quietly reinforces the "Apis = bee" narrative without being corny.

### Visual principles

1. **Real data, never lorem ipsum.** Even on landing → live stats from devnet feed.
2. **One screen, one job.** No power-user dashboards in v1.
3. **Mobile-responsive but desktop-first.** Provider work is desktop; agent users have no UI.
4. **Latency is part of the design.** Skeleton states, progressive image loading, on-chain tx confirmations animated.
5. **Real-time everywhere.** WebSockets to Helius — no manual refresh needed for any state.

### Color palette

| Role | Color | Hex |
|---|---|---|
| Background | Pitch black | `#000000` |
| Surface | Near-black | `#0F0F0F` |
| Primary accent | Solana green | `#14F195` |
| Secondary accent | Neon violet | `#9945FF` |
| Text | Warm white | `#FAFAF9` |
| Subtle hex motif | Dark grey overlay | `#1A1A1A` @ ~3% opacity |
| Success | Solana green (reuse) | `#14F195` |
| Error | Neon red | `#FF3B5C` |

### Typography

- **UI:** Geist Mono *or* Berkeley Mono (paid, optional)
- **Headlines:** Space Grotesk *or* Bricolage Grotesque (free)
- **Code:** JetBrains Mono (free)

### Differentiation from "every Solana DePIN" cliché

A subtle hexagonal grid (~3% opacity) on backgrounds, and **swarm-style loading animations** (small hex tiles lighting up around a job). Worker-locations on the public map render as glowing hex tiles, not pins.

### Key Screens

| # | Screen | Purpose | Audience |
|---|---|---|---|
| 1 | **Marketing landing** (`apis.xyz`) | Pitch → wallet connect → "Earn" or "Buy" CTA | All |
| 2 | **Provider onboarding** (Tauri app) | GPU detection → benchmark → start hosting | Maxime |
| 3 | **Provider dashboard** (Tauri app) | Live earnings, jobs, system tray quick state | Maxime |
| 4 | **Buyer marketplace** (Web app) | Browse providers + filters + map | Sarah |
| 5 | **Buyer job submission** (Web app) | Prompt + model + price → submit | Sarah |
| 6 | **Job result + history** (Web app) | Image preview, IPFS link, tx hash, rate provider | Sarah |
| 7 | **Public stats** (`apis.xyz/stats`) | North-Star metric + GMV + provider count + global map | All |
| 8 | **Agent docs / MCP page** (`apis.xyz/agents`) | API docs, code snippets, MCP install button | Atlas-7's developer |

### Wireframe — Marketplace landing (text sketch)

```
┌─────────────────────────────────────────────────────┐
│ APIS                              [Connect Phantom] │
├─────────────────────────────────────────────────────┤
│                                                     │
│   Where idle gaming GPUs meet AI agents.            │
│                                                     │
│   [▶ Earn from your GPU]    [▶ Buy compute]         │
│                                                     │
├─────────────────────────────────────────────────────┤
│   Live → 1,237 jobs/day | $4,302 GMV | 412 active   │
│                  [global hex map]                   │
├─────────────────────────────────────────────────────┤
│   How it works  ·  For agents  ·  For gamers        │
└─────────────────────────────────────────────────────┘
```

---

## 8. Technical Considerations

**Platform support:**

| Surface | Platforms | Browsers/OS |
|---|---|---|
| Provider desktop | Windows 10/11 only at launch | x86_64, NVIDIA RTX 3060+ |
| Buyer web | Desktop-first responsive | Chrome 130+, Safari 17+, Firefox 130+, Edge 130+ |
| Buyer mobile | "Works" but not optimized | iOS 17+, Android 13+ via Phantom mobile |
| Agent API | Any platform speaking HTTP+Solana | Node, Python, Rust SDKs |

**Performance targets (p95):**

| Metric | Target |
|---|---|
| Web app first contentful paint | < 1.5s |
| Web app time-to-interactive | < 3s |
| Inference latency end-to-end (Flux Schnell 1024²) | < 10s |
| MCP server response (excl. payment+inference) | < 200ms |
| Solana tx confirmation | < 1s |
| Apis Tauri provider app idle CPU | < 5% |
| Provider uptime SLO | ≥ 80% |

**Security & privacy:**

- ✅ **Non-custodial by design** — Apis program never has authority to sweep escrow funds
- ✅ **No KYC** for providers or buyers (MVP)
- ✅ **OFAC/EU sanction screening** on every wallet (Chainalysis Free API or TRM Labs starter)
- ✅ **Squads v4 multisig** holds program upgrade authority before mainnet
- ✅ **`coral-xyz/sealevel-attacks`** checklist run before any mainnet deploy
- ✅ **Bug bounty** announced on submission (min $500 at hackathon, $50K cap once raised)

**Privacy commitments:**

- ✅ Apis Provider app collects **GPU specs + heartbeat only**. No game data. No keystrokes. No screenshots. **Full source on GitHub.**
- ✅ Buyer prompts encrypted in transit (TLS), stored briefly only for retry/dispute. Auto-purged after 7 days.
- ✅ Generated images stored on IPFS — buyer controls their CID (can pin or unpin)
- ✅ No user-level analytics until consent UI exists. PostHog with anonymized events only at first.

**Scalability targets:**

| Layer | Scale plan | Mechanism |
|---|---|---|
| Solana program | 1k → 100k jobs/day | Address Lookup Tables, batching, priority fees |
| MCP server | 10 → 1k RPS | Fly.io machines, horizontally stateless |
| Indexer | 100 → 10k tx/s | Helius Geyser/Laserstream subscription |
| Provider network | 10 → 10k providers | Permissionless registration, no manual review |

**Compliance:**

- **MiCA (EU):** legal memo from a Paris crypto-specialist firm in Phase 2 (€10-15K) to confirm Apis is not a CASP (non-custodial → likely yes).
- **FATF Travel Rule:** does not apply if we're not a VASP. Documented in legal memo.
- **AML / sanctions:** Chainalysis or TRM Labs free tier from day 1.
- **GDPR:** minimal user data (email optional, wallet address always). Privacy policy + cookie banner on `apis.xyz`.
- **Legal structure (post-hackathon):** Cayman Foundation Company + French SAS (op-co), ~$50-75K setup year 1.

---

## 9. Quality Standards (Anti-Vibe Rules)

These are enforced for every commit by the team and the AI coding assistant.

### What this project will NOT accept

- ❌ **Placeholder content in production** ("Lorem ipsum", sample images that aren't real)
- ❌ **Half-finished features** — works or it isn't included
- ❌ **Skipped mobile testing** before a release
- ❌ **Bypassed accessibility basics**
- ❌ **Bypassed pre-commit hooks** (Anchor tests, Prettier, ESLint, type checking)
- ❌ **`any` in TypeScript** without an `eslint-disable` + comment justification
- ❌ **Swallowed errors** — explicit handling or explicit re-throw
- ❌ **`unwrap()` in Rust** without a SAFETY comment explaining the invariant

### Code quality requirements

- **Type safety:** strict TypeScript on web/MCP server, idiomatic Rust on program
- **Architecture:** thin controllers — logic in services / instruction handlers only
- **Error handling:** explicit error types, no swallowed exceptions
- **Testing:** ≥ 80% coverage minimum on critical paths (escrow, payment release, dispute resolution)

### Design quality requirements

- **Design tokens only** — no raw hex/pixel values in component code
- **Accessibility:** WCAG 2.1 AA verified
- **Performance:** Core Web Vitals in green zone

---

## 10. Budget & Constraints

### Budget

| Phase | Cost | What for |
|---|---|---|
| **Phase 1 — Hackathon (~6 weeks)** | $0–$200 | All free tiers. Optional: domain (~$10), code-signing OV cert (~$200). |
| **Phase 2 — Beta (Months 2-4)** | ~$300/mo | Helius Developer ($49) + Vercel Pro ($20) + Fly.io scaling ($30-50) + Privy if MAU > 500 ($299) + misc. |
| **Phase 3 — Seed-ready (Months 5-9)** | $500-2K/mo + one-time $65-105K | Above + audit ($15-30K) + legal ($50-75K) — funded by VC raise. |

**Hard constraint:** Phase 1 stays at **$200 max** (GPU available + Noah AI 5M credits + everything else free).

### Timeline

- **No external deadline.** "All-in, take time to ship the best version."
- **Internal target:** Dev3pack submission in **5-6 weeks** of focused work.
- **Buffer rule:** every weekly checkpoint has a fallback per the Build Plan — if S2 isn't done by Sunday, swap real provider for Replicate API mock and proceed.
- **No-go date:** if at end of Week 4, Claude doesn't autonomously buy 1 inference, **stop adding features and polish what works**.

### Team

Founder + AI coding assistant. Possibly 1-2 collaborators to be confirmed.

---

## 11. Open Questions & Assumptions

### Open questions

- Is there a French/EU MiCA registration risk we're missing for the marketplace operator role specifically (vs. pure facilitator)? — to be answered by Phase-2 legal memo.
- Will Anchor 1.0.x ship a stable release before our hackathon submission or stay at 1.0.2? — track release notes weekly.
- x402 + MCP composition — no formal SEP yet for "MCP tool returns 402"; it's a transport-layer behavior the spec permits but doesn't standardize.
- Does Privy server-wallet free tier allow sub-second-transaction signing throughput at the agent demo's burst load? — needs a prototype test before week 4.
- TEE on H100 via Phala — exact integration window (how many engineer-weeks) — confirm with Phala docs in Phase 2.

### Key assumptions

- Solana mainnet stays performant enough through Q3 2026 for sub-second settlement (no large-scale outage during demo window).
- Flux.1 Schnell remains Apache-2.0; Black Forest Labs doesn't change the license retroactively.
- Coinbase x402 facilitator stays free or near-free for 0.012 USDC payments (1k tx/mo free tier holds).
- Helius free tier (1M credits/month) is sufficient for hackathon usage and early beta.
- Gamer providers tolerate ~5% CPU overhead and don't reject the app over telemetry concerns (mitigated by full source on GitHub).
- The "AI agent buys compute autonomously" story is novel enough to the Dev3pack jury in 2026 that it remains a wow-factor.
- io.net's enterprise/data-center positioning continues — they don't pivot to consumer GPUs while we're building.

---

## 12. Launch Strategy

### Soft launch sequence

1. **Hackathon submission** = the public unveil. Demo video + GitHub repo + Twitter thread tagging sponsors and judges.
2. **First 14 days post-submission** = capture momentum: blog post on Mirror, Discord open, sponsor amplifications.
3. **Days 14-30** = 50 invited providers + 50 invited buyers (closed beta). Bug-fix-iterate.
4. **Days 30-60** = open public beta (target Tier-2 KPIs).
5. **Days 60-90** = paid press cycle + VC outreach + Tier-3 metrics.

### Target users at launch

- 50 closed-beta providers from gamer Discords, /g/, NiceHash diaspora — **bonus**: $50 SOL signup + 0% take rate for life.
- 50 closed-beta buyers from Solana AI agent ecosystems (Virtuals, Pump-AI, ai16z), HuggingFace Discord, indie ML Twitter — **bonus**: $25 free credit.

### Feedback collection

- In-app NPS prompt at job 5 and job 25
- Founder DMs to first 100 users (manual outreach)
- Discord channel `#bugs-and-feedback` with a public Notion roadmap
- Weekly recap email to all users

### Iteration cycle

Weekly release on Tuesdays during beta. Hotfix-on-demand for P0 bugs.

---

## 13. Definition of Done for MVP

The MVP is ready to submit when:

### Feature complete

- [ ] All 5 P0 features (F1-F5) functional
- [ ] All acceptance criteria met for each P0 feature
- [ ] Code review completed (self + AI-assisted) on every commit

### Quality assurance

- [ ] Anchor program test suite passing — coverage > 80% on escrow/payment/dispute paths
- [ ] Provider node integration tests passing
- [ ] Web app E2E test for the full buyer journey (connect → submit → result)
- [ ] MCP inspector tests passing
- [ ] Manual QA on the agent demo flow (Claude buys 1 image autonomously) — ≥ 5 successful runs in a row
- [ ] Performance benchmarks met (per §8)

### Documentation

- [ ] Public GitHub repo with README, setup instructions, contract addresses (devnet)
- [ ] Apis SDK docs (TypeScript, Python) on `apis.xyz/agents`
- [ ] At least 8 Solana SDKs documented in README (max sponsor bonus)
- [ ] User-facing FAQ published

### Release ready

- [ ] Live deployment: `apis.xyz` (Vercel) + `mcp.apis.xyz` (Fly.io) + provider download URL
- [ ] Solana devnet program deployed + verified
- [ ] Monitoring/alerting on MCP server, Solana indexer, provider heartbeat
- [ ] Rollback plan documented (revert deploy + close pending jobs)
- [ ] Demo video < 3 minutes, captioned, published

### Hackathon submission

- [ ] Dev3pack submission form filled with all required fields
- [ ] GitHub repo public, README explicit on the 5 P0 features and the agent demo
- [ ] Live demo URL working at submission time
- [ ] Sponsor activation tags / mentions in repo and submission
- [ ] Tweet thread published, all sponsors tagged

---

## 14. Next Steps

Once this PRD is approved:

1. **Create Technical Design Document (Part 3)** — detailed architecture, state machines, account schemas, API specs.
2. **Set up development environment** — Anchor 1.0.2, Tauri 2.x, Next.js 15 via `create-solana-dapp`, Python worker repo.
3. **Build MVP with AI assistance** — follow the Build Plan §8 from the Research Report (5-week sprint).
4. **Closed beta with 50 providers + 50 buyers** post-submission.
5. **Public beta + VC outreach** at Day 60-90 per the Post-Hackathon Path.

---

*PRD Version: 1.0*
*Status: Draft — Ready for Technical Design*
*Created: 2026-05-09*
*Owner: Apis founding team*
*Next review: after Technical Design Document drafted*
