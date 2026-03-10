import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";

const testSqlite = new Database(":memory:");
testSqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(testSqlite, { schema });

mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

import { describe, expect, test, beforeAll } from "bun:test";
import { claimsRouter } from "../routes/claims";
import { adjustersRouter } from "../routes/adjusters";
import {
  createTables,
  createTestApp,
  authHeader,
  makeClaim,
  makeAdjuster,
  makeTimelineEvent,
  makeClaimDocument,
} from "./setup";

const app = createTestApp({ claims: claimsRouter, adjusters: adjustersRouter });

beforeAll(() => {
  createTables(testSqlite);

  // Seed adjusters
  const adjusterRows = [
    makeAdjuster({ adjuster_id: "ADJ-001", first_name: "Marcus", last_name: "Rivera", specialty: "auto", active: 1, max_open_claims: 25 }),
    makeAdjuster({ adjuster_id: "ADJ-002", first_name: "Sandra", last_name: "Chen", specialty: "property", active: 1, max_open_claims: 2 }),
    makeAdjuster({ adjuster_id: "ADJ-003", first_name: "David", last_name: "Okafor", specialty: "general", active: 0, max_open_claims: 30 }),
  ];
  for (const row of adjusterRows) {
    testDb.insert(schema.adjusters).values(row).run();
  }

  // Seed claims
  const claimRows = [
    makeClaim({ claim_id: "CLM-2026-000001", client_id: "CLI-001", policy_id: "POL-PA-2025-001847", claim_type: "auto_collision", status: "settled", adjuster_id: "ADJ-001", reserve_amount: 8500, settlement_amount: 7200, loss_date: "2025-09-12", created_at: "2025-09-12T14:30:00Z" }),
    makeClaim({ claim_id: "CLM-2026-000002", client_id: "CLI-001", policy_id: "POL-HO-2025-000312", claim_type: "water", status: "investigating", adjuster_id: "ADJ-002", reserve_amount: 15000, loss_date: "2026-01-08", created_at: "2026-01-09T09:15:00Z" }),
    makeClaim({ claim_id: "CLM-2026-000003", client_id: "CLI-003", policy_id: "POL-PA-2025-002103", claim_type: "auto_comprehensive", status: "reported", loss_date: "2025-11-20", created_at: "2025-11-21T08:00:00Z" }),
    makeClaim({ claim_id: "CLM-2026-000004", client_id: "CLI-004", policy_id: "POL-HO-2024-000810", claim_type: "fire", status: "assigned", adjuster_id: "ADJ-002", loss_date: "2026-01-25", created_at: "2026-01-25T20:00:00Z" }),
    makeClaim({ claim_id: "CLM-2026-000005", client_id: "CLI-005", policy_id: "POL-PA-2025-002250", claim_type: "theft", status: "denied", adjuster_id: "ADJ-001", loss_date: "2025-12-01", created_at: "2025-12-05T11:00:00Z" }),
  ];
  for (const row of claimRows) {
    testDb.insert(schema.claims).values(row).run();
  }

  // Seed timeline events
  testDb.insert(schema.claimTimeline).values(
    makeTimelineEvent({ event_id: "EVT-001", claim_id: "CLM-2026-000001", event_type: "status_change", description: "Status changed to settled.", old_value: "reserved", new_value: "settled" }),
  ).run();
});

// ── Auth tests ──

