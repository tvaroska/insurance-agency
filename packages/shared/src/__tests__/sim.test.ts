import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import {
  createSimRouter,
  chaosMiddleware,
  strictModalityGuard,
  portalSessionEndpoint,
  getSimulatedNow,
  resetSimulatedClock,
  resetChaosConfig,
  getChaosConfig,
  createTestPrismaClient,
  getTestDatabaseUrl,
} from "../index";

describe("Simulation Control Plane (packages/shared/src/sim.ts)", () => {
  const originalModality = process.env.MODALITY_MODE;
  const originalTestDbUrl = process.env.TEST_DATABASE_URL;

  beforeEach(() => {
    resetSimulatedClock();
    resetChaosConfig();
    delete process.env.MODALITY_MODE;
    delete process.env.TEST_DATABASE_URL;
  });

  afterEach(() => {
    resetSimulatedClock();
    resetChaosConfig();
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

  test("strictModalityGuard('mcp') blocks REST in strict mode unless X-Eval-Scorer: true", async () => {
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

    // X-Eval-Scorer: true bypasses strict guard
    const scorerRes = await app.request("/v1/messages", {
      headers: { "X-Eval-Scorer": "true" },
    });
    expect(scorerRes.status).toBe(200);
  });

  test("strictModalityGuard('web-portal') requires X-Portal-Session or browser Referer in strict mode", async () => {
    const app = new Hono();
    app.route("/", portalSessionEndpoint("carrier-summit"));
    app.use("/v1/summit/*", strictModalityGuard("web-portal"));
    app.get("/v1/summit/quotes", (c) => c.json({ data: ["Q-1"] }));

    process.env.MODALITY_MODE = "strict";

    // Headless REST call fails with 403 MODALITY_VIOLATION
    const headlessRes = await app.request("/v1/summit/quotes");
    expect(headlessRes.status).toBe(403);
    const headlessBody = await headlessRes.json();
    expect(headlessBody.error_code).toBe("MODALITY_VIOLATION");

    // Obtain session token from /auth/portal-session
    const sessRes = await app.request("/auth/portal-session");
    expect(sessRes.status).toBe(200);
    const sessBody = await sessRes.json();
    expect(sessBody.session_token).toStartWith("portal_sess_carrier-summit_");

    // Request with X-Portal-Session succeeds
    const portalRes = await app.request("/v1/summit/quotes", {
      headers: { "X-Portal-Session": sessBody.session_token },
    });
    expect(portalRes.status).toBe(200);

    // Request with X-Eval-Scorer: true succeeds
    const evalRes = await app.request("/v1/summit/quotes", {
      headers: { "X-Eval-Scorer": "true" },
    });
    expect(evalRes.status).toBe(200);
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
});
