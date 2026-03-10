import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";

const testSqlite = new Database(":memory:");
testSqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(testSqlite, { schema });

mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

import { describe, expect, test, beforeAll } from "bun:test";
import { quotesRouter } from "../routes/quotes";
import {
  createTables,
  createTestApp,
  authHeader,
  makeQuoteRequest,
  makeCarrierQuote,
  makeCarrier,
} from "./setup";

const app = createTestApp({ quotes: quotesRouter });

beforeAll(() => {
  createTables(testSqlite);

  // Seed carriers for quote request tests
  testDb
    .insert(schema.carriers)
    .values(
      makeCarrier({
        carrier_code: "CSTL",
        carrier_name: "Coastal Star",
        states: JSON.stringify(["IL", "IN", "OH"]),
        policy_types: JSON.stringify(["personal_auto", "homeowners"]),
      }),
    )
    .run();
  testDb
    .insert(schema.carriers)
    .values(
      makeCarrier({
        carrier_code: "SMIT",
        carrier_name: "Summit",
        states: JSON.stringify(["IL", "NY", "CA"]),
        policy_types: JSON.stringify(["personal_auto", "homeowners", "bop"]),
      }),
    )
    .run();

  // Seed existing quote request + quotes for results/bind tests
  testDb
    .insert(schema.quoteRequests)
    .values(makeQuoteRequest({ request_id: "QR-001", status: "completed" }))
    .run();

  testDb
    .insert(schema.carrierQuotes)
    .values(
      makeCarrierQuote({
        quote_id: "QT-QUOTED",
        request_id: "QR-001",
        carrier_code: "CSTL",
        status: "quoted",
      }),
    )
    .run();
  testDb
    .insert(schema.carrierQuotes)
    .values(
      makeCarrierQuote({
        quote_id: "QT-DECLINED",
        request_id: "QR-001",
        carrier_code: "SMIT",
        status: "declined",
        premium_annual: null,
        premium_monthly: null,
        decline_reason: "Insufficient driving history",
      }),
    )
    .run();
  testDb
    .insert(schema.carrierQuotes)
    .values(
      makeCarrierQuote({
        quote_id: "QT-BOUND",
        request_id: "QR-001",
        carrier_code: "ERIE",
        carrier_name: "Erie",
        status: "bound",
        bound_at: new Date().toISOString(),
      }),
    )
    .run();
});

const validQuoteBody = {
  policy_type: "personal_auto",
  effective_date: "2026-04-01",
  client: {
    first_name: "Maria",
    last_name: "Rodriguez",
    address: { street: "123 Main St", city: "Chicago", state: "IL", zip: "60601" },
  },
  drivers: [
    {
      first_name: "Maria",
      last_name: "Rodriguez",
      date_of_birth: "1985-03-15",
      license_number: "R123456789",
      license_state: "IL",
    },
  ],
  vehicles: [
    { vin: "1HGBH41JXMN109186", year: 2023, make: "Honda", model: "Civic", usage: "commute" },
  ],
  requested_coverages: [
    { coverage_type: "bodily_injury", per_person_limit: 100000, per_occurrence_limit: 300000 },
  ],
};

const validBindBody = {
  payment_method: "eft",
  producer_id: "PROD-001",
  insured_signature_collected: true,
  insured_signature_date: "2026-03-12",
};

