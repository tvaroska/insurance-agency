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

export const TEST_SECRET = "test-secret-for-ams-tests";
process.env.JWT_SECRET = TEST_SECRET;

// ── Database helpers ──

export function createTestDatabase() {
  return _createTestDb(schema);
}

export function createTables(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      dob TEXT,
      email TEXT NOT NULL,
      phone TEXT,
      address_street TEXT,
      address_city TEXT,
      address_state TEXT,
      address_zip TEXT,
      driver_license_number TEXT,
      occupation TEXT,
      marital_status TEXT,
      household_id TEXT,
      preferred_contact_method TEXT,
      preferred_contact_time TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS policies (
      policy_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id),
      carrier_code TEXT NOT NULL,
      policy_type TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      expiration_date TEXT NOT NULL,
      premium_current REAL NOT NULL,
      premium_prior REAL,
      status TEXT NOT NULL DEFAULT 'active',
      multi_policy_discount INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS coverages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      policy_id TEXT NOT NULL REFERENCES policies(policy_id),
      type TEXT NOT NULL,
      "limit" TEXT,
      deductible REAL
    );

    CREATE TABLE IF NOT EXISTS endorsements (
      endorsement_id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL REFERENCES policies(policy_id),
      effective_date TEXT NOT NULL,
      change_type TEXT NOT NULL,
      changes TEXT NOT NULL,
      premium_delta REAL,
      status TEXT NOT NULL DEFAULT 'pending_review',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commissions (
      commission_id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL REFERENCES policies(policy_id),
      carrier_code TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      gross_amount REAL NOT NULL,
      net_amount REAL NOT NULL,
      commission_rate REAL NOT NULL,
      effective_date TEXT NOT NULL,
      payment_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      producer_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'medium',
      task_type TEXT,
      assigned_to TEXT,
      related_client_id TEXT,
      related_policy_id TEXT,
      due_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS escalations (
      escalation_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      policy_id TEXT,
      reason TEXT NOT NULL,
      summary TEXT NOT NULL,
      context TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      manager_response TEXT,
      poll_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS escalation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      escalation_id TEXT NOT NULL REFERENCES escalations(escalation_id),
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      details TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

// ── App factory ──

export function createTestApp(routers: {
  clients?: Hono<{ Variables: AppVariables }>;
  policies?: Hono<{ Variables: AppVariables }>;
  accounting?: Hono<{ Variables: AppVariables }>;
  tasks?: Hono<{ Variables: AppVariables }>;
  escalations?: Hono<{ Variables: AppVariables }>;
}) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", correlationId);
  app.onError(errorHandler);

  const api = new Hono<{ Variables: AppVariables }>();
  api.use("*", jwtAuth);
  if (routers.clients) api.route("/clients", routers.clients);
  if (routers.policies) api.route("/policies", routers.policies);
  if (routers.accounting) api.route("/accounting", routers.accounting);
  if (routers.tasks) api.route("/tasks", routers.tasks);
  if (routers.escalations) api.route("/escalations", routers.escalations);

  app.route("/v1", api);
  return app;
}

// ── Auth helpers ──

export async function authHeader(scopes: string[]) {
  return _authHeader(TEST_SECRET, scopes);
}

// ── Entity factories ──

const now = new Date().toISOString();

export function makeClient(overrides: Partial<typeof schema.clients.$inferInsert> = {}) {
  return {
    id: `CL-${Math.random().toString(36).slice(2, 8)}`,
    first_name: "John",
    last_name: "Doe",
    email: "john@example.com",
    status: "active",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export function makePolicy(overrides: Partial<typeof schema.policies.$inferInsert> = {}) {
  return {
    policy_id: `POL-${Math.random().toString(36).slice(2, 8)}`,
    client_id: "CL-001",
    carrier_code: "SMIT",
    policy_type: "personal_auto",
    effective_date: "2025-01-01",
    expiration_date: "2026-01-01",
    premium_current: 1200.0,
    premium_prior: null,
    status: "active",
    multi_policy_discount: false,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export function makeCoverage(overrides: Partial<typeof schema.coverages.$inferInsert> = {}) {
  return {
    policy_id: "POL-001",
    type: "liability",
    limit: "100000/300000",
    deductible: 500,
    ...overrides,
  };
}

export function makeCommission(overrides: Partial<typeof schema.commissions.$inferInsert> = {}) {
  return {
    commission_id: `COM-${Math.random().toString(36).slice(2, 8)}`,
    policy_id: "POL-001",
    carrier_code: "SMIT",
    transaction_type: "new_business",
    gross_amount: 1200.0,
    net_amount: 960.0,
    commission_rate: 0.15,
    effective_date: "2025-01-15",
    payment_date: null,
    status: "earned",
    producer_id: null,
    created_at: now,
    ...overrides,
  };
}

export function makeTask(overrides: Partial<typeof schema.tasks.$inferInsert> = {}) {
  return {
    id: `TASK-${Math.random().toString(36).slice(2, 8)}`,
    title: "Follow up with client",
    description: "Call client about renewal",
    status: "open",
    priority: "medium",
    task_type: null,
    assigned_to: "agent-1",
    related_client_id: null,
    related_policy_id: null,
    due_date: "2025-06-01",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export function makeEscalation(overrides: Partial<typeof schema.escalations.$inferInsert> = {}) {
  return {
    escalation_id: `esc_${Math.random().toString(36).slice(2, 10)}`,
    client_id: "CL-001",
    policy_id: null,
    reason: "premium_threshold" as string,
    summary: "Premium exceeds $10,000 threshold",
    context: null,
    status: "pending",
    manager_response: null,
    poll_count: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export function makeEscalationEvent(overrides: Partial<typeof schema.escalationEvents.$inferInsert> = {}) {
  return {
    escalation_id: "esc_test0001",
    event_type: "created",
    from_status: null,
    to_status: "pending",
    details: null,
    created_at: now,
    ...overrides,
  };
}
