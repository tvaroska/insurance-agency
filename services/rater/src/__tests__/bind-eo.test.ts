import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { insertSqliteRow } from "@evergreen/shared";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { mkdtempSync } from "fs";
import { join } from "path";

const tmpDir = mkdtempSync("/tmp/test-rater-");
const dbPath = join(tmpDir, "test.db");
const testSqlite = new Database(dbPath);
testSqlite.exec("PRAGMA journal_mode = WAL;");
testSqlite.exec("PRAGMA foreign_keys = ON;");

const testAdapter = new PrismaLibSql({ url: `file:${dbPath}` });
const testPrisma = new PrismaClient({ adapter: testAdapter });
mock.module("../prisma", () => ({ prisma: testPrisma }));

import { describe, expect, test, beforeAll, beforeEach, afterEach, spyOn } from "bun:test";
import { quotesRouter } from "../routes/quotes";
import {
  createTables,
  createTestApp,
  authHeader,
  makeQuoteRequest,
  makeCarrierQuote,
} from "./setup";

const app = createTestApp({ quotes: quotesRouter });

const validBindBody = {
  payment_method: "eft",
  producer_id: "PROD-001",
  insured_signature_collected: true,
  insured_signature_date: "2026-03-12",
};

beforeAll(() => {
  createTables(testSqlite);
});

let fetchSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  testSqlite.exec("DELETE FROM carrier_quotes");
  testSqlite.exec("DELETE FROM quote_requests");

  // Normal premium quote (under $10K)
  insertSqliteRow(testSqlite, "quote_requests", makeQuoteRequest({ request_id: "QR-EO-01", status: "completed" }),);
  insertSqliteRow(testSqlite, "carrier_quotes", makeCarrierQuote({
      quote_id: "QT-NORMAL",
      request_id: "QR-EO-01",
      premium_annual: 2500,
      premium_monthly: 208.33,
      status: "quoted",
    }),);

  // High premium quote (over $10K)
  insertSqliteRow(testSqlite, "quote_requests", makeQuoteRequest({ request_id: "QR-EO-02", status: "completed" }),);
  insertSqliteRow(testSqlite, "carrier_quotes", makeCarrierQuote({
      quote_id: "QT-HIGHPREM",
      request_id: "QR-EO-02",
      premium_annual: 15000,
      premium_monthly: 1250,
      status: "quoted",
    }),);

  // Below state minimum auto quote
  insertSqliteRow(testSqlite, "quote_requests", makeQuoteRequest({
      request_id: "QR-EO-03",
      status: "completed",
      policy_type: "personal_auto",
      risk_data: JSON.stringify({
        requested_coverages: [
          { coverage_type: "bodily_injury", per_person_limit: 10000 },
        ],
        drivers: [{ first_name: "Test", last_name: "Driver" }],
        vehicles: [{ vin: "1HGBH41JXMN109186", year: 2023, make: "Honda", model: "Civic" }],
      }),
    }),);
  insertSqliteRow(testSqlite, "carrier_quotes", makeCarrierQuote({
      quote_id: "QT-LOWLIMIT",
      request_id: "QR-EO-03",
      premium_annual: 800,
      premium_monthly: 66.67,
      status: "quoted",
    }),);
});

afterEach(() => {
  if (fetchSpy) {
    fetchSpy.mockRestore();
  }
});