describe("Auth", () => {
  test("returns 401 without Authorization header", async () => {
    const res = await app.request("/v1/claims");
    expect(res.status).toBe(401);
  });

  test("returns 403 with wrong scope on GET /v1/claims", async () => {
    const res = await app.request("/v1/claims", {
      headers: await authHeader(["ams:clients:read"]),
    });
    expect(res.status).toBe(403);
  });

  test("returns 403 with wrong scope on POST /v1/claims/fnol", async () => {
    const res = await app.request("/v1/claims/fnol", {
      method: "POST",
      headers: {
        ...(await authHeader(["claims:read"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });
});

// ── FNOL tests ──

describe("POST /v1/claims/fnol", () => {
  test("creates claim with valid data", async () => {
    const res = await app.request("/v1/claims/fnol", {
      method: "POST",
      headers: {
        ...(await authHeader(["claims:write"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        policy_id: "POL-PA-2025-001847",
        client_id: "CLI-001",
        claim_type: "auto_collision",
        loss_date: "2026-01-15",
        loss_description: "Fender bender in parking lot.",
        loss_location: "123 Main St, Chicago, IL",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.claim_id).toStartWith("CLM-");
    expect(body.status).toBe("reported");
    expect(body.policy_id).toBe("POL-PA-2025-001847");
  });

  test("returns 400 for missing required fields", async () => {
    const res = await app.request("/v1/claims/fnol", {
      method: "POST",
      headers: {
        ...(await authHeader(["claims:write"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ policy_id: "POL-001" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe("VALIDATION_ERROR");
  });

  test("returns 400 for invalid claim_type", async () => {
    const res = await app.request("/v1/claims/fnol", {
      method: "POST",
      headers: {
        ...(await authHeader(["claims:write"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        policy_id: "POL-001",
        client_id: "CLI-001",
        claim_type: "alien_abduction",
        loss_date: "2026-01-15",
        loss_description: "Taken by aliens.",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe("VALIDATION_ERROR");
  });

  test("returns 400 for future loss_date", async () => {
    const res = await app.request("/v1/claims/fnol", {
      method: "POST",
      headers: {
        ...(await authHeader(["claims:write"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        policy_id: "POL-001",
        client_id: "CLI-001",
        claim_type: "auto_collision",
        loss_date: "2099-12-31",
        loss_description: "Future accident.",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid loss_date format", async () => {
    const res = await app.request("/v1/claims/fnol", {
      method: "POST",
      headers: {
        ...(await authHeader(["claims:write"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        policy_id: "POL-001",
        client_id: "CLI-001",
        claim_type: "auto_collision",
        loss_date: "Jan 15, 2026",
        loss_description: "Bad format.",
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ── Claims listing ──

describe("GET /v1/claims", () => {
  test("returns paginated list", async () => {
    const res = await app.request("/v1/claims", {
      headers: await authHeader(["claims:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.pagination).toBeDefined();
    expect(body.pagination.limit).toBeDefined();
  });

  test("filters by status", async () => {
    const res = await app.request("/v1/claims?status=investigating", {
      headers: await authHeader(["claims:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const c of body.data) {
      expect(c.status).toBe("investigating");
    }
  });

  test("filters by client_id", async () => {
    const res = await app.request("/v1/claims?client_id=CLI-001", {
      headers: await authHeader(["claims:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const c of body.data) {
      expect(c.client_id).toBe("CLI-001");
    }
  });

  test("filters by claim_type", async () => {
    const res = await app.request("/v1/claims?claim_type=fire", {
      headers: await authHeader(["claims:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const c of body.data) {
      expect(c.claim_type).toBe("fire");
    }
  });

  test("returns 400 for invalid status filter", async () => {
    const res = await app.request("/v1/claims?status=invalid", {
      headers: await authHeader(["claims:read"]),
    });
    expect(res.status).toBe(400);
  });

  test("cursor pagination traverses all results", async () => {
    const headers = await authHeader(["claims:read"]);
    const allIds = new Set<string>();
    let url = "/v1/claims?limit=2";

    while (true) {
      const res = await app.request(url, { headers });
      expect(res.status).toBe(200);
      const body = await res.json();
      for (const c of body.data) {
        allIds.add(c.claim_id);
      }
      if (!body.pagination.has_more) break;
      url = `/v1/claims?limit=2&cursor=${body.pagination.next_cursor}`;
    }

    // At least the 5 seeded + 1 from FNOL test
    expect(allIds.size).toBeGreaterThanOrEqual(5);
  });
});

// ── Claim detail ──

describe("GET /v1/claims/:claim_id", () => {
  test("returns claim with adjuster and timeline", async () => {
    const res = await app.request("/v1/claims/CLM-2026-000001", {
      headers: await authHeader(["claims:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claim_id).toBe("CLM-2026-000001");
    expect(body.adjuster).toBeDefined();
    expect(body.adjuster.adjuster_id).toBe("ADJ-001");
    expect(body.timeline).toBeArray();
    expect(body.documents).toBeArray();
  });

  test("returns 404 for non-existent claim", async () => {
    const res = await app.request("/v1/claims/CLM-NONEXISTENT", {
      headers: await authHeader(["claims:read"]),
    });
    expect(res.status).toBe(404);
  });
});

// ── Adjuster assignment ──

describe("POST /v1/claims/:claim_id/assign", () => {
  test("assigns adjuster and transitions to assigned", async () => {
    const res = await app.request("/v1/claims/CLM-2026-000003/assign", {
      method: "POST",
      headers: {
        ...(await authHeader(["claims:assign"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ adjuster_id: "ADJ-001" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.adjuster_id).toBe("ADJ-001");
    expect(body.status).toBe("assigned");
  });

  test("returns 404 for non-existent claim", async () => {
    const res = await app.request("/v1/claims/CLM-FAKE/assign", {
      method: "POST",
      headers: {
        ...(await authHeader(["claims:assign"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ adjuster_id: "ADJ-001" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 404 for non-existent adjuster", async () => {
    const res = await app.request("/v1/claims/CLM-2026-000002/assign", {
      method: "POST",
      headers: {
        ...(await authHeader(["claims:assign"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ adjuster_id: "ADJ-FAKE" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 400 for inactive adjuster", async () => {
    const res = await app.request("/v1/claims/CLM-2026-000002/assign", {
      method: "POST",
      headers: {
        ...(await authHeader(["claims:assign"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ adjuster_id: "ADJ-003" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 400 when adjuster exceeds max_open_claims", async () => {
    // ADJ-002 has max_open_claims=2 and already has 2 open claims (CLM-000002 investigating, CLM-000004 assigned)
    const res = await app.request("/v1/claims/CLM-2026-000005/assign", {
      method: "POST",
      headers: {
        ...(await authHeader(["claims:assign"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ adjuster_id: "ADJ-002" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe("VALIDATION_ERROR");
  });
});

// ── Status transitions ──

describe("PATCH /v1/claims/:claim_id", () => {
  test("transitions status forward", async () => {
    // CLM-2026-000004 is "assigned", should be able to go to "investigating"
    const res = await app.request("/v1/claims/CLM-2026-000004", {
      method: "PATCH",
      headers: {
        ...(await authHeader(["claims:write"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "investigating" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("investigating");
  });

  test("rejects invalid status transition", async () => {
    // CLM-2026-000001 is "settled", cannot go back to "reported"
    const res = await app.request("/v1/claims/CLM-2026-000001", {
      method: "PATCH",
      headers: {
        ...(await authHeader(["claims:write"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "reported" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe("VALIDATION_ERROR");
  });

  test("updates reserve_amount", async () => {
    const res = await app.request("/v1/claims/CLM-2026-000002", {
      method: "PATCH",
      headers: {
        ...(await authHeader(["claims:write"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reserve_amount: 20000 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reserve_amount).toBe(20000);
  });

  test("rejects negative reserve_amount", async () => {
    const res = await app.request("/v1/claims/CLM-2026-000002", {
      method: "PATCH",
      headers: {
        ...(await authHeader(["claims:write"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reserve_amount: -500 }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 400 for empty body", async () => {
    const res = await app.request("/v1/claims/CLM-2026-000002", {
      method: "PATCH",
      headers: {
        ...(await authHeader(["claims:write"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ irrelevant: "field" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 404 for non-existent claim", async () => {
    const res = await app.request("/v1/claims/CLM-FAKE", {
      method: "PATCH",
      headers: {
        ...(await authHeader(["claims:write"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ notes: "test" }),
    });
    expect(res.status).toBe(404);
  });
});

// ── Timeline ──

describe("GET /v1/claims/:claim_id/timeline", () => {
  test("returns timeline events", async () => {
    const res = await app.request("/v1/claims/CLM-2026-000001/timeline", {
      headers: await authHeader(["claims:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  test("returns 404 for non-existent claim", async () => {
    const res = await app.request("/v1/claims/CLM-NONEXISTENT/timeline", {
      headers: await authHeader(["claims:read"]),
    });
    expect(res.status).toBe(404);
  });
});

// ── Documents ──

describe("POST /v1/claims/:claim_id/documents", () => {
  test("uploads document metadata", async () => {
    const res = await app.request("/v1/claims/CLM-2026-000001/documents", {
      method: "POST",
      headers: {
        ...(await authHeader(["claims:documents"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        document_type: "photos",
        file_name: "damage-front.jpg",
        file_path: "/uploads/claims/CLM-2026-000001/damage-front.jpg",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.document_id).toStartWith("DOC-");
    expect(body.document_type).toBe("photos");
  });

  test("returns 400 for invalid document_type", async () => {
    const res = await app.request("/v1/claims/CLM-2026-000001/documents", {
      method: "POST",
      headers: {
        ...(await authHeader(["claims:documents"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        document_type: "selfie",
        file_name: "my-selfie.jpg",
        file_path: "/uploads/selfie.jpg",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 400 for missing required fields", async () => {
    const res = await app.request("/v1/claims/CLM-2026-000001/documents", {
      method: "POST",
      headers: {
        ...(await authHeader(["claims:documents"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ document_type: "photos" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 404 for non-existent claim", async () => {
    const res = await app.request("/v1/claims/CLM-FAKE/documents", {
      method: "POST",
      headers: {
        ...(await authHeader(["claims:documents"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        document_type: "photos",
        file_name: "photo.jpg",
        file_path: "/uploads/photo.jpg",
      }),
    });
    expect(res.status).toBe(404);
  });
});

// ── Adjusters list ──

describe("GET /v1/adjusters", () => {
  test("returns all adjusters with open_claims_count", async () => {
    const res = await app.request("/v1/adjusters", {
      headers: await authHeader(["claims:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBe(3);
    for (const a of body.data) {
      expect(typeof a.open_claims_count).toBe("number");
    }
  });

  test("filters by specialty", async () => {
    const res = await app.request("/v1/adjusters?specialty=auto", {
      headers: await authHeader(["claims:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const a of body.data) {
      expect(a.specialty).toBe("auto");
    }
  });

  test("filters by active status", async () => {
    const res = await app.request("/v1/adjusters?active=0", {
      headers: await authHeader(["claims:read"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].adjuster_id).toBe("ADJ-003");
  });

  test("returns 400 for invalid specialty", async () => {
    const res = await app.request("/v1/adjusters?specialty=wizard", {
      headers: await authHeader(["claims:read"]),
    });
    expect(res.status).toBe(400);
  });
});

// ── POST /v1/claims — alias for /fnol with field normalization ──

describe("POST /v1/claims - alias", () => {
  test("creates claim with normalized field names", async () => {
    const res = await app.request("/v1/claims", {
      method: "POST",
      headers: {
        ...(await authHeader(["claims:write"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        policy_id: "POL-PA-2025-001847",
        client_id: "CLI-001",
        loss_type: "auto_collision",
        loss_date: "2026-01-15",
        description: "Rear-ended at stoplight.",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.claim_id).toStartWith("CLM-");
    expect(body.claim_type).toBe("auto_collision");
    expect(body.loss_description).toBe("Rear-ended at stoplight.");
    expect(body.status).toBe("reported");
  });

  test("passes through standard field names", async () => {
    const res = await app.request("/v1/claims", {
      method: "POST",
      headers: {
        ...(await authHeader(["claims:write"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        policy_id: "POL-PA-2025-001847",
        client_id: "CLI-001",
        claim_type: "theft",
        loss_date: "2026-01-15",
        loss_description: "Vehicle stolen from parking lot.",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.claim_type).toBe("theft");
    expect(body.loss_description).toBe("Vehicle stolen from parking lot.");
  });

  test("returns 400 for validation errors", async () => {
    const res = await app.request("/v1/claims", {
      method: "POST",
      headers: {
        ...(await authHeader(["claims:write"])),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        policy_id: "POL-PA-2025-001847",
      }),
    });
    expect(res.status).toBe(400);
  });
});
