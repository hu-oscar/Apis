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
4. **Environment Variables** — leave blank for now; we'll add them in
   step 2 after wiring up Upstash.
5. Click **Deploy**.

The first deploy will succeed but `/api/spec`, `/api/results`, and
`/api/jobs/[pda]` will fall back to `/tmp/apis_kv/*` writes that don't
persist between serverless invocations. The home + `/network` pages work
fine without KV.

## 2. Add Upstash KV

1. In your Vercel project → **Storage** tab → **Browse Marketplace** →
   **Upstash** → **Create**.
2. Pick **Redis**, free tier, region = closest to where you run the
   worker (probably `us-east-1`).
3. Vercel auto-wires `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` into the project as env vars.
4. Trigger a new deploy (Vercel does this automatically on env var
   change) and the side-channels are live.

## 3. Point the worker at the deployed API

The worker (running on your Mac) now needs to GET specs and POST results
against the deployed Vercel URL instead of `/tmp/`. Add to
`packages/worker/.env`:

```
APIS_API_BASE=https://apis-mvp.vercel.app
```

(Use your actual Vercel URL — Vercel gives you `*.vercel.app` by
default; configure a custom subdomain via the **Settings → Domains** tab
if desired.)

Restart the worker:

```bash
set -a && source .env && set +a && \
  HF_HUB_ENABLE_HF_TRANSFER=1 .venv/bin/python -m apis_worker
```

The worker now talks to KV via the deployed API for both directions of
the side-channel.

## 4. Verify

- Open the Vercel URL → home page renders, network stats populate.
- Open `/network` → registered providers + open jobs visible.
- Open `/submit`, connect Phantom (devnet), submit a job — Phantom
  approval, page redirects to `/job/<pda>`, status flips Funded →
  Started → Completed → settled.
- Check the Upstash dashboard → you should see `spec:<hash>` and
  `result:<pda>` keys appear as you exercise the flow.

## Local dev

The KV client falls back to `/tmp/apis_kv/` when both
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are unset, so
`pnpm --filter web dev` runs without any extra setup. Pair it with
`python -m apis_worker` (without `APIS_API_BASE` set) for full local
e2e.
