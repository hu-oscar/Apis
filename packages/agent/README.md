# @apis/agent — autonomous Claude buyer

The agent layer on top of the Apis marketplace. Given a task description, Claude (Sonnet 4.5 by default) browses the on-chain provider catalog, picks the best provider, refines the prompt for Flux Schnell, sets a budget, and the agent buys the inference end-to-end — no human in the loop.

This is Sprint 4.0 of Phase 1.5: a direct-Solana agent that proves the "an AI agent can buy compute autonomously" thesis without needing an MCP server in between. Sprint 4.1+ adds the real MCP + x402 layer that the agent will sit behind.

## Quick start

```bash
# 1. Generate the agent's keypair (one-time)
pnpm --filter agent buy --bootstrap-wallet

# 2. Fund the printed pubkey on devnet
solana airdrop 1 <agent-pubkey> --url devnet
cd packages/worker && .venv/bin/python scripts/bootstrap_devnet.py --fund <agent-pubkey> --amount 10

# 3. Set your Anthropic API key
export ANTHROPIC_API_KEY=sk-ant-…

# 4. Buy
pnpm --filter agent buy "a samurai cat in cyberpunk Tokyo, neon rain"
```

## Architecture

```
src/
├── index.ts                 # CLI entrypoint, story-shaped narration
└── lib/
    ├── wallet.ts            # load/generate ~/.config/apis/agent.json
    ├── rpc.ts               # devnet RPC + program constants + USDC formatter
    ├── network.ts           # fetch providers + their signed heartbeats
    ├── decide.ts            # Claude as decision-maker (provider + prompt + budget)
    ├── spec.ts              # canonical-JSON spec hash + POST /api/spec
    ├── submit.ts            # build + sign + send create_job
    ├── watch.ts             # poll /api/jobs/[pda] until terminal
    ├── confirm.ts           # build + sign + send confirm_completion
    ├── download.ts          # fetch IPFS CID → save PNG to ./out/
    └── format.ts            # ANSI color helpers for the CLI output
```

Reuses the Codama-generated client (copied from `packages/web/`) under `src/generated/apis-program/`. Run `pnpm codama:generate` in `packages/web` and re-copy after any IDL change.

## CLI

```
pnpm --filter agent buy "<task>" [options]

  --budget <usdc>         hard cap (default: 0.01)
  --skip-claude           skip Claude; pick cheapest provider, raw prompt
  --model <model>         override Claude model (default: claude-sonnet-4-5)
  --dry-run               plan but don't submit
  --bootstrap-wallet      create the agent keypair + exit
  -h, --help              this output
```

## What Claude returns

The decision step asks Claude for one JSON object:

```json
{
  "provider_pda": "<base58 Solana address>",
  "refined_prompt": "<string under 256 chars>",
  "max_price_usdc_base": "<u64 as decimal string>",
  "reasoning": "<one or two sentences>"
}
```

The CLI validates:
- `provider_pda` is in the catalog Claude was shown (rejects hallucinations).
- `max_price_usdc_base` is ≤ the user's `--budget` cap (clamps if Claude overshoots).
- `refined_prompt` is truncated to 256 chars (Flux Schnell limit).

If anything fails validation, `decideDeterministic()` falls back to picking the fastest in-budget provider with the raw user task as the prompt.

## What's next 

This is the direct-Solana version of the agent. The full MCP + x402 plan is:

1. **`packages/mcp`** — Hono + `@modelcontextprotocol/sdk` MCP server, four tools: `list_providers`, `quote_inference`, `submit_job`, `get_status`. Deployed on Fly.io.
2. **x402 paywall** on `submit_job`: first call → HTTP 402 with payment requirements; agent retries with `X-Payment` header carrying an SPL USDC transfer signature; server verifies via the Coinbase facilitator (or a self-rolled verifier) before executing the actual on-chain `create_job` from its hot wallet.
3. **Atlas-7 rewired** to use the MCP tools instead of direct Solana — same Claude, same flow, but now through the protocol layer that any MCP-compatible agent (Claude Desktop, ElizaOS, agent frameworks) can plug into.


