import { Hono } from "hono";
import {
  correlationId,
  requestLogger,
  jwtAuth,
  errorHandler,
  oauthTokenEndpoint,
  chaosMiddleware,
  createSimRouter,
  createRequestLog,
  type CorrelationVariables,
  type AuthVariables,
} from "@evergreen/shared";
import { prisma } from "./prisma";
import { seedDatabase } from "./seed";

type AppVariables = CorrelationVariables & AuthVariables;

const app = new Hono<{ Variables: AppVariables }>();
const requestLog = createRequestLog({ serviceName: "claims", port: 3007 });

// ── Global middleware ────────────────────────────────────────────────
app.use("*", correlationId);
app.use("*", requestLogger);
app.use("*", requestLog.middleware);
app.use("*", chaosMiddleware());
app.onError(errorHandler);

// ── Health check (no auth required) ──────────────────────────────────
app.get("/health", (c) =>
  c.json({ status: "ok", service: "claims", timestamp: new Date().toISOString() }),
);

// ── Simulation control plane ─────────────────────────────────────────
app.route(
  "/sim",
  createSimRouter({
    serviceName: "claims",
    prisma,
    tables: [
      { name: "claims", delegate: "claim", orderBy: "claim_id" },
      { name: "adjusters", delegate: "adjuster", orderBy: "adjuster_id" },
      { name: "claim_documents", delegate: "claimDocument", orderBy: "document_id" },
      { name: "claim_timeline", delegate: "claimTimeline", orderBy: "event_id" },
    ],
    onTimeTravel: async (days, simulatedNow) => {
      if (days <= 0) {
        return { claims_advanced: 0 };
      }
      const isoNow = simulatedNow.toISOString();
      const advancedClaims = await prisma.claim.updateMany({
        where: { status: { in: ["open", "reported", "assigned"] } },
        data: { status: "investigating", updated_at: isoNow },
      });
      return { claims_advanced: advancedClaims.count };
    },
    onReset: async (seedMode) => {
      await seedDatabase(seedMode);
    },
  }),
);
app.route("/sim", requestLog.router);

// ── OAuth token endpoint (no auth required) ─────────────────────────
app.route("/", oauthTokenEndpoint());

// ── Authenticated routes ─────────────────────────────────────────────
const api = new Hono<{ Variables: AppVariables }>();
api.use("*", jwtAuth);

// Route groups
import { claimsRouter } from "./routes/claims";
import { adjustersRouter } from "./routes/adjusters";
api.route("/claims", claimsRouter);
api.route("/adjusters", adjustersRouter);

app.route("/v1", api);

// ── Start server ─────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || "3007", 10);
if (import.meta.main) {
  console.log(`Claims service listening on port ${port}`);
}

export { app, seedDatabase };
export default {
  port,
  fetch: app.fetch,
};
