// Claude as decision-maker — Sprint 4.0f.
//
// The agent's "brain" runs here. Given the user's high-level task
// (e.g. "a cyberpunk cat hacker") + the live provider list, Claude:
//   1. Picks the best provider for the task.
//   2. Refines the prompt for Flux Schnell.
//   3. Sets a max price the agent is willing to pay.
//   4. Explains its reasoning.
//
// We use Anthropic's structured-output / JSON-shape pattern rather
// than tool use — this is the *decision* step, not the *action* step.
// Actions are still done by deterministic Solana code in submit.ts +
// confirm.ts. Sprint 4.7 swaps decision + action into a single tool-
// use loop once the MCP server is live.

import Anthropic from "@anthropic-ai/sdk";
import type { Address } from "@solana/kit";

import type { ProviderRow } from "./network.js";
import { formatUsdc } from "./rpc.js";

export type Decision = {
  providerPda: Address;
  refinedPrompt: string;
  maxPriceUsdcBase: bigint;
  reasoning: string;
};

export type DecisionInput = {
  task: string;
  providers: ProviderRow[];
  /** Hard cap from the CLI. Claude can pick under this but not over. */
  budgetUsdcBase: bigint;
  model?: string;
};

const DEFAULT_MODEL = "claude-sonnet-4-5";

/** Ask Claude to choose a provider + refine the prompt. Returns
 *  the decision + the raw reasoning so the CLI can surface it.
 *  Falls back to a deterministic pick + the raw task if Claude
 *  errors or returns malformed output. */
export async function decideWithClaude(input: DecisionInput): Promise<Decision> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY not set. Either export it, put it in .env, or " +
        "pass --skip-claude to use the deterministic fallback.",
    );
  }
  const client = new Anthropic({ apiKey });

  const providerCatalog = input.providers
    .filter((p) => p.online && p.secondsPerImage !== null)
    .slice(0, 10)
    .map((p, i) => {
      const price =
        p.suggestedPriceUsdcBase != null
          ? `${formatUsdc(p.suggestedPriceUsdcBase)} USDC suggested`
          : "no price published";
      const speed =
        p.secondsPerImage != null
          ? `${p.secondsPerImage.toFixed(2)}s / image`
          : "speed unknown";
      const chip = p.chip || "unknown chip";
      const ram = p.ramGb ? `${p.ramGb} GB` : "RAM unknown";
      return `  ${i + 1}. ${p.pda}
       ${chip} · ${ram} · ${speed} · ${price} · ${p.totalJobs} jobs served`;
    })
    .join("\n");

  const systemPrompt = `You are Atlas-7, an autonomous AI agent purchasing GPU compute on Apis — a permissionless marketplace on Solana. You're given a creative task and a live list of providers. Your job:

1. Pick the single best provider from the catalog for this task.
2. Refine the user's task into a Flux Schnell text-to-image prompt — be vivid, specific, and stay under 256 characters.
3. Set the maximum price you'll pay (in USDC base units, 6 decimals). Hard cap: ${input.budgetUsdcBase.toString()}.
4. Explain your reasoning in one or two sentences.

Reply with ONLY a JSON object matching this exact schema, no markdown, no preamble:

{
  "provider_pda": "<base58 Solana address>",
  "refined_prompt": "<string under 256 chars>",
  "max_price_usdc_base": "<u64 as decimal string>",
  "reasoning": "<one or two sentences>"
}`;

  const userMessage = `Task: ${input.task}

Live provider catalog (online + Flux-capable, sorted fastest-first):
${providerCatalog || "  (no online providers — abort the run)"}

Hard budget cap: ${formatUsdc(input.budgetUsdcBase)} USDC (= ${input.budgetUsdcBase.toString()} base units)

Return the JSON decision.`;

  const response = await client.messages.create({
    model: input.model ?? DEFAULT_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  // Concatenate text blocks (Claude returns content as an array).
  const raw = response.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = extractJsonObject(raw);
  if (!parsed) {
    throw new Error(`Claude returned no JSON object:\n${raw.slice(0, 500)}`);
  }
  return validateDecision(parsed, input);
}

/** Deterministic fallback when Claude is skipped or unavailable —
 *  pick the fastest in-budget provider, use the raw task as the
 *  prompt, set max_price = budget. */
export function decideDeterministic(input: DecisionInput): Decision {
  // network.ts already sorts fastest-first.
  const eligible = input.providers.filter(
    (p) =>
      p.online &&
      p.secondsPerImage !== null &&
      (p.suggestedPriceUsdcBase == null ||
        p.suggestedPriceUsdcBase <= input.budgetUsdcBase),
  );
  const pick = eligible[0];
  if (!pick) {
    throw new Error(
      "no online provider matches the budget — pass a higher --budget or wait for a provider to come online",
    );
  }
  return {
    providerPda: pick.pda,
    refinedPrompt: input.task,
    maxPriceUsdcBase: input.budgetUsdcBase,
    reasoning:
      "Deterministic fallback (Claude skipped) — picked fastest in-budget provider.",
  };
}

/** Find the first balanced `{ ... }` JSON object in a string. Claude
 *  sometimes wraps its reply with explanation or markdown despite the
 *  prompt; this peels it off. */
function extractJsonObject(raw: string): unknown {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = raw.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function validateDecision(parsed: unknown, input: DecisionInput): Decision {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`decision is not an object: ${JSON.stringify(parsed)}`);
  }
  const o = parsed as Record<string, unknown>;
  if (typeof o.provider_pda !== "string") {
    throw new Error(`decision.provider_pda is not a string`);
  }
  if (typeof o.refined_prompt !== "string") {
    throw new Error(`decision.refined_prompt is not a string`);
  }
  if (typeof o.max_price_usdc_base !== "string") {
    throw new Error(`decision.max_price_usdc_base is not a string`);
  }
  if (typeof o.reasoning !== "string") {
    throw new Error(`decision.reasoning is not a string`);
  }

  let maxPrice: bigint;
  try {
    maxPrice = BigInt(o.max_price_usdc_base);
  } catch {
    throw new Error(
      `decision.max_price_usdc_base is not a valid u64: ${o.max_price_usdc_base}`,
    );
  }
  if (maxPrice > input.budgetUsdcBase) {
    // Clamp to the user's hard budget rather than rejecting.
    maxPrice = input.budgetUsdcBase;
  }

  // Validate provider PDA actually exists in the catalog. Claude
  // hallucinating a non-existent PDA is the most common failure mode.
  const found = input.providers.find((p) => p.pda === o.provider_pda);
  if (!found) {
    throw new Error(
      `Claude chose provider ${o.provider_pda} but it isn't in the catalog`,
    );
  }

  return {
    providerPda: found.pda,
    refinedPrompt: o.refined_prompt.slice(0, 256),
    maxPriceUsdcBase: maxPrice,
    reasoning: o.reasoning,
  };
}
