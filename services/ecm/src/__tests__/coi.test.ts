import { describe, it, expect, beforeAll } from "bun:test";
import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";

const testSqlite = new Database(":memory:");
testSqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(testSqlite, { schema });

mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

// Mock AMS client
const mockClients = [
  {
    id: "CLI-001",
    first_name: "Alice",
    last_name: "Adams",
    email: "alice@example.com",
    phone: null,
    dob: null,
    address: { street: "123 Main St", city: "Hartford", state: "CT", zip: "06101" },
    driver_license_number: null,
    occupation: null,
    marital_status: null,
  },
];

const mockPolicies = [
  {
    policy_id: "POL-001",
    client_id: "CLI-001",
    carrier_code: "SMIT",
    policy_type: "personal_auto",
    effective_date: "2025-01-01",
    expiration_date: "2026-01-01",
    premium_current: 1200,
    premium_prior: null,
    status: "active",
    multi_policy_discount: false,
    coverages: [
      { type: "liability", limit: "100000/300000", deductible: null },
      { type: "collision", limit: null, deductible: 500 },
    ],
  },
  {
    policy_id: "POL-002",
    client_id: "CLI-001",
    carrier_code: "SMIT",
    policy_type: "homeowners",
    effective_date: "2024-01-01",
    expiration_date: "2025-01-01",
    premium_current: 800,
    premium_prior: null,
    status: "expired",
    multi_policy_discount: false,
    coverages: [],
  },
];

mock.module("../clients/ams-client", () => ({
  fetchAllClients: async () => mockClients,
  fetchClientPolicies: async (clientId: string) =>
    mockPolicies.filter((p) => p.client_id === clientId),
  fetchClient: async (clientId: string) =>
    mockClients.find((c) => c.id === clientId),
}));

import { coiRouter } from "../routes/coi";
import { createTestApp, createTables, authHeader } from "./setup";

const app = createTestApp({ coi: coiRouter });

function postCoi(body: any, headers: Record<string, string> = {}) {
  return app.request("/v1/documents/coi/generate", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  createTables(testSqlite);
});

describe("POST /v1/documents/coi/generate - auth", () => {
  it("returns 401 without auth", async () => {
    const res = await postCoi({ policy_id: "POL-001", certificate_holder: { name: "Test" } });
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await postCoi({ policy_id: "POL-001", certificate_holder: { name: "Test" } }, headers);
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/documents/coi/generate - validation", () => {
  it("returns 400 when policy_id is missing", async () => {
    const headers = await authHeader(["ecm:documents:write"]);
    const res = await postCoi({ certificate_holder: { name: "Test" } }, headers);
    expect(res.status).toBe(400);
  });

  it("returns 400 when certificate_holder is missing", async () => {
    const headers = await authHeader(["ecm:documents:write"]);
    const res = await postCoi({ policy_id: "POL-001" }, headers);
    expect(res.status).toBe(400);
  });

  it("returns 400 when certificate_holder.name is missing", async () => {
    const headers = await authHeader(["ecm:documents:write"]);
    const res = await postCoi({ policy_id: "POL-001", certificate_holder: { address: "123 St" } }, headers);
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-existent policy", async () => {
    const headers = await authHeader(["ecm:documents:write"]);
    const res = await postCoi({ policy_id: "POL-999", certificate_holder: { name: "Test" } }, headers);
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-active policy", async () => {
    const headers = await authHeader(["ecm:documents:write"]);
    const res = await postCoi({ policy_id: "POL-002", certificate_holder: { name: "Test" } }, headers);
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/documents/coi/generate - success", () => {
  it("generates COI document for active policy", async () => {
    const headers = await authHeader(["ecm:documents:write"]);
    const res = await postCoi({
      policy_id: "POL-001",
      certificate_holder: { name: "ACME Corp", address: { street: "789 Business Blvd", city: "Chicago", state: "IL", zip: "60601" } },
      description: "COI for vendor requirement",
    }, headers);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.document_id).toStartWith("doc_");
    expect(body.client_id).toBe("CLI-001");
    expect(body.policy_id).toBe("POL-001");
    expect(body.document_type).toBe("coi");
    expect(body.status).toBe("generated");
    expect(body.certificate_holder.name).toBe("ACME Corp");
    expect(body.coverage_summary.policy_type).toBe("personal_auto");
    expect(body.coverage_summary.coverages.length).toBe(2);
    expect(body.created_at).toBeDefined();
  });

  it("generates COI with minimal fields", async () => {
    const headers = await authHeader(["ecm:documents:write"]);
    const res = await postCoi({
      policy_id: "POL-001",
      certificate_holder: { name: "Simple Corp" },
    }, headers);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.certificate_holder.name).toBe("Simple Corp");
    expect(body.description).toContain("Certificate of Insurance");
  });
});
