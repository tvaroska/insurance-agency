import { Hono } from "hono";
import { join } from "path";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "./server";
import { prisma } from "./prisma";
import {
  oauthTokenEndpoint,
  correlationId,
  requestLogger,
  errorHandler,
  jwtAuth,
  chaosMiddleware,
  strictModalityGuard,
  createSimRouter,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { messagesRouter } from "./routes/messages";
import { callsRouter } from "./routes/calls";
import { webhooksRouter } from "./routes/webhooks";

type AppVariables = CorrelationVariables & AuthVariables;

const app = new Hono<{ Variables: AppVariables }>();
app.use("*", correlationId);
app.use("*", requestLogger);
app.use("*", chaosMiddleware());
app.onError(errorHandler);

// ── Health check (no auth) ──────────────────────────────────────────
app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "comm",
    timestamp: new Date().toISOString(),
  }),
);

// ── Simulation control plane ────────────────────────────────────────
app.route(
  "/sim",
  createSimRouter({
    serviceName: "comm",
    prisma,
    tables: [
      { name: "messages", delegate: "message", orderBy: "message_id" },
      { name: "webhooks", delegate: "webhook", orderBy: "webhook_id" },
      { name: "webhook_deliveries", delegate: "webhookDelivery", orderBy: "delivery_id" },
    ],
    onTimeTravel: async (_days, simulatedNow) => {
      const isoNow = simulatedNow.toISOString();
      const expiredDeliveries = await prisma.webhookDelivery.updateMany({
        where: {
          status: "pending",
          next_retry_at: { not: null, lt: isoNow },
        },
        data: { status: "failed" },
      });
      return { webhook_deliveries_expired: expiredDeliveries.count };
    },
    onReset: async (seedMode) => {
      const seedScript = join(import.meta.dir, "seed.ts");
      const proc = Bun.spawnSync(["bun", "run", seedScript], {
        env: { ...process.env, SEED_MODE: seedMode },
      });
      if (proc.exitCode !== 0) {
        throw new Error(`Comm seed reset failed: ${proc.stderr.toString()}`);
      }
    },
  }),
);

// ── OAuth token endpoint (no auth required) ─────────────────────────
app.route("/", oauthTokenEndpoint());

// ── REST API (authenticated, blocked under MODALITY_MODE=strict unless X-Eval-Scorer: true) ──
const api = new Hono<{ Variables: AppVariables }>();
api.use("*", strictModalityGuard("mcp"));
api.use("*", jwtAuth);
api.route("/messages", messagesRouter);
api.route("/calls", callsRouter);
api.route("/webhooks", webhooksRouter);
app.route("/v1", api);

// ── MCP Streamable HTTP transport ───────────────────────────────────
// Stateless mode: each request creates a fresh transport + server pair
app.all("/mcp", async (c) => {
  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = createServer(prisma);
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
