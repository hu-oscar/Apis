#!/usr/bin/env node
// Apis agent buyer CLI — Sprint 4.0g.
//
// Usage:
//   pnpm --filter agent buy "a cyberpunk cat hacker, neon rain"
//   pnpm --filter agent buy "..." --budget 0.01 --skip-claude
//   pnpm --filter agent buy --bootstrap-wallet
//
// Full end-to-end:
//   1. Load (or generate) the agent keypair.
//   2. Browse /network for online providers.
//   3. Ask Claude (or fallback) which provider + refined prompt.
//   4. POST spec to /api/spec.
//   5. Sign + send create_job (USDC moves to escrow).
//   6. Poll /api/jobs/[pda] until Completed.
//   7. Sign + send confirm_completion (provider gets paid).
//   8. Download the result PNG to ./out/.
//
// Designed to read like a story when it runs — every step prints
// what it's about to do, then what it learned. The transcript is
// the demo.

import { loadAgentWallet, bootstrapAgentWallet } from "./lib/wallet.js";
import { fetchProviders, type ProviderRow } from "./lib/network.js";
import {
  decideWithClaude,
  decideDeterministic,
  type Decision,
  type DecisionInput,
} from "./lib/decide.js";
import { buildSpec, postSpec } from "./lib/spec.js";
import { createJob } from "./lib/submit.js";
import { watchJob } from "./lib/watch.js";
import { confirmCompletion } from "./lib/confirm.js";
import { downloadResult } from "./lib/download.js";
import { formatUsdc, explorerTxUrl, APIS_API_BASE } from "./lib/rpc.js";
import { c, step, indent, rule, formatElapsed } from "./lib/format.js";
import { ApisMcpClient, type McpProviderRow } from "./lib/mcp-client.js";
import { payQuote } from "./lib/payment-tx.js";
import type { Address } from "@solana/kit";
import type { Signature } from "@solana/kit";

type CliArgs = {
  task: string | null;
  budgetUsdc: number;
  skipClaude: boolean;
  bootstrapWallet: boolean;
  model: string;
  dryRun: boolean;
  mcpUrl: string | null;
};

