import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";

const testSqlite = new Database(":memory:");
testSqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(testSqlite, { schema });

mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

import { describe, expect, test, beforeAll } from "bun:test";
import { policiesRouter } from "../routes/policies";
import { createTables, createTestApp, authHeader, makeClient, makePolicy } from "./setup";

const app = createTestApp({ policies: policiesRouter });

beforeAll(() => {
  createTables(testSqlite);

  testDb.insert(schema.clients).values(makeClient({ id: "CL-001" })).run();

  testDb.insert(schema.policies).values(makePolicy({ policy_id: "POL-ACTIVE", client_id: "CL-001", status: "active" })).run();
  testDb.insert(schema.policies).values(makePolicy({ policy_id: "POL-CANCELLED", client_id: "CL-001", status: "cancelled" })).run();
  testDb.insert(schema.policies).values(makePolicy({ policy_id: "POL-EXPIRED", client_id: "CL-001", status: "expired" })).run();
});

const validBody = {
  effective_date: "2025-06-01",
  change_type: "add_coverage",
  changes: { coverage: "umbrella", limit: 1000000 },
};

function postEndorsement(policyId: string, body: any, headers: Record<string, string>) {
  return app.request(`/v1/policies/${policyId}/endorsements`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/policies/:id/endorsements - auth", () => {
  test("returns 401 without auth", async () => {
    const res = await postEndorsement("POL-ACTIVE", validBody, {});
    expect(res.status).toBe(401);
  });
});

describe("POST /v1/policies/:id/endorsements - successful creation", () => {
  test("returns 201 with endorsement on valid input", async () => {
    const headers = await authHeader(["ams:policies:endorsements"]);
    const res = await postEndorsement("POL-ACTIVE", validBody, headers);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.policy_id).toBe("POL-ACTIVE");
    expect(body.change_type).toBe("add_coverage");
    expect(body.status).toBe("pending_review");
    expect(body.premium_delta).toBe(0);
    expect(body.changes).toEqual({ coverage: "umbrella", limit: 1000000 });
    expect(body.notes).toBeNull();
  });

  test("endorsement ID matches format END-YYYY-XXXXXX", async () => {
    const headers = await authHeader(["ams:policies:endorsements"]);
    const res = await postEndorsement("POL-ACTIVE", validBody, headers);
    const body = await res.json();
    expect(body.endorsement_id).toMatch(/^END-\d{4}-\d{6}$/);
  });

  test("notes are included when provided", async () => {
    const headers = await authHeader(["ams:policies:endorsements"]);
    const res = await postEndorsement("POL-ACTIVE", { ...validBody, notes: "Customer requested" }, headers);
    const body = await res.json();
    expect(body.notes).toBe("Customer requested");
  });
});

describe("POST /v1/policies/:id/endorsements - validation and conflicts", () => {
  test("returns 404 for nonexistent policy", async () => {
    const headers = await authHeader(["ams:policies:endorsements"]);
    const res = await postEndorsement("NONEXISTENT", validBody, headers);
    expect(res.status).toBe(404);
  });

  test("returns 409 for cancelled policy", async () => {
    const headers = await authHeader(["ams:policies:endorsements"]);
    const res = await postEndorsement("POL-CANCELLED", validBody, headers);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe("CONFLICT");
  });

  test("returns 409 for expired policy", async () => {
    const headers = await authHeader(["ams:policies:endorsements"]);
    const res = await postEndorsement("POL-EXPIRED", validBody, headers);
    expect(res.status).toBe(409);
  });

  test("returns 400 for missing effective_date", async () => {
    const headers = await authHeader(["ams:policies:endorsements"]);
    const { effective_date, ...body } = validBody;
    const res = await postEndorsement("POL-ACTIVE", body, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid date format", async () => {
    const headers = await authHeader(["ams:policies:endorsements"]);
    const res = await postEndorsement("POL-ACTIVE", { ...validBody, effective_date: "06/01/2025" }, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid change_type", async () => {
    const headers = await authHeader(["ams:policies:endorsements"]);
    const res = await postEndorsement("POL-ACTIVE", { ...validBody, change_type: "invalid_type" }, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for missing changes", async () => {
    const headers = await authHeader(["ams:policies:endorsements"]);
    const { changes, ...body } = validBody;
    const res = await postEndorsement("POL-ACTIVE", body, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for notes exceeding 2000 chars", async () => {
    const headers = await authHeader(["ams:policies:endorsements"]);
    const res = await postEndorsement("POL-ACTIVE", { ...validBody, notes: "x".repeat(2001) }, headers);
    expect(res.status).toBe(400);
  });
});
