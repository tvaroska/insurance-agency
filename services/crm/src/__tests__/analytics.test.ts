import { describe, it, expect, beforeAll } from "bun:test";
import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";

// ── Mock db module with in-memory database ──
const testSqlite = new Database(":memory:");
testSqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(testSqlite, { schema });

mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

import { analyticsRouter } from "../routes/analytics";
import { createTestApp, createTables, authHeader, makeRetentionRisk } from "./setup";

const app = createTestApp({ analytics: analyticsRouter });

const ANALYTICS_URL = "http://localhost/v1/analytics";

async function getRetentionRisk(params: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const url = new URL(`${ANALYTICS_URL}/retention-risk`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return app.request(url.toString(), { headers });
}

beforeAll(() => {
  createTables(testSqlite);

  // Seed retention risks with varied scores
  const risks = [
    makeRetentionRisk({ client_id: "CLI-R01", client_name: "High Risk", risk_score: 90, assigned_producer: "prod_A", rate_increase_pct: 18.0, months_since_contact: 10, email_open_rate: 0.02, policies_count: 1 }),
    makeRetentionRisk({ client_id: "CLI-R02", client_name: "Med-High Risk", risk_score: 75, assigned_producer: "prod_A", rate_increase_pct: 12.0, months_since_contact: 7, email_open_rate: 0.08, policies_count: 2 }),
    makeRetentionRisk({ client_id: "CLI-R03", client_name: "Medium Risk", risk_score: 60, assigned_producer: "prod_B", rate_increase_pct: 8.0, months_since_contact: 5, email_open_rate: 0.15, policies_count: 1 }),
    makeRetentionRisk({ client_id: "CLI-R04", client_name: "Low-Med Risk", risk_score: 45, assigned_producer: "prod_B", rate_increase_pct: 4.0, months_since_contact: 3, email_open_rate: 0.25, policies_count: 3 }),
    makeRetentionRisk({ client_id: "CLI-R05", client_name: "Low Risk", risk_score: 30, assigned_producer: "prod_A", rate_increase_pct: 2.0, months_since_contact: 1, email_open_rate: 0.45, policies_count: 4 }),
  ];

  for (const r of risks) {
    testDb.insert(schema.retentionRisks).values(r).run();
  }
});

// ── Auth tests ──

describe("GET /v1/analytics/retention-risk - Auth", () => {
  it("returns 401 without token", async () => {
    const res = await getRetentionRisk();
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getRetentionRisk({}, headers);
    expect(res.status).toBe(403);
  });
});

// ── Basic retrieval ──

describe("GET /v1/analytics/retention-risk - Basic", () => {
  it("returns at-risk clients with default min_risk_score=50", async () => {
    const headers = await authHeader(["crm:analytics:read"]);
    const res = await getRetentionRisk({}, headers);
    expect(res.status).toBe(200);

    const json = await res.json();
    // Default min_risk_score=50 filters out scores 45 and 30
    expect(json.data.length).toBe(3);
    for (const item of json.data) {
      expect(item.risk_score).toBeGreaterThanOrEqual(50);
    }
  });

  it("returns results sorted by risk_score desc", async () => {
    const headers = await authHeader(["crm:analytics:read"]);
    const res = await getRetentionRisk({}, headers);
    const json = await res.json();
    expect(json.data[0].risk_score).toBe(90);
    expect(json.data[1].risk_score).toBe(75);
    expect(json.data[2].risk_score).toBe(60);
  });

  it("returns nested factors object", async () => {
    const headers = await authHeader(["crm:analytics:read"]);
    const res = await getRetentionRisk({}, headers);
    const json = await res.json();

    const first = json.data[0];
    expect(first.factors).toBeDefined();
    expect(first.factors.rate_increase_pct).toBe(18.0);
    expect(first.factors.months_since_contact).toBe(10);
    expect(first.factors.email_open_rate).toBe(0.02);
    expect(first.factors.policies_count).toBe(1);
  });

  it("returns recommended_action", async () => {
    const headers = await authHeader(["crm:analytics:read"]);
    const res = await getRetentionRisk({}, headers);
    const json = await res.json();
    expect(json.data[0].recommended_action).toBeTruthy();
  });

  it("returns pagination metadata", async () => {
    const headers = await authHeader(["crm:analytics:read"]);
    const res = await getRetentionRisk({}, headers);
    const json = await res.json();
    expect(json.pagination).toBeDefined();
    expect(json.pagination.limit).toBe(25);
    expect(json.pagination.has_more).toBe(false);
  });
});

// ── Filters ──

describe("GET /v1/analytics/retention-risk - Filters", () => {
  it("filters by custom min_risk_score", async () => {
    const headers = await authHeader(["crm:analytics:read"]);
    const res = await getRetentionRisk({ min_risk_score: "70" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(2); // 90, 75
  });

  it("filters by min_risk_score=0 to include all", async () => {
    const headers = await authHeader(["crm:analytics:read"]);
    const res = await getRetentionRisk({ min_risk_score: "0" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(5);
  });

  it("filters by assigned_producer", async () => {
    const headers = await authHeader(["crm:analytics:read"]);
    const res = await getRetentionRisk({ min_risk_score: "0", assigned_producer: "prod_B" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(2);
    for (const item of json.data) {
      expect(item.client_id).toMatch(/CLI-R0[34]/);
    }
  });

  it("rejects min_risk_score out of range", async () => {
    const headers = await authHeader(["crm:analytics:read"]);
    const res = await getRetentionRisk({ min_risk_score: "150" }, headers);
    expect(res.status).toBe(400);
  });
});

// ── Pagination ──

describe("GET /v1/analytics/retention-risk - Pagination", () => {
  it("paginates with limit", async () => {
    const headers = await authHeader(["crm:analytics:read"]);
    const res = await getRetentionRisk({ limit: "2", min_risk_score: "0" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(2);
    expect(json.pagination.has_more).toBe(true);
    expect(json.pagination.next_cursor).toBeTruthy();
  });

  it("fetches next page with cursor", async () => {
    const headers = await authHeader(["crm:analytics:read"]);
    const res1 = await getRetentionRisk({ limit: "3", min_risk_score: "0" }, headers);
    const json1 = await res1.json();
    expect(json1.pagination.has_more).toBe(true);

    const res2 = await getRetentionRisk({ limit: "3", min_risk_score: "0", cursor: json1.pagination.next_cursor }, headers);
    const json2 = await res2.json();
    expect(json2.data.length).toBe(2);
    expect(json2.pagination.has_more).toBe(false);
  });
});
