import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";

const testSqlite = new Database(":memory:");
testSqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(testSqlite, { schema });

mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

import { describe, it, expect, beforeAll } from "bun:test";
import { quotesRouter } from "../routes/quotes";
import { bindingRouter } from "../routes/binding";
import {
  createTables,
  createTestApp,
  authHeader,
  makeQuote,
  makePolicy,
} from "./setup";

const app = createTestApp({
  quotes: quotesRouter,
  binding: bindingRouter,
});

beforeAll(() => {
  createTables(testSqlite);

  // Seed test quotes
  const quoteRows = [
    makeQuote({
      quote_id: "QT-001-CSTL",
      status: "quoted",
    }),
    makeQuote({
      quote_id: "QT-ASSESSED-CSTL",
      status: "assessed",
      risk_score: 72,
      risk_tier: "standard",
      risk_factors: JSON.stringify([
        { factor: "driver_age", impact: "positive", detail: "Preferred age range" },
        { factor: "vehicle_value", impact: "positive", detail: "Low-risk tier" },
        { factor: "claims_history", impact: "positive", detail: "No claims" },
      ]),
      assessed_at: new Date().toISOString(),
    }),
    makeQuote({
      quote_id: "QT-BOUND-CSTL",
      status: "bound",
      risk_score: 80,
      risk_tier: "preferred",
      risk_factors: JSON.stringify([]),
      assessed_at: new Date().toISOString(),
      bind_status: "bound",
      bound_at: new Date().toISOString(),
      policy_id: "POL-EXISTING",
    }),
    makeQuote({
      quote_id: "QT-NOASSESS-CSTL",
      status: "quoted",
    }),
  ];
  for (const q of quoteRows) {
    testDb.insert(schema.quotes).values(q).run();
  }

  // Seed test policies
  const policyRows = [
    makePolicy({ policy_id: "POL-EXISTING" }),
  ];
  for (const p of policyRows) {
    testDb.insert(schema.policies).values(p).run();
  }
});

// ── Quote Submission Routes ──

describe("POST /v1/coastal/quotes/submit", () => {
  it("submits a quote and generates risk assessment", async () => {
    const headers = await authHeader(["carrier:quotes:write"]);
    const res = await app.request("/v1/coastal/quotes/submit", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: "QT-001-CSTL" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.quote_id).toBe("QT-001-CSTL");
    expect(body.status).toBe("assessed");
    expect(body.risk_score).toBeGreaterThanOrEqual(30);
    expect(body.risk_score).toBeLessThanOrEqual(89);
    expect(body.risk_tier).toBeDefined();
    expect(body.assessed_at).toBeDefined();
  });

  it("returns 404 for non-existent quote", async () => {
    const headers = await authHeader(["carrier:quotes:write"]);
    const res = await app.request("/v1/coastal/quotes/submit", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: "QT-NONEXISTENT" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when quote already submitted", async () => {
    const headers = await authHeader(["carrier:quotes:write"]);
    const res = await app.request("/v1/coastal/quotes/submit", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: "QT-ASSESSED-CSTL" }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 400 when quote_id is missing", async () => {
    const headers = await authHeader(["carrier:quotes:write"]);
    const res = await app.request("/v1/coastal/quotes/submit", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 401 without auth token", async () => {
    const res = await app.request("/v1/coastal/quotes/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: "QT-001-CSTL" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["carrier:policies:read"]);
    const res = await app.request("/v1/coastal/quotes/submit", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: "QT-001-CSTL" }),
    });
    expect(res.status).toBe(403);
  });
});

// ── Risk Assessment Routes ──

