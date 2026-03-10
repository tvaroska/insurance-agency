import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { correlationId } from "../correlation";
import { errorHandler } from "../errors";
import { jwtAuth, requireScopes, generateDevToken, oauthTokenEndpoint } from "../auth";
import type { AuthVariables } from "../auth";
import type { CorrelationVariables } from "../correlation";

const TEST_SECRET = "test-secret-for-auth-tests";
process.env.JWT_SECRET = TEST_SECRET;

type AppVars = { Variables: AuthVariables & CorrelationVariables };

function createApp() {
  const app = new Hono<AppVars>();
  app.use(correlationId);
  app.onError(errorHandler);
  app.use("/protected/*", jwtAuth);
  app.get("/protected/me", (c) => {
    const payload = c.get("jwtPayload");
    return c.json({ sub: payload.sub, scope: payload.scope });
  });
  app.get("/protected/admin", requireScopes("ams:clients:write"), (c) => {
    return c.json({ ok: true });
  });
  app.get(
    "/protected/multi",
    requireScopes("ams:clients:read", "ams:policies:read"),
    (c) => {
      return c.json({ ok: true });
    },
  );
  return app;
}

describe("generateDevToken", () => {
  test("produces a three-part JWT string", async () => {
    const token = await generateDevToken({ secret: TEST_SECRET });
    const parts = token.split(".");
    expect(parts.length).toBe(3);
  });

  test("respects custom sub and scopes", async () => {
    const token = await generateDevToken({
      secret: TEST_SECRET,
      sub: "agent-007",
      scopes: ["ams:clients:read", "ams:clients:write"],
    });
    // Decode payload to verify claims
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    expect(payload.sub).toBe("agent-007");
    expect(payload.scope).toBe("ams:clients:read ams:clients:write");
  });

  test("defaults to dev-user with empty scope", async () => {
    const token = await generateDevToken({ secret: TEST_SECRET });
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    expect(payload.sub).toBe("dev-user");
    expect(payload.scope).toBe("");
  });
});

