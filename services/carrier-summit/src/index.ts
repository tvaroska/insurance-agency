import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { join } from "path";
import {
  correlationId,
  requestLogger,
  jwtAuth,
  carrierLatency,
  errorHandler,
  generateDevToken,
  oauthTokenEndpoint,
  chaosMiddleware,
  strictModalityGuard,
  portalSessionEndpoint,
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
  c.json({ status: "ok", service: "carrier-summit", timestamp: new Date().toISOString() }),
);

// ── Simulation control plane ─────────────────────────────────────────
app.route(
  "/sim",
  createSimRouter({
    serviceName: "carrier-summit",
    prisma,
    tables: [
      { name: "quotes", delegate: "quote", orderBy: "quote_id" },
      { name: "policies", delegate: "policy", orderBy: "policy_id" },
      { name: "policy_documents", delegate: "policyDocument", orderBy: "document_id" },
      { name: "underwriting_conditions", delegate: "underwritingCondition", orderBy: "condition_id" },
    ],
    onTimeTravel: async (_days, simulatedNow) => {
      const isoDate = simulatedNow.toISOString().slice(0, 10);
      const isoNow = simulatedNow.toISOString();
      const expiredQuotes = await prisma.quote.updateMany({
        where: { status: "quoted", valid_until: { not: null, lt: isoDate } },
        data: { status: "expired" },
      });
      const expiredPolicies = await prisma.policy.updateMany({
        where: { status: "active", expiration_date: { lt: isoDate } },
        data: { status: "expired", updated_at: isoNow },
      });
      return {
        quotes_expired: expiredQuotes.count,
        policies_expired: expiredPolicies.count,
      };
    },
    onReset: async (seedMode) => {
      const seedScript = join(import.meta.dir, "seed.ts");
      const proc = Bun.spawnSync(["bun", "run", seedScript], {
        env: { ...process.env, SEED_MODE: seedMode },
      });
      if (proc.exitCode !== 0) {
        throw new Error(`Carrier Summit seed reset failed: ${proc.stderr.toString()}`);
      }
    },
  }),
);

// ── OAuth & portal session endpoints (no auth required) ─────────────
app.route("/", oauthTokenEndpoint());
app.route("/", portalSessionEndpoint("carrier-summit"));

// ── Dev token endpoint (no auth — training environment) ──────────────
app.get("/auth/dev-token", async (c) => {
  const token = await generateDevToken({
    scopes: [
      "carrier:quotes:read",
      "carrier:quotes:write",
      "carrier:underwriting:write",
      "carrier:policies:read",
    ],
  });
  return c.json({ token });
});

// ── Authenticated routes ─────────────────────────────────────────────
const api = new Hono<{ Variables: AppVariables }>();
api.use("*", strictModalityGuard("web-portal"));
api.use("*", jwtAuth);
api.use("*", carrierLatency);

// Route groups
import { quotesRouter } from "./routes/quotes";
import { underwritingRouter } from "./routes/underwriting";
import { policiesRouter } from "./routes/policies";
import { submissionsRouter } from "./routes/submissions";
import { inspectionsRouter } from "./routes/inspections";
api.route("/quotes", quotesRouter);
api.route("/underwriting", underwritingRouter);
api.route("/policies", policiesRouter);
api.route("/submissions", submissionsRouter);
api.route("/inspections", inspectionsRouter);

app.route("/v1/summit", api);

// ── Static file serving (React portal) ───────────────────────────────
const publicDir = join(import.meta.dir, "..", "public");
app.use("/*", serveStatic({ root: publicDir }));
app.get("/*", serveStatic({ root: publicDir, path: "/index.html" }));

// ── Start server ─────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || "3005", 10);
console.log(`Carrier Summit Fire & Casualty service listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
