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

export const TEST_SECRET = "test-secret-for-crm-tests";
process.env.JWT_SECRET = TEST_SECRET;

// ── Database helpers ──

export function createTables(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      lead_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      score INTEGER NOT NULL DEFAULT 0,
      assigned_producer TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      last_activity_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      campaign_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      enrolled_count INTEGER NOT NULL DEFAULT 0,
      conversion_rate REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS campaign_enrollments (
      enrollment_id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id),
      client_id TEXT NOT NULL,
      trigger_reason TEXT,
      metadata TEXT,
      enrolled_at TEXT NOT NULL,
      sequence_step INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS retention_risks (
      client_id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      risk_score INTEGER NOT NULL,
      rate_increase_pct REAL,
      months_since_contact INTEGER,
      email_open_rate REAL,
      policies_count INTEGER,
      recommended_action TEXT,
      assigned_producer TEXT
    );
  `);
}

// ── App factory ──

export function createTestApp(routers: {
  leads?: Hono<{ Variables: AppVariables }>;
  campaigns?: Hono<{ Variables: AppVariables }>;
  analytics?: Hono<{ Variables: AppVariables }>;
}) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", correlationId);
  app.onError(errorHandler);

  const api = new Hono<{ Variables: AppVariables }>();
  api.use("*", jwtAuth);
  if (routers.leads) api.route("/leads", routers.leads);
  if (routers.campaigns) api.route("/campaigns", routers.campaigns);
  if (routers.analytics) api.route("/analytics", routers.analytics);

  app.route("/v1", api);
  return app;
}

// ── Auth helpers ──

export async function authHeader(scopes: string[]) {
  return _authHeader(TEST_SECRET, scopes);
}

// ── Entity factories ──

const now = new Date().toISOString();

export function makeLead(
  overrides: Partial<typeof schema.leads.$inferInsert> = {},
) {
  return {
    lead_id: `lead_${Math.random().toString(36).slice(2, 10)}`,
    client_id: "CLI-001",
    first_name: "Test",
    last_name: "Lead",
    email: "test@example.com",
    phone: "+1-312-555-0100",
    source: "web",
    status: "new",
    score: 50,
    assigned_producer: "prod_44e1bc90",
    tags: JSON.stringify(["test"]),
    notes: null,
    last_activity_date: "2026-02-18",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export function makeCampaign(
  overrides: Partial<typeof schema.campaigns.$inferInsert> = {},
) {
  return {
    campaign_id: `camp_${Math.random().toString(36).slice(2, 10)}`,
    name: "Test Campaign",
    type: "nurture",
    status: "active",
    enrolled_count: 0,
    conversion_rate: 0,
    ...overrides,
  };
}

export function makeEnrollment(
  overrides: Partial<typeof schema.campaignEnrollments.$inferInsert> = {},
) {
  return {
    enrollment_id: `enr_${Math.random().toString(36).slice(2, 10)}`,
    campaign_id: "camp_test",
    client_id: "CLI-001",
    trigger_reason: "Test enrollment",
    metadata: null,
    enrolled_at: now,
    sequence_step: 1,
    ...overrides,
  };
}

export function makeRetentionRisk(
  overrides: Partial<typeof schema.retentionRisks.$inferInsert> = {},
) {
  return {
    client_id: `CLI-${Math.random().toString(36).slice(2, 5)}`,
    client_name: "Test Client",
    risk_score: 70,
    rate_increase_pct: 10.5,
    months_since_contact: 6,
    email_open_rate: 0.1,
    policies_count: 2,
    recommended_action: "Send retention email.",
    assigned_producer: "prod_44e1bc90",
    ...overrides,
  };
}
