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
  c.json({ status: "ok", service: "carrier-summit", timestamp: new Date().toISOString() }),
);

// ── OAuth token endpoint (no auth required) ─────────────────────────
app.route("/", oauthTokenEndpoint());

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
