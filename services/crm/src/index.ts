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
  c.json({ status: "ok", service: "crm", timestamp: new Date().toISOString() }),
);

// ── Simulation control plane ─────────────────────────────────────────
app.route(
  "/sim",
  createSimRouter({
    serviceName: "crm",
    prisma,
    tables: [
      { name: "leads", delegate: "lead", orderBy: "lead_id" },
      { name: "campaigns", delegate: "campaign", orderBy: "campaign_id" },
      { name: "campaign_enrollments", delegate: "campaignEnrollment", orderBy: "enrollment_id" },
      { name: "retention_risks", delegate: "retentionRisk", orderBy: "client_id" },
    ],
    onTimeTravel: async (days) => {
      if (days <= 0) {
        return { campaign_enrollments_advanced: 0 };
      }
      const stepsToAdvance = Math.max(1, Math.floor(days / 7));
      const updated = await prisma.campaignEnrollment.updateMany({
        data: { sequence_step: { increment: stepsToAdvance } },
      });
      return { campaign_enrollments_advanced: updated.count };
    },
    onReset: async (seedMode) => {
      const seedScript = join(import.meta.dir, "seed.ts");
      const proc = Bun.spawnSync(["bun", "run", seedScript], {
        env: { ...process.env, SEED_MODE: seedMode },
      });
      if (proc.exitCode !== 0) {
        throw new Error(`CRM seed reset failed: ${proc.stderr.toString()}`);
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
import { leadsRouter } from "./routes/leads";
import { campaignsRouter } from "./routes/campaigns";
import { analyticsRouter } from "./routes/analytics";
api.route("/leads", leadsRouter);
api.route("/campaigns", campaignsRouter);
api.route("/analytics", analyticsRouter);

app.route("/v1", api);

// ── Start server ─────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || "3002", 10);
console.log(`CRM service listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
