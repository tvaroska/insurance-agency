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

import { leadsRouter } from "../routes/leads";
import { createTestApp, createTables, authHeader, makeLead } from "./setup";

const app = createTestApp({ leads: leadsRouter });

const LEADS_URL = "http://localhost/v1/leads";

async function getLeads(params: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const url = new URL(LEADS_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return app.request(url.toString(), { headers });
}

async function getScoring(params: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const url = new URL(`${LEADS_URL}/scoring`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return app.request(url.toString(), { headers });
}

async function patchLead(id: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.request(`${LEADS_URL}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function postLead(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.request(LEADS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  createTables(testSqlite);

  // Seed test leads with varied scores and statuses
  const leads = [
    makeLead({ lead_id: "lead_001", first_name: "Alice", last_name: "Top", score: 95, status: "qualified", source: "web", assigned_producer: "prod_A", client_id: "cli_100" }),
    makeLead({ lead_id: "lead_002", first_name: "Bob", last_name: "High", score: 80, status: "contacted", source: "referral", assigned_producer: "prod_A", client_id: "cli_100" }),
    makeLead({ lead_id: "lead_003", first_name: "Carol", last_name: "Mid", score: 60, status: "new", source: "cold_call", assigned_producer: "prod_B", client_id: "cli_200" }),
    makeLead({ lead_id: "lead_004", first_name: "Dave", last_name: "Low", score: 30, status: "closed_lost", source: "partner", assigned_producer: "prod_B", client_id: "cli_200" }),
    makeLead({ lead_id: "lead_005", first_name: "Eve", last_name: "Won", score: 90, status: "closed_won", source: "event", assigned_producer: "prod_A", client_id: "cli_300" }),
    makeLead({ lead_id: "lead_006", first_name: "Frank", last_name: "Prop", score: 75, status: "proposal_sent", source: "web", assigned_producer: "prod_A", client_id: "cli_300", tags: JSON.stringify(["high-value", "auto"]) }),
  ];

  for (const l of leads) {
    testDb.insert(schema.leads).values(l).run();
  }
});

// ── GET /leads ──

describe("GET /v1/leads - Auth", () => {
  it("returns 401 without token", async () => {
    const res = await getLeads();
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["crm:analytics:read"]);
    const res = await getLeads({}, headers);
    expect(res.status).toBe(403);
  });
});

describe("GET /v1/leads - Basic", () => {
  it("returns all leads sorted by score desc", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({}, headers);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.length).toBe(6);
    expect(json.data[0].score).toBe(95);
    expect(json.data[5].score).toBe(30);
  });

  it("returns pagination metadata", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({}, headers);
    const json = await res.json();
    expect(json.pagination).toBeDefined();
    expect(json.pagination.limit).toBe(25);
    expect(json.pagination.has_more).toBe(false);
  });
});

describe("GET /v1/leads - Filters", () => {
  it("filters by client_id", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ client_id: "cli_100" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(2);
    for (const lead of json.data) {
      expect(lead.client_id).toBe("cli_100");
    }
  });

  it("filters by status", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ status: "new" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(1);
    expect(json.data[0].lead_id).toBe("lead_003");
  });

  it("filters by source", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ source: "web" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(2);
  });

  it("filters by assigned_producer", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ assigned_producer: "prod_B" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(2);
  });

  it("filters by min_score", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ min_score: "80" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(3); // 95, 90, 80
    for (const lead of json.data) {
      expect(lead.score).toBeGreaterThanOrEqual(80);
    }
  });

  it("combines client_id and min_score filters", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ client_id: "cli_100", min_score: "90" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(1);
    expect(json.data[0].lead_id).toBe("lead_001");
  });

  it("returns empty array for non-existent client_id", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ client_id: "cli_999" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(0);
  });

  it("rejects invalid status enum", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ status: "invalid" }, headers);
    expect(res.status).toBe(400);
  });

  it("rejects invalid source enum", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ source: "invalid" }, headers);
    expect(res.status).toBe(400);
  });

  it("rejects min_score out of range", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ min_score: "150" }, headers);
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/leads - Pagination", () => {
  it("paginates with limit", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ limit: "2" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(2);
    expect(json.pagination.has_more).toBe(true);
    expect(json.pagination.next_cursor).toBeTruthy();
  });

  it("fetches next page with cursor", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res1 = await getLeads({ limit: "3" }, headers);
    const json1 = await res1.json();
    expect(json1.data.length).toBe(3);
    expect(json1.pagination.has_more).toBe(true);

    const res2 = await getLeads({ limit: "3", cursor: json1.pagination.next_cursor }, headers);
    const json2 = await res2.json();
    expect(json2.data.length).toBe(3);
    expect(json2.pagination.has_more).toBe(false);

    // No overlap between pages
    const ids1 = json1.data.map((d: any) => d.lead_id);
    const ids2 = json2.data.map((d: any) => d.lead_id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toEqual([]);
  });
});

// ── Auth tests ──

describe("GET /v1/leads/scoring - Auth", () => {
  it("returns 401 without token", async () => {
    const res = await getScoring();
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["crm:analytics:read"]);
    const res = await getScoring({}, headers);
    expect(res.status).toBe(403);
  });
});

// ── GET /leads/scoring ──

describe("GET /v1/leads/scoring - Basic", () => {
  it("returns all leads sorted by score desc", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getScoring({}, headers);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.length).toBe(6);
    expect(json.data[0].score).toBe(95);
    expect(json.data[1].score).toBe(90);
    expect(json.data[5].score).toBe(30);
  });

  it("returns tags as array", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getScoring({}, headers);
    const json = await res.json();
    const frank = json.data.find((l: any) => l.lead_id === "lead_006");
    expect(frank.tags).toEqual(["high-value", "auto"]);
  });

  it("returns pagination metadata", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getScoring({}, headers);
    const json = await res.json();
    expect(json.pagination).toBeDefined();
    expect(json.pagination.limit).toBe(25);
    expect(json.pagination.has_more).toBe(false);
  });
});

describe("GET /v1/leads/scoring - Filters", () => {
  it("filters by min_score", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getScoring({ min_score: "70" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(4); // 95, 90, 80, 75
    for (const lead of json.data) {
      expect(lead.score).toBeGreaterThanOrEqual(70);
    }
  });

  it("filters by status", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getScoring({ status: "qualified" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(1);
    expect(json.data[0].lead_id).toBe("lead_001");
  });

  it("filters by source", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getScoring({ source: "web" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(2);
  });

  it("filters by assigned_producer", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getScoring({ assigned_producer: "prod_B" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(2);
  });

  it("combines multiple filters", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getScoring({ source: "web", min_score: "80" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(1);
    expect(json.data[0].lead_id).toBe("lead_001");
  });

  it("rejects invalid status enum", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getScoring({ status: "invalid" }, headers);
    expect(res.status).toBe(400);
  });

  it("rejects invalid source enum", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getScoring({ source: "invalid" }, headers);
    expect(res.status).toBe(400);
  });

  it("rejects min_score out of range", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getScoring({ min_score: "150" }, headers);
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/leads/scoring - Pagination", () => {
  it("paginates with limit", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getScoring({ limit: "2" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(2);
    expect(json.pagination.has_more).toBe(true);
    expect(json.pagination.next_cursor).toBeTruthy();
  });

  it("fetches next page with cursor", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res1 = await getScoring({ limit: "3" }, headers);
    const json1 = await res1.json();
    expect(json1.data.length).toBe(3);
    expect(json1.pagination.has_more).toBe(true);

    const res2 = await getScoring({ limit: "3", cursor: json1.pagination.next_cursor }, headers);
    const json2 = await res2.json();
    expect(json2.data.length).toBe(3);
    expect(json2.pagination.has_more).toBe(false);

    // No overlap between pages
    const ids1 = json1.data.map((d: any) => d.lead_id);
    const ids2 = json2.data.map((d: any) => d.lead_id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toEqual([]);
  });
});

// ── PATCH /leads/:id ──

describe("PATCH /v1/leads/:id - Auth", () => {
  it("returns 401 without token", async () => {
    const res = await patchLead("lead_001", { score: 99 });
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await patchLead("lead_001", { score: 99 }, headers);
    expect(res.status).toBe(403);
  });
});

describe("PATCH /v1/leads/:id - Validation", () => {
  it("rejects empty body", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await patchLead("lead_001", {}, headers);
    expect(res.status).toBe(400);
  });

  it("rejects invalid status", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await patchLead("lead_001", { status: "invalid" }, headers);
    expect(res.status).toBe(400);
  });

  it("rejects score out of range", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await patchLead("lead_001", { score: 150 }, headers);
    expect(res.status).toBe(400);
  });

  it("rejects notes exceeding max length", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await patchLead("lead_001", { notes: "x".repeat(2001) }, headers);
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent lead", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await patchLead("lead_nonexistent", { score: 50 }, headers);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /v1/leads/:id - Update", () => {
  it("updates score", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await patchLead("lead_003", { score: 85 }, headers);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.score).toBe(85);
    expect(json.lead_id).toBe("lead_003");
  });

  it("updates status", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await patchLead("lead_003", { status: "contacted" }, headers);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("contacted");
  });

  it("updates tags", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await patchLead("lead_003", { tags: ["new-tag", "priority"] }, headers);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tags).toEqual(["new-tag", "priority"]);
  });

  it("updates notes", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await patchLead("lead_003", { notes: "Follow up needed." }, headers);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.notes).toBe("Follow up needed.");
  });

  it("updates assigned_producer", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await patchLead("lead_003", { assigned_producer: "prod_new" }, headers);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.assigned_producer).toBe("prod_new");
  });

  it("updates multiple fields at once", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await patchLead("lead_004", {
      status: "contacted",
      score: 45,
      notes: "Re-engaged via phone.",
    }, headers);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("contacted");
    expect(json.score).toBe(45);
    expect(json.notes).toBe("Re-engaged via phone.");
  });

  it("sets last_activity_date and updated_at on update", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await patchLead("lead_002", { score: 82 }, headers);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated_at).toBeTruthy();
    expect(json.last_activity_date).toBeTruthy();
  });
});

// ── POST /leads ──

describe("POST /v1/leads - Auth", () => {
  it("returns 401 without token", async () => {
    const res = await postLead({ first_name: "Test", last_name: "Lead", email: "test@example.com", source: "web" });
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await postLead({ first_name: "Test", last_name: "Lead", email: "test@example.com", source: "web" }, headers);
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/leads - Validation", () => {
  it("returns 400 when first_name missing", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await postLead({ last_name: "Lead", email: "test@example.com", source: "web" }, headers);
    expect(res.status).toBe(400);
  });

  it("returns 400 when last_name missing", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await postLead({ first_name: "Test", email: "test@example.com", source: "web" }, headers);
    expect(res.status).toBe(400);
  });

  it("returns 400 when email missing", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await postLead({ first_name: "Test", last_name: "Lead", source: "web" }, headers);
    expect(res.status).toBe(400);
  });

  it("returns 400 when source missing", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await postLead({ first_name: "Test", last_name: "Lead", email: "test@example.com" }, headers);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid source enum", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await postLead({ first_name: "Test", last_name: "Lead", email: "test@example.com", source: "invalid" }, headers);
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/leads - Success", () => {
  it("creates lead with required fields and defaults", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await postLead({ first_name: "New", last_name: "Lead", email: "new@example.com", source: "web" }, headers);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.lead_id).toStartWith("lead_");
    expect(json.first_name).toBe("New");
    expect(json.last_name).toBe("Lead");
    expect(json.email).toBe("new@example.com");
    expect(json.source).toBe("web");
    expect(json.status).toBe("new");
    expect(json.score).toBe(50);
    expect(json.tags).toEqual([]);
    expect(json.created_at).toBeTruthy();
  });

  it("creates lead with all fields", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await postLead({
      first_name: "Full",
      last_name: "Record",
      email: "full@example.com",
      phone: "+1-555-0200",
      source: "referral",
      client_id: "CLI-099",
      assigned_producer: "prod_new",
      tags: ["auto", "high-value"],
      notes: "Referred by existing client",
    }, headers);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.client_id).toBe("CLI-099");
    expect(json.phone).toBe("+1-555-0200");
    expect(json.assigned_producer).toBe("prod_new");
    expect(json.tags).toEqual(["auto", "high-value"]);
    expect(json.notes).toBe("Referred by existing client");
    expect(json.status).toBe("new");
    expect(json.score).toBe(50);
  });

  it("creates lead without optional client_id", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await postLead({ first_name: "No", last_name: "Client", email: "noclient@example.com", source: "cold_call" }, headers);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.client_id).toBe("");
  });
});

// ── GET /v1/leads - additional filter combinations ──

describe("GET /v1/leads - combined filters", () => {
  it("combines status and source filters", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ status: "qualified", source: "web" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(1);
    expect(json.data[0].lead_id).toBe("lead_001");
    expect(json.data[0].status).toBe("qualified");
    expect(json.data[0].source).toBe("web");
  });

  it("combines assigned_producer and status filters", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ assigned_producer: "prod_A", status: "closed_won" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(1);
    expect(json.data[0].lead_id).toBe("lead_005");
  });

  it("combines three filters at once", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ assigned_producer: "prod_A", source: "web", min_score: "70" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(2); // lead_001 (95) and lead_006 (75)
    for (const lead of json.data) {
      expect(lead.assigned_producer).toBe("prod_A");
      expect(lead.source).toBe("web");
      expect(lead.score).toBeGreaterThanOrEqual(70);
    }
  });

  it("returns empty when filters match nothing", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ status: "qualified", source: "cold_call" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(0);
  });
});

describe("GET /v1/leads - response shape", () => {
  it("each lead has all expected fields", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({}, headers);
    const json = await res.json();
    const lead = json.data[0];
    expect(lead).toHaveProperty("lead_id");
    expect(lead).toHaveProperty("client_id");
    expect(lead).toHaveProperty("first_name");
    expect(lead).toHaveProperty("last_name");
    expect(lead).toHaveProperty("email");
    expect(lead).toHaveProperty("phone");
    expect(lead).toHaveProperty("source");
    expect(lead).toHaveProperty("status");
    expect(lead).toHaveProperty("score");
    expect(lead).toHaveProperty("assigned_producer");
    expect(lead).toHaveProperty("tags");
    expect(lead).toHaveProperty("notes");
    expect(lead).toHaveProperty("last_activity_date");
    expect(lead).toHaveProperty("created_at");
    expect(lead).toHaveProperty("updated_at");
  });

  it("tags are parsed as arrays not JSON strings", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({}, headers);
    const json = await res.json();
    const frank = json.data.find((l: any) => l.lead_id === "lead_006");
    expect(Array.isArray(frank.tags)).toBe(true);
    expect(frank.tags).toEqual(["high-value", "auto"]);
  });

  it("leads with no tags return empty array", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ status: "qualified" }, headers);
    const json = await res.json();
    expect(json.data[0].tags).toEqual(["test"]);
  });
});

describe("GET /v1/leads - validation edge cases", () => {
  it("rejects min_score of -1", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ min_score: "-1" }, headers);
    expect(res.status).toBe(400);
  });

  it("accepts min_score of 0", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ min_score: "0" }, headers);
    expect(res.status).toBe(200);
    const json = await res.json();
    // All leads have score >= 0, so all seeded + created leads returned
    expect(json.data.length).toBeGreaterThanOrEqual(6);
  });

  it("accepts min_score of 100", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ min_score: "100" }, headers);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(0);
  });
});

describe("GET /v1/leads - pagination with filters", () => {
  it("paginates filtered results correctly", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await getLeads({ assigned_producer: "prod_A", limit: "2" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(2);
    expect(json.pagination.has_more).toBe(true);

    const res2 = await getLeads({ assigned_producer: "prod_A", limit: "2", cursor: json.pagination.next_cursor }, headers);
    const json2 = await res2.json();
    expect(json2.data.length).toBe(2);
    expect(json2.pagination.has_more).toBe(false);

    // Total prod_A leads = 4
    const allIds = [...json.data.map((d: any) => d.lead_id), ...json2.data.map((d: any) => d.lead_id)];
    expect(new Set(allIds).size).toBe(4);
  });
});

// ── GET /v1/leads/:id ──

describe("GET /v1/leads/:id - success", () => {
  it("returns lead by ID", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await app.request(`${LEADS_URL}/lead_001`, { headers });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.lead_id).toBe("lead_001");
    expect(json.first_name).toBe("Alice");
    expect(json.tags).toBeArray();
  });

  it("returns 404 for nonexistent lead", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await app.request(`${LEADS_URL}/lead_nonexistent`, { headers });
    expect(res.status).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const res = await app.request(`${LEADS_URL}/lead_001`);
    expect(res.status).toBe(401);
  });
});

// ── POST /v1/leads/:id/enroll ──

describe("POST /v1/leads/:id/enroll - success", () => {
  it("enrolls lead in a campaign", async () => {
    // First, seed a campaign
    const { db: testDb } = require("../db");
    const schema = require("../schema");
    testDb.insert(schema.campaigns).values({
      campaign_id: "camp_test_enroll",
      name: "Test Enrollment Campaign",
      type: "welcome",
      status: "active",
      enrolled_count: 0,
      conversion_rate: 0,
    }).run();

    const headers = await authHeader(["crm:campaigns:enroll"]);
    const res = await app.request(`${LEADS_URL}/lead_001/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ campaign_id: "camp_test_enroll" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.enrollment_id).toMatch(/^enr_/);
    expect(json.campaign_id).toBe("camp_test_enroll");
    expect(json.client_id).toBe("cli_100"); // from lead_001's client_id
  });

  it("returns 404 for nonexistent lead", async () => {
    const headers = await authHeader(["crm:campaigns:enroll"]);
    const res = await app.request(`${LEADS_URL}/lead_nonexistent/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ campaign_id: "camp_test_enroll" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when campaign_id missing", async () => {
    const headers = await authHeader(["crm:campaigns:enroll"]);
    const res = await app.request(`${LEADS_URL}/lead_001/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
