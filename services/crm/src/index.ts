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
  c.json({ status: "ok", service: "crm", timestamp: new Date().toISOString() }),
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
