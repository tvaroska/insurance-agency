import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";

const testSqlite = new Database(":memory:");
testSqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(testSqlite, { schema });

mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

import { describe, it, expect, beforeAll } from "bun:test";
import { quotesRouter } from "../routes/quotes";
import { underwritingRouter } from "../routes/underwriting";
import { policiesRouter } from "../routes/policies";
import {
  createTables,
  createTestApp,
  authHeader,
  makeQuote,
  makePolicy,
  makeDocument,
} from "./setup";

const app = createTestApp({
  quotes: quotesRouter,
  underwriting: underwritingRouter,
  policies: policiesRouter,
});

beforeAll(() => {
  createTables(testSqlite);

  // Seed test quotes
  const quoteRows = [
    makeQuote({
      quote_id: "QT-001-SMIT",
      underwriting_status: "pending_review",
    }),
    makeQuote({
      quote_id: "QT-002-SMIT",
      status: "declined",
      premium_annual: null,
      premium_monthly: null,
      coverages: JSON.stringify([]),
      deductibles: JSON.stringify({}),
      decline_reason: "Risk exceeds guidelines",
      underwriting_status: "declined",
    }),
    makeQuote({
      quote_id: "QT-PENDING-SMIT",
      underwriting_status: "pending_review",
    }),
    makeQuote({
      quote_id: "QT-REFERRED-SMIT",
      underwriting_status: "pending_review",
    }),
    makeQuote({
      quote_id: "QT-CONFLICT-SMIT",
      underwriting_status: "approved",
    }),
  ];
  for (const q of quoteRows) {
    testDb.insert(schema.quotes).values(q).run();
  }

  // Seed test policies
  const policyRows = [
    makePolicy({ policy_id: "POL-PA-001" }),
    makePolicy({ policy_id: "POL-PA-002" }),
  ];
  for (const p of policyRows) {
    testDb.insert(schema.policies).values(p).run();
  }

  // Seed test documents (only for POL-PA-001)
  const docRows = [
    makeDocument({
      document_id: "TDOC-001",
      policy_id: "POL-PA-001",
      document_type: "dec_page",
      filename: "pol_pa_001_declarations.pdf",
    }),
    makeDocument({
      document_id: "TDOC-002",
      policy_id: "POL-PA-001",
      document_type: "id_cards",
      filename: "pol_pa_001_id_cards.pdf",
    }),
  ];
  for (const d of docRows) {
    testDb.insert(schema.policyDocuments).values(d).run();
  }
});

// ── Quote Routes ──

describe("GET /v1/summit/quotes/:quote_id", () => {
  it("returns a quote when found", async () => {
    const headers = await authHeader(["carrier:quotes:read"]);
    const res = await app.request("/v1/summit/quotes/QT-001-SMIT", { headers });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quote_id).toBe("QT-001-SMIT");
    expect(body.premium_annual).toBe(1085.0);
    expect(body.coverages).toBeArray();
    expect(body.underwriting_status).toBe("pending_review");
  });

  it("returns 404 for non-existent quote", async () => {
    const headers = await authHeader(["carrier:quotes:read"]);
    const res = await app.request("/v1/summit/quotes/QT-NONEXISTENT", { headers });
    expect(res.status).toBe(404);
  });

  it("returns declined quote with decline reason", async () => {
    const headers = await authHeader(["carrier:quotes:read"]);
    const res = await app.request("/v1/summit/quotes/QT-002-SMIT", { headers });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("declined");
    expect(body.decline_reason).toBe("Risk exceeds guidelines");
    expect(body.premium_annual).toBeNull();
  });

  it("returns 401 without auth token", async () => {
    const res = await app.request("/v1/summit/quotes/QT-001-SMIT");
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["carrier:policies:read"]);
    const res = await app.request("/v1/summit/quotes/QT-001-SMIT", { headers });
    expect(res.status).toBe(403);
  });
});

// ── Underwriting Routes ──

describe("POST /v1/summit/underwriting/:quote_id/decision", () => {
  it("approves a pending quote", async () => {
    const headers = await authHeader(["carrier:underwriting:write"]);
    const res = await app.request(
      "/v1/summit/underwriting/QT-PENDING-SMIT/decision",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "approve",
          notes: "Clean risk profile",
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.underwriting_status).toBe("approved");
    expect(body.underwriting_notes).toBe("Clean risk profile");
  });

  it("refers a pending quote for further review", async () => {
    const headers = await authHeader(["carrier:underwriting:write"]);
    const res = await app.request(
      "/v1/summit/underwriting/QT-REFERRED-SMIT/decision",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "refer" }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.underwriting_status).toBe("referred");
  });

  it("returns 400 for invalid decision", async () => {
    const headers = await authHeader(["carrier:underwriting:write"]);
    const res = await app.request(
      "/v1/summit/underwriting/QT-001-SMIT/decision",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "invalid_value" }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when decision is missing", async () => {
    const headers = await authHeader(["carrier:underwriting:write"]);
    const res = await app.request(
      "/v1/summit/underwriting/QT-001-SMIT/decision",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent quote", async () => {
    const headers = await authHeader(["carrier:underwriting:write"]);
    const res = await app.request(
      "/v1/summit/underwriting/QT-NONEXISTENT/decision",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approve" }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("returns 409 for already-decided quote", async () => {
    const headers = await authHeader(["carrier:underwriting:write"]);
    const res = await app.request(
      "/v1/summit/underwriting/QT-CONFLICT-SMIT/decision",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "decline" }),
      },
    );
    expect(res.status).toBe(409);
  });

  it("returns 401 without auth token", async () => {
    const res = await app.request(
      "/v1/summit/underwriting/QT-001-SMIT/decision",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approve" }),
      },
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["carrier:quotes:read"]);
    const res = await app.request(
      "/v1/summit/underwriting/QT-001-SMIT/decision",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approve" }),
      },
    );
    expect(res.status).toBe(403);
  });
});

