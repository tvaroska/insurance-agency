import { describe, it, expect, beforeAll } from "bun:test";
import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";

// ── Mock db module (required by route imports even though ACORD doesn't use DB) ──
const testSqlite = new Database(":memory:");
testSqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(testSqlite, { schema });
mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

// ── Mock cross-service HTTP clients ──

const mockClient = {
  id: "CLI-001",
  first_name: "Sarah",
  last_name: "Chen",
  dob: "1985-03-15",
  email: "sarah.chen@email.com",
  phone: "310-555-0101",
  address: { street: "742 Maple Drive", city: "Los Angeles", state: "CA", zip: "90026" },
  driver_license_number: "CA-D8832910",
  occupation: "Software Engineer",
  marital_status: "married",
};

const mockAutoPolicy = {
  policy_id: "POL-PA-2025-001847",
  client_id: "CLI-001",
  carrier_code: "SMIT",
  policy_type: "personal_auto",
  effective_date: "2025-06-01",
  expiration_date: "2026-06-01",
  premium_current: 1450.0,
  premium_prior: 1280.0,
  status: "active",
  multi_policy_discount: true,
  coverages: [
    { type: "bodily_injury", limit: "100000/300000", deductible: null },
    { type: "property_damage", limit: "50000", deductible: null },
    { type: "collision", limit: null, deductible: 500 },
    { type: "comprehensive", limit: null, deductible: 250 },
  ],
};

const mockHomePolicy = {
  policy_id: "POL-HO-2025-000312",
  client_id: "CLI-001",
  carrier_code: "SMIT",
  policy_type: "homeowners",
  effective_date: "2025-06-01",
  expiration_date: "2026-06-01",
  premium_current: 1850.0,
  premium_prior: 1720.0,
  status: "active",
  multi_policy_discount: true,
  coverages: [
    { type: "dwelling", limit: "450000", deductible: 1000 },
    { type: "personal_property", limit: "225000", deductible: null },
    { type: "liability", limit: "300000", deductible: null },
    { type: "medical_payments", limit: "5000", deductible: null },
  ],
};

const mockClaim = {
  claim_id: "CLM-2025-000001",
  policy_id: "POL-PA-2025-001847",
  client_id: "CLI-001",
  claim_type: "auto_collision",
  status: "settled",
  loss_date: "2025-09-12",
  reported_date: "2025-09-12",
  loss_description: "Rear-ended at intersection of Main St and 5th Ave.",
  loss_location: "Main St & 5th Ave, Chicago, IL",
  reserve_amount: 8500.0,
  settlement_amount: 7200.0,
  adjuster: {
    adjuster_id: "ADJ-001",
    first_name: "Marcus",
    last_name: "Rivera",
    email: "m.rivera@evergreen-claims.com",
    phone: "+1-312-555-0401",
    specialty: "auto",
  },
};

// Track whether fetch should fail
let amsClientShouldFail = false;
let claimsShouldFail = false;

// Mock the global fetch to intercept cross-service calls
const originalFetch = globalThis.fetch;
mock.module("../clients/ams-client", () => ({
  fetchClient: async (id: string) => {
    if (amsClientShouldFail) throw Object.assign(new Error("AMS client lookup failed"), { status: 404 });
    if (id === "CLI-001") return mockClient;
    throw Object.assign(new Error("AMS client lookup failed"), { status: 404 });
  },
  fetchClientPolicies: async (id: string) => {
    if (amsClientShouldFail) throw Object.assign(new Error("AMS policy lookup failed"), { status: 404 });
    if (id === "CLI-001") return [mockAutoPolicy, mockHomePolicy];
    return [];
  },
  fetchAllClients: async () => {
    if (amsClientShouldFail) throw Object.assign(new Error("AMS client list failed"), { status: 500 });
    return [mockClient];
  },
}));

mock.module("../clients/claims-client", () => ({
  fetchClaim: async (id: string) => {
    if (claimsShouldFail) throw Object.assign(new Error("Claims lookup failed"), { status: 404 });
    if (id === "CLM-2025-000001") return mockClaim;
    throw Object.assign(new Error("Claims lookup failed"), { status: 404 });
  },
}));

import { acordRouter } from "../routes/acord";
import { createTestApp, createTables, authHeader } from "./setup";