describe("GET /v1/coastal/quotes/:quote_id/risk-assessment", () => {
  it("returns risk assessment for assessed quote", async () => {
    const headers = await authHeader(["carrier:quotes:read"]);
    const res = await app.request(
      "/v1/coastal/quotes/QT-ASSESSED-CSTL/risk-assessment",
      { headers },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quote_id).toBe("QT-ASSESSED-CSTL");
    expect(body.risk_score).toBe(72);
    expect(body.risk_tier).toBe("standard");
    expect(body.factors).toBeArray();
    expect(body.recommendation).toBeDefined();
    expect(body.assessed_at).toBeDefined();
  });

  it("returns 404 for non-existent quote", async () => {
    const headers = await authHeader(["carrier:quotes:read"]);
    const res = await app.request(
      "/v1/coastal/quotes/QT-NONEXISTENT/risk-assessment",
      { headers },
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when quote has no assessment", async () => {
    const headers = await authHeader(["carrier:quotes:read"]);
    const res = await app.request(
      "/v1/coastal/quotes/QT-NOASSESS-CSTL/risk-assessment",
      { headers },
    );
    expect(res.status).toBe(404);
  });

  it("returns 401 without auth token", async () => {
    const res = await app.request(
      "/v1/coastal/quotes/QT-ASSESSED-CSTL/risk-assessment",
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["carrier:underwriting:write"]);
    const res = await app.request(
      "/v1/coastal/quotes/QT-ASSESSED-CSTL/risk-assessment",
      { headers },
    );
    expect(res.status).toBe(403);
  });
});

// ── Binding Routes ──

describe("POST /v1/coastal/quotes/:quote_id/bind", () => {
  it("binds an assessed quote and creates a policy", async () => {
    const headers = await authHeader(["carrier:underwriting:write"]);
    const res = await app.request("/v1/coastal/quotes/QT-ASSESSED-CSTL/bind", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        effective_date: "2026-03-15",
        payment_plan: "annual",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quote_id).toBe("QT-ASSESSED-CSTL");
    expect(body.policy_id).toBeDefined();
    expect(body.bind_status).toBe("bound");
    expect(body.effective_date).toBe("2026-03-15");
    expect(body.expiration_date).toBe("2027-03-15");
    expect(body.bound_at).toBeDefined();
  });

  it("returns 404 for non-existent quote", async () => {
    const headers = await authHeader(["carrier:underwriting:write"]);
    const res = await app.request("/v1/coastal/quotes/QT-NONEXISTENT/bind", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        effective_date: "2026-03-15",
        payment_plan: "annual",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when quote already bound", async () => {
    const headers = await authHeader(["carrier:underwriting:write"]);
    const res = await app.request("/v1/coastal/quotes/QT-BOUND-CSTL/bind", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        effective_date: "2026-03-15",
        payment_plan: "annual",
      }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 400 when quote not yet assessed", async () => {
    const headers = await authHeader(["carrier:underwriting:write"]);
    const res = await app.request("/v1/coastal/quotes/QT-NOASSESS-CSTL/bind", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        effective_date: "2026-03-15",
        payment_plan: "annual",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing effective_date", async () => {
    const headers = await authHeader(["carrier:underwriting:write"]);
    const res = await app.request("/v1/coastal/quotes/QT-ASSESSED-CSTL/bind", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ payment_plan: "annual" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 401 without auth token", async () => {
    const res = await app.request("/v1/coastal/quotes/QT-ASSESSED-CSTL/bind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        effective_date: "2026-03-15",
        payment_plan: "annual",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["carrier:quotes:read"]);
    const res = await app.request("/v1/coastal/quotes/QT-ASSESSED-CSTL/bind", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        effective_date: "2026-03-15",
        payment_plan: "annual",
      }),
    });
    expect(res.status).toBe(403);
  });
});

// ── Quick Quote Routes ──

describe("POST /v1/coastal/quotes/quick", () => {
  it("returns instant premium with VIN decode", async () => {
    const headers = await authHeader(["carrier:quotes:write"]);
    const res = await app.request("/v1/coastal/quotes/quick", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        vin: "1HGBH41JXMN109186",
        client_id: "CL-001",
        driver_name: "Jane Smith",
        driver_dob: "1990-05-20",
        driver_license: "S123456789",
        state: "IL",
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.quote_id).toBeDefined();
    expect(body.vehicle.vin).toBe("1HGBH41JXMN109186");
    expect(body.premium.annual).toBeGreaterThan(0);
    expect(body.premium.semi_annual).toBeGreaterThan(0);
    expect(body.premium.monthly).toBeGreaterThan(0);
  });

  it("returns 400 when VIN is missing", async () => {
    const headers = await authHeader(["carrier:quotes:write"]);
    const res = await app.request("/v1/coastal/quotes/quick", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        driver_name: "Jane Smith",
        driver_dob: "1990-05-20",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 401 without auth token", async () => {
    const res = await app.request("/v1/coastal/quotes/quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vin: "1HGBH41JXMN109186" }),
    });
    expect(res.status).toBe(401);
  });
});

// ── Recalculate Routes ──

describe("POST /v1/coastal/quotes/:id/recalculate", () => {
  it("recalculates premium with updated coverage config", async () => {
    const headers = await authHeader(["carrier:quotes:read"]);
    const res = await app.request("/v1/coastal/quotes/QT-001-CSTL/recalculate", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        coverage_config: {
          bodily_injury: "250000/500000",
          collision_deductible: 1000,
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quote_id).toBe("QT-001-CSTL");
    expect(body.adjusted_premium).toBeDefined();
    expect(body.adjusted_premium.annual).toBeGreaterThan(0);
    expect(body.adjusted_premium.monthly).toBeGreaterThan(0);
  });

  it("returns 404 for non-existent quote", async () => {
    const headers = await authHeader(["carrier:quotes:read"]);
    const res = await app.request("/v1/coastal/quotes/QT-NONEXISTENT/recalculate", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ coverage_config: {} }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 401 without auth token", async () => {
    const res = await app.request("/v1/coastal/quotes/QT-001-CSTL/recalculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverage_config: {} }),
    });
    expect(res.status).toBe(401);
  });
});

// ── ID Card Routes ──

describe("GET /v1/coastal/policies/:id/id-card", () => {
  it("generates a digital ID card for an active policy", async () => {
    const headers = await authHeader(["carrier:policies:read"]);
    const res = await app.request("/v1/coastal/policies/POL-EXISTING/id-card", {
      headers,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policy_id).toBe("POL-EXISTING");
    expect(body.card_data).toBeDefined();
    expect(body.issued_at).toBeDefined();
  });

  it("returns 404 for non-existent policy", async () => {
    const headers = await authHeader(["carrier:policies:read"]);
    const res = await app.request("/v1/coastal/policies/POL-NONEXISTENT/id-card", {
      headers,
    });
    expect(res.status).toBe(404);
  });

  it("returns 401 without auth token", async () => {
    const res = await app.request("/v1/coastal/policies/POL-EXISTING/id-card");
    expect(res.status).toBe(401);
  });
});
