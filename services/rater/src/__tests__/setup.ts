import { Hono } from "hono";
import { Database } from "bun:sqlite";
import {
  correlationId,
  jwtAuth,
  errorHandler,
  createTestDatabase as _createTestDb,
  authHeader as _authHeader,
  type AppVariables,
} from "@evergreen/shared";
import * as schema from "../schema";

export const TEST_SECRET = "test-secret-for-rater-tests";
process.env.JWT_SECRET = TEST_SECRET;

// ── Database helpers ──

export function createTables(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS quote_requests (
      request_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      policy_type TEXT NOT NULL,
      effective_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      submitted_at TEXT NOT NULL,
      completed_at TEXT,
      expires_at TEXT,
      risk_data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS carrier_quotes (
      quote_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES quote_requests(request_id),
      carrier_code TEXT NOT NULL,
      carrier_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      premium_annual REAL,
      premium_monthly REAL,
      coverages TEXT NOT NULL DEFAULT '[]',
      deductibles TEXT NOT NULL DEFAULT '{}',
      decline_reason TEXT,
      valid_until TEXT,
      bound_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS carriers (
      carrier_code TEXT PRIMARY KEY,
      carrier_name TEXT NOT NULL,
      states TEXT NOT NULL,
      policy_types TEXT NOT NULL,
      risk_categories TEXT NOT NULL,
      appetite_level TEXT NOT NULL,
      min_driver_age INTEGER,
      max_vehicles INTEGER,
      accepts_sr22 INTEGER DEFAULT 0,
      surplus_lines_only INTEGER DEFAULT 0,
      sr22_available INTEGER DEFAULT 0,
      citizens_eligible INTEGER DEFAULT 0,
      state_restrictions TEXT NOT NULL DEFAULT '[]'
    );
  `);
}

// ── App factory ──

export function createTestApp(routers: {
  quotes?: Hono<{ Variables: AppVariables }>;
  carriers?: Hono<{ Variables: AppVariables }>;
}) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", correlationId);
  app.onError(errorHandler);

  const api = new Hono<{ Variables: AppVariables }>();
  api.use("*", jwtAuth);
  if (routers.quotes) api.route("/quotes", routers.quotes);
  if (routers.carriers) api.route("/carriers", routers.carriers);

  app.route("/v1", api);
  return app;
}

// ── Auth helpers ──

export async function authHeader(scopes: string[]) {
  return _authHeader(TEST_SECRET, scopes);
}

// ── Entity factories ──

const now = new Date().toISOString();

export function makeQuoteRequest(
  overrides: Partial<typeof schema.quoteRequests.$inferInsert> = {},
) {
  return {
    request_id: `QR-${Math.random().toString(36).slice(2, 8)}`,
    client_id: "client-001",
    policy_type: "personal_auto",
    effective_date: "2026-04-01",
    status: "completed",
    submitted_at: now,
    completed_at: now,
    expires_at: null,
    risk_data: JSON.stringify({
      drivers: [{ first_name: "John", last_name: "Doe" }],
      vehicles: [{ vin: "1HGBH41JXMN109186", year: 2023, make: "Honda", model: "Civic" }],
      requested_coverages: [{ coverage_type: "bodily_injury", per_person_limit: 100000 }],
    }),
    created_at: now,
    ...overrides,
  };
}

export function makeCarrierQuote(
  overrides: Partial<typeof schema.carrierQuotes.$inferInsert> = {},
) {
  return {
    quote_id: `QT-${Math.random().toString(36).slice(2, 8)}`,
    request_id: "QR-001",
    carrier_code: "CSTL",
    carrier_name: "Coastal Star",
    status: "quoted",
    premium_annual: 1842.0,
    premium_monthly: 153.5,
    coverages: JSON.stringify([
      { coverage_type: "bodily_injury", per_person_limit: 100000 },
    ]),
    deductibles: JSON.stringify({ collision: 500 }),
    decline_reason: null,
    valid_until: "2026-05-01T00:00:00.000Z",
    bound_at: null,
    created_at: now,
    ...overrides,
  };
}

export function makeCarrier(
  overrides: Partial<typeof schema.carriers.$inferInsert> = {},
) {
  return {
    carrier_code: "CSTL",
    carrier_name: "Coastal Star",
    states: JSON.stringify(["IL", "IN", "OH", "MI"]),
    policy_types: JSON.stringify(["personal_auto", "homeowners"]),
    risk_categories: JSON.stringify(["preferred", "standard", "non_standard"]),
    appetite_level: "high",
    min_driver_age: 16,
    max_vehicles: 8,
    accepts_sr22: true,
    surplus_lines_only: false,
    sr22_available: true,
    citizens_eligible: false,
    state_restrictions: JSON.stringify([]),
    ...overrides,
  };
}
