// MCP client — Sprint 4.7.
//
// Thin wrapper around @modelcontextprotocol/sdk's Client + the
// Streamable HTTP transport. Connects to the Apis MCP server,
// initializes the session, exposes typed helpers for each of the four
// tools (list_providers, quote_inference, submit_job, get_status).
//
// All tool responses come back as MCP "content blocks." Our server
// returns JSON-stringified text inside the first text block — these
// helpers parse + type-check it for the caller.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type McpProviderRow = {
  pda: string;
  authority: string;
  chip: string | null;
  ram_gb: number | null;
  cpu_cores: number | null;
  seconds_per_image: number | null;
  suggested_price_usdc_base: string | null;
  suggested_price_usdc: string | null;
  online: boolean;
  age_seconds: number | null;
  total_jobs_served: number;
  active_jobs: number;
  explorer_url: string;
};

export type McpQuote = {
  provider_pda: string;
  price_usdc_base: string;
  price_usdc: string;
  estimated_seconds: number | null;
  spec_hash_hex: string;
  job_deadline_seconds: number;
  payment: {
    payment_id: string;
    pay_to_owner: string;
    pay_to_ata: string;
    pay_mint: string;
    pay_amount_usdc_base: string;
    pay_amount_usdc: string;
    pay_memo: string;
    expires_at_unix_ms: number;
    instructions: string;
  };
};

export type McpSubmitResult = {
  job_pda: string;
  create_job_signature: string;
  explorer_url: string;
  price_paid_usdc: string;
  spec_hash_hex: string;
  payment_payer: string;
};

export type McpJobStatus = {
  job_pda: string;
  status: string;
  settled: boolean;
  deadline_unix_sec: number | null;
  result: {
    cid: string;
    ipfs_url: string;
    proof_hash_hex: string | null;
    completed_at_unix_sec: number | null;
  } | null;
  settlement: {
    signature: string;
    explorer_url: string;
  } | null;
};

export class ApisMcpClient {
  private client: Client;
  private transport: StreamableHTTPClientTransport;

  private constructor(client: Client, transport: StreamableHTTPClientTransport) {
    this.client = client;
    this.transport = transport;
  }

  static async connect(url: string): Promise<ApisMcpClient> {
    const transport = new StreamableHTTPClientTransport(new URL(url));
    const client = new Client({
      name: "apis-agent",
      version: "0.4.0",
    });
    await client.connect(transport);
    return new ApisMcpClient(client, transport);
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  /** list_providers — returns the live catalog, optionally filtered. */
  async listProviders(opts?: {
    onlyOnline?: boolean;
    maxPriceUsdc?: number;
  }): Promise<McpProviderRow[]> {
    const result = await this.client.callTool({
      name: "list_providers",
      arguments: {
        ...(opts?.onlyOnline !== undefined && { only_online: opts.onlyOnline }),
        ...(opts?.maxPriceUsdc !== undefined && {
          max_price_usdc: opts.maxPriceUsdc,
        }),
      },
    });
    const parsed = parseToolJson(result) as { providers?: McpProviderRow[] };
    return parsed.providers ?? [];
  }

  /** quote_inference — returns a quote + payment block. */
  async quoteInference(input: {
    providerPda: string;
    prompt: string;
    width?: number;
    height?: number;
    seed?: number;
  }): Promise<McpQuote> {
    const result = await this.client.callTool({
      name: "quote_inference",
      arguments: {
        provider_pda: input.providerPda,
        prompt: input.prompt,
        ...(input.width !== undefined && { width: input.width }),
        ...(input.height !== undefined && { height: input.height }),
        ...(input.seed !== undefined && { seed: input.seed }),
      },
    });
    return parseToolJson(result) as McpQuote;
  }

  /** submit_job — pay first, then this. Returns the Job PDA + tx. */
  async submitJob(input: {
    paymentId: string;
    paymentSignature: string;
  }): Promise<McpSubmitResult> {
    const result = await this.client.callTool({
      name: "submit_job",
      arguments: {
        payment_id: input.paymentId,
        payment_signature: input.paymentSignature,
      },
    });
    return parseToolJson(result) as McpSubmitResult;
  }

  /** get_status — polls + auto-settles when Completed. */
  async getStatus(jobPda: string): Promise<McpJobStatus> {
    const result = await this.client.callTool({
      name: "get_status",
      arguments: { job_pda: jobPda },
    });
    return parseToolJson(result) as McpJobStatus;
  }
}

/** Extract the first text content block + parse it as JSON. Throws
 *  with the tool's own error message when isError is set. */
function parseToolJson(result: unknown): unknown {
  if (typeof result !== "object" || result === null) {
    throw new Error(`tool returned non-object: ${JSON.stringify(result)}`);
  }
  const r = result as {
    isError?: boolean;
    content?: Array<{ type?: string; text?: string }>;
  };
  const block = r.content?.find((b) => b.type === "text");
  const text = block?.text ?? "";
  if (r.isError) {
    // Server errors are JSON-stringified `{error: "..."}` inside the
    // text block. Surface the message string so callers see something
    // actionable instead of a wrapped object.
    try {
      const parsed = JSON.parse(text) as { error?: string };
      throw new Error(parsed.error ?? text);
    } catch (err) {
      if (err instanceof Error && err.message) throw err;
      throw new Error(text);
    }
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `couldn't parse tool response as JSON: ${err instanceof Error ? err.message : err}\n${text.slice(0, 500)}`,
    );
  }
}
