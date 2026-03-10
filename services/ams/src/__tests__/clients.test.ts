import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";

const testSqlite = new Database(":memory:");
testSqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(testSqlite, { schema });

mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

import { describe, expect, test, beforeAll, beforeEach } from "bun:test";
import { clientsRouter } from "../routes/clients";
import { createTables, createTestApp, authHeader, makeClient, makePolicy, makeTask } from "./setup";

const app = createTestApp({ clients: clientsRouter });

beforeAll(() => {
  createTables(testSqlite);
});

beforeEach(() => {
  testSqlite.exec("DELETE FROM coverages");
  testSqlite.exec("DELETE FROM commissions");
  testSqlite.exec("DELETE FROM endorsements");
  testSqlite.exec("DELETE FROM tasks");
  testSqlite.exec("DELETE FROM policies");
  testSqlite.exec("DELETE FROM clients");

  const clientRows = [
    makeClient({ id: "CL-001", first_name: "Alice", last_name: "Adams", email: "alice@example.com", status: "active", household_id: "HH-001", address_street: "123 Main St", address_city: "Hartford", address_state: "CT", address_zip: "06101" }),
    makeClient({ id: "CL-002", first_name: "Bob", last_name: "Adams", email: "bob@example.com", status: "inactive", household_id: "HH-001" }),
    makeClient({ id: "CL-003", first_name: "Carol", last_name: "Baker", email: "carol@example.com", status: "active", household_id: "HH-002" }),
    makeClient({ id: "CL-004", first_name: "Dan", last_name: "Baker", email: "dan@example.com", status: "prospect" }),
    makeClient({ id: "CL-005", first_name: "Eve", last_name: "Zane", email: "eve@example.com", status: "active" }),
  ];

  for (const row of clientRows) {
    testDb.insert(schema.clients).values(row).run();
  }
});

// ── Helpers ──

