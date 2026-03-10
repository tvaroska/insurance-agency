import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";

const testSqlite = new Database(":memory:");
testSqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(testSqlite, { schema });

mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

import { describe, expect, test, beforeAll } from "bun:test";
import { clientsRouter } from "../routes/clients";
import { policiesRouter } from "../routes/policies";
import { createTables, createTestApp, authHeader, makeClient, makePolicy, makeCoverage } from "./setup";

const app = createTestApp({ clients: clientsRouter, policies: policiesRouter });

beforeAll(() => {
  createTables(testSqlite);

  testDb.insert(schema.clients).values(makeClient({ id: "CL-001", first_name: "Alice", last_name: "Adams" })).run();

  testDb.insert(schema.policies).values(makePolicy({
    policy_id: "POL-001", client_id: "CL-001", policy_type: "personal_auto", status: "active", effective_date: "2025-01-01",
  })).run();
  testDb.insert(schema.policies).values(makePolicy({
    policy_id: "POL-002", client_id: "CL-001", policy_type: "homeowners", status: "expired", effective_date: "2024-06-01",
  })).run();
  testDb.insert(schema.policies).values(makePolicy({
    policy_id: "POL-003", client_id: "CL-001", policy_type: "personal_auto", status: "pending", effective_date: "2025-03-01",
  })).run();

  testDb.insert(schema.coverages).values(makeCoverage({ policy_id: "POL-001", type: "liability", limit: "100000/300000", deductible: 500 })).run();
  testDb.insert(schema.coverages).values(makeCoverage({ policy_id: "POL-001", type: "collision", limit: null, deductible: 1000 })).run();
  testDb.insert(schema.coverages).values(makeCoverage({ policy_id: "POL-002", type: "dwelling", limit: "350000", deductible: 2500 })).run();
});

describe("GET /v1/clients/:id/policies - auth", () => {
  test("returns 401 without auth", async () => {
    const res = await app.request("/v1/clients/CL-001/policies");
    expect(res.status).toBe(401);
  });
});

