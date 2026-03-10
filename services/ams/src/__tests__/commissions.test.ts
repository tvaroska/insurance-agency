import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";

const testSqlite = new Database(":memory:");
testSqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(testSqlite, { schema });

mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

import { describe, expect, test, beforeAll } from "bun:test";
import { accountingRouter } from "../routes/accounting";
import { createTables, createTestApp, authHeader, makeClient, makePolicy, makeCommission } from "./setup";

const app = createTestApp({ accounting: accountingRouter });

beforeAll(() => {
  createTables(testSqlite);

  testDb.insert(schema.clients).values(makeClient({ id: "CL-001" })).run();
  testDb.insert(schema.policies).values(makePolicy({ policy_id: "POL-001", client_id: "CL-001", carrier_code: "SMIT" })).run();
  testDb.insert(schema.policies).values(makePolicy({ policy_id: "POL-002", client_id: "CL-001", carrier_code: "CSTL" })).run();

  const commissions = [
    makeCommission({ commission_id: "COM-001", policy_id: "POL-001", carrier_code: "SMIT", transaction_type: "new_business", status: "earned", effective_date: "2025-01-15", producer_id: "PROD-001" }),
    makeCommission({ commission_id: "COM-002", policy_id: "POL-001", carrier_code: "SMIT", transaction_type: "renewal", status: "paid", effective_date: "2025-03-01", producer_id: "PROD-002" }),
    makeCommission({ commission_id: "COM-003", policy_id: "POL-002", carrier_code: "CSTL", transaction_type: "endorsement", status: "pending", effective_date: "2025-02-01", producer_id: "PROD-001" }),
    makeCommission({ commission_id: "COM-004", policy_id: "POL-002", carrier_code: "CSTL", transaction_type: "cancellation", status: "reversed", effective_date: "2024-12-01", producer_id: null }),
  ];

  for (const c of commissions) {
    testDb.insert(schema.commissions).values(c).run();
  }
});

describe("GET /v1/accounting/commissions - auth", () => {
  test("returns 401 without auth", async () => {
    const res = await app.request("/v1/accounting/commissions");
    expect(res.status).toBe(401);
  });
});

describe("GET /v1/accounting/commissions - listing and filtering", () => {
  test("returns 200 with commissions list", async () => {
    const res = await app.request("/v1/accounting/commissions", {
      headers: await authHeader(["ams:accounting:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBe(4);
    expect(body.pagination).toBeDefined();
  });

  test("filters by carrier_code=SMIT", async () => {
    const res = await app.request("/v1/accounting/commissions?carrier_code=SMIT", {
      headers: await authHeader(["ams:accounting:read"]),
    });
    const body = await res.json();
    expect(body.data.length).toBe(2);
    for (const c of body.data) {
      expect(c.carrier_code).toBe("SMIT");
    }
  });

  test("filters by status=pending", async () => {
    const res = await app.request("/v1/accounting/commissions?status=pending", {
      headers: await authHeader(["ams:accounting:read"]),
    });
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].commission_id).toBe("COM-003");
  });

  test("filters by date range", async () => {
    const res = await app.request("/v1/accounting/commissions?effective_date_from=2025-01-01&effective_date_to=2025-02-28", {
      headers: await authHeader(["ams:accounting:read"]),
    });
    const body = await res.json();
    expect(body.data.length).toBe(2);
    const ids = body.data.map((c: any) => c.commission_id);
    expect(ids).toContain("COM-001");
    expect(ids).toContain("COM-003");
  });

  test("filters by producer_id", async () => {
    const res = await app.request("/v1/accounting/commissions?producer_id=PROD-001", {
      headers: await authHeader(["ams:accounting:read"]),
    });
    const body = await res.json();
    expect(body.data.length).toBe(2);
    for (const c of body.data) {
      expect(c.producer_id).toBe("PROD-001");
    }
  });
});

describe("GET /v1/accounting/commissions - validation", () => {
  test("returns 400 for invalid carrier_code", async () => {
    const res = await app.request("/v1/accounting/commissions?carrier_code=INVALID", {
      headers: await authHeader(["ams:accounting:read"]),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe("VALIDATION_ERROR");
  });

  test("returns 400 for invalid date format", async () => {
    const res = await app.request("/v1/accounting/commissions?effective_date_from=01-15-2025", {
      headers: await authHeader(["ams:accounting:read"]),
    });
    expect(res.status).toBe(400);
  });
});