function postClient(body: any, headers: Record<string, string> = {}) {
  return app.request("/v1/clients", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchClient(id: string, body: any, headers: Record<string, string> = {}) {
  return app.request(`/v1/clients/${id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── GET /v1/clients ──

describe("GET /v1/clients - auth", () => {
  test("returns 401 without Authorization header", async () => {
    const res = await app.request("/v1/clients");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe("AUTH_ERROR");
  });

  test("returns 403 with wrong scope", async () => {
    const res = await app.request("/v1/clients", {
      headers: await authHeader(["ams:policies:read"]),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe("FORBIDDEN");
  });
});

describe("GET /v1/clients - listing", () => {
  test("returns 200 with clients and pagination metadata", async () => {
    const res = await app.request("/v1/clients", {
      headers: await authHeader(["ams:clients:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.limit).toBeDefined();
    expect(typeof body.pagination.has_more).toBe("boolean");
  });

  test("nests address fields into address object", async () => {
    const res = await app.request("/v1/clients?last_name=Adams&status=active", {
      headers: await authHeader(["ams:clients:read"]),
    });
    const body = await res.json();
    const alice = body.data.find((c: any) => c.id === "CL-001");
    expect(alice).toBeDefined();
    expect(alice.address).toEqual({
      street: "123 Main St",
      city: "Hartford",
      state: "CT",
      zip: "06101",
    });
    expect(alice.address_street).toBeUndefined();
  });
});

describe("GET /v1/clients - filters", () => {
  test("filters by status=active", async () => {
    const res = await app.request("/v1/clients?status=active", {
      headers: await authHeader(["ams:clients:read"]),
    });
    const body = await res.json();
    expect(body.data.length).toBe(3);
    for (const c of body.data) {
      expect(c.status).toBe("active");
    }
  });

  test("filters by last_name prefix", async () => {
    const res = await app.request("/v1/clients?last_name=Ada", {
      headers: await authHeader(["ams:clients:read"]),
    });
    const body = await res.json();
    expect(body.data.length).toBe(2);
    for (const c of body.data) {
      expect(c.last_name).toStartWith("Ada");
    }
  });

  test("filters by email", async () => {
    const res = await app.request("/v1/clients?email=alice@example.com", {
      headers: await authHeader(["ams:clients:read"]),
    });
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].email).toBe("alice@example.com");
  });

  test("returns empty data for non-matching email", async () => {
    const res = await app.request("/v1/clients?email=nobody@example.com", {
      headers: await authHeader(["ams:clients:read"]),
    });
    const body = await res.json();
    expect(body.data.length).toBe(0);
  });

  test("filters by household_id", async () => {
    const res = await app.request("/v1/clients?household_id=HH-001", {
      headers: await authHeader(["ams:clients:read"]),
    });
    const body = await res.json();
    expect(body.data.length).toBe(2);
  });

  test("returns 400 for invalid status", async () => {
    const res = await app.request("/v1/clients?status=deleted", {
      headers: await authHeader(["ams:clients:read"]),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe("VALIDATION_ERROR");
  });

  test("returns 400 for last_name exceeding 100 chars", async () => {
    const longName = "a".repeat(101);
    const res = await app.request(`/v1/clients?last_name=${longName}`, {
      headers: await authHeader(["ams:clients:read"]),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /v1/clients - pagination", () => {
  test("cursor pagination traverses all results", async () => {
    const headers = await authHeader(["ams:clients:read"]);
    const allIds = new Set<string>();
    let url = "/v1/clients?limit=2";

    while (true) {
      const res = await app.request(url, { headers });
      expect(res.status).toBe(200);
      const body = await res.json();

      for (const c of body.data) {
        allIds.add(c.id);
      }

      if (!body.pagination.has_more) break;
      expect(body.pagination.next_cursor).toBeTruthy();
      url = `/v1/clients?limit=2&cursor=${body.pagination.next_cursor}`;
    }

    expect(allIds.size).toBe(5);
  });
});

// ── POST /v1/clients ──

describe("POST /v1/clients - auth", () => {
  test("returns 401 without auth", async () => {
    const res = await postClient({ first_name: "Test", last_name: "User", email: "test@example.com" });
    expect(res.status).toBe(401);
  });

  test("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["ams:clients:read"]);
    const res = await postClient({ first_name: "Test", last_name: "User", email: "test@example.com" }, headers);
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/clients - validation", () => {
  test("returns 400 when first_name missing", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await postClient({ last_name: "User", email: "test@example.com" }, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 when last_name missing", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await postClient({ first_name: "Test", email: "test@example.com" }, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 when email missing", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await postClient({ first_name: "Test", last_name: "User" }, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid status enum", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await postClient({ first_name: "Test", last_name: "User", email: "new@example.com", status: "deleted" }, headers);
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/clients - duplicate detection", () => {
  test("returns 409 for duplicate email", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await postClient({ first_name: "Another", last_name: "Alice", email: "alice@example.com" }, headers);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe("CONFLICT");
  });
});

describe("POST /v1/clients - success", () => {
  test("creates client with required fields only", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await postClient({ first_name: "New", last_name: "Client", email: "new@example.com" }, headers);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toStartWith("CL-");
    expect(body.first_name).toBe("New");
    expect(body.last_name).toBe("Client");
    expect(body.email).toBe("new@example.com");
    expect(body.status).toBe("active");
    expect(body.address).toBeDefined();
    expect(body.created_at).toBeDefined();
  });

  test("creates client with all fields", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await postClient({
      first_name: "Full",
      last_name: "Record",
      email: "full@example.com",
      dob: "1990-01-15",
      phone: "+1-555-0100",
      address: { street: "456 Oak Ave", city: "Portland", state: "OR", zip: "97201" },
      driver_license_number: "DL-12345",
      occupation: "Engineer",
      marital_status: "married",
      household_id: "HH-099",
      preferred_contact_method: "email",
      status: "prospect",
    }, headers);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.address.street).toBe("456 Oak Ave");
    expect(body.address.city).toBe("Portland");
    expect(body.marital_status).toBe("married");
    expect(body.status).toBe("prospect");
    expect(body.occupation).toBe("Engineer");
  });
});

// ── PATCH /v1/clients/:id ──

describe("PATCH /v1/clients/:id - auth", () => {
  test("returns 401 without auth", async () => {
    const res = await patchClient("CL-001", { first_name: "Updated" });
    expect(res.status).toBe(401);
  });
});

describe("PATCH /v1/clients/:id - validation", () => {
  test("returns 404 for nonexistent client", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await patchClient("CL-NOPE", { first_name: "Updated" }, headers);
    expect(res.status).toBe(404);
  });

  test("returns 400 when no updatable fields present", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await patchClient("CL-001", { random_field: "value" }, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid status enum", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await patchClient("CL-001", { status: "deleted" }, headers);
    expect(res.status).toBe(400);
  });
});

describe("PATCH /v1/clients/:id - success", () => {
  test("updates first_name", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await patchClient("CL-001", { first_name: "Alicia" }, headers);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.first_name).toBe("Alicia");
    expect(body.id).toBe("CL-001");
  });

  test("updates address", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await patchClient("CL-001", { address: { street: "999 New St", city: "Boston", state: "MA", zip: "02101" } }, headers);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.address.street).toBe("999 New St");
    expect(body.address.city).toBe("Boston");
  });

  test("updates status", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await patchClient("CL-001", { status: "inactive" }, headers);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("inactive");
  });

  test("returns 409 when updating email to duplicate", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await patchClient("CL-001", { email: "bob@example.com" }, headers);
    expect(res.status).toBe(409);
  });

  test("allows updating email to same value", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await patchClient("CL-001", { email: "alice@example.com" }, headers);
    expect(res.status).toBe(200);
  });
});

// ── POST /v1/clients/:id/merge ──

function mergeClient(id: string, body: any, headers: Record<string, string> = {}) {
  return app.request(`/v1/clients/${id}/merge`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/clients/:id/merge - auth", () => {
  test("returns 401 without auth", async () => {
    const res = await mergeClient("CL-001", { source_client_id: "CL-002" });
    expect(res.status).toBe(401);
  });

  test("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["ams:clients:read"]);
    const res = await mergeClient("CL-001", { source_client_id: "CL-002" }, headers);
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/clients/:id/merge - validation", () => {
  test("returns 400 when source_client_id missing", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await mergeClient("CL-001", {}, headers);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe("VALIDATION_ERROR");
  });

  test("returns 409 when merging client with itself", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await mergeClient("CL-001", { source_client_id: "CL-001" }, headers);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe("CONFLICT");
  });

  test("returns 404 when target client not found", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await mergeClient("CL-NOPE", { source_client_id: "CL-002" }, headers);
    expect(res.status).toBe(404);
  });

  test("returns 404 when source client not found", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await mergeClient("CL-001", { source_client_id: "CL-NOPE" }, headers);
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/clients/:id/merge - success", () => {
  test("merges clients with policies and tasks", async () => {
    // Seed policies and tasks for source client
    testDb.insert(schema.policies).values(makePolicy({ policy_id: "POL-M1", client_id: "CL-002" })).run();
    testDb.insert(schema.policies).values(makePolicy({ policy_id: "POL-M2", client_id: "CL-002" })).run();
    testDb.insert(schema.tasks).values(makeTask({ id: "TASK-M1", related_client_id: "CL-002" })).run();

    const headers = await authHeader(["ams:clients:write"]);
    const res = await mergeClient("CL-001", { source_client_id: "CL-002" }, headers);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.target_client.id).toBe("CL-001");
    expect(body.source_client_id).toBe("CL-002");
    expect(body.policies_moved).toBe(2);
    expect(body.tasks_moved).toBe(1);
  });

  test("sets source client status to inactive", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    await mergeClient("CL-001", { source_client_id: "CL-003" }, headers);

    // Verify source is inactive
    const res = await app.request("/v1/clients/CL-003", {
      headers: await authHeader(["ams:clients:read"]),
    });
    const body = await res.json();
    expect(body.status).toBe("inactive");
  });

  test("merge with no policies or tasks returns zero counts", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await mergeClient("CL-001", { source_client_id: "CL-005" }, headers);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policies_moved).toBe(0);
    expect(body.tasks_moved).toBe(0);
  });
});

// ── GET /v1/clients/household/:household_id ──

describe("GET /v1/clients/household/:household_id - auth", () => {
  test("returns 401 without auth", async () => {
    const res = await app.request("/v1/clients/household/HH-001");
    expect(res.status).toBe(401);
  });
});

describe("GET /v1/clients/household/:household_id - validation", () => {
  test("returns 404 for nonexistent household", async () => {
    const res = await app.request("/v1/clients/household/HH-NOPE", {
      headers: await authHeader(["ams:clients:read"]),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe("NOT_FOUND");
  });
});

describe("GET /v1/clients/household/:household_id - success", () => {
  test("returns household summary with members", async () => {
    const res = await app.request("/v1/clients/household/HH-001", {
      headers: await authHeader(["ams:clients:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.household_id).toBe("HH-001");
    expect(body.member_count).toBe(2);
    expect(body.members).toBeArray();
    expect(body.members.length).toBe(2);
    expect(body.coverage_gaps).toBeArray();
  });

  test("computes policy counts and premiums per member", async () => {
    // Seed policies for HH-001 members
    testDb.insert(schema.policies).values(makePolicy({ policy_id: "POL-H1", client_id: "CL-001", premium_current: 1200, policy_type: "personal_auto" })).run();
    testDb.insert(schema.policies).values(makePolicy({ policy_id: "POL-H2", client_id: "CL-001", premium_current: 800, policy_type: "homeowners" })).run();
    testDb.insert(schema.policies).values(makePolicy({ policy_id: "POL-H3", client_id: "CL-002", premium_current: 500, policy_type: "personal_auto" })).run();

    const res = await app.request("/v1/clients/household/HH-001", {
      headers: await authHeader(["ams:clients:read"]),
    });
    const body = await res.json();

    expect(body.total_premium).toBe(2500);

    const alice = body.members.find((m: any) => m.id === "CL-001");
    expect(alice.policy_count).toBe(2);
    expect(alice.total_premium).toBe(2000);
    expect(alice.coverage_types).toContain("personal_auto");
    expect(alice.coverage_types).toContain("homeowners");

    const bob = body.members.find((m: any) => m.id === "CL-002");
    expect(bob.policy_count).toBe(1);
    expect(bob.total_premium).toBe(500);
  });

  test("identifies coverage gaps", async () => {
    testDb.insert(schema.policies).values(makePolicy({ policy_id: "POL-H4", client_id: "CL-001", policy_type: "personal_auto" })).run();

    const res = await app.request("/v1/clients/household/HH-001", {
      headers: await authHeader(["ams:clients:read"]),
    });
    const body = await res.json();

    // Should identify missing types from recommended set
    expect(body.coverage_gaps).toContain("umbrella");
    expect(body.coverage_gaps).toContain("life");
    expect(body.coverage_gaps).toContain("flood");
    expect(body.coverage_gaps).not.toContain("personal_auto");
  });

  test("single-member household works", async () => {
    const res = await app.request("/v1/clients/household/HH-002", {
      headers: await authHeader(["ams:clients:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.member_count).toBe(1);
    expect(body.members[0].id).toBe("CL-003");
  });

  test("returns coverage_types as sorted array", async () => {
    testDb.insert(schema.policies).values(makePolicy({ policy_id: "POL-H5", client_id: "CL-001", policy_type: "homeowners" })).run();
    testDb.insert(schema.policies).values(makePolicy({ policy_id: "POL-H6", client_id: "CL-001", policy_type: "personal_auto" })).run();

    const res = await app.request("/v1/clients/household/HH-001", {
      headers: await authHeader(["ams:clients:read"]),
    });
    const body = await res.json();

    // Coverage types should be sorted
    const types = body.coverage_types;
    const sorted = [...types].sort();
    expect(types).toEqual(sorted);
  });
});

// ── POST /v1/clients/:id/merge - additional edge cases ──

describe("POST /v1/clients/:id/merge - scope validation", () => {
  test("returns 403 with read-only scope", async () => {
    const headers = await authHeader(["ams:clients:read"]);
    const res = await mergeClient("CL-001", { source_client_id: "CL-002" }, headers);
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/clients/:id/merge - response shape", () => {
  test("response contains all expected fields", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await mergeClient("CL-001", { source_client_id: "CL-004" }, headers);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("target_client");
    expect(body).toHaveProperty("source_client_id");
    expect(body).toHaveProperty("policies_moved");
    expect(body).toHaveProperty("tasks_moved");
    expect(body.target_client).toHaveProperty("id");
    expect(body.target_client).toHaveProperty("first_name");
    expect(body.target_client).toHaveProperty("last_name");
    expect(body.target_client).toHaveProperty("email");
    expect(body.target_client).toHaveProperty("address");
  });

  test("target_client has nested address object", async () => {
    const headers = await authHeader(["ams:clients:write"]);
    const res = await mergeClient("CL-001", { source_client_id: "CL-005" }, headers);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.target_client.address).toBeDefined();
    expect(typeof body.target_client.address).toBe("object");
  });
});

describe("POST /v1/clients/:id/merge - policies and tasks re-parenting", () => {
  test("merged policies are accessible under target client", async () => {
    // Seed a policy for CL-003
    testDb.insert(schema.policies).values(makePolicy({ policy_id: "POL-MERGE-1", client_id: "CL-003" })).run();

    const headers = await authHeader(["ams:clients:write"]);
    const res = await mergeClient("CL-001", { source_client_id: "CL-003" }, headers);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policies_moved).toBe(1);
    expect(body.source_client_id).toBe("CL-003");
  });
});

// ── GET /v1/clients/household/:household_id - additional edge cases ──

describe("GET /v1/clients/household/:household_id - scope validation", () => {
  test("returns 403 with wrong scope", async () => {
    const res = await app.request("/v1/clients/household/HH-001", {
      headers: await authHeader(["ams:policies:read"]),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /v1/clients/household/:household_id - response shape", () => {
  test("response contains all expected top-level fields", async () => {
    const res = await app.request("/v1/clients/household/HH-001", {
      headers: await authHeader(["ams:clients:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("household_id");
    expect(body).toHaveProperty("member_count");
    expect(body).toHaveProperty("total_premium");
    expect(body).toHaveProperty("coverage_types");
    expect(body).toHaveProperty("coverage_gaps");
    expect(body).toHaveProperty("members");
  });

  test("each member has policy summary fields", async () => {
    const res = await app.request("/v1/clients/household/HH-001", {
      headers: await authHeader(["ams:clients:read"]),
    });
    const body = await res.json();
    for (const member of body.members) {
      expect(member).toHaveProperty("id");
      expect(member).toHaveProperty("first_name");
      expect(member).toHaveProperty("last_name");
      expect(member).toHaveProperty("policy_count");
      expect(member).toHaveProperty("total_premium");
      expect(member).toHaveProperty("coverage_types");
      expect(typeof member.policy_count).toBe("number");
      expect(typeof member.total_premium).toBe("number");
      expect(Array.isArray(member.coverage_types)).toBe(true);
    }
  });
});

describe("GET /v1/clients/household/:household_id - no policies household", () => {
  test("returns zero total_premium when no policies exist", async () => {
    const res = await app.request("/v1/clients/household/HH-002", {
      headers: await authHeader(["ams:clients:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_premium).toBe(0);
    expect(body.members[0].policy_count).toBe(0);
    expect(body.members[0].total_premium).toBe(0);
  });

  test("all recommended types are coverage gaps when no policies", async () => {
    const res = await app.request("/v1/clients/household/HH-002", {
      headers: await authHeader(["ams:clients:read"]),
    });
    const body = await res.json();
    expect(body.coverage_gaps).toContain("personal_auto");
    expect(body.coverage_gaps).toContain("homeowners");
    expect(body.coverage_gaps).toContain("umbrella");
    expect(body.coverage_gaps).toContain("life");
    expect(body.coverage_gaps).toContain("flood");
  });
});
