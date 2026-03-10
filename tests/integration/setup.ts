import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mock } from "bun:test";
import {
  correlationId,
  jwtAuth,
  errorHandler,
  generateDevToken,
  type CorrelationVariables,
  type AuthVariables,
} from "@evergreen/shared";

type AppVariables = CorrelationVariables & AuthVariables;

// ── K8s mode detection ──

export const K8S_MODE = !!process.env.K8S_BASE_URL;

export const TEST_SECRET = "integration-test-secret";
if (!K8S_MODE) {
  process.env.JWT_SECRET = TEST_SECRET;
}

// ── K8s HTTP client (lazy import to avoid side effects in local mode) ──

let createHttpClient: (servicePath: string) => { request: (path: string, init?: RequestInit) => Promise<Response> };
let fetchOAuthToken: (scopes: string[]) => Promise<string>;

if (K8S_MODE) {
  const httpClient = await import("./http-client");
  createHttpClient = httpClient.createHttpClient;
  fetchOAuthToken = httpClient.fetchOAuthToken;
}

// ── Database helpers (local mode only) ──

import * as amsSchema from "../../services/ams/src/schema";
import * as raterSchema from "../../services/rater/src/schema";
import * as crmSchema from "../../services/crm/src/schema";
import * as ecmSchema from "../../services/ecm/src/schema";
import * as commSchema from "../../services/comm/src/schema";

