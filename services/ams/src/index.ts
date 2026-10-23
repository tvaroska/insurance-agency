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
  getSimulatedNow,
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
  c.json({ status: "ok", service: "ams", timestamp: new Date().toISOString() }),
);

// ── Simulation control plane ─────────────────────────────────────────
app.route(
  "/sim",
  createSimRouter({
    serviceName: "ams",
    prisma,
    tables: [
      { name: "clients", delegate: "client", orderBy: "id" },
      { name: "policies", delegate: "policy", orderBy: "policy_id" },
      { name: "coverages", delegate: "coverage", orderBy: "id" },
      { name: "endorsements", delegate: "endorsement", orderBy: "endorsement_id" },
      { name: "commissions", delegate: "commission", orderBy: "commission_id" },
      { name: "tasks", delegate: "task", orderBy: "id" },
      { name: "escalations", delegate: "escalation", orderBy: "escalation_id" },
      { name: "escalation_events", delegate: "escalationEvent", orderBy: "id" },
    ],
    onTimeTravel: async (_days, simulatedNow) => {
      const isoDate = simulatedNow.toISOString().slice(0, 10);
      const isoNow = simulatedNow.toISOString();
      const expiredPolicies = await prisma.policy.updateMany({
        where: { status: "active", expiration_date: { lt: isoDate } },
        data: { status: "expired", updated_at: isoNow },
      });
      const appliedEndorsements = await prisma.endorsement.updateMany({
        where: { status: "pending_review", effective_date: { lte: isoDate } },
        data: { status: "applied", updated_at: isoNow },
      });
      return {
        policies_expired: expiredPolicies.count,
        endorsements_applied: appliedEndorsements.count,
      };
    },
    onReset: async (seedMode) => {
      const seedScript = join(import.meta.dir, "seed.ts");
      const proc = Bun.spawnSync(["bun", "run", seedScript], {
        env: { ...process.env, SEED_MODE: seedMode },
      });
      if (proc.exitCode !== 0) {
        throw new Error(`AMS seed reset failed: ${proc.stderr.toString()}`);
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
import { clientsRouter } from "./routes/clients";
import { policiesRouter } from "./routes/policies";
import { accountingRouter } from "./routes/accounting";
import { tasksRouter } from "./routes/tasks";
import { escalationsRouter } from "./routes/escalations";
api.route("/clients", clientsRouter);
api.route("/policies", policiesRouter);
api.route("/accounting", accountingRouter);
api.route("/tasks", tasksRouter);
api.route("/escalations", escalationsRouter);

app.route("/v1", api);

// ── Start server ─────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || "3000", 10);
console.log(`AMS service listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
