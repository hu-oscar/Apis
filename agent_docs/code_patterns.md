# Code Patterns

## Purpose

This file defines the implementation patterns the agent must follow for Apis. Prefer these patterns over inventing new ones. When in doubt, refer to [`tech_stack.md`](tech_stack.md) for the chosen libraries and [`product_requirements.md`](product_requirements.md) for the feature scope.

## Architecture Pattern

- **Primary pattern:** Feature-based monorepo with **hexagonal-ish boundaries**. Each `packages/<surface>/` is a self-contained unit; shared cross-surface contracts live in `packages/shared` (TS types) or are derived from the Anchor IDL (`packages/program/target/idl/apis_program.json`).
- **Rule:** Domain logic does **not** depend on transport / UI / framework specifics. Anchor instructions are thin; helpers in `instructions/<name>/helpers.rs`. Next.js route handlers are thin; logic in `services/`. Python worker entrypoint is thin; logic in `apis_worker/<feature>.py`.
- **Rule:** Reuse existing modules before creating new ones. Search the repo before inventing an abstraction.
- **Rule:** Smart contract code is **money-touching** — every diff requires the workflow in [`AGENTS.md` § Agent Behaviors #7](../AGENTS.md). No exceptions.

## Data Fetching

- **Primary approach (web app):** **React Server Components** for static / cached data; client-side `@solana/web3.js` + `@coral-xyz/anchor` TS client for wallet-signed user actions; Helius **enhanced WebSockets** (`programSubscribe` / `accountSubscribe`) for real-time job state changes.
- **Primary approach (MCP server):** direct Anchor TS client + Helius RPC. No ORM (Postgres queries via `pg` lib for the indexer).
- **Primary approach (worker):** Helius enhanced WebSockets (`transactionSubscribe` / `programSubscribe`) — **never** raw `logsSubscribe` (drops events under load).
- **Rule:** Do not assume a specific library beyond what's listed in `tech_stack.md`. Do not add `axios`, `swr`, `react-query`, `trpc`, or similar without explicit human approval.
- **Rule:** Keep fetch logic out of render functions in client components (use `useEffect` + state, or move to a server component / route handler).

## State Management

- **Server state:** Solana on-chain (source of truth) + Postgres mirror (indexer). The web app reads from the on-chain accounts directly for live state; from Postgres for historical / aggregated views.
- **Client state (web app):** React's built-in `useState` / `useReducer` for local UI; `@solana/wallet-adapter-react` context for wallet connection. **No Redux / Zustand / Recoil unless human-approved** — the MVP scope doesn't justify a state library.
- **Forms:** React Hook Form + Zod resolver. Validate at submit time, not on every keystroke (per Cyberpunk Swarm principle: latency is part of the design).
- **Provider desktop (Tauri):** local state in React webview; persistent state in `tauri-plugin-store`; encrypted secrets in `tauri-plugin-stronghold`.
- **Rule:** Prefer the simplest working approach. Do not add a state library if the framework's built-in state is sufficient.

## Error Handling

- Normalize errors at service / API boundaries — never let raw exceptions reach the UI.
- Never swallow errors silently; always log or surface them.
- Return user-safe messages in the UI (`"Could not create the job. Please retry."`); log developer context server-side (with `pino` or Sentry).
- Use a consistent error shape across all API responses (`{ ok: false, code: "VALIDATION_FAILED", message: "..." }`).
- See `tech_stack.md` for the canonical TS / Rust / Python error patterns.

## Validation

- Validate **all** external inputs (user forms, API payloads, environment variables, IPC messages from Python sidecar).
- Apply runtime validation at system boundaries (Zod for TS, `serde` derive for Rust, manual `try/except` in Python). Trust internal types inside those boundaries.
- Co-locate validation rules with the relevant contract:
  - API route validation: in the route handler or its sibling `schema.ts`
  - Anchor instruction context: `#[derive(Accounts)]` does most of the work; explicit `require!()` for state machine rules
  - Python sidecar: `pydantic` models on the JSON-RPC boundary
- Environment variables validated at startup with Zod (`packages/web/src/env.ts`, `packages/mcp/src/env.ts`). Boot fails loudly if a required env var is missing.

## Solana / Anchor Patterns

### Account model (per Tech Design §3 + AGENTS.md)

```
GlobalConfig         seeds = ["config"]
ProviderRegistry     seeds = ["provider", provider_pubkey]
JobRecord            seeds = ["job", client_pubkey, nonce_le_bytes]
EscrowVault          seeds = ["vault", job_record_pubkey]   ← SPL Token account, NOT custom Anchor account
ReputationAccount    seeds = ["rep", provider_pubkey]
DisputeAccount       seeds = ["dispute", job_record_pubkey]
```

### Instruction list (12 instructions for Phase 1)

```
initialize_config / update_config
register_provider / update_provider / deactivate_provider
deposit_bond / withdraw_bond
create_job / accept_job / submit_completion / confirm_completion / auto_release / cancel_job
raise_dispute / resolve_dispute
slash_provider
update_reputation                  // CPI from confirm_completion / resolve_dispute
```

### Patterns to copy

- **Marketplace + escrow:** [`solana-developers/program-examples/tokens/escrow`](https://github.com/solana-developers/program-examples) — start every program work session by re-reading this.
- **Vaults + accounting:** [`drift-labs/drift-vaults`](https://github.com/drift-labs/drift-vaults).
- **Two-sided marketplace shape:** [`metaplex-foundation/mpl-auction-house`](https://github.com/metaplex-foundation/mpl-auction-house).
- **Security checklist:** [`coral-xyz/sealevel-attacks`](https://github.com/coral-xyz/sealevel-attacks).

### Mandatory Anchor patterns (non-negotiable)

```rust
// 1. Hardcode the token program — never accept arbitrary
#[derive(Accounts)]
pub struct CreateJob<'info> {
    pub token_program: Program<'info, Token>,  // hardcoded — do NOT use AccountInfo
    // ...
}

// 2. Always transfer_checked, never transfer
use anchor_spl::token::{self, TransferChecked};
token::transfer_checked(
    CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
            to: ctx.accounts.provider_token_account.to_account_info(),
            authority: ctx.accounts.job_record.to_account_info(),
        },
        signer_seeds,
    ),
    amount,
    decimals,  // mint decimals — defends against mint substitution
)?;

// 3. PDAs validated by Anchor constraints, not by manual key checks
#[account(
    seeds = [b"vault", job_record.key().as_ref()],
    bump = job_record.bump,
)]
pub vault: Account<'info, TokenAccount>,

// 4. has_one for ownership relationships
#[account(
    has_one = client,
    has_one = provider,
    seeds = [b"job", client.key().as_ref(), &nonce.to_le_bytes()],
    bump = job_record.bump,
)]
pub job_record: Account<'info, JobRecord>,

// 5. Checked math everywhere
let fee = price.checked_mul(fee_bps as u64)
              .ok_or(ApisError::MathOverflow)?
              .checked_div(10_000)
              .ok_or(ApisError::MathOverflow)?;
```

### Cross-Program Invocation (CPI) rules

- **Pyth (price oracles):** validate `price.publish_time > slot_time - 30` and `price.conf / price.price < 0.005`. Reject stale or wide-confidence prices.
- **Switchboard:** alternative oracle, same validation discipline.
- **Jupiter swaps:** **do NOT CPI from on-chain.** Build the swap on the client and bundle with our `fund_escrow_with_usdc` instruction in a single transaction.
- **Standard SPL token:** `anchor_spl::token::transfer_checked` — never raw `token::transfer`.
- **Squads multisig:** holds program upgrade authority before mainnet. CPI not required at MVP.

### Cargo.toml hardening (program crate)

```toml
[profile.release]
overflow-checks = true       # mandatory — never disable
lto = "fat"
codegen-units = 1
debug-assertions = true       # for hackathon / devnet
panic = "abort"
```

## File and Naming Conventions

- **Files:** kebab-case (`job-service.ts`, `submit-completion.rs`)
- **React components:** PascalCase (`HexMap.tsx`, `JobStreamLog.tsx`)
- **TS functions / variables:** camelCase
- **Rust types / structs / traits:** PascalCase
- **Rust functions / variables:** snake_case
- **Anchor instructions:** snake_case (`create_job`, `submit_completion`)
- **Anchor account types:** PascalCase (`JobRecord`, `ProviderRegistry`)
- **Constants / env vars:** UPPER_SNAKE_CASE
- **PDA seed strings:** kebab-case in source (`b"provider"`, `b"vault"`)
- **Test files:** `<unit>.test.ts` (TS), `tests/<unit>_test.rs` (Rust), `test_<unit>.py` (Python)

## Testing Pattern

- **Unit tests** for pure logic and utility functions (formatters, math, hash functions).
- **Integration tests** for API contracts (MCP server tools), Anchor instructions (happy path + at least one malicious-input case per instruction), and Python worker IPC.
- **E2E tests** (Playwright) only for the top user journeys per PRD: (1) wallet connect → submit job → see result, (2) provider install → benchmark → first job, (3) Claude agent autonomously buys 1 image.
- **Run the test suite after every feature; fix failures before moving on.** Per `AGENTS.md` § Agent Behaviors.
- **For smart contract changes:** every PR must include (a) a new test that catches the bug the change fixes, OR (b) explicit justification why no test is needed (very rare — must be human-approved).

## Change Discipline

- Prefer focused, minimal edits over large rewrites.
- Do not introduce new dependencies without checking `tech_stack.md` first; if you must, propose the addition with rationale + license check, get human approval, then add to `tech_stack.md`.
- Do not change Anchor account structures, database migrations, infrastructure config, or auth flows without explicit approval.
- One feature at a time. Commit (or checkpoint) after each working feature. Update `MEMORY.md`'s "Architectural Decisions" if the feature involved a non-obvious choice.
- Never push to `main` without CI passing.
- Never bypass pre-commit hooks. If a hook fails, fix the underlying issue.
- For UI changes, capture a screenshot before / after; for backend changes, capture the relevant terminal output (test pass, deploy success). These go in the PR description.

## Anti-patterns to refuse

| Anti-pattern | Why we refuse | What to do instead |
|---|---|---|
| Adding `axios` | Already have `fetch` (built-in) | Use `fetch` |
| Adding `lodash` | Modern TS / Node has all utilities natively | Use native methods |
| Adding `moment` | Date-fns or native `Intl.DateTimeFormat` is enough | Use native or `date-fns` |
| Adding a global state library (Redux/Zustand) at MVP scope | Over-engineering for the feature scope | Use built-in `useState`/`useReducer` |
| Using `any` in TypeScript | Type erasure loses static safety | Use `unknown` + type guard, or define an interface |
| Catching errors and silently returning `null` | Hides bugs | Use the `ApisError` pattern from `tech_stack.md` |
| Hardcoding secrets in source | Leaks via git history | Use `.env*` (gitignored) |
| Generating Anchor accounts without `seeds + bump + has_one` | PDA confusion attacks | Always validate via `#[account(...)]` |
| Using `transfer` instead of `transfer_checked` | Mint substitution attacks | Always `transfer_checked` |
| Bypassing `coral-xyz/sealevel-attacks` checklist on program changes | Smart contract = money | Run the checklist; document compliance |
| Promising TEE on consumer GPUs | Hardware doesn't support it in 2026 | Position as "cryptoeconomic security tier 1" |
| Adding GPL-licensed dependencies | Viral license breaks our commercial future | MIT/Apache only |