describe("GET /v1/clients/:id/policies - retrieval", () => {
  test("returns 200 with policies and nested coverages", async () => {
    const res = await app.request("/v1/clients/CL-001/policies", {
      headers: await authHeader(["ams:policies:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBe(3);

    const pol1 = body.data.find((p: any) => p.policy_id === "POL-001");
    expect(pol1.coverages).toBeArray();
    expect(pol1.coverages.length).toBe(2);
    expect(pol1.coverages[0]).toHaveProperty("type");
    expect(pol1.coverages[0]).toHaveProperty("deductible");
  });

  test("returns 404 for nonexistent client", async () => {
    const res = await app.request("/v1/clients/NONEXISTENT/policies", {
      headers: await authHeader(["ams:policies:read"]),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe("NOT_FOUND");
  });

  test("coverages grouped correctly per policy", async () => {
    const res = await app.request("/v1/clients/CL-001/policies", {
      headers: await authHeader(["ams:policies:read"]),
    });
    const body = await res.json();

    const pol1 = body.data.find((p: any) => p.policy_id === "POL-001");
    const pol3 = body.data.find((p: any) => p.policy_id === "POL-003");

    expect(pol1.coverages.length).toBe(2);
    expect(pol3.coverages).toEqual([]);
  });
});

describe("GET /v1/clients/:id/policies - filters", () => {
  test("filters by policy_type=homeowners", async () => {
    const res = await app.request("/v1/clients/CL-001/policies?policy_type=homeowners", {
      headers: await authHeader(["ams:policies:read"]),
    });
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].policy_type).toBe("homeowners");
  });

  test("filters by status=active", async () => {
    const res = await app.request("/v1/clients/CL-001/policies?status=active", {
      headers: await authHeader(["ams:policies:read"]),
    });
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].status).toBe("active");
  });

  test("returns 400 for invalid policy_type", async () => {
    const res = await app.request("/v1/clients/CL-001/policies?policy_type=commercial", {
      headers: await authHeader(["ams:policies:read"]),
    });
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid status", async () => {
    const res = await app.request("/v1/clients/CL-001/policies?status=bogus", {
      headers: await authHeader(["ams:policies:read"]),
    });
    expect(res.status).toBe(400);
  });
});

// ── POST /v1/policies ─────────────────────────────────────────────────

const VALID_CREATE = {
  client_id: "CL-001",
  policy_type: "personal_auto",
  carrier_code: "SMIT",
  effective_date: "2025-06-01",
  expiration_date: "2026-06-01",
  annual_premium: 1450.0,
  status: "active",
  coverages: [
    { type: "bodily_injury", limit: "100000/300000", deductible: null },
    { type: "property_damage", limit: "50000", deductible: null },
  ],
};

async function postPolicy(body: object, scopes = ["ams:policies:write"]) {
  return app.request("/v1/policies", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader(scopes)) },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/policies - auth", () => {
  test("returns 401 without Authorization", async () => {
    const res = await app.request("/v1/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_CREATE),
    });
    expect(res.status).toBe(401);
  });

  test("returns 403 with wrong scope", async () => {
    const res = await postPolicy(VALID_CREATE, ["ams:clients:read"]);
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/policies - validation", () => {
  test("returns 400 when client_id missing", async () => {
    const { client_id, ...body } = VALID_CREATE;
    const res = await postPolicy(body);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.details.some((d: any) => d.field === "client_id")).toBe(true);
  });

  test("returns 400 for invalid policy_type", async () => {
    const res = await postPolicy({ ...VALID_CREATE, policy_type: "spaceship" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.details.some((d: any) => d.field === "policy_type")).toBe(true);
  });

  test("returns 400 for invalid status", async () => {
    const res = await postPolicy({ ...VALID_CREATE, status: "bogus" });
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid effective_date format", async () => {
    const res = await postPolicy({ ...VALID_CREATE, effective_date: "06/01/2025" });
    expect(res.status).toBe(400);
  });

  test("returns 400 for negative annual_premium", async () => {
    const res = await postPolicy({ ...VALID_CREATE, annual_premium: -100 });
    expect(res.status).toBe(400);
  });

  test("returns 400 when coverages is empty array", async () => {
    const res = await postPolicy({ ...VALID_CREATE, coverages: [] });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.details.some((d: any) => d.field === "coverages")).toBe(true);
  });

  test("returns 400 when coverages is missing", async () => {
    const { coverages, ...body } = VALID_CREATE;
    const res = await postPolicy(body);
    expect(res.status).toBe(400);
  });

  test("returns 400 when coverage entry missing type", async () => {
    const res = await postPolicy({ ...VALID_CREATE, coverages: [{ limit: "100000" }] });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/policies - client lookup", () => {
  test("returns 404 when client_id does not exist", async () => {
    const res = await postPolicy({ ...VALID_CREATE, client_id: "CL-NONEXISTENT" });
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/policies - success", () => {
  test("creates policy with required fields and returns 201", async () => {
    const res = await postPolicy(VALID_CREATE);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.policy_id).toMatch(/^POL-/);
    expect(json.client_id).toBe("CL-001");
    expect(json.policy_type).toBe("personal_auto");
    expect(json.carrier_code).toBe("SMIT");
    expect(json.effective_date).toBe("2025-06-01");
    expect(json.expiration_date).toBe("2026-06-01");
    expect(json.annual_premium).toBe(1450.0);
    expect(json.status).toBe("active");
    expect(json.coverages).toHaveLength(2);
    expect(json.coverages[0].type).toBe("bodily_injury");
    expect(json.created_at).toBeDefined();
    expect(json.updated_at).toBeDefined();
  });

  test("defaults status to pending when not provided", async () => {
    const { status, ...body } = VALID_CREATE;
    const res = await postPolicy(body);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.status).toBe("pending");
  });

  test("creates policy with multi_policy_discount", async () => {
    const res = await postPolicy({ ...VALID_CREATE, multi_policy_discount: true });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.multi_policy_discount).toBe(true);
  });
});

// ── POST /v1/policies - additional validation edge cases ─────────────

describe("POST /v1/policies - date validation", () => {
  test("returns 400 for expiration_date with wrong format", async () => {
    const res = await postPolicy({ ...VALID_CREATE, expiration_date: "01-01-2026" });
    expect(res.status).toBe(400);
  });

  test("returns 400 when annual_premium is zero", async () => {
    const res = await postPolicy({ ...VALID_CREATE, annual_premium: 0 });
    expect(res.status).toBe(201);
    // Zero is non-negative, so it should succeed
  });

  test("returns 400 when annual_premium is a string", async () => {
    const res = await postPolicy({ ...VALID_CREATE, annual_premium: "not_a_number" });
    expect(res.status).toBe(400);
  });

  test("returns 400 when effective_date is empty string", async () => {
    const res = await postPolicy({ ...VALID_CREATE, effective_date: "" });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/policies - coverage edge cases", () => {
  test("creates policy with single coverage", async () => {
    const res = await postPolicy({
      ...VALID_CREATE,
      coverages: [{ type: "comprehensive", limit: "50000", deductible: 250 }],
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.coverages).toHaveLength(1);
    expect(json.coverages[0].type).toBe("comprehensive");
    expect(json.coverages[0].deductible).toBe(250);
  });

  test("creates policy with coverage that has null limit and deductible", async () => {
    const res = await postPolicy({
      ...VALID_CREATE,
      coverages: [{ type: "uninsured_motorist", limit: null, deductible: null }],
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.coverages[0].limit).toBeNull();
    expect(json.coverages[0].deductible).toBeNull();
  });

  test("creates policy with multiple coverages and verifies order preserved", async () => {
    const coverages = [
      { type: "liability", limit: "100000/300000", deductible: null },
      { type: "collision", limit: null, deductible: 500 },
      { type: "comprehensive", limit: null, deductible: 250 },
    ];
    const res = await postPolicy({ ...VALID_CREATE, coverages });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.coverages).toHaveLength(3);
    expect(json.coverages[0].type).toBe("liability");
    expect(json.coverages[1].type).toBe("collision");
    expect(json.coverages[2].type).toBe("comprehensive");
  });
});

describe("POST /v1/policies - all policy types", () => {
  const validTypes = ["personal_auto", "homeowners", "renters", "umbrella", "bop", "workers_comp", "general_liability", "professional_liability"];

  for (const pType of validTypes) {
    test(`accepts policy_type=${pType}`, async () => {
      const res = await postPolicy({ ...VALID_CREATE, policy_type: pType });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.policy_type).toBe(pType);
    });
  }
});

describe("POST /v1/policies - all statuses", () => {
  const validStatuses = ["active", "pending", "cancelled", "expired", "non_renewed"];

  for (const s of validStatuses) {
    test(`accepts status=${s}`, async () => {
      const res = await postPolicy({ ...VALID_CREATE, status: s });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.status).toBe(s);
    });
  }
});

describe("POST /v1/policies - response shape", () => {
  test("response contains all expected fields", async () => {
    const res = await postPolicy(VALID_CREATE);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toHaveProperty("policy_id");
    expect(json).toHaveProperty("client_id");
    expect(json).toHaveProperty("carrier_code");
    expect(json).toHaveProperty("policy_type");
    expect(json).toHaveProperty("effective_date");
    expect(json).toHaveProperty("expiration_date");
    expect(json).toHaveProperty("annual_premium");
    expect(json).toHaveProperty("status");
    expect(json).toHaveProperty("multi_policy_discount");
    expect(json).toHaveProperty("coverages");
    expect(json).toHaveProperty("created_at");
    expect(json).toHaveProperty("updated_at");
  });

  test("multi_policy_discount defaults to false when not provided", async () => {
    const res = await postPolicy(VALID_CREATE);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.multi_policy_discount).toBe(false);
  });
});

// ── GET /v1/policies — List ─────────────────────────────────────────

describe("GET /v1/policies - auth", () => {
  test("returns 401 without auth", async () => {
    const res = await app.request("/v1/policies");
    expect(res.status).toBe(401);
  });

  test("returns 403 with wrong scope", async () => {
    const res = await app.request("/v1/policies", {
      headers: await authHeader(["ams:clients:read"]),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /v1/policies - list all", () => {
  test("returns 200 with paginated policies", async () => {
    const res = await app.request("/v1/policies", {
      headers: await authHeader(["ams:policies:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    // At minimum the 3 seeded + any created by POST tests
    expect(body.data.length).toBeGreaterThanOrEqual(3);
    expect(body.pagination).toBeDefined();
  });
});

describe("GET /v1/policies - filters", () => {
  test("filters by status", async () => {
    const res = await app.request("/v1/policies?status=active", {
      headers: await authHeader(["ams:policies:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const p of body.data) {
      expect(p.status).toBe("active");
    }
  });

  test("filters by client_id", async () => {
    const res = await app.request("/v1/policies?client_id=CL-001", {
      headers: await authHeader(["ams:policies:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const p of body.data) {
      expect(p.client_id).toBe("CL-001");
    }
  });

  test("filters by policy_type", async () => {
    const res = await app.request("/v1/policies?policy_type=homeowners", {
      headers: await authHeader(["ams:policies:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    for (const p of body.data) {
      expect(p.policy_type).toBe("homeowners");
    }
  });

  test("returns 400 for invalid status", async () => {
    const res = await app.request("/v1/policies?status=bogus", {
      headers: await authHeader(["ams:policies:read"]),
    });
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid policy_type", async () => {
    const res = await app.request("/v1/policies?policy_type=spaceship", {
      headers: await authHeader(["ams:policies:read"]),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/policies - pagination", () => {
  test("paginates with limit", async () => {
    const res = await app.request("/v1/policies?limit=2", {
      headers: await authHeader(["ams:policies:read"]),
    });
    const body = await res.json();
    expect(body.data.length).toBe(2);
    expect(body.pagination.has_more).toBe(true);
    expect(body.pagination.next_cursor).toBeDefined();
  });
});

// ── GET /v1/policies/:id — Detail ───────────────────────────────────

describe("GET /v1/policies/:id - auth", () => {
  test("returns 401 without auth", async () => {
    const res = await app.request("/v1/policies/POL-001");
    expect(res.status).toBe(401);
  });
});

describe("GET /v1/policies/:id - retrieval", () => {
  test("returns policy with coverages", async () => {
    const res = await app.request("/v1/policies/POL-001", {
      headers: await authHeader(["ams:policies:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policy_id).toBe("POL-001");
    expect(body.coverages).toBeArray();
    expect(body.coverages.length).toBe(2);
  });

  test("returns 404 for nonexistent policy", async () => {
    const res = await app.request("/v1/policies/POL-NONEXISTENT", {
      headers: await authHeader(["ams:policies:read"]),
    });
    expect(res.status).toBe(404);
  });
});