function postBind(quoteId: string, body: unknown, headers: Record<string, string>) {
  return app.request(`/v1/quotes/${quoteId}/bind`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── E&O: Premium threshold ──

function mockEscalation(escalation: Record<string, unknown>, status = 200) {
  const seen: { url?: string; headers?: Record<string, string> } = {};
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("/v1/escalations/")) {
      seen.url = url;
      seen.headers = init?.headers;
      return new Response(JSON.stringify(escalation), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return app.fetch(new Request(url, init));
  });
  return seen;
}

describe("E&O - premium threshold", () => {
  test("premium >$10K without escalation_id returns 422", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    const res = await postBind("QT-HIGHPREM", validBindBody, headers);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("E&O_RULES_TRIGGERED");
    expect(body.error_code).toBe("E_EO_PREMIUM_THRESHOLD_EXCEEDED");
    expect(body.eo_rules).toBeArray();
    expect(body.eo_rules.length).toBeGreaterThanOrEqual(1);
    expect(body.eo_rules[0].rule).toBe("premium_threshold");
    expect(body.details[0].code).toBe("E_EO_PREMIUM_THRESHOLD_EXCEEDED");
  });

  test("premium >$10K with approved same-client premium_threshold escalation returns 201", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    const seen = mockEscalation({
      escalation_id: "esc_approved1",
      client_id: "client-001",
      reason: "premium_threshold",
      status: "approved",
      manager_response: { decision: "approved" },
    });

    const res = await postBind("QT-HIGHPREM", {
      ...validBindBody,
      escalation_id: "esc_approved1",
    }, headers);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.bind_status).toBe("bound");
    // The AMS lookup is service-to-service, so AMS must not log it as an agent call.
    expect(seen.headers?.["X-Evergreen-Internal"]).toBe("1");
  });

  test("AMS escalation lookup honors AMS_BASE_URL", async () => {
    const prev = process.env.AMS_BASE_URL;
    process.env.AMS_BASE_URL = "http://localhost:3100/";
    try {
      const headers = await authHeader(["rater:quotes:bind"]);
      const seen = mockEscalation({
        escalation_id: "esc_base",
        client_id: "client-001",
        reason: "premium_threshold",
        status: "approved",
      });
      const res = await postBind("QT-HIGHPREM", { ...validBindBody, escalation_id: "esc_base" }, headers);
      expect(res.status).toBe(201);
      expect(seen.url).toBe("http://localhost:3100/v1/escalations/esc_base");
    } finally {
      if (prev === undefined) delete process.env.AMS_BASE_URL;
      else process.env.AMS_BASE_URL = prev;
    }
  });

  test("premium >$10K with denied escalation returns 422", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    mockEscalation({
      escalation_id: "esc_denied01",
      client_id: "client-001",
      reason: "premium_threshold",
      status: "denied",
      manager_response: { decision: "denied" },
    });

    const res = await postBind("QT-HIGHPREM", {
      ...validBindBody,
      escalation_id: "esc_denied01",
    }, headers);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("ESCALATION_NOT_APPROVED");
  });

  test("approved escalation for a DIFFERENT client cannot unlock the bind (422)", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    mockEscalation({
      escalation_id: "esc_other_client",
      client_id: "CLI-999",
      reason: "premium_threshold",
      status: "approved",
    });
    const res = await postBind("QT-HIGHPREM", { ...validBindBody, escalation_id: "esc_other_client" }, headers);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("ESCALATION_NOT_APPROVED");
    expect(body.message).toContain("CLI-999");
  });

  test("approved escalation with the WRONG reason cannot unlock the bind (422)", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    mockEscalation({
      escalation_id: "esc_wrong_reason",
      client_id: "client-001",
      reason: "principal_review",
      status: "approved",
    });
    const res = await postBind("QT-HIGHPREM", { ...validBindBody, escalation_id: "esc_wrong_reason" }, headers);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("ESCALATION_NOT_APPROVED");
    expect(body.message).toContain("premium_threshold");
  });

  test("escalation lookup failure returns 422 ESCALATION_VERIFICATION_FAILED", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    mockEscalation({ error_code: "NOT_FOUND" }, 404);
    const res = await postBind("QT-HIGHPREM", { ...validBindBody, escalation_id: "esc_missing" }, headers);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("ESCALATION_VERIFICATION_FAILED");
  });
});

// ── E&O: State minimum violation ──

