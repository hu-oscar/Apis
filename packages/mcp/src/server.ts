// Apis MCP server — Sprint 4.1+4.2+4.3.
//
// Registers four tools that agents call over MCP:
//
//   list_providers     — read-only, GET-shaped. No payment.
//   quote_inference    — read-only. Computes the per-job price + ETA
//                        for a specific provider + spec. No payment.
//   submit_job         — paywalled in 4.4 (today: open). Builds the
//                        spec, server-side signs create_job, USDC
//                        moves from the server's hot wallet → escrow.
//   get_status         — read-only. Polls /api/jobs/[pda] and returns
//                        the merged on-chain + KV view. Once result
//                        is available, automatically signs
//                        confirm_completion + reports the IPFS CID.
//
// MCP tool inputs are zod-validated. Outputs are stringified JSON
// inside MCP `content` blocks — that's how Claude sees them.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ProviderStatus } from "./generated/apis-program/src/generated/types/providerStatus.js";
import { fetchProviders, type ProviderRow } from "./lib/network.js";
import {
  APIS_API_BASE,
  USDC_DECIMALS,
  USDC_MINT,
  explorerTxUrl,
  formatUsdc,
} from "./lib/rpc.js";
import { buildSpec, postSpec, specHashHex, type JobSpec } from "./lib/spec.js";
import {
  createJobAsServer,
  confirmCompletionAsServer,
} from "./lib/onchain.js";
import { loadServerWallet, type ServerWallet } from "./lib/server-wallet.js";
import { deriveUsdcAta, verifyPayment } from "./lib/payment.js";
import type { Address, Signature } from "@solana/kit";

/** Singleton — initialized on server boot, reused across requests. */
let serverWallet: ServerWallet | null = null;
let serverUsdcAta: Address | null = null;

async function getServerWallet(): Promise<ServerWallet> {
  if (!serverWallet) serverWallet = await loadServerWallet();
  return serverWallet;
}

async function getServerUsdcAta(): Promise<Address> {
  if (!serverUsdcAta) {
    const w = await getServerWallet();
    serverUsdcAta = await deriveUsdcAta(w.address);
  }
  return serverUsdcAta;
}

/** Cached jobs we've signed create_job for, keyed by job PDA. Used
 *  by get_status to auto-trigger confirm_completion when the worker
 *  reports a result — the server stays in the loop for the full
 *  lifecycle. Volatile (in-memory); a restart loses pending state. */
const pendingJobs = new Map<
  string,
  { providerPda: Address; submittedAt: number }
>();

/** Outstanding quotes — `payment_id` → {spec, provider, price}. The
 *  agent must pay the exact `price` USDC to the server's ATA with
 *  `payment_id` as the SPL memo before calling submit_job. Quotes
 *  expire after QUOTE_TTL_MS to bound replay risk. Volatile —
 *  Phase 2 swap for Redis. */
const QUOTE_TTL_MS = 5 * 60 * 1000;

type Quote = {
  paymentId: string;
  providerPda: Address;
  spec: JobSpec;
  priceUsdcBase: bigint;
  expiresAt: number;
};

const quoteStore = new Map<string, Quote>();

function pruneExpiredQuotes(): void {
  const now = Date.now();
  for (const [id, q] of quoteStore) {
    if (q.expiresAt < now) quoteStore.delete(id);
  }
}

