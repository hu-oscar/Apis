# CLAUDE.md — Claude Code Configuration for Apis

## Project Context

- **App:** Apis — permissionless GPU compute marketplace on Solana for AI agents and indie developers.
- **Stack (multi-package monorepo):**
  - Anchor 1.0.2 program (Rust)
  - Next.js 15 buyer web app (TypeScript)
  - Tauri 2.x provider desktop app (Rust + React/TS)
  - Python 3.12 worker (Stable Diffusion / Flux Schnell)
  - Node MCP + x402 server (TypeScript / Hono)
- **Stage:** **Phase 1 — Hackathon MVP, Week 1** (foundation: end-to-end pipeline scaffolds)
- **User Level:** **A — Vibe-coder.** AI writes the code; the human guides direction and tests.
- **Hackathon target:** Dev3pack (Solana track) — submission window ~6 weeks. Hard W4 no-go date.

## Directives

> **READ FIRST, every session:**
> 1. `AGENTS.md` (project root)
> 2. `MEMORY.md` (current phase + active task + open architectural decisions)
> 3. The relevant file under `agent_docs/` for the area you're working in:
>    - Tech / library / setup question → [`agent_docs/tech_stack.md`](agent_docs/tech_stack.md)
>    - Implementation pattern question → [`agent_docs/code_patterns.md`](agent_docs/code_patterns.md)
>    - Feature scope / acceptance criteria → [`agent_docs/product_requirements.md`](agent_docs/product_requirements.md)
>    - Test strategy / coverage → [`agent_docs/testing.md`](agent_docs/testing.md)
>    - Conventions / commands → [`agent_docs/project_brief.md`](agent_docs/project_brief.md)

### Core working rules

1. **Master plan is `AGENTS.md`.** It is the source of truth for engineering constraints, anti-vibe rules, and agent behaviors. Re-read it whenever you're about to do something risky.
2. **Plan-First.** Always propose a brief step-by-step plan before changing more than one file. Wait for human approval. For complex features, use Plan/Reflect mode if available.
3. **Read before write.** Before suggesting a change, read the existing file(s) and surrounding modules. Reuse existing patterns; do not invent new abstractions.
4. **Incremental Build.** Build one small feature at a time. Run tests after each change. Commit after each working feature with a clear `feat: ...` / `fix: ...` / `chore: ...` message.
5. **Verify after every change.** Run `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test`, and `anchor test` (if program changed). Fix failures before declaring done.
6. **Pre-commit hooks must pass.** If they fail, fix the underlying issue. Do not bypass without human approval.
7. **Do not act as a linter** during a feature build. Use the project's linter (`pnpm -r lint`) for that.
8. **Communication style:** be concise. State issues briefly and fix them. No filler. Ask **one** specific clarifying question if context is missing.
9. **Update `MEMORY.md`** after every milestone or non-obvious architectural decision.
10. **Use `REVIEW-CHECKLIST.md`** before declaring a feature complete.
11. **Push directly to `main`.** Solo hackathon mode — no feature-branch / PR flow. From worktrees, use `git push origin HEAD:main` (fast-forward only). Re-evaluate this rule once test-running CI lands (W5).
12. **Commit messages: conventional, no `Co-Authored-By`.** Use `feat:` / `fix:` / `chore:` / `test:` / `docs:` prefixes with a tight subject and a "why-not-what" body. **Do NOT** append `Co-Authored-By: Claude …` footers — user preference.

### Special rule for the smart contract (`packages/program`)

This is **money-touching code.** Apply this stricter workflow:

