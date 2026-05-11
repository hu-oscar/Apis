// Apis MCP server entrypoint — Sprint 4.1+4.2+4.3.
//
// Hosts the MCP server over Streamable HTTP (the modern MCP transport
// agents like Claude Desktop, Claude SDK, and Anthropic's MCP Inspector
// all speak). Routes:
//
//   GET  /              — landing page (curl-friendly).
//   GET  /health        — JSON health check (RPC + server wallet).
//   POST /mcp           — primary MCP endpoint. Each call is one
//                          server-client message. The SDK handles the
//                          tool-call dispatch.
//   GET  /mcp           — optional Server-Sent Events stream for
//                          progress notifications. Not required by
//                          the spec but agents that support it get
//                          interactive feedback.
//
// Start locally with `pnpm --filter @apis/mcp dev`.
// Deploys to Fly.io as a single container (see Sprint 4.8).

import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { buildMcpServer } from "./server.js";
import { loadServerWallet } from "./lib/server-wallet.js";
import { APIS_API_BASE, RPC_URL } from "./lib/rpc.js";

const PORT = Number(process.env.PORT ?? 3030);
const HOST = process.env.HOST ?? "0.0.0.0";

// One transport per client session — the SDK uses session IDs for
// reconnection + state isolation. We index by the `mcp-session-id`
// header MCP sends.
const transports = new Map<string, StreamableHTTPServerTransport>();

async function main() {
  // Fail fast if the hot wallet isn't loadable — better to crash on
  // boot than 500 on the first agent submit_job.
  const wallet = await loadServerWallet();
  // eslint-disable-next-line no-console
  console.log(
    `[apis-mcp] server wallet: ${wallet.address} (loaded from ${wallet.source})`,
  );

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Landing — humans curl-ing the URL get a friendly hint.
  app.get("/", (_req, res) => {
    res.type("text/plain").send(
      `Apis MCP server\n` +
        `Marketplace API:  ${APIS_API_BASE}\n` +
        `Solana RPC:       ${RPC_URL}\n` +
        `Server wallet:    ${wallet.address}\n` +
        `\n` +
        `Endpoints:\n` +
        `  GET  /health     server + RPC health check\n` +
        `  POST /mcp        MCP tool dispatch (Streamable HTTP)\n` +
        `\n` +
        `Tools: list_providers · quote_inference · submit_job · get_status\n`,
    );
  });

  app.get("/health", async (_req, res) => {
    res.json({
      ok: true,
      service: "apis-mcp",
      version: "0.4.0",
      server_wallet: wallet.address,
      marketplace_api: APIS_API_BASE,
      solana_rpc: RPC_URL,
    });
  });

  // MCP endpoint.
  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.header("mcp-session-id");
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New session — wire up a fresh transport + new MCP server
      // instance. Spec says session ID is returned in the
      // `mcp-session-id` response header on initialize.
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newId) => {
          transports.set(newId, transport);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) transports.delete(transport.sessionId);
      };
      const server = buildMcpServer();
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message:
            "Bad Request: missing mcp-session-id header (and not an initialize request)",
        },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  // SSE stream — optional, for clients that want push notifications.
  // The SDK uses GET with an existing session ID.
  const sseHandler = async (req: Request, res: Response) => {
    const sessionId = req.header("mcp-session-id");
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send("missing or unknown mcp-session-id");
      return;
    }
    await transports.get(sessionId)!.handleRequest(req, res);
  };
  app.get("/mcp", sseHandler);
  app.delete("/mcp", sseHandler);

  app.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`[apis-mcp] listening on http://${HOST}:${PORT}`);
    // eslint-disable-next-line no-console
    console.log(`           tools: list_providers · quote_inference · submit_job · get_status`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[apis-mcp] fatal:", err);
  process.exit(1);
});