// ── Policy Document Routes ──

describe("GET /v1/summit/policies/:policy_id/documents", () => {
  it("returns documents for a policy", async () => {
    const headers = await authHeader(["carrier:policies:read"]);
    const res = await app.request("/v1/summit/policies/POL-PA-001/documents", {
      headers,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policy_id).toBe("POL-PA-001");
    expect(body.document_count).toBe(2);
    expect(body.documents).toHaveLength(2);
    expect(body.documents[0].document_type).toBe("dec_page");
  });

  it("returns 404 for non-existent policy", async () => {
    const headers = await authHeader(["carrier:policies:read"]);
    const res = await app.request("/v1/summit/policies/POL-NONEXISTENT/documents", {
      headers,
    });
    expect(res.status).toBe(404);
  });

  it("returns empty documents list for policy with no documents", async () => {
    const headers = await authHeader(["carrier:policies:read"]);
    const res = await app.request("/v1/summit/policies/POL-PA-002/documents", {
      headers,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.document_count).toBe(0);
    expect(body.documents).toHaveLength(0);
  });

  it("returns 401 without auth token", async () => {
    const res = await app.request("/v1/summit/policies/POL-PA-001/documents");
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["carrier:underwriting:write"]);
    const res = await app.request("/v1/summit/policies/POL-PA-001/documents", {
      headers,
    });
    expect(res.status).toBe(403);
  });
});

// ── Submission Routes ──

describe("POST /v1/summit/submissions", () => {
  it("creates a property submission with required fields", async () => {
    const headers = await authHeader(["carrier:quotes:write"]);
    const res = await app.request("/v1/summit/submissions", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: "CLI-001",
        policy_type: "homeowners",
        property_address: { street: "123 Main St", city: "Springfield", state: "IL", zip: "62704" },
        property_details: { year_built: 1995, square_feet: 2200, construction: "frame" },
        coverages: [{ type: "dwelling", limit: 350000 }],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.quote_id).toBeDefined();
    expect(body.inspection_status).toBe("scheduled");
    expect(body.conditions_count).toBeGreaterThanOrEqual(1);
  });

  it("returns 400 when required fields are missing", async () => {
    const headers = await authHeader(["carrier:quotes:write"]);
    const res = await app.request("/v1/summit/submissions", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: "CLI-001" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 401 without auth token", async () => {
    const res = await app.request("/v1/summit/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: "CLI-001",
        policy_type: "homeowners",
        property_address: "123 Main St",
      }),
    });
    expect(res.status).toBe(401);
  });
});

// ── Inspection Routes ──

describe("GET /v1/summit/inspections/:id", () => {
  it("returns inspection status for a quote", async () => {
    const headers = await authHeader(["carrier:quotes:read"]);
    const res = await app.request("/v1/summit/inspections/QT-001-SMIT", {
      headers,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quote_id).toBe("QT-001-SMIT");
    expect(body.inspection_status).toBeDefined();
  });

  it("returns 404 for non-existent quote", async () => {
    const headers = await authHeader(["carrier:quotes:read"]);
    const res = await app.request("/v1/summit/inspections/QT-NONEXISTENT", {
      headers,
    });
    expect(res.status).toBe(404);
  });

  it("returns 401 without auth token", async () => {
    const res = await app.request("/v1/summit/inspections/QT-001-SMIT");
    expect(res.status).toBe(401);
  });
});

// ── Conditions Routes ──

describe("GET /v1/summit/inspections/:id/conditions", () => {
  it("returns conditions for a quote", async () => {
    const headers = await authHeader(["carrier:quotes:read"]);
    const res = await app.request("/v1/summit/inspections/QT-001-SMIT/conditions", {
      headers,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quote_id).toBe("QT-001-SMIT");
    expect(body.conditions).toBeArray();
  });

  it("returns 404 for non-existent quote", async () => {
    const headers = await authHeader(["carrier:quotes:read"]);
    const res = await app.request("/v1/summit/inspections/QT-NONEXISTENT/conditions", {
      headers,
    });
    expect(res.status).toBe(404);
  });

  it("returns 401 without auth token", async () => {
    const res = await app.request("/v1/summit/inspections/QT-001-SMIT/conditions");
    expect(res.status).toBe(401);
  });
});
