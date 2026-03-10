import { Hono } from "hono";
import {
  correlationId,
  requestLogger,
  jwtAuth,
  errorHandler,
  oauthTokenEndpoint,
  type CorrelationVariables,
  type AuthVariables,
} from "@evergreen/shared";

type AppVariables = CorrelationVariables & AuthVariables;

const app = new Hono<{ Variables: AppVariables }>();

// ── Global middleware ────────────────────────────────────────────────
app.use("*", correlationId);
app.use("*", requestLogger);
app.onError(errorHandler);

// ── Health check (no auth required) ──────────────────────────────────
app.get("/health", (c) =>
  c.json({ status: "ok", service: "ecm", timestamp: new Date().toISOString() }),
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
