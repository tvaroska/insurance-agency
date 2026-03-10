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

import { campaignsRouter } from "../routes/campaigns";
import { createTestApp, createTables, authHeader, makeCampaign, makeEnrollment } from "./setup";

const app = createTestApp({ campaigns: campaignsRouter });

const CAMPAIGNS_URL = "http://localhost/v1/campaigns";

async function postEnroll(campaignId: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.request(`${CAMPAIGNS_URL}/${campaignId}/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  createTables(testSqlite);

  // Seed test campaigns
  const campaigns = [
    makeCampaign({ campaign_id: "camp_active_1", name: "Active Campaign", status: "active", enrolled_count: 10 }),
    makeCampaign({ campaign_id: "camp_paused_1", name: "Paused Campaign", status: "paused" }),
    makeCampaign({ campaign_id: "camp_completed_1", name: "Completed Campaign", status: "completed" }),
  ];

  for (const c of campaigns) {
    testDb.insert(schema.campaigns).values(c).run();
  }

  // Add an existing enrollment to test duplicate detection
  testDb.insert(schema.campaignEnrollments)
    .values(makeEnrollment({
      enrollment_id: "enr_existing",
      campaign_id: "camp_active_1",
      client_id: "CLI-EXISTING",
    }))
    .run();
});

// ── Auth tests ──

describe("POST /v1/campaigns/:id/enroll - Auth", () => {
  it("returns 401 without token", async () => {
    const res = await postEnroll("camp_active_1", { client_id: "CLI-001" });
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await postEnroll("camp_active_1", { client_id: "CLI-001" }, headers);
    expect(res.status).toBe(403);
  });
});

// ── Validation tests ──

describe("POST /v1/campaigns/:id/enroll - Validation", () => {
  it("rejects missing client_id", async () => {
    const headers = await authHeader(["crm:campaigns:enroll"]);
    const res = await postEnroll("camp_active_1", {}, headers);
    expect(res.status).toBe(400);
  });

  it("rejects trigger_reason exceeding max length", async () => {
    const headers = await authHeader(["crm:campaigns:enroll"]);
    const res = await postEnroll("camp_active_1", {
      client_id: "CLI-001",
      trigger_reason: "x".repeat(501),
    }, headers);
    expect(res.status).toBe(400);
  });
});

// ── Not found / Conflict ──

describe("POST /v1/campaigns/:id/enroll - Not Found / Conflict", () => {
  it("returns 404 for non-existent campaign", async () => {
    const headers = await authHeader(["crm:campaigns:enroll"]);
    const res = await postEnroll("camp_nonexistent", { client_id: "CLI-001" }, headers);
    expect(res.status).toBe(404);
  });

  it("returns 409 for paused campaign", async () => {
    const headers = await authHeader(["crm:campaigns:enroll"]);
    const res = await postEnroll("camp_paused_1", { client_id: "CLI-001" }, headers);
    expect(res.status).toBe(409);
  });

  it("returns 409 for completed campaign", async () => {
    const headers = await authHeader(["crm:campaigns:enroll"]);
    const res = await postEnroll("camp_completed_1", { client_id: "CLI-001" }, headers);
    expect(res.status).toBe(409);
  });

  it("returns 409 for duplicate enrollment", async () => {
    const headers = await authHeader(["crm:campaigns:enroll"]);
    const res = await postEnroll("camp_active_1", { client_id: "CLI-EXISTING" }, headers);
    expect(res.status).toBe(409);
  });
});

// ── Successful enrollment ──

describe("POST /v1/campaigns/:id/enroll - Success", () => {
  it("enrolls client and returns 201", async () => {
    const headers = await authHeader(["crm:campaigns:enroll"]);
    const res = await postEnroll("camp_active_1", {
      client_id: "CLI-NEW-001",
      trigger_reason: "Annual review interest.",
    }, headers);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.enrollment_id).toMatch(/^enr_/);
    expect(json.campaign_id).toBe("camp_active_1");
    expect(json.client_id).toBe("CLI-NEW-001");
    expect(json.sequence_step).toBe(1);
    expect(json.enrolled_at).toBeTruthy();
  });

  it("increments enrolled_count", async () => {
    const headers = await authHeader(["crm:campaigns:enroll"]);
    // First, check the campaign had 10+1 enrollments already (from previous test)
    await postEnroll("camp_active_1", {
      client_id: "CLI-NEW-002",
    }, headers);

    // Verify by trying to detect count via a second enrollment
    const row = testDb.select().from(schema.campaigns).all()
      .find((c: any) => c.campaign_id === "camp_active_1");
    expect(row!.enrolled_count).toBeGreaterThanOrEqual(12);
  });

  it("stores metadata as JSON", async () => {
    const headers = await authHeader(["crm:campaigns:enroll"]);
    const res = await postEnroll("camp_active_1", {
      client_id: "CLI-META-001",
      trigger_reason: "Term conversion interest.",
      metadata: { current_policy: "pol_123", coverage_amount: 500000 },
    }, headers);
    expect(res.status).toBe(201);

    // Verify metadata stored in DB
    const enrollment = testDb.select().from(schema.campaignEnrollments).all()
      .find((e: any) => e.client_id === "CLI-META-001");
    expect(enrollment).toBeTruthy();
    const parsed = JSON.parse(enrollment!.metadata!);
    expect(parsed.current_policy).toBe("pol_123");
    expect(parsed.coverage_amount).toBe(500000);
  });

  it("prevents duplicate enrollment after successful one", async () => {
    const headers = await authHeader(["crm:campaigns:enroll"]);
    const res = await postEnroll("camp_active_1", { client_id: "CLI-NEW-001" }, headers);
    expect(res.status).toBe(409);
  });
});

// ── GET /v1/campaigns — List ──

async function getCampaigns(params: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const url = new URL(CAMPAIGNS_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return app.request(url.toString(), { headers });
}

describe("GET /v1/campaigns - Auth", () => {
  it("returns 401 without token", async () => {
    const res = await getCampaigns();
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getCampaigns({}, headers);
    expect(res.status).toBe(403);
  });
});

describe("GET /v1/campaigns - List", () => {
  it("returns all campaigns", async () => {
    const headers = await authHeader(["crm:campaigns:read"]);
    const res = await getCampaigns({}, headers);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toBeArray();
    expect(json.data.length).toBe(3);
    expect(json.pagination).toBeDefined();
  });

  it("filters by status=active", async () => {
    const headers = await authHeader(["crm:campaigns:read"]);
    const res = await getCampaigns({ status: "active" }, headers);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(1);
    expect(json.data[0].status).toBe("active");
  });

  it("filters by type", async () => {
    const headers = await authHeader(["crm:campaigns:read"]);
    const res = await getCampaigns({ type: "nurture" }, headers);
    expect(res.status).toBe(200);
    const json = await res.json();
    for (const c of json.data) {
      expect(c.type).toBe("nurture");
    }
  });

  it("returns 400 for invalid status", async () => {
    const headers = await authHeader(["crm:campaigns:read"]);
    const res = await getCampaigns({ status: "invalid" }, headers);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid type", async () => {
    const headers = await authHeader(["crm:campaigns:read"]);
    const res = await getCampaigns({ type: "invalid" }, headers);
    expect(res.status).toBe(400);
  });

  it("paginates with limit", async () => {
    const headers = await authHeader(["crm:campaigns:read"]);
    const res = await getCampaigns({ limit: "2" }, headers);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(2);
    expect(json.pagination.has_more).toBe(true);
  });
});
