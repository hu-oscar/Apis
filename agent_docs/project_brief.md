# Project Brief

- **Product vision:** Apis is a permissionless decentralized GPU compute marketplace on Solana, where individuals (gamers, ex-miners, creatives with idle workstations) rent out their personal GPUs directly to AI developers and autonomous AI agents — settled in USDC on-chain in seconds.
- **Tagline:** *Where idle gaming GPUs meet AI agents.*
- **Target Audience:**
  - **Supply (providers):** Maxime — 24-year-old gamer, RTX 4080 idle, France/Germany, software-savvy + crypto-curious.
  - **Demand (humans):** Sarah — 28-year-old indie AI developer, $40K runway, Lisbon, frustrated by Replicate cost + OpenAI throttling.
  - **Demand (agents):** Atlas-7 — autonomous AI agents (LangGraph / ElizaOS / Virtuals) with their own Solana wallets, no humans in the loop.
- **Core differentiation:** First marketplace combining (1) **true consumer-GPU supply**, (2) **on-chain permissionless settlement**, (3) **AI-agent-native payment rails** (MCP + x402 on Solana). Validated against 11 competitors in Research Report §2 — none combines all three.
- **Hackathon target:** Dev3pack (Solana track) — submission window ~5-6 weeks. Top 10 Solana track / Top 5 DePIN side track aspiration.

## Conventions

- **Naming:**
  - Files: kebab-case (`job-service.ts`, `submit-completion.rs`)
  - React components: PascalCase (`HexMap.tsx`)
  - TS functions / vars: camelCase
  - Rust types / functions: PascalCase / snake_case respectively
  - Anchor instructions: snake_case (`create_job`)
  - Anchor account types: PascalCase (`JobRecord`)
  - Env vars / constants: UPPER_SNAKE_CASE
  - PDA seeds (in source): `b"<lowercase-noun>"`
- **File structure:** monorepo at `packages/<surface>/`:
  - `packages/program/` — Anchor smart contract
  - `packages/web/` — Next.js buyer marketplace
  - `packages/apis-provider/` — Tauri desktop provider app
  - `packages/worker/` — Python Stable Diffusion worker
  - `packages/mcp/` — Node MCP + x402 server
  - `packages/shared/` — shared TS types (Anchor IDL re-exports)
- **Test colocation:** test files live next to source (`Button.tsx` next to `Button.test.tsx`) or in a `tests/` directory for Rust.

## Quality Gates

- **Pre-commit hooks:** `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, `pnpm -r lint`, `pnpm -r typecheck`, `gitleaks detect --staged`, related-tests run.
- **CI on every PR:** `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test`, `cd packages/program && anchor test`. Fails CI → no merge to `main`.
- **Smart contract changes (special):** require sealevel-attacks checklist re-read + line-by-line diff review + new test that catches the bug being fixed.
- **Test coverage targets:** ≥ 80% on Anchor program escrow / payment / dispute paths. Unit + integration on critical TS services. E2E on the top 3 user journeys (per `code_patterns.md` § Testing Pattern).
- **Pre-merge:** complete `REVIEW-CHECKLIST.md` checklist.

## Key Commands

| Purpose | Command |
|---|---|
| Install all packages | `pnpm install` |
| Run web app (dev) | `pnpm --filter web dev` |
| Run MCP server (dev) | `pnpm --filter mcp dev` |
| Run Tauri provider app (dev) | `pnpm --filter apis-provider tauri dev` |
| Run Python worker | `cd packages/worker && python -m apis_worker` |
| Anchor build | `cd packages/program && anchor build` |
| Anchor test (local validator) | `cd packages/program && anchor test` |
| Anchor deploy (devnet) | `cd packages/program && anchor deploy --provider.cluster devnet` |
| Lint everything | `pnpm -r lint` |
| Type check everything | `pnpm -r typecheck` |
| Test everything | `pnpm -r test` |

## Key Principles

- **Ship the simplest possible solution that solves the user story.** No over-engineering for v1.
- **Devnet only at hackathon.** Mainnet deferred to post-audit (Phase 2+). Zero real-money exposure during MVP development.
- **Permissionless by design.** No KYC. Non-custodial — Apis program never has authority to sweep escrow funds.
- **Pre-recorded demo > live demo.** Solana devnet can lag. The 3-min hackathon submission video is recorded; live demo URL is for judges who want to verify on their own.
- **Single AI tool = Claude Code (CLI) only.** Compensating safeguards = deterministic checks (tests + sealevel-attacks + invariants), not multi-AI cross-review.
- **Honest pitch.** Do not promise TEE on consumer GPUs (infeasible in 2026). Do not promise zkML for Stable Diffusion (infeasible in 2026). Position is *cryptoeconomic security tier 1; TEE-attested premium tier on roadmap (Phase 2 via Phala)*.
- **No native APIS token at hackathon.** Per Research §10: 0% take rate (M0-9) → points program (M9-18) → TGE only after PMF (M18-24).
- **Permissive licenses only.** All scaffolds and dependencies must be MIT/Apache-2.0. Explicitly **NO** GPL/AGPL/SSPL.
- **Low-code where possible.** If a built-in (Solana wallet-adapter, x402 facilitator, Privy server-wallet) solves the problem, use it before building custom.

## Update Cadence

- After every architectural decision (logged in `MEMORY.md` § Architectural Decisions).
- After every weekly checkpoint (W1-W6).
- When a new dependency is added or removed.
- When a quality gate or workflow command changes.
