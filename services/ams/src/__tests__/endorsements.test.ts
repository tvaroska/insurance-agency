import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { mkdtempSync } from "fs";
import { join } from "path";

const tmpDir = mkdtempSync("/tmp/test-ams-");
const dbPath = join(tmpDir, "test.db");
const testSqlite = new Database(dbPath);
testSqlite.exec("PRAGMA journal_mode = WAL;");
testSqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(testSqlite, { schema });

const testAdapter = new PrismaLibSql({ url: `file:${dbPath}` });
const testPrisma = new PrismaClient({ adapter: testAdapter });
mock.module("../prisma", () => ({ prisma: testPrisma }));

import { describe, expect, test, beforeAll } from "bun:test";
import { policiesRouter } from "../routes/policies";
import { createTables, createTestApp, authHeader, makeClient, makePolicy } from "./setup";

const app = createTestApp({ policies: policiesRouter });

beforeAll(() => {
  createTables(testSqlite);

  testDb.insert(schema.clients).values(makeClient({ id: "CL-001", address_state: "TX" })).run();

  testDb.insert(schema.policies).values(makePolicy({ policy_id: "POL-ACTIVE", client_id: "CL-001", status: "active" })).run();
  testDb.insert(schema.policies).values(makePolicy({
    policy_id: "POL-2026-ACTIVE",
    client_id: "CL-001",
    policy_type: "personal_auto",
    effective_date: "2025-11-01",
    expiration_date: "2026-11-01",
    status: "active",
  })).run();
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

  test("returns 422 E_EO_BACKDATING_PROHIBITED when backdating prior to simulated today (2026-02-18)", async () => {
    const headers = await authHeader(["ams:policies:endorsements"]);
    const res = await postEndorsement(
      "POL-2026-ACTIVE",
      {
        effective_date: "2026-02-10",
        change_type: "modify_coverage",
        changes: { coverage: "bop_limit", limit: 1000000 },
      },
      headers,
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error_code).toBe("E_EO_BACKDATING_PROHIBITED");
  });

  test("returns 422 E_EO_STATE_MINIMUM_VIOLATION when lowering TX auto limits to 15/30/10", async () => {
    const headers = await authHeader(["ams:policies:endorsements"]);
    const res = await postEndorsement(
      "POL-2026-ACTIVE",
      {
        effective_date: "2026-03-01",
        change_type: "modify_coverage",
        changes: { coverage: "bodily_injury", limit: "15/30/10" },
      },
      headers,
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error_code).toBe("E_EO_STATE_MINIMUM_VIOLATION");
  });
});