function createDb<T extends Record<string, unknown>>(schema: T) {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

// ── Create all 5 databases (local mode only, but schemas imported regardless) ──

export const ams = K8S_MODE ? ({ db: null, sqlite: null } as any) : createDb(amsSchema);
export const rater = K8S_MODE ? ({ db: null, sqlite: null } as any) : createDb(raterSchema);
export const crm = K8S_MODE ? ({ db: null, sqlite: null } as any) : createDb(crmSchema);
export const ecm = K8S_MODE ? ({ db: null, sqlite: null } as any) : createDb(ecmSchema);
export const comm = K8S_MODE ? ({ db: null, sqlite: null } as any) : createDb(commSchema);

// ── Create tables (local mode only) ──

function createAmsTables() {
  ams.sqlite.exec(`
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
      assigned_to TEXT,
      related_client_id TEXT,
      related_policy_id TEXT,
      due_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function createRaterTables() {
  rater.sqlite.exec(`
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

function createCrmTables() {
  crm.sqlite.exec(`
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

function createEcmTables() {
  ecm.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      document_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      document_type TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'uploaded',
      upload_date TEXT NOT NULL,
      signer_name TEXT,
      signer_email TEXT,
      signed_date TEXT,
      expiration_date TEXT,
      tags TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS envelopes (
      envelope_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      document_ids TEXT NOT NULL DEFAULT '[]',
      signers TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'created',
      message TEXT,
      redirect_url TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      expiration_date TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS marketing_assets (
      asset_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      url TEXT NOT NULL,
      version TEXT NOT NULL,
      published_date TEXT NOT NULL
    );
  `);
}

function createCommTables() {
  comm.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      channel TEXT NOT NULL,
      subject TEXT,
      body TEXT,
      from_addr TEXT NOT NULL,
      to_addr TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      call_id TEXT,
      duration_seconds INTEGER,
      transcript TEXT,
      sentiment TEXT,
      topics TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'delivered',
      template_id TEXT,
      attachments TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS webhooks (
      webhook_id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '[]',
      secret TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      delivery_id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      next_retry_at TEXT,
      response_status INTEGER,
      created_at TEXT NOT NULL
    );
  `);
}

// Initialize tables and mocks (local mode only)
if (!K8S_MODE) {
  createAmsTables();
  createRaterTables();
  createCrmTables();
  createEcmTables();
  createCommTables();

  // ── Mock all service DB modules ──
  mock.module("../../services/ams/src/db", () => ({
    db: ams.db,
    sqlite: ams.sqlite,
  }));
  mock.module("../../services/rater/src/db", () => ({
    db: rater.db,
    sqlite: rater.sqlite,
  }));
  mock.module("../../services/crm/src/db", () => ({
    db: crm.db,
    sqlite: crm.sqlite,
  }));
  mock.module("../../services/ecm/src/db", () => ({
    db: ecm.db,
    sqlite: ecm.sqlite,
  }));
  mock.module("../../services/comm/src/db", () => ({
    db: comm.db,
    sqlite: comm.sqlite,
  }));
}

// ── Build Hono apps (local mode) or HTTP clients (K8s mode) ──

import { clientsRouter } from "../../services/ams/src/routes/clients";
import { policiesRouter } from "../../services/ams/src/routes/policies";
import { accountingRouter } from "../../services/ams/src/routes/accounting";
import { tasksRouter } from "../../services/ams/src/routes/tasks";

import { quotesRouter } from "../../services/rater/src/routes/quotes";
import { carriersRouter } from "../../services/rater/src/routes/carriers";

import { leadsRouter } from "../../services/crm/src/routes/leads";
import { campaignsRouter } from "../../services/crm/src/routes/campaigns";
import { analyticsRouter } from "../../services/crm/src/routes/analytics";

import { documentsRouter } from "../../services/ecm/src/routes/documents";
import { envelopesRouter } from "../../services/ecm/src/routes/envelopes";
import { assetsRouter } from "../../services/ecm/src/routes/assets";

function buildApp(routes: Record<string, Hono<{ Variables: AppVariables }>>) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", correlationId);
  app.onError(errorHandler);

  const api = new Hono<{ Variables: AppVariables }>();
  api.use("*", jwtAuth);
  for (const [path, router] of Object.entries(routes)) {
    api.route(`/${path}`, router);
  }
  app.route("/v1", api);
  return app;
}

export const amsApp = K8S_MODE
  ? createHttpClient!("ams")
  : buildApp({
      clients: clientsRouter,
      policies: policiesRouter,
      accounting: accountingRouter,
      tasks: tasksRouter,
    });

export const raterApp = K8S_MODE
  ? createHttpClient!("rater")
  : buildApp({
      quotes: quotesRouter,
      carriers: carriersRouter,
    });

export const crmApp = K8S_MODE
  ? createHttpClient!("crm")
  : buildApp({
      leads: leadsRouter,
      campaigns: campaignsRouter,
      analytics: analyticsRouter,
    });

export const ecmApp = K8S_MODE
  ? createHttpClient!("ecm")
  : buildApp({
      documents: documentsRouter,
      envelopes: envelopesRouter,
      assets: assetsRouter,
    });

// ── Comm tool handlers (MCP tools — called directly, not via HTTP) ──

export { handleGetTranscript } from "../../services/comm/src/tools/get_transcript";
export { handleSendMessage } from "../../services/comm/src/tools/send_message";
export { handleGetInbox } from "../../services/comm/src/tools/get_inbox";

// ── Auth helper ──

export async function authHeader(scopes: string[]) {
  if (K8S_MODE) {
    const token = await fetchOAuthToken!(scopes);
    return { Authorization: `Bearer ${token}` };
  }
  const token = await generateDevToken({ secret: TEST_SECRET, scopes });
  return { Authorization: `Bearer ${token}` };
}

// ── Seed helpers (no-ops in K8s mode — data seeded by init containers) ──

const now = new Date().toISOString();

export function seedAmsClient(overrides: Partial<typeof amsSchema.clients.$inferInsert> = {}) {
  if (K8S_MODE) return { id: "CLI-001", ...overrides };
  const client = {
    id: "CLI-001",
    first_name: "John",
    last_name: "Smith",
    email: "john.smith@email.com",
    phone: "+1-312-555-0100",
    address_state: "IL",
    status: "active",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  ams.db.insert(amsSchema.clients).values(client).run();
  return client;
}

export function seedAmsPolicy(overrides: Partial<typeof amsSchema.policies.$inferInsert> = {}) {
  if (K8S_MODE) return { policy_id: "POL-test", ...overrides };
  const policy = {
    policy_id: `POL-${Math.random().toString(36).slice(2, 8)}`,
    client_id: "CLI-001",
    carrier_code: "TRAV",
    policy_type: "personal_auto",
    effective_date: "2025-01-01",
    expiration_date: "2026-01-01",
    premium_current: 1200.0,
    premium_prior: 1100.0,
    status: "active",
    multi_policy_discount: false,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  ams.db.insert(amsSchema.policies).values(policy).run();
  return policy;
}

export function seedRaterCarrier(overrides: Partial<typeof raterSchema.carriers.$inferInsert> = {}) {
  if (K8S_MODE) return { carrier_code: "TRAV", ...overrides };
  const carrier = {
    carrier_code: "TRAV",
    carrier_name: "Travelers",
    states: JSON.stringify(["IL", "IN", "OH", "MI", "WI"]),
    policy_types: JSON.stringify(["personal_auto", "homeowners", "bop", "umbrella"]),
    risk_categories: JSON.stringify(["preferred", "standard"]),
    appetite_level: "high",
    min_driver_age: 16,
    max_vehicles: 6,
    accepts_sr22: false,
    ...overrides,
  };
  rater.db.insert(raterSchema.carriers).values(carrier).run();
  return carrier;
}

export function seedCrmLead(overrides: Partial<typeof crmSchema.leads.$inferInsert> = {}) {
  if (K8S_MODE) return { lead_id: "lead_test", ...overrides };
  const lead = {
    lead_id: `lead_${Math.random().toString(36).slice(2, 10)}`,
    client_id: "CLI-001",
    first_name: "John",
    last_name: "Smith",
    email: "john.smith@email.com",
    phone: "+1-312-555-0100",
    source: "web",
    status: "new",
    score: 50,
    assigned_producer: "prod_44e1bc90",
    tags: JSON.stringify([]),
    notes: null,
    last_activity_date: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  crm.db.insert(crmSchema.leads).values(lead).run();
  return lead;
}

export function seedCrmCampaign(overrides: Partial<typeof crmSchema.campaigns.$inferInsert> = {}) {
  if (K8S_MODE) return { campaign_id: "camp_test", ...overrides };
  const campaign = {
    campaign_id: `camp_${Math.random().toString(36).slice(2, 10)}`,
    name: "Test Campaign",
    type: "nurture",
    status: "active",
    enrolled_count: 0,
    conversion_rate: 0,
    ...overrides,
  };
  crm.db.insert(crmSchema.campaigns).values(campaign).run();
  return campaign;
}

export function seedCrmRetentionRisk(overrides: Partial<typeof crmSchema.retentionRisks.$inferInsert> = {}) {
  if (K8S_MODE) return { client_id: "CLI-001", ...overrides };
  const risk = {
    client_id: "CLI-001",
    client_name: "John Smith",
    risk_score: 85,
    rate_increase_pct: 18.5,
    months_since_contact: 4,
    email_open_rate: 0.12,
    policies_count: 2,
    recommended_action: "Re-shop and send comparison.",
    assigned_producer: "prod_44e1bc90",
    ...overrides,
  };
  crm.db.insert(crmSchema.retentionRisks).values(risk).run();
  return risk;
}

export function seedEcmDocument(overrides: Partial<typeof ecmSchema.documents.$inferInsert> = {}) {
  if (K8S_MODE) return { document_id: "doc_test", ...overrides };
  const doc = {
    document_id: `doc_${Math.random().toString(36).slice(2, 10)}`,
    client_id: "CLI-001",
    document_type: "signed_application",
    filename: "application.pdf",
    mime_type: "application/pdf",
    file_size_bytes: 24500,
    status: "uploaded",
    upload_date: now,
    signer_name: null,
    signer_email: null,
    signed_date: null,
    expiration_date: null,
    tags: JSON.stringify([]),
    ...overrides,
  };
  ecm.db.insert(ecmSchema.documents).values(doc).run();
  return doc;
}

export function seedEcmAsset(overrides: Partial<typeof ecmSchema.marketingAssets.$inferInsert> = {}) {
  if (K8S_MODE) return { asset_id: "asset_test", ...overrides };
  const asset = {
    asset_id: `asset_${Math.random().toString(36).slice(2, 10)}`,
    name: "Test Asset",
    description: "A marketing asset",
    category: "flyer",
    mime_type: "application/pdf",
    url: "https://cdn.evergreen-insurance.com/assets/test.pdf",
    version: "1.0",
    published_date: now,
    ...overrides,
  };
  ecm.db.insert(ecmSchema.marketingAssets).values(asset).run();
  return asset;
}

export function seedCommMessage(overrides: Partial<typeof commSchema.messages.$inferInsert> = {}) {
  if (K8S_MODE) return { message_id: "msg_test", ...overrides };
  const msg = {
    message_id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    client_id: "CLI-001",
    direction: "inbound" as const,
    channel: "email" as const,
    subject: "Test",
    body: "Test body",
    from_addr: "test@example.com",
    to_addr: "service@evergreen-ins.com",
    timestamp: now,
    read: false,
    call_id: null,
    duration_seconds: null,
    transcript: null,
    sentiment: null,
    topics: "[]",
    status: "delivered",
    template_id: null,
    attachments: "[]",
    ...overrides,
  };
  comm.db.insert(commSchema.messages).values(msg).run();
  return msg;
}