describe("E&O - state minimum violation", () => {
  test("below state min BI without escalation returns 422", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    const res = await postBind("QT-LOWLIMIT", validBindBody, headers);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("E&O_RULES_TRIGGERED");
    expect(body.error_code).toBe("E_EO_STATE_MINIMUM_VIOLATION");
    expect(body.eo_rules.some((r: any) => r.rule === "state_minimum_violation")).toBe(true);
  });

  test("statutory minimums can NEVER be waived by an approved escalation (422)", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    const seen = mockEscalation({
      escalation_id: "esc_waive_attempt",
      client_id: "client-001",
      reason: "state_minimum_violation",
      status: "approved",
    });
    const res = await postBind("QT-LOWLIMIT", { ...validBindBody, escalation_id: "esc_waive_attempt" }, headers);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error_code).toBe("E_EO_STATE_MINIMUM_VIOLATION");
    // Rejected before any escalation lookup happens
    expect(seen.url).toBeUndefined();
    const quote = testSqlite.query(`SELECT status FROM carrier_quotes WHERE quote_id = 'QT-LOWLIMIT'`).get() as { status: string };
    expect(quote.status).toBe("quoted");
  });

  test("POST /request persists client state so bind enforces that state's minimums", async () => {
    const headers = await authHeader(["rater:quotes:create", "rater:quotes:bind"]);
    insertSqliteRow(testSqlite, "carriers", {
      carrier_code: "TXCO",
      carrier_name: "Texas Carrier",
      states: JSON.stringify(["TX"]),
      policy_types: JSON.stringify(["personal_auto"]),
      risk_categories: JSON.stringify(["standard"]),
      appetite_level: "high",
      min_driver_age: 16,
      max_vehicles: 4,
      accepts_sr22: false,
      surplus_lines_only: false,
      sr22_available: false,
      citizens_eligible: false,
      state_restrictions: "[]",
    });
    try {
      const reqRes = await app.request("/v1/quotes/request", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          policy_type: "personal_auto",
          effective_date: "2026-04-01",
          client: {
            first_name: "Tanya",
            last_name: "Marsh",
            address: { street: "1 Main St", city: "Austin", state: "TX", zip: "73301" },
          },
          drivers: [{ first_name: "Tanya", last_name: "Marsh" }],
          vehicles: [{ vin: "1HGBH41JXMN109186", year: 2023, make: "Honda", model: "Civic" }],
          // 25/50/25 satisfies the DEFAULT minimum but violates TX 30/60/25
          requested_coverages: [{ coverage_type: "bodily_injury", limit: "25/50/25" }],
        }),
      });
      expect(reqRes.status).toBe(202);
      const { request_id } = await reqRes.json();

      const stored = testSqlite.query(`SELECT risk_data FROM quote_requests WHERE request_id = ?`).get(request_id) as { risk_data: string };
      const riskData = JSON.parse(stored.risk_data);
      expect(riskData.state).toBe("TX");
      expect(riskData.address.state).toBe("TX");

      const quote = testSqlite.query(`SELECT quote_id FROM carrier_quotes WHERE request_id = ?`).get(request_id) as { quote_id: string };
      testSqlite.query(`UPDATE carrier_quotes SET premium_annual = 1200 WHERE quote_id = ?`).run(quote.quote_id);
      const bindRes = await postBind(quote.quote_id, validBindBody, headers);
      expect(bindRes.status).toBe(422);
      const body = await bindRes.json();
      expect(body.error_code).toBe("E_EO_STATE_MINIMUM_VIOLATION");
      expect(body.message).toContain("TX");
    } finally {
      testSqlite.exec("DELETE FROM carriers");
    }
  });
});

// ── Normal bind unaffected ──

describe("E&O - no regression on normal bind", () => {
  test("normal premium bind succeeds without escalation", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    const res = await postBind("QT-NORMAL", validBindBody, headers);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.bind_status).toBe("bound");
  });
});
