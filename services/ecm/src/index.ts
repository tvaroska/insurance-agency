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
  c.json({ status: "ok", service: "ecm", timestamp: new Date().toISOString() }),
);

// ── Simulation control plane ─────────────────────────────────────────
app.route(
  "/sim",
  createSimRouter({
    serviceName: "ecm",
    prisma,
    tables: [
      { name: "documents", delegate: "document", orderBy: "document_id" },
      { name: "envelopes", delegate: "envelope", orderBy: "envelope_id" },
      { name: "marketing_assets", delegate: "marketingAsset", orderBy: "asset_id" },
    ],
    onTimeTravel: async (_days, simulatedNow) => {
      const isoNow = simulatedNow.toISOString();
      const expiredEnvelopes = await prisma.envelope.updateMany({
        where: {
          status: { in: ["created", "sent"] },
          expiration_date: { lt: isoNow },
        },
        data: { status: "expired" },
      });
      return { envelopes_expired: expiredEnvelopes.count };
    },
    onReset: async (seedMode) => {
      const seedScript = join(import.meta.dir, "seed.ts");
      const proc = Bun.spawnSync(["bun", "run", seedScript], {
        env: { ...process.env, SEED_MODE: seedMode },
      });
      if (proc.exitCode !== 0) {
        throw new Error(`ECM seed reset failed: ${proc.stderr.toString()}`);
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
import { documentsRouter } from "./routes/documents";
import { envelopesRouter } from "./routes/envelopes";
import { assetsRouter } from "./routes/assets";
import { acordRouter } from "./routes/acord";
import { coiRouter } from "./routes/coi";
api.route("/documents/acord", acordRouter);
api.route("/documents/coi", coiRouter);
api.route("/documents", documentsRouter);
api.route("/envelopes", envelopesRouter);
api.route("/assets", assetsRouter);

app.route("/v1", api);

// ── Start server ─────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || "3003", 10);
console.log(`ECM service listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
