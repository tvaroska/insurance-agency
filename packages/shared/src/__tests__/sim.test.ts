import { describe, expect, test, beforeEach, afterEach, setSystemTime } from "bun:test";
import { Hono } from "hono";
import {
  createSimRouter,
  chaosMiddleware,
  strictModalityGuard,
  portalSessionEndpoint,
  portalBootstrapMiddleware,
  resetPortalSessions,
  getSimulatedNow,
  advanceSimulatedClock,
  resetSimulatedClock,
  resetChaosConfig,
  getChaosConfig,
  createTestPrismaClient,
  getTestDatabaseUrl,
} from "../index";

function portalApp() {
  const app = new Hono();
  app.use("*", portalBootstrapMiddleware("carrier-summit"));
  app.get("/", (c) => c.html("<html><body>Summit Portal</body></html>"));
  app.route("/", portalSessionEndpoint("carrier-summit"));
  app.use("/v1/summit/*", strictModalityGuard("web-portal"));
  app.get("/v1/summit/quotes", (c) => c.json({ data: ["Q-1"] }));
  return app;
}

async function fetchBootstrapCookie(app: Hono): Promise<string> {
  const rootRes = await app.request("/");
  expect(rootRes.status).toBe(200);
  const setCookie = rootRes.headers.get("set-cookie") ?? "";
  expect(setCookie).toContain("evergreen_portal_boot_carrier-summit=");
  return setCookie.split(";")[0];
}

