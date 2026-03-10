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
  c.json({ status: "ok", service: "rater", timestamp: new Date().toISOString() }),
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