function parseArgs(argv: string[]): CliArgs {
  // Skip first 2 (node + script path) when called via tsx.
  const args = argv.slice(2);
  const out: CliArgs = {
    task: null,
    budgetUsdc: 0.01,
    skipClaude: false,
    bootstrapWallet: false,
    model: "claude-sonnet-4-5",
    dryRun: false,
    mcpUrl: null,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--budget") {
      const next = args[++i];
      if (!next) throw new Error("--budget needs a value (USDC, e.g. 0.01)");
      out.budgetUsdc = parseFloat(next);
    } else if (a === "--skip-claude") {
      out.skipClaude = true;
    } else if (a === "--bootstrap-wallet") {
      out.bootstrapWallet = true;
    } else if (a === "--model") {
      const next = args[++i];
      if (!next) throw new Error("--model needs a value");
      out.model = next;
    } else if (a === "--dry-run") {
      out.dryRun = true;
    } else if (a === "--mcp") {
      const next = args[++i];
      if (!next) throw new Error("--mcp needs a URL (e.g. http://localhost:3030/mcp)");
      out.mcpUrl = next;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a && !a.startsWith("--") && out.task === null) {
      out.task = a;
    } else if (a) {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  return out;
}

function printHelp(): void {
  console.log(`
${c.bold("Apis agent")} — autonomous Claude buyer on Solana devnet

${c.bold("usage:")}
  pnpm --filter agent buy "<task description>" [options]

${c.bold("options:")}
  --budget <usdc>         Hard cap on what the agent will pay (default: 0.01).
  --skip-claude           Skip the Claude call; pick the cheapest provider
                          + use the raw task as the prompt.
  --model <model>         Anthropic model (default: claude-sonnet-4-5).
                          Try "claude-opus-4-5" for demo recordings.
  --dry-run               Plan everything but don't submit any tx.
  --mcp <url>             Run through the Apis MCP server (x402-paywalled)
                          instead of signing create_job + confirm_completion
                          directly. Agent only signs the USDC payment.
                          Default: direct Solana. Env: APIS_MCP_URL.
  --bootstrap-wallet      Generate ~/.config/apis/agent.json and exit.
                          Fund the printed pubkey before running again.
  -h, --help              Show this.

${c.bold("env:")}
  ANTHROPIC_API_KEY       Required unless --skip-claude.
  APIS_AGENT_KEYPAIR      Override the default keypair path.
  APIS_API_BASE           Override the marketplace API base
                          (default: https://apis-web-five.vercel.app).
  APIS_MCP_URL            Run over MCP (same as --mcp flag).

${c.bold("example:")}
  pnpm --filter agent buy "a samurai cat in cyberpunk Tokyo" --budget 0.005
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  // Auto-pick MCP mode if APIS_MCP_URL is set in the env or passed
  // on the command line. Direct-Solana stays the fallback.
  const mcpUrl = args.mcpUrl ?? process.env.APIS_MCP_URL ?? null;

  if (args.bootstrapWallet) {
    const { address, path } = await bootstrapAgentWallet();
    console.log(`${c.green("✓")} generated agent keypair at ${path}`);
    console.log(`  pubkey: ${c.bold(address)}`);
    console.log(`\nFund it on devnet (~0.05 SOL for tx fees + some test USDC):`);
    console.log(c.dim(`  solana airdrop 1 ${address} --url devnet`));
    console.log(
      c.dim(`  cd packages/worker && .venv/bin/python scripts/bootstrap_devnet.py --fund ${address} --amount 10`),
    );
    return;
  }

  if (!args.task) {
    console.error(c.red("error: missing task description"));
    console.error("run with --help for usage.");
    process.exit(2);
  }

  const started = Date.now();
  const budgetUsdcBase = BigInt(Math.round(args.budgetUsdc * 1_000_000));

  console.log(`${c.violet("🤖")} ${c.bold("atlas-7")} · ${c.dim("apis-agent / sonnet-4.5")}`);
  if (mcpUrl) {
    console.log(`   ${c.dim("mcp:")} ${mcpUrl}`);
  } else {
    console.log(`   ${c.dim("api:")} ${APIS_API_BASE} ${c.dim("(direct Solana — no MCP)")}`);
  }

  // 1. Wallet
  const wallet = await loadAgentWallet();
  console.log(
    `   ${c.dim("wallet:")} ${c.bold(wallet.address)} ${c.dim(
      `(keypair: ${wallet.path})`,
    )}`,
  );
  console.log();

  if (mcpUrl) {
    await runOverMcp({
      mcpUrl,
      task: args.task,
      wallet,
      budgetUsdcBase,
      skipClaude: args.skipClaude,
      model: args.model,
      dryRun: args.dryRun,
      started,
    });
    return;
  }

  // ── Direct-Solana mode (fallback) ────────────────────────────────
  // 2. Browse network
  console.log(step(1, 5, "Browsing /network for online providers…"));
  const providers = await fetchProviders();
  const online = providers.filter((p) => p.online);
  if (online.length === 0) {
    console.error(c.red(indent("✗ no online providers — abort.")));
    console.error(
      indent(
        c.dim(
          "Bring up a provider via `pnpm --filter apis-provider tauri dev` and try again.",
        ),
      ),
    );
    process.exit(3);
  }
  for (const p of online.slice(0, 5)) {
    const speed =
      p.secondsPerImage != null ? `${p.secondsPerImage.toFixed(2)}s/img` : "speed —";
    const price =
      p.suggestedPriceUsdcBase != null
        ? `${formatUsdc(p.suggestedPriceUsdcBase)} USDC`
        : "no price";
    console.log(
      indent(
        `• ${c.bold(p.pda.slice(0, 16) + "…")} — ${
          p.chip ?? "unknown"
        } · ${speed} · ${price}`,
      ),
    );
  }
  console.log();

  // 3. Decide
  console.log(
    step(2, 5, args.skipClaude ? "Picking provider (deterministic)…" : `Asking Claude (${args.model})…`),
  );
  const decision = args.skipClaude
    ? decideDeterministic({
        task: args.task,
        providers,
        budgetUsdcBase,
      })
    : await decideWithClaude({
        task: args.task,
        providers,
        budgetUsdcBase,
        model: args.model,
      });
  console.log(indent(`provider: ${c.bold(decision.providerPda)}`));
  console.log(indent(`prompt:   ${c.dim('"')}${decision.refinedPrompt}${c.dim('"')}`));
  console.log(
    indent(
      `budget:   ${c.green(formatUsdc(decision.maxPriceUsdcBase) + " USDC")} (cap: ${formatUsdc(
        budgetUsdcBase,
      )} USDC)`,
    ),
  );
  console.log(indent(c.dim(`reasoning: ${decision.reasoning}`)));
  console.log();

  if (args.dryRun) {
    console.log(c.yellow("--dry-run set; skipping on-chain submission."));
    return;
  }

  // 4. POST spec + create_job
  console.log(step(3, 5, "Submitting job (spec POST + create_job tx)…"));
  const spec = buildSpec(decision.refinedPrompt);
  const specHashHex = await postSpec(spec);
  console.log(indent(`spec POSTed   · hash ${c.dim(specHashHex.slice(0, 16) + "…")}`));

  const jobResult = await createJob({
    buyer: wallet.signer,
    providerPda: decision.providerPda,
    spec,
    priceLamportsUsdc: decision.maxPriceUsdcBase,
  });
  console.log(
    indent(
      `create_job ✓ · job ${c.bold(jobResult.jobPda)} · tx ${c.dim(jobResult.signature.slice(0, 12) + "…")}`,
    ),
  );
  console.log(indent(c.dim(explorerTxUrl(jobResult.signature))));
  console.log();

  // 5. Wait for completion
  console.log(step(4, 5, "Waiting for the worker…"));
  const finalSnap = await watchJob(jobResult.jobPda, {
    onTransition: (s, prev) => {
      if (prev === null) {
        console.log(indent(`status: ${c.bold(s.status)}`));
      } else if (s.status !== prev.status) {
        console.log(indent(`${c.dim(prev.status)} → ${c.bold(s.status)}`));
      }
    },
  });

  if (finalSnap.status !== "Completed") {
    console.error(
      c.red(indent(`✗ job ended in non-Completed state: ${finalSnap.status}`)),
    );
    process.exit(4);
  }
  if (!finalSnap.providerAuthority) {
    console.error(c.red(indent("✗ provider authority missing from API response")));
    process.exit(5);
  }
  if (!finalSnap.resultCid) {
    console.error(c.red(indent("✗ no result CID returned by worker")));
    process.exit(6);
  }
  console.log(
    indent(`✓ completed · CID ${c.dim(finalSnap.resultCid.slice(0, 16) + "…")}`),
  );
  console.log();

  // 6. confirm_completion + download
  console.log(step(5, 5, "Settling + downloading result…"));
  const confirmSig = await confirmCompletion({
    buyer: wallet.signer,
    jobPda: jobResult.jobPda,
    providerPda: decision.providerPda,
    providerAuthority: finalSnap.providerAuthority as Address,
  });
  console.log(
    indent(
      `confirm_completion ✓ · tx ${c.dim(confirmSig.slice(0, 12) + "…")}`,
    ),
  );
  console.log(indent(c.dim(explorerTxUrl(confirmSig))));

  const dl = await downloadResult(finalSnap.resultCid);
  console.log(indent(`image saved → ${c.bold(dl.localPath)} ${c.dim(`(${dl.bytes} bytes)`)}`));

  // Summary
  console.log();
  console.log(rule());
  console.log(
    `${c.green("✓")} done in ${c.bold(formatElapsed(Date.now() - started))} · paid ${c.green(
      formatUsdc(decision.maxPriceUsdcBase) + " USDC",
    )}`,
  );
  console.log(`  ${c.dim("ipfs:")}  ${dl.ipfsUrl}`);
  console.log(`  ${c.dim("tx:")}    ${explorerTxUrl(jobResult.signature)}`);
  console.log(`  ${c.dim("tx:")}    ${explorerTxUrl(confirmSig)}`);
}

// ── MCP mode ─────────────────────────────────────────────────────────
//
// When APIS_MCP_URL is set, the agent talks through the Apis MCP
// server instead of signing on-chain instructions directly. Only one
// Solana tx is signed by the agent — the USDC payment for the x402
// paywall. The MCP server signs create_job + confirm_completion on
// the agent's behalf. End result: the agent never touches the
// program directly; it pays via SPL transfer + uses MCP tools.

async function runOverMcp(args: {
  mcpUrl: string;
  task: string;
  wallet: Awaited<ReturnType<typeof loadAgentWallet>>;
  budgetUsdcBase: bigint;
  skipClaude: boolean;
  model: string;
  dryRun: boolean;
  started: number;
}): Promise<void> {
  console.log(step(1, 5, "Connecting to MCP + listing providers…"));
  const mcp = await ApisMcpClient.connect(args.mcpUrl);
  let providers: McpProviderRow[];
  try {
    providers = await mcp.listProviders({ onlyOnline: true });
  } catch (err) {
    await mcp.close();
    throw err;
  }
  const online = providers.filter((p) => p.online);
  if (online.length === 0) {
    await mcp.close();
    console.error(c.red(indent("✗ no online providers — abort.")));
    process.exit(3);
  }
  for (const p of online.slice(0, 5)) {
    const speed =
      p.seconds_per_image != null
        ? `${p.seconds_per_image.toFixed(2)}s/img`
        : "speed —";
    const price = p.suggested_price_usdc ?? "no price";
    console.log(
      indent(
        `• ${c.bold(p.pda.slice(0, 16) + "…")} — ${
          p.chip ?? "unknown"
        } · ${speed} · ${price === "no price" ? price : price + " USDC"}`,
      ),
    );
  }
  console.log();

  // Decide via Claude — convert MCP rows back to the agent's
  // ProviderRow shape since the Claude prompt template was written
  // against that. Pure structural shim, no semantic change.
  const adapted = online.map(mcpRowToProviderRow);
  console.log(
    step(
      2,
      5,
      args.skipClaude
        ? "Picking provider (deterministic)…"
        : `Asking Claude (${args.model})…`,
    ),
  );
  const decisionInput: DecisionInput = {
    task: args.task,
    providers: adapted,
    budgetUsdcBase: args.budgetUsdcBase,
    model: args.model,
  };
  const decision: Decision = args.skipClaude
    ? decideDeterministic(decisionInput)
    : await decideWithClaude(decisionInput);
  console.log(indent(`provider: ${c.bold(decision.providerPda)}`));
  console.log(
    indent(`prompt:   ${c.dim('"')}${decision.refinedPrompt}${c.dim('"')}`),
  );
  console.log(
    indent(
      `budget:   ${c.green(formatUsdc(decision.maxPriceUsdcBase) + " USDC")} (cap: ${formatUsdc(args.budgetUsdcBase)} USDC)`,
    ),
  );
  console.log(indent(c.dim(`reasoning: ${decision.reasoning}`)));
  console.log();

  // Quote — server mints a payment_id + tells us where to pay.
  console.log(step(3, 5, "Requesting MCP quote + paying via x402…"));
  const quote = await mcp.quoteInference({
    providerPda: decision.providerPda,
    prompt: decision.refinedPrompt,
  });
  const priceUsdcBase = BigInt(quote.payment.pay_amount_usdc_base);
  if (priceUsdcBase > decision.maxPriceUsdcBase) {
    await mcp.close();
    console.error(
      c.red(indent(`✗ quote price ${quote.payment.pay_amount_usdc} USDC exceeds budget`)),
    );
    process.exit(4);
  }
  console.log(
    indent(
      `quote ${c.dim("payment_id=" + quote.payment.payment_id.slice(0, 16) + "…")} · ${c.green(quote.payment.pay_amount_usdc + " USDC")} → ${c.dim(quote.payment.pay_to_ata.slice(0, 12) + "…")}`,
    ),
  );

  if (args.dryRun) {
    await mcp.close();
    console.log(c.yellow("--dry-run set; skipping payment + submit."));
    return;
  }

  // Sign + send the USDC payment. THIS is the agent's only Solana tx.
  const paymentSig: Signature = await payQuote({
    agentSigner: args.wallet.signer,
    recipientAta: quote.payment.pay_to_ata as Address,
    amountBase: priceUsdcBase,
    memo: quote.payment.pay_memo,
  });
  console.log(
    indent(
      `x402 payment ✓ · tx ${c.dim(paymentSig.slice(0, 12) + "…")}`,
    ),
  );
  console.log(indent(c.dim(explorerTxUrl(paymentSig))));

  // submit_job — server verifies the payment, then signs create_job.
  const submit = await mcp.submitJob({
    paymentId: quote.payment.payment_id,
    paymentSignature: paymentSig,
  });
  console.log(
    indent(
      `submit_job ✓ · job ${c.bold(submit.job_pda)} · server-signed create_job ${c.dim(submit.create_job_signature.slice(0, 12) + "…")}`,
    ),
  );
  console.log();

  // Poll get_status — server auto-settles when Completed.
  console.log(step(4, 5, "Waiting for the worker (server auto-settles)…"));
  let last = "";
  let status;
  const pollEnd = Date.now() + 10 * 60 * 1000;
  while (Date.now() < pollEnd) {
    status = await mcp.getStatus(submit.job_pda);
    if (status.status !== last) {
      console.log(
        indent(
          last
            ? `${c.dim(last)} → ${c.bold(status.status)}`
            : `status: ${c.bold(status.status)}`,
        ),
      );
      last = status.status;
    }
    if (status.settlement) {
      console.log(
        indent(
          `confirm_completion ✓ · server-signed tx ${c.dim(status.settlement.signature.slice(0, 12) + "…")}`,
        ),
      );
      break;
    }
    if (status.status === "Refunded" || status.status === "Slashed") break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!status || !status.result?.cid) {
    await mcp.close();
    console.error(c.red(indent("✗ job did not complete with a result CID")));
    process.exit(5);
  }
  console.log();

  // Download the result image (last bit done agent-side — IPFS is public).
  console.log(step(5, 5, "Downloading result from IPFS…"));
  const dl = await downloadResult(status.result.cid);
  console.log(
    indent(`image saved → ${c.bold(dl.localPath)} ${c.dim(`(${dl.bytes} bytes)`)}`),
  );

  await mcp.close();

  console.log();
  console.log(rule());
  console.log(
    `${c.green("✓")} done in ${c.bold(formatElapsed(Date.now() - args.started))} · paid ${c.green(quote.payment.pay_amount_usdc + " USDC")} via x402`,
  );
  console.log(`  ${c.dim("ipfs:")}  ${status.result.ipfs_url}`);
  console.log(`  ${c.dim("pay:")}   ${explorerTxUrl(paymentSig)}`);
  console.log(`  ${c.dim("job:")}   ${submit.explorer_url}`);
  if (status.settlement) {
    console.log(`  ${c.dim("settle:")} ${status.settlement.explorer_url}`);
  }
}

/** Convert the MCP wire shape back to the agent's ProviderRow shape
 *  so the existing Claude prompt template + decideDeterministic can
 *  consume it without modification. */
function mcpRowToProviderRow(r: McpProviderRow): ProviderRow {
  return {
    pda: r.pda as Address,
    authority: r.authority as Address,
    activeJobs: r.active_jobs,
    totalJobs: r.total_jobs_served,
    // MCP only surfaces online providers when only_online=true; we
    // assume Active here. The agent never sees Paused/Slashed
    // providers in this flow.
    status: 0,
    online: r.online,
    ageMs: r.age_seconds != null ? r.age_seconds * 1000 : null,
    chip: r.chip,
    ramGb: r.ram_gb,
    cpuCores: r.cpu_cores,
    secondsPerImage: r.seconds_per_image,
    suggestedPriceUsdcBase:
      r.suggested_price_usdc_base != null
        ? safeBigint(r.suggested_price_usdc_base)
        : null,
  };
}

function safeBigint(s: string): bigint | null {
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error();
  console.error(c.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
  if (process.env.DEBUG) {
    console.error(err);
  }
  process.exit(1);
});
