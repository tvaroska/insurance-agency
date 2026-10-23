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
        where: { status: { in: ["open", "reported"] } },
        data: { status: "under_review", updated_at: isoNow },
      });
      return { claims_advanced: advancedClaims.count };
    },
    onReset: async (seedMode) => {
      const seedScript = join(import.meta.dir, "seed.ts");
      const proc = Bun.spawnSync(["bun", "run", seedScript], {
        env: { ...process.env, SEED_MODE: seedMode },
      });
      if (proc.exitCode !== 0) {
        throw new Error(`Claims seed reset failed: ${proc.stderr.toString()}`);
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
import { claimsRouter } from "./routes/claims";
import { adjustersRouter } from "./routes/adjusters";
api.route("/claims", claimsRouter);
api.route("/adjusters", adjustersRouter);

app.route("/v1", api);

// ── Start server ─────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || "3007", 10);
console.log(`Claims service listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
