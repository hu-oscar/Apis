# Tech Stack & Tools

> Source of truth for the **languages, libraries, versions, and setup commands** the agent must use. Anything not in this list should not be added without explicit human approval.

## Languages & Toolchains

| Layer | Language | Version | Toolchain |
|---|---|---|---|
| On-chain program | Rust | 1.79+ stable | `rustup` + `cargo` |
| Anchor framework | Rust | **Anchor 1.0.2** | `avm install 1.0.2 && avm use 1.0.2` |
| Buyer web app | TypeScript | 5.x | `pnpm` (preferred) or `npm` |
| MCP server | TypeScript / Node | Node **22 LTS** | `pnpm` |
| Provider desktop shell | Rust | 1.79+ stable | Tauri **2.x** |
| Provider desktop UI | TypeScript / React | React 18+ | Tauri's React-TS template |
| Worker (Stable Diffusion) | Python | **3.12** | `python3 -m venv .venv` + `pip` |

## Frameworks & Libraries

### On-chain / Solana
- **`anchor-lang` 1.0.2** — Solana program framework
- **`anchor-spl` 1.0.2** — SPL token CPI helpers (`token::transfer_checked`)
- **`solana-program` 2.x** — base SDK
- **`spl-token` 8.x** — classic SPL Token program (USDC stays on classic, NOT Token-2022, in v1)
- Reference repo: [`solana-developers/program-examples`](https://github.com/solana-developers/program-examples) — start every program from here, modify; do not blank-page

### Buyer web app (`packages/web`)
- **Next.js 15** (App Router) — scaffold via `pnpm create solana-dapp@latest`
- **React 19**
- **TypeScript** (strict mode)
- **Tailwind CSS** + **shadcn/ui** components
- **`@solana/wallet-adapter-react`** + `@solana/wallet-adapter-react-ui` — Phantom + Solflare + Backpack
- **`@solana/web3.js`** — Solana primitives
- **`@coral-xyz/anchor`** (TS client) — typed program calls
- **`@solana/spl-token`** — token operations
- **Zod** — runtime input validation
- **`react-simple-maps` or `mapbox-gl-js`** — global hex map of providers
- **Hosting:** Vercel (Hobby tier free at hackathon)

### Provider desktop (`packages/apis-provider`)
- **Tauri 2.x** — scaffold via `cargo create-tauri-app --template react-ts`
- **`tauri-plugin-store`** — user preferences
- **`tauri-plugin-system-tray`** — system tray
- **`tauri-plugin-stronghold`** — encrypted keypair storage
- **`tauri-plugin-shell` or `tauri-plugin-sidecar`** — Python sidecar spawn
- **`tauri-plugin-updater`** — auto-update
- **`nvml-wrapper`** (Rust crate) — NVIDIA GPU detection
- **`wgpu`** (Rust crate) — cross-vendor first-pass detection
- **`windows-service`** (Rust crate) — install worker as Windows Service
- **Reference patterns:** `tauri-apps/awesome-tauri` filtered to MIT/Apache only — **NEVER** Authme/Spacedrive/Pot (GPL)

### Python worker (`packages/worker`)
- **`diffusers`** (HuggingFace) — Flux Schnell pipeline
- **`torch` 2.6** + CUDA 12.4 — PyTorch backend (do NOT bundle in installer; first-run download)
- **`bitsandbytes`** — NF4 quantization (default tier)
- **`torchao`** — INT4 + `torch.compile` (premium speed tier on RTX 40-series)
- **`anchorpy`** — typed Anchor client for Python
- **`solders`** — fast Rust-via-PyO3 Solana primitives (Keypair, Transaction, Pubkey)
- **`solana-py`** — Python RPC client
- **`Pillow`** — image manipulation
- **`imagehash`** — perceptual hash for cross-arch verification fallback
- **`ipfshttpclient`** or Pinata SDK — upload result to IPFS
- **Packaging:** **Nuitka** (one-folder mode) — NOT PyInstaller (AV false positives)

### MCP server (`packages/mcp`)
- **Node.js 22 LTS**
- **`@modelcontextprotocol/sdk`** — MCP server primitives (spec rev. **2025-11-25**)
- **Hono** — minimalist HTTP framework
- **`x402`** (Coinbase npm package) — HTTP 402 + Solana USDC settlement
- **`@solana/web3.js`** — Solana primitives
- **`@solana/spl-token`** — USDC SPL operations
- **`@coral-xyz/anchor`** TS client — typed program calls
- **`@anthropic-ai/sdk`** — demo agent (Claude Sonnet 4.x); fallback to Noah AI for the demo backup
- **`@privy-io/server-auth`** — agent server-wallet
- **`pino`** — structured logging
- **Hosting:** Fly.io (free trial → small machine ~$5/mo)

### Database / indexer
- **PostgreSQL 17** on Fly.io Postgres — indexed mirror of on-chain JobRecord, analytics, spot-check audit log
- **Helius webhooks + Geyser/Laserstream** — stream Solana events into Postgres
- See [`agent_docs/code_patterns.md`](code_patterns.md) for schema (also in TDD §6)

### Storage
- **Pinata IPFS** (free 1 GB) — generated image artifacts
- **`@pinata/sdk`** (Node) and Pinata HTTP API (Python)

### Infrastructure / DX
- **GitHub Actions** — CI (lint + typecheck + test on every PR)
- **`gitleaks`** — pre-commit secret scanner
- **Sentry** — error tracking (free 5K errors/mo)
- **PostHog** — product analytics (anonymized only, free <1M events/mo)

## Setup Commands

### One-time global toolchain

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Solana CLI
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Anchor 1.0.2 via avm
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 1.0.2
avm use 1.0.2
anchor --version  # → anchor-cli 1.0.2

# Node 22 (via fnm)
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 22 && fnm use 22

# Python 3.12
brew install python@3.12  # macOS
# or: apt install python3.12  # Ubuntu

# Tauri prereqs (macOS: xcode-select --install; Windows: MSVC + WebView2)
cargo install create-tauri-app --locked

# pnpm (preferred package manager for the monorepo)
corepack enable && corepack prepare pnpm@latest --activate
```

### Per-package install / dev / test

| Package | Install | Dev | Build | Test |
|---|---|---|---|---|
| `packages/program` | (anchor build pulls deps) | `solana-test-validator` (local) | `anchor build` | `anchor test` |
| `packages/web` | `pnpm install` | `pnpm dev` | `pnpm build` | `pnpm test` |
| `packages/apis-provider` | `pnpm install` | `pnpm tauri dev` | `pnpm tauri build` | `pnpm test` |
| `packages/worker` | `pip install -r requirements.txt` | `python -m apis_worker` | (no build) | `pytest` |
| `packages/mcp` | `pnpm install` | `pnpm dev` | `pnpm build` | `pnpm test` |

### Universal commands (run from repo root)

```bash
pnpm -r lint       # all packages
pnpm -r typecheck  # all TS packages
pnpm -r test       # all packages
anchor test --provider.cluster localnet  # smart contract — most important
```

## Error Handling Pattern

### TypeScript (web app + MCP server)

```typescript
// services/job-service.ts
import { z } from 'zod'

export class ApisError extends Error {
  constructor(
    public readonly code: string,
    public readonly userMessage: string,
    public readonly developerContext?: Record<string, unknown>,
  ) {
    super(userMessage)
    this.name = 'ApisError'
  }
}

const SubmitJobInput = z.object({
  prompt: z.string().min(1).max(256),  // Flux Schnell limit
  model: z.literal('flux-schnell'),    // v1: only one model
  resolution: z.enum(['512', '1024', '2048']),
  maxPriceUsdc: z.number().positive().max(1),  // sanity cap
})

export async function submitJob(rawInput: unknown) {
  // 1. Validate input at the boundary
  const parsed = SubmitJobInput.safeParse(rawInput)
  if (!parsed.success) {
    throw new ApisError(
      'VALIDATION_FAILED',
      'Invalid job parameters. Please check the prompt and parameters.',
      { issues: parsed.error.issues },
    )
  }

  // 2. Call core domain logic
  try {
    const job = await jobDomain.create(parsed.data)
    return { success: true as const, job }
  } catch (err) {
    // 3. Normalize errors at the service boundary — never let raw exceptions reach the UI
    if (err instanceof ApisError) throw err
    if (err instanceof Error) {
      throw new ApisError('JOB_CREATION_FAILED', 'Could not create the job. Please retry.', {
        cause: err.message,
      })
    }
    throw new ApisError('UNKNOWN_ERROR', 'An unexpected error occurred.', { cause: String(err) })
  }
}
```

### Rust (Anchor program)

```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum ApisError {
    #[msg("Job is not in a state that allows this transition.")]
    InvalidJobState,
    #[msg("Provider stake is below the required minimum.")]
    InsufficientBond,
    #[msg("Hash mismatch between provider result and validator spot-check.")]
    HashMismatch,
    #[msg("Math overflow.")]
    MathOverflow,
    #[msg("Caller is not authorized for this action.")]
    Unauthorized,
}

pub fn confirm_completion(ctx: Context<ConfirmCompletion>) -> Result<()> {
    let job = &mut ctx.accounts.job;
    require!(job.status == JobStatus::Completed, ApisError::InvalidJobState);

    let fee_bps = ctx.accounts.config.fee_bps as u64;
    let fee = job
        .price_lamports_usdc
        .checked_mul(fee_bps)
        .ok_or(ApisError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(ApisError::MathOverflow)?;
    let provider_amount = job
        .price_lamports_usdc
        .checked_sub(fee)
        .ok_or(ApisError::MathOverflow)?;

    // SAFETY: vault PDA seeds proven correct via #[account(...)] constraints; checked above.
    transfer_checked_from_vault(ctx.accounts.vault.clone(), ctx.accounts.provider_token_account.clone(), provider_amount)?;
    transfer_checked_from_vault(ctx.accounts.vault.clone(), ctx.accounts.fee_treasury.clone(), fee)?;

    // Invariant: vault must be empty after release
    let vault_after = ctx.accounts.vault.amount;
    require!(vault_after == 0, ApisError::MathOverflow);  // shouldn't happen

    Ok(())
}
```

### Python (worker)

```python
import logging
import hashlib

class ApisWorkerError(Exception):
    """Base class for all worker errors. Always raise a subclass."""

class GpuUnavailable(ApisWorkerError): ...
class InferenceTimeout(ApisWorkerError): ...
class IpfsUploadFailed(ApisWorkerError): ...

logger = logging.getLogger("apis_worker")

def run_job(job_spec: dict) -> dict:
    try:
        seed = int(job_spec["seed"])
        prompt = str(job_spec["prompt"])[:256]  # Flux Schnell hard limit
        result_tensor = pipeline(prompt, num_inference_steps=4, guidance_scale=0.0,
                                 generator=seeded_generator(seed)).images[0]
        result_hash = hashlib.sha256(result_tensor.cpu().contiguous().numpy().tobytes()).hexdigest()
        cid = upload_to_ipfs(result_tensor)
        return {"status": "completed", "result_hash": result_hash, "cid": cid}
    except torch.cuda.OutOfMemoryError as err:
        logger.exception("GPU OOM running job %s", job_spec.get("job_id"))
        raise GpuUnavailable("GPU ran out of memory") from err
    except TimeoutError as err:
        raise InferenceTimeout("Job exceeded time budget") from err
    # Any other unexpected exception bubbles up — supervisor catches + reports
```

## Styling & Component Examples

### Tailwind + shadcn/ui (Cyberpunk Swarm theme)

```tsx
// packages/web/src/lib/design-tokens.ts
export const colors = {
  background: '#000000',
  surface: '#0F0F0F',
  primary: '#14F195',     // Solana green
  secondary: '#9945FF',    // neon violet
  text: '#FAFAF9',
  hexMotif: 'rgba(26,26,26,0.03)',
  success: '#14F195',
  error: '#FF3B5C',
} as const
```

```tsx
// Example component using design tokens (NEVER raw hex)
import { colors } from '@/lib/design-tokens'
import { Button } from '@/components/ui/button'

export function StartHostingButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      onClick={onClick}
      className="bg-[var(--apis-primary)] text-black hover:bg-[var(--apis-primary)]/90"
    >
      Start Hosting
    </Button>
  )
}
```

## Naming Conventions

- **Files:** kebab-case (`provider-registry.ts`, `job-record.rs`)
- **React components:** PascalCase (`HexMap`, `JobStreamLog`)
- **TS functions / vars:** camelCase
- **Rust types / structs:** PascalCase
- **Rust functions / vars:** snake_case
- **Constants / env vars:** UPPER_SNAKE_CASE
- **Anchor account types:** PascalCase (`JobRecord`, `ProviderRegistry`)
- **Anchor instructions:** snake_case (`create_job`, `submit_completion`)
- **Solana PDAs seeds:** kebab-case strings (`["provider", pubkey]`, `["vault", job_record_pubkey]`)
- **Test files:** `<unit>.test.ts` (TS), `<unit>_test.rs` or `tests/` directory (Rust), `test_<unit>.py` (Python)

## Update cadence for this file

This file is updated whenever:
- A new dependency is added (after a PR-level review, not impromptu)
- A version is pinned or bumped
- A pattern (error handling, validation, logging) changes
- A toolchain command changes
