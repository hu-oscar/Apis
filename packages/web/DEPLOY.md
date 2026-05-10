# Deploying the Apis web app to Vercel

Hackathon-grade runbook. Get from `git push` to a public URL in ~5 minutes.

## 1. Import the repo on Vercel

1. Go to <https://vercel.com/new> (sign in with GitHub).
2. **Import Git Repository** → pick `hu-oscar/Apis`.
3. **Configure Project**:
   - **Root Directory**: `packages/web`
   - **Framework Preset**: Next.js (auto-detected)
   - **Install / Build commands**: leave blank — `vercel.json` already
     points them at the workspace root.
4. Skip env vars for now — we'll add them in step 2.
5. Click **Deploy**.

The first deploy will succeed but `/api/spec`, `/api/results`,
`/api/jobs/[pda]`, and `/api/faucet` will return errors because
`PINATA_JWT` and `APIS_DEPLOYER_KEYPAIR` aren't set yet. The home and
`/network` pages work fine — they only read from devnet RPC.

## 2. Set the environment variables

We use **Pinata as the side-channel backend** (no Upstash, no separate
DB — see `app/lib/pinata-store.ts`). Just two env vars to add.

In your Vercel project → **Settings → Environment Variables**:

| Name | Value | Apply to |
|---|---|---|
| `PINATA_JWT` | The same JWT you put in `packages/worker/.env`. Get one at <https://app.pinata.cloud/developers/api-keys> with **Files: Write** scope. | All (Production, Preview, Development) |
| `APIS_DEPLOYER_KEYPAIR` | Output of `cat ~/.config/solana/id.json` — the entire `[223,16,…]` 64-element JSON array. Used by `/api/faucet` to mint test USDC. | Production, Preview |

After saving, go to **Deployments** → top-right `…` on the latest →
**Redeploy** (env-var changes only apply to new builds).

## 3. Point the worker at the deployed API

The worker (running on your Mac) now needs to GET specs from + POST
results to the deployed Vercel API instead of `/tmp/`. Add to
`packages/worker/.env`:

```
APIS_API_BASE=https://apis-web-<your-hash>.vercel.app
```

(Use the actual URL Vercel gave you. Custom subdomain via **Settings →
Domains** if desired.)

Restart the worker:

```bash
cd packages/worker
set -a && source .env && set +a && \
  HF_HUB_ENABLE_HF_TRANSFER=1 .venv/bin/python -m apis_worker
```

The worker now talks to the deployed API for both directions of the
side-channel; the Vercel routes in turn read/write Pinata under the
hood.

## 4. Verify

- Open the Vercel URL → home page renders, network stats populate from
  devnet RPC.
- Open `/network` → registered providers + open jobs visible.
- Open `/submit`, connect Phantom (devnet). If your wallet has 0 test
  USDC, click **Get 10 USDC** → tx lands → balance updates.
- Submit a job → Phantom approval → page redirects to `/job/<pda>` →
  status flips Funded → Started → Completed → settled.
- Check the Pinata dashboard → you should see new pinned files named
  `spec:<hash>` and `result:<pda>` appear as you exercise the flow.

## Local dev

The KV layer falls back to `/tmp/apis_kv/` when `PINATA_JWT` is unset,
so `pnpm --filter web dev` runs without configuring Pinata. Pair it
with `python -m apis_worker` (without `APIS_API_BASE` set) for full
local e2e — worker and web share `/tmp/apis_specs/` and
`/tmp/apis_results/` as before.

For dev *with* Pinata enabled (closer to prod): create a
`packages/web/.env.local` with `PINATA_JWT=...` set. The Pinata path is
exercised on every request.

## Notes on the Pinata-as-KV trade-off

- **Latency**: ~200–500 ms per get/set. Fine for the 3-second poll
  cadence on `/job/[id]`; not fine for hot paths.
- **Privacy**: pinned files are world-readable on IPFS. Devnet test
  prompts are not sensitive, so this is acceptable for the hackathon
  but a real privacy regression for production.
- **Rate-limit**: the faucet uses an on-chain balance check instead of
  an external rate-limit DB — if the recipient already holds ≥ 10 test
  USDC, it refuses. Slightly weaker than a 24h time lock but doesn't
  need any persistent store.
