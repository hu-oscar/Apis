# AGENTS.md — Master Plan for Apis

## Project Overview & Stack

**App:** Apis

**Overview:** Apis is a permissionless decentralized GPU compute marketplace on Solana, where individuals (gamers, ex-miners, creatives with idle workstations) rent out their personal GPUs directly to AI developers and autonomous AI agents. Payments settle in USDC on Solana in seconds. The product is built for the **agent economy** — the first marketplace where AI agents can discover, quote, pay, and use compute resources autonomously via the **MCP + x402** combination on Solana.

**Stack (multi-language, multi-surface):**
- **Smart contract (on-chain):** Rust + Anchor 1.0.2 — a unique Solana program with provider registry, escrow, dispute, slashing, and pooling logic
- **Buyer web app:** Next.js 15 (App Router) + TypeScript + Tailwind CSS + shadcn/ui + `@solana/wallet-adapter`
- **Provider desktop app:** Tauri 2.x (Rust shell + React/TS webview) — Windows-first, MIT/Apache-licensed scaffold (`tauri-apps/create-tauri-app`)
- **Python worker (sidecar):** Python 3.12 + HuggingFace `diffusers` + `bitsandbytes` (NF4 quantization) + `anchorpy`/`solders`/`solana-py` + Flux.1 Schnell (Apache-2.0)
- **MCP server:** Node.js + Hono + `@modelcontextprotocol/sdk` + `x402` middleware + `@solana/web3.js` + `@solana/spl-token`
- **Storage:** Pinata IPFS (image artifacts) + Postgres on Fly.io (indexer + analytics)
- **AI integrations:** Claude Sonnet 4.x (demo agent) + Noah AI (5M sponsor credits as backup) + Privy server-wallet (agent wallet)
- **Infra:** Solana devnet (mandatory at hackathon); Vercel (web); Fly.io (MCP server); GitHub Actions (CI)

**Critical Constraints:**
- 🚨 **Smart contract = money-touching code.** Every diff is read line-by-line. `coral-xyz/sealevel-attacks` checklist run after every program change. 80%+ test coverage on escrow/payment/dispute paths. `transfer_checked` everywhere; never `transfer`. `overflow-checks = true`. Squads multisig holds upgrade authority before mainnet.
- 🚨 **Single AI tool = Claude Code (CLI) only.** No Cursor / Copilot / v0.dev. Compensating safeguards are deterministic (tests + checklist + invariants).
- 🚨 **Devnet only at hackathon.** Mainnet only post-audit. Zero real-money exposure during development.
- 🚨 **Permissionless by design.** No KYC. Non-custodial — Apis program never has authority to sweep escrow funds.
- 🚨 **5-6 week timeline** with hard W4 no-go rule: if Claude can't autonomously buy 1 inference by end of W4, freeze scope and polish what works.
- 🚨 **Phase 1 budget ceiling: $200 max.** All free tiers (Helius, Vercel, Fly.io, Privy, Pinata, Coinbase x402).
- 🚨 **No custom domain at hackathon.** Use `apis-mvp.vercel.app` and `apis-mcp.fly.dev`.
- 🚨 **Anchor 1.0.2 has breaking changes vs 0.30.x.** Many tutorials and AI training data lean on 0.30. Always cross-reference current docs at `anchor-lang.com` and recent commits in `solana-developers/program-examples`.

## Setup & Commands

**This is a monorepo with 5 sub-packages.** Commands are scoped per package.

### Repository setup (one-time)

```bash
# Clone
gh repo clone hu-oscar/Apis
cd Apis

# Install root tooling (pnpm workspaces)
pnpm install
```

### Per-package commands

| Package | Path | Build | Dev | Test | Deploy |
|---|---|---|---|---|---|
| **Anchor program** | `packages/program` | `anchor build` | `solana-test-validator` (local) | `anchor test` | `anchor deploy --provider.cluster devnet` |
| **Web app (buyer)** | `packages/web` | `pnpm build` | `pnpm dev` | `pnpm test` | `vercel deploy --prod` |
| **Tauri (provider)** | `packages/apis-provider` | `pnpm tauri build` | `pnpm tauri dev` | `pnpm test` | manual installer release |
| **Python worker** | `packages/worker` | (n/a — runtime) | `python -m apis_worker` | `pytest` | bundled with provider app |
| **MCP server** | `packages/mcp` | `pnpm build` | `pnpm dev` | `pnpm test` | `fly deploy --remote-only` |

### Universal verification commands