describe("jwtAuth middleware", () => {
  test("returns 401 when no Authorization header", async () => {
    const app = createApp();
    const res = await app.request("/protected/me");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe("AUTH_ERROR");
  });

  test("returns 401 when Authorization is not Bearer", async () => {
    const app = createApp();
    const res = await app.request("/protected/me", {
      headers: { Authorization: "Basic abc123" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe("AUTH_ERROR");
  });

  test("returns 401 for invalid token signature", async () => {
    const app = createApp();
    const res = await app.request("/protected/me", {
      headers: { Authorization: "Bearer invalid.token.here" },
    });
    expect(res.status).toBe(401);
  });

  test("returns 401 for expired token", async () => {
    const token = await generateDevToken({
      secret: TEST_SECRET,
      expiresIn: -60, // expired 60 seconds ago
    });
    const app = createApp();
    const res = await app.request("/protected/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe("AUTH_ERROR");
    expect(body.message).toBe("Token expired");
  });

  test("returns 200 and sets jwtPayload for valid token", async () => {
    const token = await generateDevToken({
      secret: TEST_SECRET,
      sub: "user-1",
      scopes: ["ams:clients:read"],
    });
    const app = createApp();
    const res = await app.request("/protected/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sub).toBe("user-1");
    expect(body.scope).toBe("ams:clients:read");
  });

  test("error response includes correlation_id", async () => {
    const app = createApp();
    const res = await app.request("/protected/me");
    const body = await res.json();
    expect(body.correlation_id).toBeTruthy();
  });
});

describe("requireScopes middleware", () => {
  test("returns 200 when token has the required scope", async () => {
    const token = await generateDevToken({
      secret: TEST_SECRET,
      scopes: ["ams:clients:write"],
    });
    const app = createApp();
    const res = await app.request("/protected/admin", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("returns 403 when token is missing the required scope", async () => {
    const token = await generateDevToken({
      secret: TEST_SECRET,
      scopes: ["ams:clients:read"],
    });
    const app = createApp();
    const res = await app.request("/protected/admin", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe("FORBIDDEN");
    expect(body.message).toContain("ams:clients:write");
  });

  test("returns 200 when token has all required scopes", async () => {
    const token = await generateDevToken({
      secret: TEST_SECRET,
      scopes: ["ams:clients:read", "ams:policies:read"],
    });
    const app = createApp();
    const res = await app.request("/protected/multi", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  test("returns 403 when token has only some required scopes", async () => {
    const token = await generateDevToken({
      secret: TEST_SECRET,
      scopes: ["ams:clients:read"],
    });
    const app = createApp();
    const res = await app.request("/protected/multi", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe("FORBIDDEN");
    expect(body.message).toContain("ams:policies:read");
  });

  test("returns 403 when token has empty scope", async () => {
    const token = await generateDevToken({
      secret: TEST_SECRET,
      scopes: [],
    });
    const app = createApp();
    const res = await app.request("/protected/admin", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("oauthTokenEndpoint", () => {
  function createOAuthApp() {
    const app = new Hono();
    app.route("/", oauthTokenEndpoint());
    return app;
  }

  test("returns token for valid client_credentials grant (form body)", async () => {
    const app = createOAuthApp();
    const res = await app.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&client_id=agent-full&client_secret=dev-secret",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBeTruthy();
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(3600);
    expect(body.scope).toContain("ams:clients:read");
  });

  test("returns token for valid client_credentials grant (JSON body)", async () => {
    const app = createOAuthApp();
    const res = await app.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: "agent-full",
        client_secret: "dev-secret",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBeTruthy();
    expect(body.token_type).toBe("Bearer");
  });

  test("returns 400 for unsupported grant type", async () => {
    const app = createOAuthApp();
    const res = await app.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=authorization_code&client_id=agent-full&client_secret=dev-secret",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("unsupported_grant_type");
  });

  test("returns 400 when client_id is missing", async () => {
    const app = createOAuthApp();
    const res = await app.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&client_secret=dev-secret",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
  });

  test("returns 401 for invalid client_id", async () => {
    const app = createOAuthApp();
    const res = await app.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&client_id=unknown&client_secret=dev-secret",
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("invalid_client");
  });

  test("returns 401 for wrong client_secret", async () => {
    const app = createOAuthApp();
    const res = await app.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&client_id=agent-full&client_secret=wrong",
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("invalid_client");
  });

  test("agent-csr client gets subset of scopes (no endorsements, underwriting, webhooks)", async () => {
    const app = createOAuthApp();
    const res = await app.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&client_id=agent-csr&client_secret=dev-secret",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope).not.toContain("ams:policies:endorsements");
    expect(body.scope).not.toContain("carrier:underwriting:write");
    expect(body.scope).not.toContain("comm:webhooks:manage");
    expect(body.scope).toContain("ams:clients:read");
  });

  test("agent-readonly client gets only read scopes", async () => {
    const app = createOAuthApp();
    const res = await app.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&client_id=agent-readonly&client_secret=dev-secret",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const scopes = body.scope.split(" ");
    for (const scope of scopes) {
      expect(scope.endsWith(":read") || scope === "claims:read").toBe(true);
    }
    expect(body.scope).not.toContain(":write");
  });

  test("respects requested scope subset", async () => {
    const app = createOAuthApp();
    const res = await app.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&client_id=agent-full&client_secret=dev-secret&scope=ams:clients:read",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope).toBe("ams:clients:read");
  });

  test("returns 400 for invalid requested scope", async () => {
    const app = createOAuthApp();
    const res = await app.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&client_id=agent-readonly&client_secret=dev-secret&scope=ams:clients:write",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_scope");
  });

  test("returned token is valid JWT accepted by jwtAuth", async () => {
    const oauthApp = createOAuthApp();
    const tokenRes = await oauthApp.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&client_id=agent-full&client_secret=dev-secret",
    });
    const { access_token } = await tokenRes.json();

    const protectedApp = createApp();
    const res = await protectedApp.request("/protected/me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sub).toBe("agent-full");
  });
});