async function issueToken(app: Hono): Promise<string> {
  const cookie = await fetchBootstrapCookie(app);
  const res = await app.request("/auth/portal-session", {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.session_token).toStartWith("portal_sess_carrier-summit_");
  expect(body.expires_in).toBe(3600);
  return body.session_token;
}

async function expectModalityViolation(res: Response) {
  expect(res.status).toBe(403);
  expect((await res.json()).error_code).toBe("MODALITY_VIOLATION");
}

describe("Simulation Control Plane (packages/shared/src/sim.ts)", () => {
  const originalModality = process.env.MODALITY_MODE;
  const originalTestDbUrl = process.env.TEST_DATABASE_URL;
  const originalScorerSecret = process.env.EVERGREEN_SCORER_SECRET;

  beforeEach(() => {
    resetSimulatedClock();
    resetChaosConfig();
    resetPortalSessions();
    delete process.env.MODALITY_MODE;
    delete process.env.TEST_DATABASE_URL;
    delete process.env.EVERGREEN_SCORER_SECRET;
  });

  afterEach(() => {
    setSystemTime();
    resetSimulatedClock();
    resetChaosConfig();
    resetPortalSessions();
    if (originalModality !== undefined) {
      process.env.MODALITY_MODE = originalModality;
    } else {
      delete process.env.MODALITY_MODE;
    }
    if (originalTestDbUrl !== undefined) {
      process.env.TEST_DATABASE_URL = originalTestDbUrl;
    } else {
      delete process.env.TEST_DATABASE_URL;
    }
    if (originalScorerSecret !== undefined) {
      process.env.EVERGREEN_SCORER_SECRET = originalScorerSecret;
    } else {
      delete process.env.EVERGREEN_SCORER_SECRET;
    }
  });

  test("GET /sim/snapshot queries configured Prisma delegates in deterministic order", async () => {
    const fakePrisma = {
      client: {
        findMany: async ({ orderBy }: any) => {
          expect(orderBy).toEqual({ id: "asc" });
          return [
            { id: "CLI-001", name: "Alice" },
            { id: "CLI-002", name: "Bob" },
          ];
        },
      },
      policy: {
        findMany: async ({ orderBy }: any) => {
          expect(orderBy).toEqual({ policy_id: "asc" });
          return [{ policy_id: "POL-100", status: "active" }];
        },
      },
    };

    const app = new Hono();
    app.route(
      "/sim",
      createSimRouter({
        serviceName: "test-svc",
        prisma: fakePrisma,
        tables: [
          { name: "clients", delegate: "client", orderBy: "id" },
          { name: "policies", delegate: "policy", orderBy: "policy_id" },
        ],
      }),
    );

    const res = await app.request("/sim/snapshot");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service).toBe("test-svc");
    expect(body.tables.clients).toHaveLength(2);
    expect(body.tables.policies).toHaveLength(1);
    expect(body.simulated_time).toBeDefined();
  });

  test("POST /sim/time-travel advances clock by days and invokes onTimeTravel", async () => {
    let capturedDays = 0;
    const app = new Hono();
    app.route(
      "/sim",
      createSimRouter({
        serviceName: "test-svc",
        prisma: {},
        tables: [],
        onTimeTravel: async (days) => {
          capturedDays = days;
          return { policies_expired: 3 };
        },
      }),
    );

    const before = getSimulatedNow().getTime();
    const res = await app.request("/sim/time-travel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: 45 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.days_advanced).toBe(45);
    expect(body.transitions).toEqual({ policies_expired: 3 });
    expect(capturedDays).toBe(45);

    const after = getSimulatedNow().getTime();
    expect(after - before).toBeGreaterThanOrEqual(45 * 86_400_000 - 1000);
  });

  test("POST /sim/chaos and chaosMiddleware inject 503 on /v1/* while sparing /health and /sim/*", async () => {
    const app = new Hono();
    app.use("*", chaosMiddleware());
    app.get("/health", (c) => c.json({ status: "ok" }));
    app.get("/v1/items", (c) => c.json({ items: [1, 2, 3] }));
    app.route(
      "/sim",
      createSimRouter({
        serviceName: "test-svc",
        prisma: {},
        tables: [],
      }),
    );

    // Enable 100% chaos error rate
    const enableRes = await app.request("/sim/chaos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, error_rate: 1.0, status_code: 503, latency_ms: 5 }),
    });
    expect(enableRes.status).toBe(200);
    expect(getChaosConfig().enabled).toBe(true);

    // /v1/items fails with 503 SERVICE_UNAVAILABLE
    const v1Res = await app.request("/v1/items");
    expect(v1Res.status).toBe(503);
    const v1Body = await v1Res.json();
    expect(v1Body.error_code).toBe("SERVICE_UNAVAILABLE");

    // /health and /sim/status still return 200
    const healthRes = await app.request("/health");
    expect(healthRes.status).toBe(200);

    const simStatusRes = await app.request("/sim/status");
    expect(simStatusRes.status).toBe(200);
  });

  test("POST /sim/reset resets clock, chaos config, and calls onReset", async () => {
    let resetMode = "";
    const app = new Hono();
    app.use("*", chaosMiddleware());
    app.route(
      "/sim",
      createSimRouter({
        serviceName: "test-svc",
        prisma: {},
        tables: [],
        onReset: async (mode) => {
          resetMode = mode;
        },
      }),
    );

    await app.request("/sim/chaos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, error_rate: 1.0 }),
    });
    await app.request("/sim/time-travel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: 30 }),
    });

    const resetRes = await app.request("/sim/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed_mode: "clean" }),
    });
    expect(resetRes.status).toBe(200);
    const resetBody = await resetRes.json();
    expect(resetBody.status).toBe("reset");
    expect(resetBody.seed_mode).toBe("clean");
    expect(resetMode).toBe("clean");
    expect(getChaosConfig().enabled).toBe(false);
  });

  test("strictModalityGuard('mcp') blocks REST in strict mode unless authorized X-Eval-Scorer: true", async () => {
    const app = new Hono();
    app.use("/v1/*", strictModalityGuard("mcp"));
    app.get("/v1/messages", (c) => c.json({ data: [] }));

    // Permissive by default
    const permRes = await app.request("/v1/messages");
    expect(permRes.status).toBe(200);

    // Strict mode blocks direct REST
    process.env.MODALITY_MODE = "strict";
    const blockedRes = await app.request("/v1/messages");
    expect(blockedRes.status).toBe(403);
    const blockedBody = await blockedRes.json();
    expect(blockedBody.error_code).toBe("MODALITY_VIOLATION");

    // X-Eval-Scorer: true bypasses strict guard when EVERGREEN_SCORER_SECRET is unset
    const scorerRes = await app.request("/v1/messages", {
      headers: { "X-Eval-Scorer": "true" },
    });
    expect(scorerRes.status).toBe(200);

    // When EVERGREEN_SCORER_SECRET is configured, forged X-Eval-Scorer without secret is blocked
    process.env.EVERGREEN_SCORER_SECRET = "s3cr3t-scorer-key";
    const forgedScorerRes = await app.request("/v1/messages", {
      headers: { "X-Eval-Scorer": "true" },
    });
    expect(forgedScorerRes.status).toBe(403);

    const authorizedScorerRes = await app.request("/v1/messages", {
      headers: {
        "X-Eval-Scorer": "true",
        "X-Evergreen-Scorer-Secret": "s3cr3t-scorer-key",
      },
    });
    expect(authorizedScorerRes.status).toBe(200);
  });

  test("portalSessionEndpoint requires portal bootstrap cookie in strict mode", async () => {
    const app = portalApp();
    process.env.MODALITY_MODE = "strict";

    // Direct headless call to /auth/portal-session without loading GET / fails with 403 PORTAL_BOOTSTRAP_REQUIRED
    const directRes = await app.request("/auth/portal-session");
    expect(directRes.status).toBe(403);
    expect((await directRes.json()).error_code).toBe("PORTAL_BOOTSTRAP_REQUIRED");

    // Forged bootstrap cookie is rejected
    const forgedBootRes = await app.request("/auth/portal-session", {
      headers: {
        Cookie: "evergreen_portal_boot_carrier-summit=00000000-0000-4000-8000-000000000000",
      },
    });
    expect(forgedBootRes.status).toBe(403);
    expect((await forgedBootRes.json()).error_code).toBe("PORTAL_BOOTSTRAP_REQUIRED");
  });

  test("strictModalityGuard('web-portal') accepts an issued X-Portal-Session in strict mode", async () => {
    const app = portalApp();

    // Permissive by default
    expect((await app.request("/v1/summit/quotes")).status).toBe(200);

    process.env.MODALITY_MODE = "strict";

    // Headless REST call fails with 403 MODALITY_VIOLATION
    await expectModalityViolation(await app.request("/v1/summit/quotes"));

    // Request with an issued X-Portal-Session succeeds
    const token = await issueToken(app);
    const portalRes = await app.request("/v1/summit/quotes", {
      headers: { "X-Portal-Session": token },
    });
    expect(portalRes.status).toBe(200);

    // Request with X-Eval-Scorer: true succeeds
    const evalRes = await app.request("/v1/summit/quotes", {
      headers: { "X-Eval-Scorer": "true" },
    });
    expect(evalRes.status).toBe(200);
  });

  test("strictModalityGuard('web-portal') rejects forged tokens and Referer + Mozilla without a token", async () => {
    const app = portalApp();
    process.env.MODALITY_MODE = "strict";
    const issued = await issueToken(app);

    for (const forged of [
      "portal-session-baseline",
      "portal_sess_carrier-summit_00000000-0000-4000-8000-000000000000",
      `${issued.slice(0, -1)}${issued.endsWith("0") ? "1" : "0"}`,
    ]) {
      await expectModalityViolation(
        await app.request("/v1/summit/quotes", {
          headers: { "X-Portal-Session": forged },
        }),
      );
    }

    await expectModalityViolation(
      await app.request("/v1/summit/quotes", {
        headers: {
          Referer: "http://localhost:3005/",
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        },
      }),
    );
  });

  test("strictModalityGuard('web-portal') rejects expired tokens but not after simulated time-travel", async () => {
    const app = portalApp();
    process.env.MODALITY_MODE = "strict";
    const headers = { "X-Portal-Session": await issueToken(app) };

    advanceSimulatedClock({ days: 30 });
    expect((await app.request("/v1/summit/quotes", { headers })).status).toBe(200);

    setSystemTime(new Date(Date.now() + 3_601_000));
    await expectModalityViolation(await app.request("/v1/summit/quotes", { headers }));
  });

  test("POST /sim/reset clears issued portal session and bootstrap tokens so pre-reset tokens are rejected", async () => {
    const app = portalApp();
    app.route(
      "/sim",
      createSimRouter({
        serviceName: "carrier-summit",
        prisma: {},
        tables: [],
      }),
    );

    process.env.MODALITY_MODE = "strict";
    const bootCookie = await fetchBootstrapCookie(app);
    const sessRes = await app.request("/auth/portal-session", {
      headers: { Cookie: bootCookie },
    });
    const { session_token: token } = await sessRes.json();
    const headers = { "X-Portal-Session": token };

    // Token works before reset
    expect((await app.request("/v1/summit/quotes", { headers })).status).toBe(200);

    // Trigger /sim/reset
    const resetRes = await app.request("/sim/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed_mode: "realistic" }),
    });
    expect(resetRes.status).toBe(200);

    // Pre-reset token and bootstrap cookie are now rejected
    await expectModalityViolation(await app.request("/v1/summit/quotes", { headers }));
    const postResetBoot = await app.request("/auth/portal-session", {
      headers: { Cookie: bootCookie },
    });
    expect(postResetBoot.status).toBe(403);
    expect((await postResetBoot.json()).error_code).toBe("PORTAL_BOOTSTRAP_REQUIRED");
  });

  test("createTestPrismaClient and getTestDatabaseUrl support TEST_DATABASE_URL", async () => {
    class DummyPrismaClient {
      opts: any;
      constructor(opts: any) {
        this.opts = opts;
      }
      async $disconnect() {}
    }

    const ctx = createTestPrismaClient(DummyPrismaClient, "test-shared-");
    expect(ctx.dbPath).toContain("test-shared-");
    expect(ctx.url).toBe(`file:${ctx.dbPath}`);
    await ctx.cleanup();

    process.env.TEST_DATABASE_URL = "file:/tmp/custom-override.db";
    expect(getTestDatabaseUrl("/tmp/default.db")).toBe("file:/tmp/custom-override.db");
  });

  test("POST /sim/seed initializes empty base, normalizes JSON fields, and upserts overlays", async () => {
    const calls: string[] = [];
    const createdRows: Record<string, Record<string, unknown>[]> = { clients: [], policies: [] };
    const upsertedRows: Record<string, unknown>[] = [];
    const fakePrisma = {
      client: {
        create: async ({ data }: any) => {
          calls.push(`create:clients:${data.id}`);
          createdRows.clients.push(data);
          return data;
        },
        upsert: async ({ where, create }: any) => {
          calls.push(`upsert:clients:${where.id}`);
          upsertedRows.push(create);
          return create;
        },
      },
      policy: {
        create: async ({ data }: any) => {
          calls.push(`create:policies:${data.policy_id}`);
          createdRows.policies.push(data);
          return data;
        },
      },
    };

    const resetModes: string[] = [];
    const app = new Hono();
    app.route(
      "/sim",
      createSimRouter({
        serviceName: "ams",
        prisma: fakePrisma,
        tables: [
          { name: "clients", delegate: "client", orderBy: "id" },
          { name: "policies", delegate: "policy", orderBy: "policy_id" },
        ],
        onReset: async (mode) => {
          resetModes.push(mode);
        },
      }),
    );

    // 1. Minimal empty fixture — respects parent-before-child table order even if JSON keys are reversed
    const emptyRes = await app.request("/sim/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base: "empty",
        tables: {
          policies: [{ policy_id: "POL-1", client_id: "CLI-1", meta: { nested: true } }],
          clients: [{ id: "CLI-1", first_name: "Ada", tags: ["vip"] }],
        },
      }),
    });
    expect(emptyRes.status).toBe(200);
    const emptyBody = await emptyRes.json();
    expect(emptyBody.status).toBe("seeded");
    expect(emptyBody.base).toBe("empty");
    expect(emptyBody.inserted).toEqual({ clients: 1, policies: 1 });
    expect(resetModes).toEqual(["empty"]);
    expect(calls).toEqual(["create:clients:CLI-1", "create:policies:POL-1"]);
    expect(createdRows.clients[0].tags).toBe('["vip"]');
    expect(createdRows.policies[0].meta).toBe('{"nested":true}');

    // 2. Overlay on realistic seed uses upsert by primary key
    const overlayRes = await app.request("/sim/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base: "realistic",
        tables: {
          clients: [{ id: "CLI-999", first_name: "Overlay" }],
        },
      }),
    });
    expect(overlayRes.status).toBe(200);
    expect(resetModes).toEqual(["empty", "realistic"]);
    expect(upsertedRows).toHaveLength(1);

    // 3. Rejects unknown table or invalid base
    const badTableRes = await app.request("/sim/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base: "empty", tables: { nonexistent: [] } }),
    });
    expect(badTableRes.status).toBe(400);

    const badBaseRes = await app.request("/sim/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base: "bogus" }),
    });
    expect(badBaseRes.status).toBe(400);
  });
});
