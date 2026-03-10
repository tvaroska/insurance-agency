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

export const TEST_SECRET = "test-secret-for-claims-tests";
process.env.JWT_SECRET = TEST_SECRET;

// ── Database helpers ──

export function createTables(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS adjusters (
      adjuster_id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      specialty TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      max_open_claims INTEGER NOT NULL DEFAULT 25,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS claims (
      claim_id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      claim_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'reported',
      loss_date TEXT NOT NULL,
      reported_date TEXT NOT NULL,
      loss_description TEXT NOT NULL,
      loss_location TEXT,
      reserve_amount REAL,
      settlement_amount REAL,
      adjuster_id TEXT REFERENCES adjusters(adjuster_id),
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS claim_documents (
      document_id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(claim_id),
      document_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      uploaded_by TEXT,
      uploaded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS claim_timeline (
      event_id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(claim_id),
      event_type TEXT NOT NULL,
      description TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

// ── App factory ──

export function createTestApp(routers: {
  claims?: Hono<{ Variables: AppVariables }>;
  adjusters?: Hono<{ Variables: AppVariables }>;
}) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", correlationId);
  app.onError(errorHandler);

  const api = new Hono<{ Variables: AppVariables }>();
  api.use("*", jwtAuth);
  if (routers.claims) api.route("/claims", routers.claims);
  if (routers.adjusters) api.route("/adjusters", routers.adjusters);

  app.route("/v1", api);
  return app;
}

// ── Auth helpers ──

export async function authHeader(scopes: string[]) {
  return _authHeader(TEST_SECRET, scopes);
}

// ── Entity factories ──

const now = new Date().toISOString();

export function makeClaim(
  overrides: Partial<typeof schema.claims.$inferInsert> = {},
) {
  return {
    claim_id: `CLM-${Math.random().toString(36).slice(2, 10)}`,
    policy_id: "POL-PA-2025-001847",
    client_id: "CLI-001",
    claim_type: "auto_collision",
    status: "reported",
    loss_date: "2026-01-15",
    reported_date: "2026-01-15",
    loss_description: "Test claim description",
    loss_location: "123 Test St, Chicago, IL",
    reserve_amount: null,
    settlement_amount: null,
    adjuster_id: null,
    notes: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export function makeAdjuster(
  overrides: Partial<typeof schema.adjusters.$inferInsert> = {},
) {
  return {
    adjuster_id: `ADJ-${Math.random().toString(36).slice(2, 5)}`,
    first_name: "Test",
    last_name: "Adjuster",
    email: "test@evergreen-claims.com",
    phone: "+1-312-555-0400",
    specialty: "general",
    active: 1,
    max_open_claims: 25,
    created_at: now,
    ...overrides,
  };
}

export function makeClaimDocument(
  overrides: Partial<typeof schema.claimDocuments.$inferInsert> = {},
) {
  return {
    document_id: `DOC-${Math.random().toString(36).slice(2, 10)}`,
    claim_id: "CLM-TEST",
    document_type: "photos",
    file_name: "damage-photo.jpg",
    file_path: "/uploads/claims/CLM-TEST/damage-photo.jpg",
    uploaded_by: null,
    uploaded_at: now,
    ...overrides,
  };
}

export function makeTimelineEvent(
  overrides: Partial<typeof schema.claimTimeline.$inferInsert> = {},
) {
  return {
    event_id: `EVT-${Math.random().toString(36).slice(2, 10)}`,
    claim_id: "CLM-TEST",
    event_type: "status_change",
    description: "Status changed from reported to assigned",
    old_value: "reported",
    new_value: "assigned",
    created_by: null,
    created_at: now,
    ...overrides,
  };
}