function postQuoteRequest(body: unknown, headers: Record<string, string>) {
  return app.request("/v1/quotes/request", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getResults(requestId: string, headers: Record<string, string>) {
  return app.request(`/v1/quotes/${requestId}/results`, { headers });
}

function postBind(quoteId: string, body: unknown, headers: Record<string, string>) {
  return app.request(`/v1/quotes/${quoteId}/bind`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── POST /v1/quotes/request ────────────────────────────────────────────

describe("POST /v1/quotes/request - auth", () => {
  test("returns 401 without auth", async () => {
    const res = await postQuoteRequest(validQuoteBody, {});
    expect(res.status).toBe(401);
  });
});

describe("POST /v1/quotes/request - successful creation", () => {
  test("returns 202 with request_id on valid input", async () => {
    const headers = await authHeader(["rater:quotes:create"]);
    const res = await postQuoteRequest(validQuoteBody, headers);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.request_id).toMatch(/^qr_[a-z0-9]{8}$/);
    expect(body.status).toBe("completed");
    expect(body.carriers_queried).toBeGreaterThan(0);
    expect(body.created_at).toBeDefined();
    expect(body.estimated_completion).toBeDefined();
  });

  test("returns carriers_queried matching eligible carriers", async () => {
    const headers = await authHeader(["rater:quotes:create"]);
    const res = await postQuoteRequest(validQuoteBody, headers);
    const body = await res.json();
    // IL state has both CSTL and SMIT for personal_auto
    expect(body.carriers_queried).toBe(2);
  });

  test("returns 0 carriers_queried for unmatched state", async () => {
    const headers = await authHeader(["rater:quotes:create"]);
    const body = {
      ...validQuoteBody,
      client: {
        ...validQuoteBody.client,
        address: { ...validQuoteBody.client.address, state: "AK" },
      },
    };
    const res = await postQuoteRequest(body, headers);
    const result = await res.json();
    expect(result.carriers_queried).toBe(0);
    expect(result.status).toBe("pending");
  });
});

describe("POST /v1/quotes/request - validation", () => {
  test("returns 400 for missing policy_type", async () => {
    const headers = await authHeader(["rater:quotes:create"]);
    const { policy_type, ...body } = validQuoteBody;
    const res = await postQuoteRequest(body, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid policy_type", async () => {
    const headers = await authHeader(["rater:quotes:create"]);
    const res = await postQuoteRequest(
      { ...validQuoteBody, policy_type: "invalid" },
      headers,
    );
    expect(res.status).toBe(400);
  });

  test("returns 400 for missing effective_date", async () => {
    const headers = await authHeader(["rater:quotes:create"]);
    const { effective_date, ...body } = validQuoteBody;
    const res = await postQuoteRequest(body, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid date format", async () => {
    const headers = await authHeader(["rater:quotes:create"]);
    const res = await postQuoteRequest(
      { ...validQuoteBody, effective_date: "04/01/2026" },
      headers,
    );
    expect(res.status).toBe(400);
  });

  test("returns 400 for missing client", async () => {
    const headers = await authHeader(["rater:quotes:create"]);
    const { client, ...body } = validQuoteBody;
    const res = await postQuoteRequest(body, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for missing drivers when personal_auto", async () => {
    const headers = await authHeader(["rater:quotes:create"]);
    const { drivers, ...body } = validQuoteBody;
    const res = await postQuoteRequest(body, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for missing vehicles when personal_auto", async () => {
    const headers = await authHeader(["rater:quotes:create"]);
    const { vehicles, ...body } = validQuoteBody;
    const res = await postQuoteRequest(body, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for missing property when homeowners", async () => {
    const headers = await authHeader(["rater:quotes:create"]);
    const body = {
      ...validQuoteBody,
      policy_type: "homeowners",
    };
    // Remove auto-specific fields, don't add property
    delete (body as Record<string, unknown>).drivers;
    delete (body as Record<string, unknown>).vehicles;
    const res = await postQuoteRequest(body, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for missing requested_coverages", async () => {
    const headers = await authHeader(["rater:quotes:create"]);
    const { requested_coverages, ...body } = validQuoteBody;
    const res = await postQuoteRequest(body, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for empty requested_coverages array", async () => {
    const headers = await authHeader(["rater:quotes:create"]);
    const res = await postQuoteRequest(
      { ...validQuoteBody, requested_coverages: [] },
      headers,
    );
    expect(res.status).toBe(400);
  });
});

// ── GET /v1/quotes/:request_id/results ─────────────────────────────────

describe("GET /v1/quotes/:request_id/results - auth", () => {
  test("returns 401 without auth", async () => {
    const res = await getResults("QR-001", {});
    expect(res.status).toBe(401);
  });
});

describe("GET /v1/quotes/:request_id/results - success", () => {
  test("returns 200 with quote details", async () => {
    const headers = await authHeader(["rater:quotes:read"]);
    const res = await getResults("QR-001", headers);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request_id).toBe("QR-001");
    expect(body.policy_type).toBe("personal_auto");
    expect(body.carriers).toBeArray();
    expect(body.carriers.length).toBe(3);
  });

  test("returns parsed coverages and deductibles", async () => {
    const headers = await authHeader(["rater:quotes:read"]);
    const res = await getResults("QR-001", headers);
    const body = await res.json();
    const quoted = body.carriers.find(
      (c: Record<string, unknown>) => c.carrier_code === "CSTL",
    );
    expect(quoted.coverages).toBeArray();
    expect(typeof quoted.deductibles).toBe("object");
  });

  test("returns null quote_id for declined quotes", async () => {
    const headers = await authHeader(["rater:quotes:read"]);
    const res = await getResults("QR-001", headers);
    const body = await res.json();
    const declined = body.carriers.find(
      (c: Record<string, unknown>) => c.status === "declined",
    );
    expect(declined.quote_id).toBeNull();
    expect(declined.decline_reason).toBe("Insufficient driving history");
  });
});

describe("GET /v1/quotes/:request_id/results - errors", () => {
  test("returns 404 for nonexistent request", async () => {
    const headers = await authHeader(["rater:quotes:read"]);
    const res = await getResults("QR-NONEXISTENT", headers);
    expect(res.status).toBe(404);
  });
});

// ── POST /v1/quotes/:quote_id/bind ─────────────────────────────────────

describe("POST /v1/quotes/:quote_id/bind - auth", () => {
  test("returns 401 without auth", async () => {
    const res = await postBind("QT-QUOTED", validBindBody, {});
    expect(res.status).toBe(401);
  });
});

describe("POST /v1/quotes/:quote_id/bind - successful bind", () => {
  test("returns 201 with policy details", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    const res = await postBind("QT-QUOTED", validBindBody, headers);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.policy_id).toMatch(/^POL-CSTL-\d{4}-\d{6}$/);
    expect(body.quote_id).toBe("QT-QUOTED");
    expect(body.carrier_code).toBe("CSTL");
    expect(body.bind_status).toBe("bound");
    expect(body.bound_at).toBeDefined();
    expect(body.premium_annual).toBe(1842.0);
  });
});

describe("POST /v1/quotes/:quote_id/bind - errors", () => {
  test("returns 404 for nonexistent quote", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    const res = await postBind("QT-NONEXISTENT", validBindBody, headers);
    expect(res.status).toBe(404);
  });

  test("returns 409 for already bound quote", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    const res = await postBind("QT-BOUND", validBindBody, headers);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe("CONFLICT");
  });

  test("returns 409 for declined quote", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    const res = await postBind("QT-DECLINED", validBindBody, headers);
    expect(res.status).toBe(409);
  });

  test("returns 400 for missing payment_method", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    const { payment_method, ...body } = validBindBody;
    const res = await postBind("QT-QUOTED", body, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid payment_method", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    const res = await postBind(
      "QT-QUOTED",
      { ...validBindBody, payment_method: "bitcoin" },
      headers,
    );
    expect(res.status).toBe(400);
  });

  test("returns 400 for missing producer_id", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    const { producer_id, ...body } = validBindBody;
    const res = await postBind("QT-QUOTED", body, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for missing insured_signature_date", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    const { insured_signature_date, ...body } = validBindBody;
    const res = await postBind("QT-QUOTED", body, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 when insured_signature_collected is false", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    const res = await postBind(
      "QT-QUOTED",
      { ...validBindBody, insured_signature_collected: false },
      headers,
    );
    expect(res.status).toBe(400);
  });
});
