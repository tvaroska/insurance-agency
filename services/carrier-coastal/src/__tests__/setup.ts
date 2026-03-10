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
import { quickQuoteRouter } from "../routes/quickquote";
import { customizeRouter } from "../routes/customize";
import { idCardsRouter } from "../routes/idcards";

export const TEST_SECRET = "test-secret-for-carrier-coastal-tests";
process.env.JWT_SECRET = TEST_SECRET;

// ── Database helpers ──

export function createTestDatabase() {
  return _createTestDb(schema);
}

export function createTables(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS quotes (
      quote_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      policy_type TEXT NOT NULL,
      premium_annual REAL,
      premium_monthly REAL,
      coverages TEXT NOT NULL,
      deductibles TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'quoted',
      decline_reason TEXT,
      valid_until TEXT,
      submitted_at TEXT NOT NULL,
      risk_score INTEGER,
      risk_tier TEXT,
      risk_factors TEXT,
      assessed_at TEXT,
      bind_status TEXT NOT NULL DEFAULT 'unbound',
      bound_at TEXT,
      policy_id TEXT,
      premium_semi_annual REAL,
      vin TEXT,
      vehicle_year INTEGER,
      vehicle_make TEXT,
      vehicle_model TEXT,
      driver_name TEXT,
      driver_dob TEXT,
      driver_license TEXT,
      coverage_config TEXT
    );

    CREATE TABLE IF NOT EXISTS policies (
      policy_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      policy_type TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      expiration_date TEXT NOT NULL,
      premium_current REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      coverages TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS id_cards (
      card_id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL REFERENCES policies(policy_id),
      card_data TEXT NOT NULL,
      issued_at TEXT NOT NULL
    );
  `);
}

// ── App factory ──

export function createTestApp(routers: {
  quotes?: Hono<{ Variables: AppVariables }>;
  binding?: Hono<{ Variables: AppVariables }>;
}) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", correlationId);
  app.onError(errorHandler);

  const api = new Hono<{ Variables: AppVariables }>();
  api.use("*", jwtAuth);
  if (routers.quotes) api.route("/quotes", routers.quotes);
  if (routers.binding) api.route("/quotes", routers.binding);
  api.route("/quotes", quickQuoteRouter);
  api.route("/quotes", customizeRouter);
  api.route("/policies", idCardsRouter);

  app.route("/v1/coastal", api);
  return app;
}

// ── Auth helpers ──

export async function authHeader(scopes: string[]) {
  return _authHeader(TEST_SECRET, scopes);
}

// ── Entity factories ──

const now = new Date().toISOString();

export function makeQuote(overrides: Partial<typeof schema.quotes.$inferInsert> = {}) {
  return {
    quote_id: `QT-${Math.random().toString(36).slice(2, 8)}-CSTL`,
    request_id: "QR-001",
    client_id: "CLI-001",
    policy_type: "personal_auto",
    premium_annual: 1020.0,
    premium_monthly: 88.5,
    coverages: JSON.stringify([
      { type: "bodily_injury", limit: "100000/300000" },
      { type: "property_damage", limit: "50000" },
    ]),
    deductibles: JSON.stringify({ collision: 500, comprehensive: 250 }),
    status: "quoted",
    decline_reason: null,
    valid_until: "2026-03-08",
    submitted_at: now,
    risk_score: null,
    risk_tier: null,
    risk_factors: null,
    assessed_at: null,
    bind_status: "unbound",
    bound_at: null,
    policy_id: null,
    ...overrides,
  };
}

export function makePolicy(overrides: Partial<typeof schema.policies.$inferInsert> = {}) {
  return {
    policy_id: `POL-${Math.random().toString(36).slice(2, 8)}`,
    client_id: "CLI-001",
    policy_type: "personal_auto",
    effective_date: "2025-06-01",
    expiration_date: "2026-06-01",
    premium_current: 1450.0,
    status: "active",
    coverages: JSON.stringify([
      { type: "bodily_injury", limit: "100000/300000" },
      { type: "collision", deductible: 500 },
    ]),
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}
