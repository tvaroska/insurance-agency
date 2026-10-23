import { mock, describe, expect, test, beforeAll, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";
import {
  strictModalityGuard,
  portalSessionEndpoint,
  resetSimulatedClock,
  resetChaosConfig,
} from "@evergreen/shared";
import {
  createTestPrisma,
  createTestApp,
  authHeader,
  makeClient,
  makePolicy,
} from "./setup";

const testCtx = createTestPrisma();
mock.module("../prisma", () => ({ prisma: testCtx.prisma }));

import { clientsRouter } from "../routes/clients";
import { policiesRouter } from "../routes/policies";

const app = createTestApp({
  clients: clientsRouter,
  policies: policiesRouter,
  prisma: testCtx.prisma,
});

beforeEach(async () => {
  resetSimulatedClock();
  resetChaosConfig();
  delete process.env.MODALITY_MODE;

  await testCtx.prisma.escalationEvent.deleteMany();
  await testCtx.prisma.escalation.deleteMany();
  await testCtx.prisma.task.deleteMany();
  await testCtx.prisma.commission.deleteMany();
  await testCtx.prisma.endorsement.deleteMany();
  await testCtx.prisma.coverage.deleteMany();
  await testCtx.prisma.policy.deleteMany();
  await testCtx.prisma.client.deleteMany();

  await testCtx.prisma.client.create({
    data: makeClient({
      id: "CL-SIM-1",
      first_name: "Sim",
      last_name: "Tester",
      email: "sim@example.com",
    }),
  });

  await testCtx.prisma.policy.create({
    data: makePolicy({
      policy_id: "POL-EXP-1",
      client_id: "CL-SIM-1",
      effective_date: "2025-01-01",
      expiration_date: "2026-01-01",
      status: "active",
    }),
  });
});

afterAll(async () => {
  resetSimulatedClock();
  resetChaosConfig();
  delete process.env.MODALITY_MODE;
  await testCtx.cleanup();
});

describe("AMS /sim/* Control Plane & Strict Modality Enforcement", () => {
  test("GET /sim/snapshot returns deterministic table dump", async () => {
    const res = await app.request("/sim/snapshot");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service).toBe("ams");
    expect(body.tables.clients).toHaveLength(1);
    expect(body.tables.clients[0].id).toBe("CL-SIM-1");
    expect(body.tables.policies).toHaveLength(1);
    expect(body.tables.policies[0].policy_id).toBe("POL-EXP-1");
  });

  test("POST /sim/time-travel advances clock and expires policies past expiration_date", async () => {
    const res = await app.request("/sim/time-travel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_date: "2027-06-01T00:00:00.000Z" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("ams");
    expect(body.transitions.policies_expired).toBe(1);

    const updatedPolicy = await testCtx.prisma.policy.findUnique({
      where: { policy_id: "POL-EXP-1" },
    });
    expect(updatedPolicy?.status).toBe("expired");
  });

  test("POST /sim/chaos injects 503 on /v1/* routes and /sim/reset restores normal operation", async () => {
    const chaosRes = await app.request("/sim/chaos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, error_rate: 1.0, status_code: 503 }),
    });
    expect(chaosRes.status).toBe(200);

    // /v1/clients should fail with 503
    const headers = await authHeader(["ams:clients:read"]);
    const blockedRes = await app.request("/v1/clients", { headers });
    expect(blockedRes.status).toBe(503);
    const blockedBody = await blockedRes.json();
    expect(blockedBody.error_code).toBe("SERVICE_UNAVAILABLE");

    // /health is unaffected
    const healthRes = await app.request("/health");
    expect(healthRes.status).toBe(200);

    // POST /sim/reset clears chaos and resets tables
    const resetRes = await app.request("/sim/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed_mode: "realistic" }),
    });
    expect(resetRes.status).toBe(200);

    // /v1/clients works again (0 rows after test table reset)
    const afterRes = await app.request("/v1/clients", { headers });
    expect(afterRes.status).toBe(200);
    const afterBody = await afterRes.json();
    expect(afterBody.data).toHaveLength(0);
  });

  test("MODALITY_MODE=strict enforces MCP and Web-Portal guards while allowing X-Eval-Scorer: true", async () => {
    const modApp = new Hono();
    modApp.route("/", portalSessionEndpoint("carrier-summit"));
    modApp.use("/v1/comm/*", strictModalityGuard("mcp"));
    modApp.use("/v1/summit/*", strictModalityGuard("web-portal"));
    modApp.get("/v1/comm/messages", (c) => c.json({ ok: true }));
    modApp.get("/v1/summit/quotes", (c) => c.json({ ok: true }));

    process.env.MODALITY_MODE = "strict";

    // 1. MCP guard blocks direct REST call
    const mcpBlocked = await modApp.request("/v1/comm/messages");
    expect(mcpBlocked.status).toBe(403);
    expect((await mcpBlocked.json()).error_code).toBe("MODALITY_VIOLATION");

    // 2. MCP guard allows X-Eval-Scorer: true
    const mcpScorer = await modApp.request("/v1/comm/messages", {
      headers: { "X-Eval-Scorer": "true" },
    });
    expect(mcpScorer.status).toBe(200);

    // 3. Web-portal guard blocks headless REST call
    const portalBlocked = await modApp.request("/v1/summit/quotes");
    expect(portalBlocked.status).toBe(403);
    expect((await portalBlocked.json()).error_code).toBe("MODALITY_VIOLATION");

    // 4. Web-portal guard allows X-Portal-Session from /auth/portal-session
    const sessRes = await modApp.request("/auth/portal-session");
    const { session_token } = await sessRes.json();
    const portalAllowed = await modApp.request("/v1/summit/quotes", {
      headers: { "X-Portal-Session": session_token },
    });
    expect(portalAllowed.status).toBe(200);
  });
});
