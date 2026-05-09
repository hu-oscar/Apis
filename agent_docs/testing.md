# Testing Strategy

## Frameworks (per package)

| Package | Unit | Integration | E2E |
|---|---|---|---|
| `packages/program` (Anchor) | Anchor's built-in `#[test]` + `solana-program-test` | `anchor test` against `solana-test-validator` | (n/a — covered by web app E2E) |
| `packages/web` (Next.js) | **Vitest** + React Testing Library | Vitest with mocked Solana RPC | **Playwright** |
| `packages/mcp` (Node) | **Vitest** | Vitest + MSW for HTTP mocks | (covered by agent demo end-to-end test) |
| `packages/apis-provider` (Tauri) | Vitest (web side) + `cargo test` (Rust shell) | Tauri integration tests w/ mocked sidecar | (manual smoke test on Windows) |
| `packages/worker` (Python) | **pytest** + `pytest-mock` | pytest with real GPU fixture (CI-skipped if no GPU) | (n/a) |

## Rules & Requirements

### Coverage targets

- **Anchor program:** ≥ **80%** coverage on **escrow / payment / dispute / slashing** paths. Money-touching code is non-negotiable.
- **MCP server:** ≥ **70%** coverage on tool handlers + x402 middleware.
- **Web app:** ≥ **60%** on services and route handlers; ≥ **40%** on components (components covered more by E2E).
- **Python worker:** ≥ **70%** on the job-execution pipeline (mocked GPU calls in unit tests).
- **Tauri provider app:** unit tests for IPC bridge + GPU detection. Manual QA on real Windows machine before release.

### Mandatory test patterns

#### For Anchor program

Every instruction must have:
1. **Happy path test** — exercises the normal success flow.
2. **At least one malicious-input test** — proves the instruction rejects bad input or unauthorized callers (e.g., wrong signer, wrong PDA seeds, mint substitution).
3. **State-transition test** — the instruction must reject calls when the job is in the wrong state (e.g., `confirm_completion` before `submit_completion`).

```typescript
// Example: tests/escrow.test.ts (Anchor TS test client)
describe('confirm_completion', () => {
  it('releases funds when job is Completed', async () => { /* happy path */ })

  it('rejects when called by non-client', async () => {
    // Try to call as the provider — must fail with Unauthorized
    await expect(
      program.methods.confirmCompletion()
        .accounts({ ...accounts, client: providerKeypair.publicKey })
        .signers([providerKeypair])
        .rpc()
    ).rejects.toThrow(/Unauthorized|has_one/)
  })

  it('rejects when job is in Funded state (not yet completed)', async () => { /* state-transition test */ })

  it('rejects with wrong token program (mint substitution attempt)', async () => { /* security test */ })
})
```

#### For MCP server

Every tool exposed via MCP must have:
1. **Tool-discovery test** — `tools/list` returns the tool with the correct schema.
2. **Successful-call test** — `tools/call` with valid params returns the expected response.
3. **402 test** — `submit_job` without `X-PAYMENT` returns HTTP 402 with valid x402 accepts.
4. **Payment-validated test** — `submit_job` with a valid `X-PAYMENT` proceeds to dispatch.

#### For web app E2E (Playwright)

Cover the **3 top user journeys** only:
1. **Buyer journey:** connect Phantom → submit job → result arrives → rate provider
2. **Provider journey:** install provider app (mocked installer) → benchmark → first job
3. **Agent journey:** Claude Sonnet 4.x autonomously buys 1 image (this IS the demo)

#### Self-healing test pattern

When a Playwright test fails, capture context for AI repair:

```typescript
// playwright.config.ts
use: {
  video: 'on-first-retry',
  trace: 'on-first-retry',
}

// In test failures, capture aria snapshot + error for AI-assisted repair
test('buyer submits job', async ({ page }) => {
  try {
    // ... test
  } catch (err) {
    const snapshot = await page.accessibility.snapshot()
    console.error({ error: err, snapshot, codeLocation: __filename })
    throw err
  }
})
```

#### Visual verification loop (UI changes)

For every UI change, the agent must:
1. **Generate** the component code
2. **Render** in `pnpm dev` (or Tauri dev)
3. **Inspect** via screenshot capture
4. **Refine** if visual regression vs design tokens (`tech_stack.md` § Cyberpunk Swarm palette)

Do not declare a UI feature complete without a screenshot in the PR description.

### Before commit

- ✅ `pnpm -r lint` passes
- ✅ `pnpm -r typecheck` passes
- ✅ `pnpm -r test` passes (or marked `--changed` for the modified files in dev — full suite in CI)
- ✅ `cd packages/program && anchor test` passes (if program changed)
- ✅ `gitleaks detect --staged` clean (no secrets)
- ✅ Pre-commit hooks not bypassed

### When tests fail

- **NEVER** skip tests or mock out assertions to make a pipeline pass without **explicit human approval**.
- If you broke a test, fix it.
- If a test is wrong (testing wrong behavior), fix the test, document the change in PR description, and verify the new test catches the original bug.
- If a test is flaky, mark it `.skip()` with a `// FLAKY:` comment + linked issue, and fix root cause within 24h. Do not let flaky tests rot.

## Execution

### Run all tests

```bash
# From repo root
pnpm -r test                    # Vitest + pytest in all packages

# Anchor program (separate; needs solana-test-validator)
cd packages/program && anchor test
```

### Run a single test file

| Package | Pattern |
|---|---|
| `packages/web` (Vitest) | `pnpm --filter web test src/services/job-service.test.ts` |
| `packages/mcp` (Vitest) | `pnpm --filter mcp test src/tools/submit-job.test.ts` |
| `packages/worker` (pytest) | `cd packages/worker && pytest tests/test_inference.py -v` |
| `packages/program` (Anchor) | `cd packages/program && anchor test --skip-deploy --skip-build -- --grep "confirm_completion"` |

### Run E2E tests (Playwright)

```bash
# Headed mode for debugging
pnpm --filter web e2e:headed

# Headless (default in CI)
pnpm --filter web e2e
```

### Coverage report

```bash
pnpm -r test:coverage
# → opens HTML report at coverage/index.html in each package
```

## Verification Loop (after each feature)

> Per `AGENTS.md` § Agent Behaviors #6 — "Iterative verification" — **mandatory** after every feature.

1. **Lint:** `pnpm -r lint` (or `cargo clippy` for the program)
2. **Type check:** `pnpm -r typecheck`
3. **Tests:** `pnpm -r test` + `anchor test` if program changed
4. **Manual smoke test:** for UI changes — screenshot before/after; for backend — terminal log of the green test
5. **REVIEW-CHECKLIST.md** — mentally walk through it before declaring "done"
6. **Update `MEMORY.md`** if the feature involved an architectural decision

If any step fails, fix before proceeding to the next feature.