const app = createTestApp({ acord: acordRouter });

const BASE_URL = "http://localhost/v1/documents/acord";

// ── Request helper ──

async function getAcord(
  formType: string,
  params: Record<string, string> = {},
  headers: Record<string, string> = {},
) {
  const url = new URL(`${BASE_URL}/${formType}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return app.request(url.toString(), { headers });
}

// ── Setup ──

beforeAll(() => {
  createTables(testSqlite);
  amsClientShouldFail = false;
  claimsShouldFail = false;
});

// ── Auth tests ──

describe("GET /v1/documents/acord/:form_type - Auth", () => {
  it("returns 401 without token", async () => {
    const res = await getAcord("90", { policy_id: "POL-PA-2025-001847" });
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await getAcord("90", { policy_id: "POL-PA-2025-001847" }, headers);
    expect(res.status).toBe(403);
  });
});

// ── Validation tests ──

describe("GET /v1/documents/acord/:form_type - Validation", () => {
  it("returns 400 for invalid form_type", async () => {
    const headers = await authHeader(["ecm:acord:read"]);
    const res = await getAcord("99", {}, headers);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error_code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when policy_id missing for form 90", async () => {
    const headers = await authHeader(["ecm:acord:read"]);
    const res = await getAcord("90", {}, headers);
    expect(res.status).toBe(400);
  });

  it("returns 400 when claim_id missing for form 35", async () => {
    const headers = await authHeader(["ecm:acord:read"]);
    const res = await getAcord("35", {}, headers);
    expect(res.status).toBe(400);
  });

  it("returns 400 when policy type does not match form 90", async () => {
    const headers = await authHeader(["ecm:acord:read"]);
    // POL-HO is homeowners, not personal_auto
    const res = await getAcord("90", { policy_id: "POL-HO-2025-000312" }, headers);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.details[0].message).toContain("personal_auto");
  });

  it("returns 400 when policy type does not match form 80", async () => {
    const headers = await authHeader(["ecm:acord:read"]);
    // POL-PA is personal_auto, not homeowners
    const res = await getAcord("80", { policy_id: "POL-PA-2025-001847" }, headers);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.details[0].message).toContain("homeowners");
  });
});

// ── ACORD 90 success tests ──

describe("GET /v1/documents/acord/90 - Success", () => {
  it("returns a valid PDF for personal auto policy", async () => {
    const headers = await authHeader(["ecm:acord:read"]);
    const res = await getAcord("90", { policy_id: "POL-PA-2025-001847" }, headers);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("ACORD-90.pdf");

    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    // PDF magic bytes: %PDF
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("%PDF");
    expect(bytes.length).toBeGreaterThan(100);
  });
});

// ── ACORD 80 success tests ──

describe("GET /v1/documents/acord/80 - Success", () => {
  it("returns a valid PDF for homeowners policy", async () => {
    const headers = await authHeader(["ecm:acord:read"]);
    const res = await getAcord("80", { policy_id: "POL-HO-2025-000312" }, headers);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("ACORD-80.pdf");

    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("%PDF");
  });
});

// ── ACORD 35 success tests ──

describe("GET /v1/documents/acord/35 - Success", () => {
  it("returns a valid PDF for a claim", async () => {
    const headers = await authHeader(["ecm:acord:read"]);
    const res = await getAcord("35", { claim_id: "CLM-2025-000001" }, headers);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("ACORD-35.pdf");

    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("%PDF");
  });
});

// ── Error handling tests ──

describe("GET /v1/documents/acord/:form_type - Upstream errors", () => {
  it("returns 400 when policy not found in AMS", async () => {
    const headers = await authHeader(["ecm:acord:read"]);
    const res = await getAcord("90", { policy_id: "POL-NONEXISTENT" }, headers);
    // The findPolicyWithClient function throws a validation error when policy is not found
    expect(res.status).toBe(400);
  });

  it("returns 500 when claims service is unavailable", async () => {
    claimsShouldFail = true;
    const headers = await authHeader(["ecm:acord:read"]);
    const res = await getAcord("35", { claim_id: "CLM-2025-000001" }, headers);
    expect(res.status).toBe(500);
    claimsShouldFail = false;
  });
});
