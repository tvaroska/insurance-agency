import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "./server";
import { db } from "./db";
import {
  oauthTokenEndpoint,
  correlationId,
  requestLogger,
  errorHandler,
  jwtAuth,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { messagesRouter } from "./routes/messages";

type AppVariables = CorrelationVariables & AuthVariables;

const app = new Hono<{ Variables: AppVariables }>();
app.use("*", correlationId);
app.onError(errorHandler);

// ── Health check (no auth) ──────────────────────────────────────────
app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "comm",
    timestamp: new Date().toISOString(),
  }),
);

// ── OAuth token endpoint (no auth required) ─────────────────────────
app.route("/", oauthTokenEndpoint());

// ── REST API (authenticated) ────────────────────────────────────────
const api = new Hono<{ Variables: AppVariables }>();
api.use("*", jwtAuth);
api.route("/messages", messagesRouter);
app.route("/v1", api);

// ── MCP Streamable HTTP transport ───────────────────────────────────
// Stateless mode: each request creates a fresh transport + server pair
app.all("/mcp", async (c) => {
  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = createServer(db);
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

// ── Start server ────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || "3004", 10);
console.log(`Comm MCP service (HTTP) listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
