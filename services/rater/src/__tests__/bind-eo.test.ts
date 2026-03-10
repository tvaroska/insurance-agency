import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";

const testSqlite = new Database(":memory:");
testSqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(testSqlite, { schema });

mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

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
  testDb.insert(schema.quoteRequests).values(
    makeQuoteRequest({ request_id: "QR-EO-01", status: "completed" }),
  ).run();
  testDb.insert(schema.carrierQuotes).values(
    makeCarrierQuote({
      quote_id: "QT-NORMAL",
      request_id: "QR-EO-01",
      premium_annual: 2500,
      premium_monthly: 208.33,
      status: "quoted",
    }),
  ).run();

  // High premium quote (over $10K)
  testDb.insert(schema.quoteRequests).values(
    makeQuoteRequest({ request_id: "QR-EO-02", status: "completed" }),
  ).run();
  testDb.insert(schema.carrierQuotes).values(
    makeCarrierQuote({
      quote_id: "QT-HIGHPREM",
      request_id: "QR-EO-02",
      premium_annual: 15000,
      premium_monthly: 1250,
      status: "quoted",
    }),
  ).run();

  // Below state minimum auto quote
  testDb.insert(schema.quoteRequests).values(
    makeQuoteRequest({
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
    }),
  ).run();
  testDb.insert(schema.carrierQuotes).values(
    makeCarrierQuote({
      quote_id: "QT-LOWLIMIT",
      request_id: "QR-EO-03",
      premium_annual: 800,
      premium_monthly: 66.67,
      status: "quoted",
    }),
  ).run();
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

describe("E&O - premium threshold", () => {
  test("premium >$10K without escalation_id returns 409", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    const res = await postBind("QT-HIGHPREM", validBindBody, headers);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("E&O_RULES_TRIGGERED");
    expect(body.eo_rules).toBeArray();
    expect(body.eo_rules.length).toBeGreaterThanOrEqual(1);
    expect(body.eo_rules[0].rule).toBe("premium_threshold");
  });

  test("premium >$10K with approved escalation returns 201", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);

    // Mock fetch to return approved escalation from AMS
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/v1/escalations/")) {
        return new Response(JSON.stringify({
          escalation_id: "esc_approved1",
          status: "approved",
          manager_response: { decision: "approved" },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      // For non-escalation fetch calls, fall through to the app
      return app.fetch(new Request(url, init));
    });

    const res = await postBind("QT-HIGHPREM", {
      ...validBindBody,
      escalation_id: "esc_approved1",
    }, headers);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.bind_status).toBe("bound");
  });

  test("premium >$10K with denied escalation returns 409", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);

    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/v1/escalations/")) {
        return new Response(JSON.stringify({
          escalation_id: "esc_denied01",
          status: "denied",
          manager_response: { decision: "denied" },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return app.fetch(new Request(url, init));
    });

    const res = await postBind("QT-HIGHPREM", {
      ...validBindBody,
      escalation_id: "esc_denied01",
    }, headers);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("ESCALATION_NOT_APPROVED");
  });
});

// ── E&O: State minimum violation ──

describe("E&O - state minimum violation", () => {
  test("below state min BI without escalation returns 409", async () => {
    const headers = await authHeader(["rater:quotes:bind"]);
    const res = await postBind("QT-LOWLIMIT", validBindBody, headers);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("E&O_RULES_TRIGGERED");
    expect(body.eo_rules.some((r: any) => r.rule === "state_minimum_violation")).toBe(true);
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
