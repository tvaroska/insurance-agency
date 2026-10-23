import { Hono } from "hono";
import { join } from "path";
import {
  correlationId,
  requestLogger,
  jwtAuth,
  errorHandler,
  oauthTokenEndpoint,
  chaosMiddleware,
  createSimRouter,
  type CorrelationVariables,
  type AuthVariables,
} from "@evergreen/shared";
import { prisma } from "./prisma";

type AppVariables = CorrelationVariables & AuthVariables;

const app = new Hono<{ Variables: AppVariables }>();

// ── Global middleware ────────────────────────────────────────────────
app.use("*", correlationId);
app.use("*", requestLogger);
app.use("*", chaosMiddleware());
app.onError(errorHandler);

// ── Health check (no auth required) ──────────────────────────────────
app.get("/health", (c) =>
  c.json({ status: "ok", service: "rater", timestamp: new Date().toISOString() }),
);

// ── Simulation control plane ─────────────────────────────────────────
app.route(
  "/sim",
  createSimRouter({
    serviceName: "rater",
    prisma,
    tables: [
      { name: "quote_requests", delegate: "quoteRequest", orderBy: "request_id" },
      { name: "carrier_quotes", delegate: "carrierQuote", orderBy: "quote_id" },
      { name: "carriers", delegate: "carrier", orderBy: "carrier_code" },
    ],
    onTimeTravel: async (_days, simulatedNow) => {
      const isoNow = simulatedNow.toISOString();
      const expiredRequests = await prisma.quoteRequest.updateMany({
        where: {
          status: { in: ["pending", "completed"] },
          expires_at: { not: null, lt: isoNow },
        },
        data: { status: "expired" },
      });
      const expiredQuotes = await prisma.carrierQuote.updateMany({
        where: {
          status: "quoted",
          valid_until: { not: null, lt: isoNow },
        },
        data: { status: "expired" },
      });
      return {
        quote_requests_expired: expiredRequests.count,
        carrier_quotes_expired: expiredQuotes.count,
      };
    },
    onReset: async (seedMode) => {
      const seedScript = join(import.meta.dir, "seed.ts");
      const proc = Bun.spawnSync(["bun", "run", seedScript], {
        env: { ...process.env, SEED_MODE: seedMode },
      });
      if (proc.exitCode !== 0) {
        throw new Error(`Rater seed reset failed: ${proc.stderr.toString()}`);
      }
    },
  }),
);

// ── OAuth token endpoint (no auth required) ─────────────────────────
app.route("/", oauthTokenEndpoint());

// ── Authenticated routes ─────────────────────────────────────────────
const api = new Hono<{ Variables: AppVariables }>();
api.use("*", jwtAuth);

// Route groups
import { quotesRouter } from "./routes/quotes";
import { carriersRouter } from "./routes/carriers";
api.route("/quotes", quotesRouter);
api.route("/carriers", carriersRouter);

app.route("/v1", api);

// ── Start server ─────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || "3001", 10);
console.log(`Rater service listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
