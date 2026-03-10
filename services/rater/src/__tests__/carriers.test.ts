import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";

const testSqlite = new Database(":memory:");
testSqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(testSqlite, { schema });

mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

import { describe, expect, test, beforeAll } from "bun:test";
import { carriersRouter } from "../routes/carriers";
import { createTables, createTestApp, authHeader, makeCarrier } from "./setup";

const app = createTestApp({ carriers: carriersRouter });

beforeAll(() => {
  createTables(testSqlite);

  testDb
    .insert(schema.carriers)
    .values(
      makeCarrier({
        carrier_code: "ERIE",
        carrier_name: "Erie Insurance",
        states: JSON.stringify(["IL", "IN", "OH", "PA"]),
        policy_types: JSON.stringify(["personal_auto", "homeowners"]),
        risk_categories: JSON.stringify(["preferred", "standard"]),
        appetite_level: "high",
      }),
    )
    .run();
  testDb
    .insert(schema.carriers)
    .values(
      makeCarrier({
        carrier_code: "NTNW",
        carrier_name: "Nationwide",
        states: JSON.stringify(["IL", "OH", "TX", "FL"]),
        policy_types: JSON.stringify(["personal_auto", "bop", "workers_comp"]),
        risk_categories: JSON.stringify(["standard", "non_standard"]),
        appetite_level: "medium",
      }),
    )
    .run();
  testDb
    .insert(schema.carriers)
    .values(
      makeCarrier({
        carrier_code: "CSTL",
        carrier_name: "Coastal Star",
        states: JSON.stringify(["IL", "IN", "CA", "NY"]),
        policy_types: JSON.stringify(["personal_auto", "homeowners", "umbrella"]),
        risk_categories: JSON.stringify(["preferred", "standard", "non_standard"]),
        appetite_level: "high",
      }),
    )
    .run();
});

function getAppetite(query: string, headers: Record<string, string>) {
  return app.request(`/v1/carriers/appetite${query ? `?${query}` : ""}`, {
    headers,
  });
}

// ── GET /v1/carriers/appetite ──────────────────────────────────────────

describe("GET /v1/carriers/appetite - auth", () => {
  test("returns 401 without auth", async () => {
    const res = await getAppetite("", {});
    expect(res.status).toBe(401);
  });
});

describe("GET /v1/carriers/appetite - list all", () => {
  test("returns 200 with all carriers", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("", headers);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBe(3);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.has_more).toBe(false);
  });

  test("returns parsed JSON arrays", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("", headers);
    const body = await res.json();
    const prog = body.data.find(
      (c: Record<string, unknown>) => c.carrier_code === "CSTL",
    );
    expect(prog.states).toBeArray();
    expect(prog.policy_types).toBeArray();
    expect(prog.risk_categories).toBeArray();
  });
});

describe("GET /v1/carriers/appetite - filters", () => {
  test("filters by state", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("state=PA", headers);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].carrier_code).toBe("ERIE");
  });

  test("filters by policy_type", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("policy_type=bop", headers);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].carrier_code).toBe("NTNW");
  });

  test("filters by risk_category", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("risk_category=non_standard", headers);
    const body = await res.json();
    expect(body.data.length).toBe(2);
    const codes = body.data.map((c: Record<string, unknown>) => c.carrier_code);
    expect(codes).toContain("NTNW");
    expect(codes).toContain("CSTL");
  });

  test("combines multiple filters", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("state=IL&policy_type=homeowners", headers);
    const body = await res.json();
    expect(body.data.length).toBe(2);
    const codes = body.data.map((c: Record<string, unknown>) => c.carrier_code);
    expect(codes).toContain("ERIE");
    expect(codes).toContain("CSTL");
  });

  test("returns empty array for no matches", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("state=AK", headers);
    const body = await res.json();
    expect(body.data.length).toBe(0);
    expect(body.pagination.has_more).toBe(false);
  });
});

describe("GET /v1/carriers/appetite - pagination", () => {
  test("limits results", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("limit=2", headers);
    const body = await res.json();
    expect(body.data.length).toBe(2);
    expect(body.pagination.has_more).toBe(true);
    expect(body.pagination.next_cursor).toBeDefined();
  });

  test("paginates with cursor", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    // First page
    const res1 = await getAppetite("limit=2", headers);
    const body1 = await res1.json();
    expect(body1.data.length).toBe(2);

    // Second page
    const res2 = await getAppetite(
      `limit=2&cursor=${body1.pagination.next_cursor}`,
      headers,
    );
    const body2 = await res2.json();
    expect(body2.data.length).toBe(1);
    expect(body2.pagination.has_more).toBe(false);
  });
});