export function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: "apis-mcp",
    version: "0.4.0",
  });

  // ── list_providers ───────────────────────────────────────────────
  server.registerTool(
    "list_providers",
    {
      title: "List active Apis providers",
      description:
        "Returns the live catalog of GPU providers on the Apis marketplace, " +
        "sorted by speed (fastest first). Each provider has its hardware specs " +
        "(chip, RAM, Flux Schnell seconds/image, suggested per-job price) " +
        "cryptographically attested via signed liveness heartbeats. Use this " +
        "before calling quote_inference / submit_job.",
      inputSchema: {
        only_online: z
          .boolean()
          .optional()
          .describe(
            "Filter to providers whose heartbeat is fresh (< 90 s old). Default: true.",
          ),
        max_price_usdc: z
          .number()
          .optional()
          .describe(
            "Hide providers whose suggested per-job price exceeds this. USDC, not base units.",
          ),
      },
    },
    async (input) => {
      const onlyOnline = input.only_online ?? true;
      const maxPriceUsdcBase =
        input.max_price_usdc != null
          ? BigInt(Math.round(input.max_price_usdc * 10 ** USDC_DECIMALS))
          : null;
      const providers = await fetchProviders();
      const filtered = providers.filter((p) => {
        if (onlyOnline && !p.online) return false;
        if (p.status !== ProviderStatus.Active) return false;
        if (
          maxPriceUsdcBase != null &&
          p.suggestedPriceUsdcBase != null &&
          p.suggestedPriceUsdcBase > maxPriceUsdcBase
        ) {
          return false;
        }
        return true;
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { providers: filtered.map(providerSummary) },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ── quote_inference ──────────────────────────────────────────────
  server.registerTool(
    "quote_inference",
    {
      title: "Quote a Flux Schnell job",
      description:
        "Given a provider PDA + prompt + dimensions, returns the price, " +
        "estimated wall-clock time, deadline window, and the spec hash that " +
        "submit_job will use. Does NOT submit anything on-chain. Call this " +
        "to decide whether to proceed; then call submit_job with the same args.",
      inputSchema: {
        provider_pda: z.string().describe("Base58 Provider PDA from list_providers."),
        prompt: z
          .string()
          .max(256)
          .describe("Flux Schnell text prompt. ≤ 256 chars."),
        width: z.number().int().optional().describe("Default: 1024."),
        height: z.number().int().optional().describe("Default: 1024."),
        seed: z
          .number()
          .int()
          .optional()
          .describe("Random by default. Pass to reproduce deterministic outputs."),
      },
    },
    async (input) => {
      const providers = await fetchProviders();
      const provider = providers.find((p) => p.pda === input.provider_pda);
      if (!provider) {
        return errorContent(
          `unknown provider PDA ${input.provider_pda}. Call list_providers first.`,
        );
      }
      if (!provider.online) {
        return errorContent(
          `provider ${input.provider_pda} is offline (no heartbeat in last 90s).`,
        );
      }
      const spec = buildSpec(input.prompt, {
        width: input.width ?? 1024,
        height: input.height ?? 1024,
        ...(input.seed != null ? { seed: input.seed } : {}),
      });
      const priceBase =
        provider.suggestedPriceUsdcBase ??
        // Fallback if provider hasn't run a benchmark: minimum 0.001 USDC.
        1_000n;

      // Issue a one-shot payment quote — the agent must pay this
      // exact amount to the server's USDC ATA with `payment_id` as
      // memo before submit_job will accept the request. This is the
      // x402 paywall (Sprint 4.4).
      pruneExpiredQuotes();
      const paymentId = `apis-${randomUUID()}`;
      const expiresAt = Date.now() + QUOTE_TTL_MS;
      quoteStore.set(paymentId, {
        paymentId,
        providerPda: provider.pda,
        spec,
        priceUsdcBase: priceBase,
        expiresAt,
      });
      const wallet = await getServerWallet();
      const recipientAta = await getServerUsdcAta();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                provider_pda: provider.pda,
                price_usdc_base: priceBase.toString(),
                price_usdc: formatUsdc(priceBase),
                estimated_seconds: provider.secondsPerImage,
                spec_hash_hex: specHashHex(spec),
                job_deadline_seconds: 600,
                payment: {
                  payment_id: paymentId,
                  pay_to_owner: wallet.address,
                  pay_to_ata: recipientAta,
                  pay_mint: USDC_MINT,
                  pay_amount_usdc_base: priceBase.toString(),
                  pay_amount_usdc: formatUsdc(priceBase),
                  pay_memo: paymentId,
                  expires_at_unix_ms: expiresAt,
                  instructions:
                    "Submit a Solana tx that (1) SPL-transfers " +
                    formatUsdc(priceBase) +
                    " USDC from your ATA to pay_to_ata + (2) attaches a memo instruction whose text equals pay_memo. Pass the resulting tx signature back to submit_job as `payment_signature`.",
                },
                explorer_provider: `https://explorer.solana.com/address/${provider.pda}?cluster=devnet`,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ── submit_job (x402-paywalled) ──────────────────────────────────
  server.registerTool(
    "submit_job",
    {
      title: "Submit a Flux Schnell job (requires x402 payment)",
      description:
        "Submits a job for execution. REQUIRES a payment receipt: first " +
        "call quote_inference to get a `payment_id` + payment details, " +
        "then sign + send an SPL USDC transfer to the server's ATA " +
        "(memo = payment_id), then pass that tx signature here as " +
        "`payment_signature`. The server verifies the transfer on chain " +
        "before signing create_job from its hot wallet. USDC then moves " +
        "into the on-chain escrow vault and the worker picks the job up.",
      inputSchema: {
        payment_id: z
          .string()
          .describe(
            "The payment_id returned by quote_inference. Identifies which quote you're paying for.",
          ),
        payment_signature: z
          .string()
          .describe(
            "Signature of the Solana tx that (a) SPL-transferred the quoted USDC amount to the server's ATA and (b) attached a memo equal to payment_id.",
          ),
      },
    },
    async (input) => {
      pruneExpiredQuotes();
      const quote = quoteStore.get(input.payment_id);
      if (!quote) {
        return errorContent(
          `unknown or expired payment_id ${input.payment_id}. Call quote_inference again.`,
        );
      }
      // One-shot use — remove now to prevent double-spend even if the
      // verification path throws later.
      quoteStore.delete(input.payment_id);

      const recipientAta = await getServerUsdcAta();
      const verifyResult = await verifyPayment({
        paymentSignature: input.payment_signature as Signature,
        expectedRecipientAta: recipientAta,
        expectedAmountBase: quote.priceUsdcBase,
        expectedMemo: input.payment_id,
      });
      if (!verifyResult.ok) {
        return errorContent(`payment verification failed: ${verifyResult.reason}`);
      }

      // Payment verified — execute the actual on-chain submission.
      // The agent paid the server; the server now pays escrow.
      await postSpec(quote.spec);

      const wallet = await getServerWallet();
      let job;
      try {
        job = await createJobAsServer({
          serverSigner: wallet.signer,
          providerPda: quote.providerPda,
          spec: quote.spec,
          priceLamportsUsdc: quote.priceUsdcBase,
        });
      } catch (err) {
        // create_job failed AFTER the agent paid. This is a refund
        // situation. For hackathon scope, surface the error + the
        // agent's payment signature so it can be tracked manually.
        // Phase 2 needs an automated refund path.
        return errorContent(
          `create_job failed after payment verified: ${
            err instanceof Error ? err.message : err
          }. Your payment tx ${input.payment_signature} is recoverable — contact the operator.`,
        );
      }

      pendingJobs.set(job.jobPda, {
        providerPda: quote.providerPda,
        submittedAt: Date.now(),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                job_pda: job.jobPda,
                create_job_signature: job.signature,
                explorer_url: explorerTxUrl(job.signature),
                price_paid_usdc_base: quote.priceUsdcBase.toString(),
                price_paid_usdc: formatUsdc(quote.priceUsdcBase),
                payment_payer: verifyResult.payerAddress,
                spec_hash_hex: Array.from(job.specHash, (b) =>
                  b.toString(16).padStart(2, "0"),
                ).join(""),
                next: "Call get_status with this job_pda to monitor + auto-settle.",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ── get_status ───────────────────────────────────────────────────
  server.registerTool(
    "get_status",
    {
      title: "Check job status (and auto-settle when Completed)",
      description:
        "Returns the merged on-chain + KV view of a job. If the job is in " +
        "Completed state and the result CID is available, the server signs " +
        "confirm_completion automatically — releasing USDC from escrow to " +
        "the provider — and includes the settlement tx + IPFS URL in the " +
        "response. Idempotent: safe to poll repeatedly.",
      inputSchema: {
        job_pda: z.string().describe("Job PDA returned by submit_job."),
      },
    },
    async (input) => {
      const r = await fetch(`${APIS_API_BASE}/api/jobs/${input.job_pda}`);
      if (!r.ok) {
        return errorContent(`GET /api/jobs/${input.job_pda} returned ${r.status}`);
      }
      type Resp = {
        onChain: {
          statusName: string;
          deadline: number;
          providerAuthority: string | null;
        } | null;
        result: { cid: string; proof_hash_hex: string; completed_at: number } | null;
        settled: boolean;
      };
      const body = (await r.json()) as Resp;

      const settled = body.settled;
      const status = settled
        ? "Settled"
        : (body.onChain?.statusName ?? "Unknown");
      const resultCid = body.result?.cid ?? null;

      let settlementTx: string | null = null;
      let ipfsUrl: string | null = null;

      // Auto-settle: if Completed + we signed create_job for this job
      // earlier, sign confirm_completion now.
      if (
        status === "Completed" &&
        resultCid &&
        body.onChain?.providerAuthority &&
        pendingJobs.has(input.job_pda)
      ) {
        try {
          const wallet = await getServerWallet();
          const sig = await confirmCompletionAsServer({
            serverSigner: wallet.signer,
            jobPda: input.job_pda as Address,
            providerPda: pendingJobs.get(input.job_pda)!.providerPda,
            providerAuthority: body.onChain.providerAuthority as Address,
          });
          settlementTx = sig;
          pendingJobs.delete(input.job_pda);
        } catch (err) {
          // Best-effort: report status, log the error.
          // eslint-disable-next-line no-console
          console.error("confirm_completion failed:", err);
        }
      }

      if (resultCid) {
        ipfsUrl = `https://gateway.pinata.cloud/ipfs/${resultCid}`;
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                job_pda: input.job_pda,
                status,
                settled,
                deadline_unix_sec: body.onChain?.deadline ?? null,
                result: resultCid
                  ? {
                      cid: resultCid,
                      ipfs_url: ipfsUrl,
                      proof_hash_hex: body.result?.proof_hash_hex ?? null,
                      completed_at_unix_sec: body.result?.completed_at ?? null,
                    }
                  : null,
                settlement: settlementTx
                  ? {
                      signature: settlementTx,
                      explorer_url: explorerTxUrl(settlementTx),
                    }
                  : null,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  return server;
}

// ── helpers ────────────────────────────────────────────────────────

function providerSummary(p: ProviderRow): Record<string, unknown> {
  return {
    pda: p.pda,
    authority: p.authority,
    chip: p.chip,
    ram_gb: p.ramGb,
    cpu_cores: p.cpuCores,
    seconds_per_image: p.secondsPerImage,
    suggested_price_usdc_base:
      p.suggestedPriceUsdcBase != null
        ? p.suggestedPriceUsdcBase.toString()
        : null,
    suggested_price_usdc:
      p.suggestedPriceUsdcBase != null
        ? formatUsdc(p.suggestedPriceUsdcBase)
        : null,
    online: p.online,
    age_seconds: p.ageMs != null ? Math.round(p.ageMs / 1000) : null,
    total_jobs_served: p.totalJobs,
    active_jobs: p.activeJobs,
    explorer_url: `https://explorer.solana.com/address/${p.pda}?cluster=devnet`,
  };
}

function errorContent(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
  };
}
