# @apis/mcp — Apis MCP server

Exposes the Apis GPU marketplace to AI agents over MCP (Model Context Protocol) Streamable HTTP transport.

This is the protocol layer of Sprint 4: any MCP-capable agent (Claude Desktop, Claude SDK, MCP Inspector, ElizaOS, agent frameworks) can call into Apis without needing to hold a Solana keypair, sign txs, or understand on-chain mechanics. The MCP server's hot wallet does all the on-chain work on the agent's behalf. The agent will pay the server via **x402** (HTTP 402 + `X-Payment` header) once Sprint 4.4 lands.

## Tools

| Tool | Payment | Description |
|---|---|---|
| `list_providers` | free | Live catalog of online providers with their attested hardware specs (chip, RAM, Flux speed, suggested price). |
| `quote_inference` | free | Given a provider + prompt + dimensions, returns the price, ETA, spec hash. No on-chain ops. |
| `submit_job` | **paid (x402 in 4.4)** | Server-side signs `create_job` from its hot wallet. USDC moves into escrow. Returns `job_pda` + tx signature. |
| `get_status` | free | Polls job state. **Auto-settles** when Completed — signs `confirm_completion` and releases escrow to the provider. |

## Run locally

```bash
# Server keypair — either:
#   (a) file at ~/.config/apis/mcp-server.json (Solana CLI format), or
#   (b) APIS_MCP_SERVER_KEYPAIR_JSON env var (entire 64-element JSON array).
# Funded with ~0.1 SOL (tx fees) + ≥ 5 USDC (job float) on devnet.

pnpm --filter @apis/mcp dev
# → listening on http://0.0.0.0:3030
```

## Test the wire

```bash
# Initialize a session
curl -s -X POST http://localhost:3030/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize",
       "params":{"protocolVersion":"2025-06-18","capabilities":{},
                 "clientInfo":{"name":"curl","version":"0.1"}}}'
# Grab the `mcp-session-id` response header → $SESSION

# Notify initialized
curl -s -X POST http://localhost:3030/mcp \
  -H "content-type: application/json" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# Call list_providers
curl -s -X POST http://localhost:3030/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"list_providers","arguments":{"only_online":true}}}'
```

Or use Anthropic's MCP Inspector for a GUI:

```bash
npx @modelcontextprotocol/inspector http://localhost:3030/mcp
```

## Architecture

```
src/
├── index.ts                    # Express + Streamable HTTP transport + session mgmt
├── server.ts                   # McpServer + 4 tool definitions
├── generated/apis-program/     # Codama-generated TS client (copied from web)
└── lib/
    ├── rpc.ts                  # Constants + RPC client + USDC formatter
    ├── network.ts              # fetchProviders() — getProgramAccounts + heartbeats
    ├── spec.ts                 # Canonical JSON hash + POST /api/spec
    ├── watch.ts                # Polling helper (unused here, kept for symmetry)
    ├── server-wallet.ts        # Load MCP server's hot keypair (file or env)
    └── onchain.ts              # createJobAsServer + confirmCompletionAsServer
```

The server is stateless across processes (sessions live in memory; a restart loses pending-job state). For production this needs a Redis or similar. For hackathon scope: a single Fly.io instance is fine.

## Deployment

See top-level `MEMORY.md` Sprint 4.8 for the Fly.io deploy runbook (coming with v0.4.0).

The deploy must set:

| Env | Required | Notes |
|---|---|---|
| `APIS_MCP_SERVER_KEYPAIR_JSON` | yes | 64-element JSON array. The hot wallet for create_job + confirm_completion. |
| `APIS_API_BASE` | optional | Default: `https://apis-web-five.vercel.app`. |
| `APIS_RPC_URL` | optional | Default: `https://api.devnet.solana.com`. Use Helius / Triton for production. |
| `PORT` | optional | Default: 3030. Fly.io will inject the right value. |

## What's next

- **Sprint 4.4** — x402 paywall middleware on `submit_job`. First call returns HTTP 402 with payment requirements; agent retries with `X-Payment: <SPL-transfer-signature>`; server validates before executing the real on-chain create_job.
- **Sprint 4.5** — Coinbase x402 facilitator integration (with self-rolled verifier as fallback).
- **Sprint 4.6** — auto-`confirm_completion` already lives in `get_status`; will be hardened in 4.6 with retries + error reporting.
- **Sprint 4.7** — rewire Atlas-7 (the agent CLI) to use these MCP tools instead of direct Solana.
- **Sprint 4.8** — Fly.io deploy + demo recording + v0.4.0 tag.
