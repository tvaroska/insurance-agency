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
  c.json({ status: "ok", service: "claims", timestamp: new Date().toISOString() }),
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