describe("GET /v1/carriers/appetite - validation", () => {
  test("returns 400 for invalid risk_category", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("risk_category=invalid", headers);
    expect(res.status).toBe(400);
  });
});

// ── GET /v1/carriers/appetite - additional tests ──

describe("GET /v1/carriers/appetite - scope validation", () => {
  test("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["rater:quotes:read"]);
    const res = await getAppetite("", headers);
    expect(res.status).toBe(403);
  });
});

describe("GET /v1/carriers/appetite - new carrier fields", () => {
  test("each carrier includes sr22_available field", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("", headers);
    const body = await res.json();
    for (const carrier of body.data) {
      expect(carrier).toHaveProperty("sr22_available");
    }
  });

  test("each carrier includes citizens_eligible field", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("", headers);
    const body = await res.json();
    for (const carrier of body.data) {
      expect(carrier).toHaveProperty("citizens_eligible");
    }
  });

  test("each carrier includes surplus_lines_only field", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("", headers);
    const body = await res.json();
    for (const carrier of body.data) {
      expect(carrier).toHaveProperty("surplus_lines_only");
    }
  });

  test("each carrier includes state_restrictions as parsed array", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("", headers);
    const body = await res.json();
    for (const carrier of body.data) {
      expect(carrier).toHaveProperty("state_restrictions");
      expect(Array.isArray(carrier.state_restrictions)).toBe(true);
    }
  });

  test("each carrier includes min_driver_age and max_vehicles", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("", headers);
    const body = await res.json();
    for (const carrier of body.data) {
      expect(carrier).toHaveProperty("min_driver_age");
      expect(carrier).toHaveProperty("max_vehicles");
    }
  });

  test("each carrier includes accepts_sr22 field", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("", headers);
    const body = await res.json();
    for (const carrier of body.data) {
      expect(carrier).toHaveProperty("accepts_sr22");
    }
  });
});

describe("GET /v1/carriers/appetite - response shape", () => {
  test("each carrier has all core fields", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("", headers);
    const body = await res.json();
    for (const carrier of body.data) {
      expect(carrier).toHaveProperty("carrier_code");
      expect(carrier).toHaveProperty("carrier_name");
      expect(carrier).toHaveProperty("states");
      expect(carrier).toHaveProperty("policy_types");
      expect(carrier).toHaveProperty("risk_categories");
      expect(carrier).toHaveProperty("appetite_level");
    }
  });

  test("specific carrier has expected values", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("", headers);
    const body = await res.json();
    const erie = body.data.find((c: any) => c.carrier_code === "ERIE");
    expect(erie).toBeDefined();
    expect(erie.carrier_name).toBe("Erie Insurance");
    expect(erie.states).toContain("IL");
    expect(erie.states).toContain("PA");
    expect(erie.policy_types).toContain("personal_auto");
    expect(erie.appetite_level).toBe("high");
  });
});

describe("GET /v1/carriers/appetite - filter combinations with new fields", () => {
  test("filters by state and policy_type together", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("state=OH&policy_type=personal_auto", headers);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    for (const carrier of body.data) {
      expect(carrier.states).toContain("OH");
      expect(carrier.policy_types).toContain("personal_auto");
    }
  });

  test("filters by state, policy_type, and risk_category", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await getAppetite("state=IL&policy_type=homeowners&risk_category=preferred", headers);
    const body = await res.json();
    expect(body.data.length).toBe(2); // ERIE and CSTL
    for (const carrier of body.data) {
      expect(carrier.states).toContain("IL");
      expect(carrier.policy_types).toContain("homeowners");
      expect(carrier.risk_categories).toContain("preferred");
    }
  });

  test("valid risk_category values are accepted", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    for (const cat of ["preferred", "standard", "non_standard"]) {
      const res = await getAppetite(`risk_category=${cat}`, headers);
      expect(res.status).toBe(200);
    }
  });
});

// ── GET /v1/carriers — alias for /appetite ──

describe("GET /v1/carriers - alias", () => {
  test("returns same results as /appetite", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await app.request("/v1/carriers", { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBe(3);
    expect(body.pagination).toBeDefined();
  });

  test("supports filters on alias route", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await app.request("/v1/carriers?state=PA", { headers });
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].carrier_code).toBe("ERIE");
  });
});