1. Re-read [`coral-xyz/sealevel-attacks`](https://github.com/coral-xyz/sealevel-attacks) checklist before any non-trivial change.
2. Every change requires: (a) line-by-line diff review by the human, (b) at least one new test that catches the bug being fixed, (c) `anchor test` passing, (d) invariant assertions before any fund release (`require!(vault.amount == job.price, ...)`).
3. **Anchor 1.0.2** has breaking changes vs 0.30.x. Most of your training data is 0.30. **Always cross-reference** current docs at `anchor-lang.com` and recent commits in `solana-developers/program-examples`. When in doubt, ask the human.
4. Never use `transfer` — always `transfer_checked`. Never use `AccountInfo` for the token program — always `Program<'info, Token>`. Always validate PDAs with `seeds + bump + has_one`.
5. `overflow-checks = true` is non-negotiable in `Cargo.toml [profile.release]`.
6. No `.unwrap()` without a `// SAFETY: <invariant>` comment that explains why it cannot panic.

### What NOT To Do

- ❌ Do NOT delete files without explicit confirmation.
- ❌ Do NOT modify Anchor account structures without backup plan + migration path.
- ❌ Do NOT add features outside the **current phase** (Phase 1 = MVP — see `agent_docs/product_requirements.md` § MVP Features).
- ❌ Do NOT skip tests for "simple" changes.
- ❌ Do NOT bypass failing tests, type checks, or pre-commit hooks.
- ❌ Do NOT use deprecated patterns (axios, class components, `transfer` instead of `transfer_checked`).
- ❌ Do NOT use Anchor 0.30 APIs that differ from 1.0.2 — verify against current docs first.
- ❌ Do NOT hardcode private keys, RPC URLs with API keys, or any secret in source — use `.env*` (gitignored).
- ❌ Do NOT log buyer prompts beyond strict need for retry/dispute (auto-purge after 7 days per privacy commitment).
- ❌ Do NOT introduce GPL/AGPL/SSPL-licensed dependencies — Apis must remain MIT/Apache-license-compatible.
- ❌ Do NOT force-push to `main` (regular fast-forward push direct to `main` is the active workflow per Core rule 11).
- ❌ Do NOT promise TEE on consumer GPUs — it is infeasible in 2026 (positioning is "cryptoeconomic security tier 1").

## Commands

### Universal (run from repo root)

| Purpose | Command |
|---|---|
| Install all packages | `pnpm install` |
| Lint everything | `pnpm -r lint` |
| Type check everything | `pnpm -r typecheck` |
| Test everything | `pnpm -r test` |

### Per package

| Package | Dev | Build | Test |
|---|---|---|---|
| `packages/program` | `solana-test-validator` (separate terminal) | `anchor build` | `anchor test` |
| `packages/web` | `pnpm --filter web dev` | `pnpm --filter web build` | `pnpm --filter web test` |
| `packages/apis-provider` | `pnpm --filter apis-provider tauri dev` | `pnpm --filter apis-provider tauri build` | `pnpm --filter apis-provider test` |
| `packages/worker` | `cd packages/worker && python -m apis_worker` | (n/a — runtime) | `cd packages/worker && pytest` |
| `packages/mcp` | `pnpm --filter mcp dev` | `pnpm --filter mcp build` | `pnpm --filter mcp test` |

### Solana / Anchor

| Purpose | Command |
|---|---|
| Set cluster to devnet | `solana config set --url https://api.devnet.solana.com` |
| Airdrop SOL on devnet | `solana airdrop 5` |
| Build program | `cd packages/program && anchor build` |
| Test program (local validator) | `cd packages/program && anchor test` |
| Deploy to devnet | `cd packages/program && anchor deploy --provider.cluster devnet` |
| Sync IDL | `cd packages/program && anchor idl init <PROGRAM_ID> --filepath target/idl/apis_program.json --provider.cluster devnet` |

## Engineering Constraints (concise — full version in `AGENTS.md`)

- **Type Safety:** No `any`. Use `unknown` + type guard. Zod for runtime validation at boundaries.
- **Architectural Sovereignty:** Routes / Anchor instructions handle request/response only. Logic in services / instruction helpers.
- **Library Governance:** Check `package.json` / `Cargo.toml` before suggesting new deps. No GPL/AGPL/SSPL.
- **Workflow Discipline:** Pre-commit hooks must pass. Update `MEMORY.md` after milestones. Use `REVIEW-CHECKLIST.md` before "done".

## How I Should Think (Meta-Cognition)

1. **Understand intent first.** Restate what the user actually needs.
2. **Ask one specific clarifying question** if context is missing.
3. **Plan before coding.** Outline approach + ask for approval.
4. **Verify after changes.** Run tests/linters.
5. **Explain trade-offs.** Mention 1-2 alternatives + why I didn't pick them.
6. **Cite sources.** "Per `agent_docs/code_patterns.md`" or "Per Anchor 1.0.2 docs at anchor-lang.com".
7. **Acknowledge uncertainty.** Especially for Anchor 1.0 vs 0.30 API differences.

## First Prompt to Use

When starting a new Claude Code session for Apis:

> Read `AGENTS.md`, `MEMORY.md`, and `agent_docs/product_requirements.md`. Then propose a 5-step plan for the next active task in `MEMORY.md`. Wait for my approval before coding.
