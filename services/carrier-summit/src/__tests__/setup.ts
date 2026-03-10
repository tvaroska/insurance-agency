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
import { submissionsRouter } from "../routes/submissions";
import { inspectionsRouter } from "../routes/inspections";

export const TEST_SECRET = "test-secret-for-carrier-summit-tests";
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
      underwriting_status TEXT NOT NULL DEFAULT 'pending_review',
      underwriting_notes TEXT,
      property_address TEXT,
      property_details TEXT,
      photo_checklist TEXT,
      inspection_status TEXT DEFAULT 'not_scheduled',
      inspection_scheduled_at TEXT,
      inspection_completed_at TEXT,
      inspection_notes TEXT
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

    CREATE TABLE IF NOT EXISTS policy_documents (
      document_id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL REFERENCES policies(policy_id),
      document_type TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      supersedes TEXT
    );

    CREATE TABLE IF NOT EXISTS underwriting_conditions (
      condition_id TEXT PRIMARY KEY,
      quote_id TEXT NOT NULL,
      condition_type TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
  `);
}

// ── App factory ──

export function createTestApp(routers: {
  quotes?: Hono<{ Variables: AppVariables }>;
  underwriting?: Hono<{ Variables: AppVariables }>;
  policies?: Hono<{ Variables: AppVariables }>;
}) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", correlationId);
  app.onError(errorHandler);

  const api = new Hono<{ Variables: AppVariables }>();
  api.use("*", jwtAuth);
  if (routers.quotes) api.route("/quotes", routers.quotes);
  if (routers.underwriting) api.route("/underwriting", routers.underwriting);
  if (routers.policies) api.route("/policies", routers.policies);
  api.route("/submissions", submissionsRouter);
  api.route("/inspections", inspectionsRouter);

  app.route("/v1/summit", api);
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
    quote_id: `QT-${Math.random().toString(36).slice(2, 8)}-SMIT`,
    request_id: "QR-001",
    client_id: "CLI-001",
    policy_type: "personal_auto",
    premium_annual: 1085.0,
    premium_monthly: 94.5,
    coverages: JSON.stringify([
      { type: "bodily_injury", limit: "100000/300000" },
      { type: "property_damage", limit: "50000" },
    ]),
    deductibles: JSON.stringify({ collision: 500, comprehensive: 250 }),
    status: "quoted",
    decline_reason: null,
    valid_until: "2026-03-08",
    submitted_at: now,
    underwriting_status: "pending_review",
    underwriting_notes: null,
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

export function makeDocument(overrides: Partial<typeof schema.policyDocuments.$inferInsert> = {}) {
  return {
    document_id: `TDOC-${Math.random().toString(36).slice(2, 8)}`,
    policy_id: "POL-001",
    document_type: "dec_page",
    filename: "pol_001_declarations.pdf",
    file_size_bytes: 180000,
    created_at: now,
    ...overrides,
  };
}
