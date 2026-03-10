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
  c.json({ status: "ok", service: "carrier-coastal", timestamp: new Date().toISOString() }),
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
import { bindingRouter } from "./routes/binding";
import { quickQuoteRouter } from "./routes/quickquote";
import { customizeRouter } from "./routes/customize";
import { idCardsRouter } from "./routes/idcards";
api.route("/quotes", quotesRouter);
api.route("/quotes", bindingRouter);
api.route("/quotes", quickQuoteRouter);
api.route("/quotes", customizeRouter);
api.route("/policies", idCardsRouter);

app.route("/v1/coastal", api);

// ── Static file serving (React portal) ───────────────────────────────
const publicDir = join(import.meta.dir, "..", "public");
app.use("/*", serveStatic({ root: publicDir }));
app.get("/*", serveStatic({ root: publicDir, path: "/index.html" }));

// ── Start server ─────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || "3006", 10);
console.log(`Carrier Coastal Star Insurance service listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