- **Lint everything:** `pnpm -r lint`
- **Type check everything:** `pnpm -r typecheck`
- **Test everything:** `pnpm -r test`
- **Anchor program test (most important):** `cd packages/program && anchor test`
- **Sealevel-attacks checklist:** read [coral-xyz/sealevel-attacks](https://github.com/coral-xyz/sealevel-attacks) after every program change

## Protected Areas

🛑 **Do NOT modify the following without explicit human approval:**

- **`packages/program/programs/apis_program/src/lib.rs`** and any escrow / dispute / slashing logic — every change requires line-by-line review + sealevel-attacks checklist + `anchor test` passing
- **`packages/program/Anchor.toml`** — affects deploy authority, cluster, program IDs
- **`.env*`** files — never commit; never echo to logs; protected by pre-commit `gitleaks`
- **Solana keypairs** — `~/.config/solana/id.json` and any `keypair.json` files; AI never sees these
- **`.github/workflows/`** — CI/CD changes require approval
- **`README.md`** — public-facing; contains contract addresses; review before pushing
- **Squads multisig configuration** — admin authority transfer (post-mainnet) must be human-confirmed
- **Anchor migrations** in `packages/program/migrations/` — changing them after deploy can break upgrades

## Coding Conventions

### Rust (Anchor program + Tauri shell)
- **Formatting:** `cargo fmt` enforced via pre-commit hook. No warnings allowed in new code (`cargo clippy --all-targets -- -D warnings`).
- **Type safety:** No `unwrap()` without a `// SAFETY: <invariant>` comment explaining why it cannot panic. Prefer `?` operator with proper error types.
- **Error types:** Use `anchor_lang::error_code!` for on-chain errors. Use `thiserror` for off-chain Rust.
- **Math:** `checked_add`, `checked_sub`, `checked_mul`, `checked_div` for all payment/fee math. `overflow-checks = true` in `Cargo.toml [profile.release]`.
- **Account constraints:** Every PDA validated via `seeds = [...]`, `bump`, and `has_one = ...`. Hardcode `Program<'info, Token>` — never accept arbitrary token program. Use `transfer_checked` everywhere — never `transfer`.

### TypeScript (Web app + MCP server)
- **Strict mode:** `tsconfig.json` with `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`.
- **No `any`:** forbidden. Use `unknown` with type guards. Justify exceptions with `// eslint-disable-next-line @typescript-eslint/no-explicit-any` + comment.
- **Validation:** Zod for all external input (forms, API payloads, env vars). Validate at boundaries; trust types within.
- **Errors:** Never swallow. Either handle explicitly or re-throw. Surface user-safe messages in UI; log developer context server-side.
- **No deprecated patterns:** prefer `fetch` over `axios`. Use the data-fetching approach specified in `agent_docs/tech_stack.md`.

### Python (Worker)
- **Formatting:** `ruff format` + `ruff check` enforced via pre-commit.
- **Type hints:** Required on all function signatures.
- **No bare `except`:** explicit exception types only.

### Architecture rules (universal)
- **Feature-based folder organization** — colocate related code. Hexagonal-ish boundaries: domain logic does not depend on transport/UI.
- **Thin route handlers / thin Anchor instructions:** business logic in services / handler helpers, not in route signatures.
- **Reuse over abstraction:** prefer reusing existing utilities before creating new ones. Don't add new dependencies without checking `agent_docs/tech_stack.md` first.

### Testing expectations
- **Anchor program:** ≥ 80% coverage on escrow/payment/dispute paths. Every instruction has a happy-path + at least one malicious-input test.
- **MCP server + web app:** Vitest + Testing Library. Critical user journeys covered by Playwright E2E.
- **Python worker:** pytest. Mock GPU calls in unit tests; integration tests with a real GPU fixture.
- **All tests run in CI** before merging to `main`.

## Agent Behaviors

These rules apply to **Claude Code** (the only AI tool used for this project per Tech Design §8).

1. **Plan Before Execution.** Always propose a brief step-by-step plan **before** changing more than one file. Wait for approval. For complex features, use Plan/Reflect mode if available.
2. **Read AGENTS.md + agent_docs/ first.** Every session starts with re-reading the current phase from `MEMORY.md` and the relevant `agent_docs/` files (`tech_stack.md`, `code_patterns.md`, `product_requirements.md`).
3. **Plan → Execute → Verify cycle.**
   - **Plan:** outline approach + ask for approval
   - **Execute:** implement one feature at a time
   - **Verify:** run tests/linter after each change; fix before moving on
4. **Refactor over rewrite.** Prefer incremental refactoring; do not rewrite working code unless explicitly asked.
5. **Context compaction.** Write evolving state to `MEMORY.md` instead of filling chat history during long sessions.
6. **Iterative verification.** After each feature: run `pnpm -r test`, `anchor test`, `cargo clippy`, and the relevant linter. Use `REVIEW-CHECKLIST.md` before declaring "done".
7. **Money-touching code = double caution.** Smart contract changes require: (a) test added that would catch the bug, (b) sealevel-attacks checklist re-read, (c) invariant assertions before fund release, (d) line-by-line diff review.
8. **Single-AI safeguards.** Since we use only Claude Code (no multi-AI cross-review), rely on deterministic checks: test coverage thresholds, type checking, sealevel-attacks, invariants. Never bypass them.
9. **Single feature at a time.** No "while I'm here" tangents. New features → backlog in `MEMORY.md`.
10. **Never bypass pre-commit hooks.** If a hook fails, fix the underlying issue. If you absolutely must skip, ask the human first.

## How I Should Think (Meta-Cognition)

1. **Understand intent first.** Before writing code, restate what the user actually needs. Ambiguous? Ask one specific clarifying question.
2. **Plan before coding.** Propose a plan, ask for approval, then implement.
3. **Verify after changes.** Run tests/linters or manual checks after each change.
4. **Explain trade-offs.** When recommending an approach, mention 1-2 alternatives and why you didn't pick them.
5. **Cite sources.** When suggesting a pattern, cite the source (e.g., "per `agent_docs/code_patterns.md`" or "per Anchor 1.0.2 docs").
6. **Acknowledge uncertainty.** If you're unsure about an Anchor 1.0 vs 0.30 API, say so and verify against current docs.

## What NOT To Do

- ❌ Do NOT delete files without explicit confirmation
- ❌ Do NOT modify the Anchor program's account structures without backup plan + migration path
- ❌ Do NOT add features not in the current PRD phase (Phase 1 = MVP)
- ❌ Do NOT skip tests for "simple" changes
- ❌ Do NOT bypass failing tests, type checks, or pre-commit hooks
- ❌ Do NOT use deprecated libraries or patterns (axios → use fetch; class components → use functional)
- ❌ Do NOT use Anchor 0.30 APIs that differ from 1.0.2 — always check `anchor-lang.com` first
- ❌ Do NOT hardcode private keys, RPC URLs with API keys, or any secret in source — use `.env*` (gitignored)
- ❌ Do NOT write code that uses a buyer's prompt for anything other than the inference (no prompt logging beyond strict need)
- ❌ Do NOT introduce GPL/AGPL/SSPL-licensed dependencies — Apis must remain MIT/Apache-license-compatible
- ❌ Do NOT force-push to `main` (regular fast-forward push direct to `main` is the active workflow per Workflow Discipline above)
- ❌ Do NOT promise TEE on consumer GPUs in code comments or docs (it's infeasible in 2026; positioning is "cryptoeconomic security tier 1")

## Engineering Constraints (Anti-Vibe Rules)

### Type Safety (No Compromises)
- The `any` type is **forbidden** in TS — use `unknown` with type guards.
- All function parameters and returns must be typed.
- Use Zod for runtime validation at system boundaries.
- In Rust: no `unwrap()` without `// SAFETY:` comment.

### Architectural Sovereignty
- Routes / Anchor instructions handle request/response only.
- Business logic in `services/` (TS) or `instructions/` helpers (Rust).
- No database calls from route handlers — go through services.
- No state mutations in render functions.

### Library Governance
- Check existing `package.json` / `Cargo.toml` before suggesting new dependencies.
- Prefer native APIs (fetch) over libraries (axios) unless an existing dependency already provides one.
- No GPL-/AGPL-/SSPL-licensed dependencies.
- Avoid deprecated patterns. Use the data-fetching approach in `agent_docs/tech_stack.md`.

### Clear Communication
- State issues briefly and fix them. No filler or repeated apologies.
- If context is missing, ask **one specific** clarifying question.

### Workflow Discipline
- Pre-commit hooks must pass before commits.
- If verification fails, fix issues before continuing.
- Update `MEMORY.md` after every milestone or architectural decision.
- Use `REVIEW-CHECKLIST.md` before declaring a feature complete.
- **Push directly to `main`** during solo hackathon mode (no feature-branch / PR flow). From worktrees: `git push origin HEAD:main` (fast-forward only). Re-evaluate when test-running CI lands in W5.
- **Commit messages: conventional, no `Co-Authored-By`.** Subjects use `feat:` / `fix:` / `chore:` / `test:` / `docs:`. Body explains "why," not "what." **Never** append `Co-Authored-By: Claude …` footers — user preference.

## Reference Documents

- 📋 [`PRD-Apis-MVP.md`](docs/PRD-Apis-MVP.md) — what to build, why, for whom
- 🏗️ [`TechDesign-Apis-MVP.md`](docs/TechDesign-Apis-MVP.md) — how to build it
- 🔍 [`Research-Apis.md`](docs/Research-Apis.md) — market analysis, competitor deep-dive, sponsor map
- 📂 [`agent_docs/`](agent_docs/) — modular detailed docs (tech stack, patterns, testing, brief, requirements)
- 🧠 [`MEMORY.md`](MEMORY.md) — current phase, active work, architectural decisions, known issues
- ✅ [`REVIEW-CHECKLIST.md`](REVIEW-CHECKLIST.md) — pre-merge / pre-completion checklist
