import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";

const testSqlite = new Database(":memory:");
testSqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(testSqlite, { schema });

mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

import { describe, expect, test, beforeAll, beforeEach } from "bun:test";
import { escalationsRouter } from "../routes/escalations";
import { createTables, createTestApp, authHeader, makeEscalation } from "./setup";
import { processEscalation } from "../manager/engine";

const app = createTestApp({ escalations: escalationsRouter });

beforeAll(() => {
  createTables(testSqlite);
});

beforeEach(() => {
  testSqlite.exec("DELETE FROM escalation_events");
  testSqlite.exec("DELETE FROM escalations");
});

// ── Helpers ──

function postEscalation(body: any, headers: Record<string, string> = {}) {
  return app.request("/v1/escalations", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getEscalation(id: string, headers: Record<string, string>) {
  return app.request(`/v1/escalations/${id}`, { headers });
}

function listEscalations(params: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const url = new URL("http://localhost/v1/escalations");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return app.request(url.toString(), { headers });
}

// ── POST /v1/escalations ──

describe("POST /v1/escalations - auth", () => {
  test("returns 401 without auth", async () => {
    const res = await postEscalation({ client_id: "CL-001", reason: "premium_threshold", summary: "Test" });
    expect(res.status).toBe(401);
  });

  test("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["ams:clients:read"]);
    const res = await postEscalation({ client_id: "CL-001", reason: "premium_threshold", summary: "Test" }, headers);
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/escalations - validation", () => {
  test("returns 400 when client_id missing", async () => {
    const headers = await authHeader(["ams:escalations:write"]);
    const res = await postEscalation({ reason: "premium_threshold", summary: "Test" }, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 when reason missing", async () => {
    const headers = await authHeader(["ams:escalations:write"]);
    const res = await postEscalation({ client_id: "CL-001", summary: "Test" }, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 when summary missing", async () => {
    const headers = await authHeader(["ams:escalations:write"]);
    const res = await postEscalation({ client_id: "CL-001", reason: "premium_threshold" }, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid reason", async () => {
    const headers = await authHeader(["ams:escalations:write"]);
    const res = await postEscalation({ client_id: "CL-001", reason: "invalid_reason", summary: "Test" }, headers);
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/escalations - success", () => {
  test("returns 201 with correct fields", async () => {
    const headers = await authHeader(["ams:escalations:write"]);
    const res = await postEscalation({
      client_id: "CL-001",
      reason: "premium_threshold",
      summary: "Premium exceeds $10K",
      policy_id: "POL-001",
      context: { premium: 12000 },
    }, headers);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.escalation_id).toStartWith("esc_");
    expect(body.client_id).toBe("CL-001");
    expect(body.reason).toBe("premium_threshold");
    expect(body.summary).toBe("Premium exceeds $10K");
    expect(body.status).toBe("pending");
    expect(body.policy_id).toBe("POL-001");
    expect(body.context).toEqual({ premium: 12000 });
    expect(body.manager_response).toBeNull();
    expect(body.poll_count).toBe(0);
    expect(body.created_at).toBeDefined();
  });

  test("creates audit event on creation", async () => {
    const headers = await authHeader(["ams:escalations:write"]);
    const res = await postEscalation({
      client_id: "CL-001",
      reason: "premium_threshold",
      summary: "Test audit",
    }, headers);
    const body = await res.json();

    // Verify audit event exists
    const readHeaders = await authHeader(["ams:escalations:read"]);
    const getRes = await getEscalation(body.escalation_id, readHeaders);
    const getBody = await getRes.json();
    expect(getBody.events).toBeArray();
    expect(getBody.events.length).toBeGreaterThanOrEqual(1);
    expect(getBody.events[0].event_type).toBe("created");
    expect(getBody.events[0].to_status).toBe("pending");
  });
});

// ── GET /v1/escalations/:id ──

describe("GET /v1/escalations/:id", () => {
  test("returns 404 for non-existent escalation", async () => {
    const headers = await authHeader(["ams:escalations:read"]);
    const res = await getEscalation("esc_nonexistent", headers);
    expect(res.status).toBe(404);
  });

  test("returns pending on first poll", async () => {
    const esc = makeEscalation({ escalation_id: "esc_first001" });
    testDb.insert(schema.escalations).values(esc).run();
    testDb.insert(schema.escalationEvents).values({
      escalation_id: "esc_first001",
      event_type: "created",
      from_status: null,
      to_status: "pending",
      details: null,
      created_at: esc.created_at,
    }).run();

    const headers = await authHeader(["ams:escalations:read"]);
    const res = await getEscalation("esc_first001", headers);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("pending");
    expect(body.poll_count).toBe(1);
    expect(body.manager_response).toBeNull();
  });

  test("resolves on second poll (poll_count >= 2)", async () => {
    const esc = makeEscalation({ escalation_id: "esc_second01", poll_count: 0 });
    testDb.insert(schema.escalations).values(esc).run();
    testDb.insert(schema.escalationEvents).values({
      escalation_id: "esc_second01",
      event_type: "created",
      from_status: null,
      to_status: "pending",
      details: null,
      created_at: esc.created_at,
    }).run();

    const headers = await authHeader(["ams:escalations:read"]);

    // First poll — still pending
    const res1 = await getEscalation("esc_second01", headers);
    const body1 = await res1.json();
    expect(body1.status).toBe("pending");
    expect(body1.poll_count).toBe(1);

    // Second poll — should resolve
    const res2 = await getEscalation("esc_second01", headers);
    const body2 = await res2.json();
    expect(body2.status).not.toBe("pending");
    expect(body2.poll_count).toBe(2);
    expect(body2.manager_response).not.toBeNull();
    expect(body2.manager_response.decision).toBeDefined();
    expect(body2.manager_response.response_text).toBeDefined();
  });

  test("includes audit trail after resolution", async () => {
    const esc = makeEscalation({ escalation_id: "esc_audit001", poll_count: 1 });
    testDb.insert(schema.escalations).values(esc).run();
    testDb.insert(schema.escalationEvents).values({
      escalation_id: "esc_audit001",
      event_type: "created",
      from_status: null,
      to_status: "pending",
      details: null,
      created_at: esc.created_at,
    }).run();

    const headers = await authHeader(["ams:escalations:read"]);
    const res = await getEscalation("esc_audit001", headers);
    const body = await res.json();

    expect(body.events.length).toBeGreaterThanOrEqual(2);
    const eventTypes = body.events.map((e: any) => e.event_type);
    expect(eventTypes).toContain("created");
    expect(eventTypes).toContain("manager_reviewed");
  });

  test("does not re-process already resolved escalation", async () => {
    const esc = makeEscalation({
      escalation_id: "esc_resolved1",
      poll_count: 5,
      status: "approved",
      manager_response: JSON.stringify({ decision: "approved", template_id: "premium_threshold_approval", response_text: "Approved" }),
    });
    testDb.insert(schema.escalations).values(esc).run();

    const headers = await authHeader(["ams:escalations:read"]);
    const res = await getEscalation("esc_resolved1", headers);
    const body = await res.json();
    expect(body.status).toBe("approved");
    expect(body.poll_count).toBe(6);
  });
});

// ── GET /v1/escalations ──

describe("GET /v1/escalations - listing", () => {
  beforeEach(() => {
    const now = new Date().toISOString();
    const escalationRows = [
      makeEscalation({ escalation_id: "esc_list0001", client_id: "CL-001", status: "pending", created_at: "2026-01-01T00:00:00.000Z", updated_at: now }),
      makeEscalation({ escalation_id: "esc_list0002", client_id: "CL-001", status: "approved", created_at: "2026-01-02T00:00:00.000Z", updated_at: now }),
      makeEscalation({ escalation_id: "esc_list0003", client_id: "CL-002", status: "denied", created_at: "2026-01-03T00:00:00.000Z", updated_at: now }),
      makeEscalation({ escalation_id: "esc_list0004", client_id: "CL-002", status: "needs_info", created_at: "2026-01-04T00:00:00.000Z", updated_at: now }),
    ];
    for (const row of escalationRows) {
      testDb.insert(schema.escalations).values(row).run();
    }
  });

  test("returns all escalations with pagination", async () => {
    const headers = await authHeader(["ams:escalations:read"]);
    const res = await listEscalations({}, headers);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBe(4);
    expect(body.pagination).toBeDefined();
  });

  test("filters by status", async () => {
    const headers = await authHeader(["ams:escalations:read"]);
    const res = await listEscalations({ status: "pending" }, headers);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].status).toBe("pending");
  });

  test("filters by client_id", async () => {
    const headers = await authHeader(["ams:escalations:read"]);
    const res = await listEscalations({ client_id: "CL-002" }, headers);
    const body = await res.json();
    expect(body.data.length).toBe(2);
    for (const esc of body.data) {
      expect(esc.client_id).toBe("CL-002");
    }
  });

  test("filters by date range", async () => {
    const headers = await authHeader(["ams:escalations:read"]);
    const res = await listEscalations({
      created_after: "2026-01-02T00:00:00.000Z",
      created_before: "2026-01-03T00:00:00.000Z",
    }, headers);
    const body = await res.json();
    expect(body.data.length).toBe(2);
  });

  test("cursor pagination traverses all results", async () => {
    const headers = await authHeader(["ams:escalations:read"]);
    const allIds = new Set<string>();
    let url = "/v1/escalations?limit=2";

    while (true) {
      const res = await app.request(url, { headers });
      expect(res.status).toBe(200);
      const body = await res.json();

      for (const esc of body.data) {
        allIds.add(esc.escalation_id);
      }

      if (!body.pagination.has_more) break;
      expect(body.pagination.next_cursor).toBeTruthy();
      url = `/v1/escalations?limit=2&cursor=${body.pagination.next_cursor}`;
    }

    expect(allIds.size).toBe(4);
  });
});

// ── Manager Engine ──

describe("Manager engine - decisions", () => {
  test("premium_threshold returns approved by default", () => {
    const result = processEscalation({
      reason: "premium_threshold",
      summary: "Premium is $12,000 for a homeowners policy",
    });
    expect(result.decision).toBe("approved");
    expect(result.template_id).toBe("premium_threshold_approval");
  });

  test("premium_threshold with deny keyword returns denied", () => {
    const result = processEscalation({
      reason: "premium_threshold",
      summary: "Premium is too high, please deny this request",
    });
    expect(result.decision).toBe("denied");
    expect(result.template_id).toBe("premium_threshold_denial");
  });

  test("state_minimum_violation always returns denied", () => {
    const result = processEscalation({
      reason: "state_minimum_violation",
      summary: "BI limits below state minimum",
    });
    expect(result.decision).toBe("denied");
    expect(result.template_id).toBe("state_minimum_override_denial");
  });

  test("coverage_adequacy with roof keyword returns needs_info", () => {
    const result = processEscalation({
      reason: "coverage_adequacy",
      summary: "Roof inspection needed for 20 year old roof",
    });
    expect(result.decision).toBe("needs_info");
    expect(result.template_id).toBe("roof_inspection_required");
  });

  test("coverage_adequacy with gap keyword returns needs_info", () => {
    const result = processEscalation({
      reason: "coverage_adequacy",
      summary: "Coverage gap from Jan to March",
    });
    expect(result.decision).toBe("needs_info");
    expect(result.template_id).toBe("coverage_gap_review");
  });

  test("coverage_adequacy generic returns needs_info", () => {
    const result = processEscalation({
      reason: "coverage_adequacy",
      summary: "Need to verify current limits",
    });
    expect(result.decision).toBe("needs_info");
    expect(result.template_id).toBe("coverage_adequacy_review");
  });

  test("surplus_lines with missing license returns denied", () => {
    const result = processEscalation({
      reason: "surplus_lines",
      summary: "Producer has no license for surplus lines",
    });
    expect(result.decision).toBe("denied");
    expect(result.template_id).toBe("surplus_lines_license_missing");
  });

  test("surplus_lines default returns approved", () => {
    const result = processEscalation({
      reason: "surplus_lines",
      summary: "Need surplus lines placement for unique risk",
    });
    expect(result.decision).toBe("approved");
    expect(result.template_id).toBe("surplus_lines_approval");
  });

  test("principal_review with high value returns approved", () => {
    const result = processEscalation({
      reason: "principal_review",
      summary: "High value property at $2M",
    });
    expect(result.decision).toBe("approved");
    expect(result.template_id).toBe("high_value_property_approval");
  });

  test("principal_review default returns approved", () => {
    const result = processEscalation({
      reason: "principal_review",
      summary: "Standard review request",
    });
    expect(result.decision).toBe("approved");
    expect(result.template_id).toBe("principal_approval_granted");
  });

  test("backdating always returns denied", () => {
    const result = processEscalation({
      reason: "backdating",
      summary: "Client wants coverage backdated to last month",
    });
    expect(result.decision).toBe("denied");
    expect(result.template_id).toBe("backdating_denial");
  });

  test("unknown reason falls back to general_escalation_acknowledged", () => {
    const result = processEscalation({
      reason: "something_unknown",
      summary: "Unknown escalation type",
    });
    expect(result.decision).toBe("needs_info");
    expect(result.template_id).toBe("general_escalation_acknowledged");
  });
});
