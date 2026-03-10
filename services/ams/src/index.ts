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
  c.json({ status: "ok", service: "ams", timestamp: new Date().toISOString() }),
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
