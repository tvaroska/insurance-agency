import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { generateDevToken } from "@evergreen/shared";

/**
 * Isolated Prisma + Real Hono App Integration Harness (`ADR-006`).
 *
 * - Eliminates Drizzle ORM, `bun:sqlite`, and `mock.module` overrides.
 * - Configures an ephemeral `EVERGREEN_DATA_DIR` before importing the real
 *   microservices (`ams`, `rater`, `crm`, `ecm`, `comm`) so every service
 *   operates against its own isolated `<svc>.db` via Prisma 7 (`@prisma/adapter-libsql`).
 * - Dispatches HTTP requests directly into each service's real `app.fetch`
 *   pipeline under `MODALITY_MODE=strict`, including JSON-RPC 2.0 `POST /mcp`
 *   calls on `comm` (`:3004`).
 */

export const TEST_SECRET = "integration-test-secret";
export const INTEGRATION_DATA_DIR = mkdtempSync(join(tmpdir(), "evergreen-int-"));

process.on("exit", () => {
  try {
    rmSync(INTEGRATION_DATA_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors on process exit
  }
});

delete process.env.DATABASE_URL;
process.env.EVERGREEN_DATA_DIR = INTEGRATION_DATA_DIR;
process.env.JWT_SECRET = TEST_SECRET;
process.env.MODALITY_MODE = "strict";

// If services/*/src/prisma.ts has not yet landed EVERGREEN_DATA_DIR support,
// isolate via DATABASE_URL inside INTEGRATION_DATA_DIR so working-tree DBs are never touched.
const amsPrismaSource = readFileSync(
  join(import.meta.dir, "../../services/ams/src/prisma.ts"),
  "utf-8",
);
if (!amsPrismaSource.includes("EVERGREEN_DATA_DIR")) {
  process.env.DATABASE_URL = `file:${join(INTEGRATION_DATA_DIR, "integration.db")}`;
}

const { prisma: amsPrisma } = await import("../../services/ams/src/prisma");
const amsServer = (await import("../../services/ams/src/index")).default;

const { prisma: raterPrisma } = await import("../../services/rater/src/prisma");
const raterServer = (await import("../../services/rater/src/index")).default;

const { prisma: crmPrisma } = await import("../../services/crm/src/prisma");
const crmServer = (await import("../../services/crm/src/index")).default;

const { prisma: ecmPrisma } = await import("../../services/ecm/src/prisma");
const ecmServer = (await import("../../services/ecm/src/index")).default;

const { prisma: commPrisma } = await import("../../services/comm/src/prisma");
const commServer = (await import("../../services/comm/src/index")).default;

export interface ServiceTestApp {
  request(
    path: string,
    init?: RequestInit & { headers?: Record<string, string> },
  ): Promise<Response>;
}

function wrapServiceApp(
  server: { fetch: (req: Request) => Response | Promise<Response> },
  port: number,
): ServiceTestApp {
  return {
    async request(path: string, init?: RequestInit): Promise<Response> {
      const url =
        path.startsWith("http://") || path.startsWith("https://")
          ? path
          : `http://localhost:${port}${path.startsWith("/") ? path : `/${path}`}`;
      return await server.fetch(new Request(url, init));
    },
  };
}

export const amsApp = wrapServiceApp(amsServer, 3000);
export const raterApp = wrapServiceApp(raterServer, 3001);
export const crmApp = wrapServiceApp(crmServer, 3002);
export const ecmApp = wrapServiceApp(ecmServer, 3003);
export const commApp = wrapServiceApp(commServer, 3004);

export const ams = { prisma: amsPrisma };
export const rater = { prisma: raterPrisma };
export const crm = { prisma: crmPrisma };
export const ecm = { prisma: ecmPrisma };
export const comm = { prisma: commPrisma };

// ── Initialize empty SQLite tables on the isolated Prisma clients ────

async function initIntegrationTables() {
  // AMS tables
  await amsPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS clients (
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
  )`);
  await amsPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS policies (
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
  )`);
  await amsPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS coverages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    policy_id TEXT NOT NULL REFERENCES policies(policy_id),
    type TEXT NOT NULL,
    "limit" TEXT,
    deductible REAL
  )`);
  await amsPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS endorsements (
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
  )`);
  await amsPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS commissions (
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
  )`);
  await amsPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS tasks (
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
  )`);
  await amsPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS escalations (
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
  )`);
  await amsPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS escalation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    escalation_id TEXT NOT NULL REFERENCES escalations(escalation_id),
    event_type TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    details TEXT,
    created_at TEXT NOT NULL
  )`);

  // Rater tables
  await raterPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS quote_requests (
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
  )`);
  await raterPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS carrier_quotes (
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
  )`);
  await raterPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS carriers (
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
  )`);

  // CRM tables (note: client_id nullable to support net-new prospect leads)
  await crmPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS leads (
    lead_id TEXT PRIMARY KEY,
    client_id TEXT,
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
  )`);
  await crmPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS campaigns (
    campaign_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    enrolled_count INTEGER NOT NULL DEFAULT 0,
    conversion_rate REAL NOT NULL DEFAULT 0
  )`);
  await crmPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS campaign_enrollments (
    enrollment_id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id),
    client_id TEXT NOT NULL,
    trigger_reason TEXT,
    metadata TEXT,
    enrolled_at TEXT NOT NULL,
    sequence_step INTEGER NOT NULL DEFAULT 1
  )`);
  await crmPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS retention_risks (
    client_id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    risk_score INTEGER NOT NULL,
    rate_increase_pct REAL,
    months_since_contact INTEGER,
    email_open_rate REAL,
    policies_count INTEGER,
    recommended_action TEXT,
    assigned_producer TEXT
  )`);

  // ECM tables
  await ecmPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS documents (
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
  )`);
  await ecmPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS envelopes (
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
  )`);
  await ecmPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS marketing_assets (
    asset_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    url TEXT NOT NULL,
    version TEXT NOT NULL,
    published_date TEXT NOT NULL
  )`);

  // Comm tables
  await commPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS messages (
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
  )`);
  await commPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS webhooks (
    webhook_id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '[]',
    secret TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`);
  await commPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS webhook_deliveries (
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
  )`);
}

await initIntegrationTables();

// ── Auth & HTTP MCP JSON-RPC helpers ─────────────────────────────────

export async function authHeader(scopes: string[]) {
  const token = await generateDevToken({ secret: TEST_SECRET, scopes });
  return { Authorization: `Bearer ${token}` };
}

let mcpRequestSeq = 1;

export interface McpToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export async function callCommMcpJsonRpc(
  method: string,
  params?: Record<string, unknown>,
  scopes: string[] = [
    "comm:messages:read",
    "comm:messages:write",
    "comm:calls:read",
    "comm:webhooks:write",
  ],
): Promise<any> {
  const headers = await authHeader(scopes);
  const res = await commApp.request("/mcp", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: mcpRequestSeq++,
      method,
      ...(params !== undefined ? { params } : {}),
    }),
  });

  const rawText = await res.text();
  if (res.status !== 200) {
    throw new Error(`Comm /mcp HTTP ${res.status}: ${rawText}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  let envelope: any;
  if (contentType.includes("text/event-stream")) {
    const dataPayloads = rawText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    envelope = JSON.parse(dataPayloads[dataPayloads.length - 1]);
  } else {
    envelope = JSON.parse(rawText);
  }

  if (envelope.error) {
    throw new Error(`Comm /mcp JSON-RPC error: ${JSON.stringify(envelope.error)}`);
  }
  return envelope.result;
}

export async function callCommMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  scopes?: string[],
): Promise<McpToolCallResult> {
  return (await callCommMcpJsonRpc(
    "tools/call",
    { name: toolName, arguments: args },
    scopes,
  )) as McpToolCallResult;
}

// ── Prisma-backed seed helpers ───────────────────────────────────────

const now = new Date().toISOString();

export async function seedAmsClient(overrides: Record<string, any> = {}) {
  const client = {
    id: "CLI-001",
    first_name: "John",
    last_name: "Smith",
    dob: null,
    email: "john.smith@email.com",
    phone: "+1-312-555-0100",
    address_street: null,
    address_city: null,
    address_state: "IL",
    address_zip: null,
    driver_license_number: null,
    occupation: null,
    marital_status: null,
    household_id: null,
    preferred_contact_method: null,
    preferred_contact_time: null,
    status: "active",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  await amsPrisma.client.upsert({
    where: { id: client.id },
    update: client,
    create: client,
  });
  return client;
}

export async function seedAmsPolicy(overrides: Record<string, any> = {}) {
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
  await amsPrisma.policy.upsert({
    where: { policy_id: policy.policy_id },
    update: policy,
    create: policy,
  });
  return policy;
}

export async function seedRaterCarrier(overrides: Record<string, any> = {}) {
  const carrier = {
    carrier_code: "TRAV",
    carrier_name: "Summit Fire & Casualty",
    states: JSON.stringify(["IL", "IN", "OH", "MI", "WI"]),
    policy_types: JSON.stringify(["personal_auto", "homeowners", "bop", "umbrella"]),
    risk_categories: JSON.stringify(["preferred", "standard"]),
    appetite_level: "high",
    min_driver_age: 16,
    max_vehicles: 6,
    accepts_sr22: false,
    surplus_lines_only: false,
    sr22_available: false,
    citizens_eligible: false,
    state_restrictions: "[]",
    ...overrides,
  };
  await raterPrisma.carrier.upsert({
    where: { carrier_code: carrier.carrier_code },
    update: carrier,
    create: carrier,
  });
  return carrier;
}

export async function seedCrmLead(overrides: Record<string, any> = {}) {
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
  await crmPrisma.lead.upsert({
    where: { lead_id: lead.lead_id },
    update: lead as any,
    create: lead as any,
  });
  return lead;
}

export async function seedCrmCampaign(overrides: Record<string, any> = {}) {
  const campaign = {
    campaign_id: `camp_${Math.random().toString(36).slice(2, 10)}`,
    name: "Test Campaign",
    type: "nurture",
    status: "active",
    enrolled_count: 0,
    conversion_rate: 0,
    ...overrides,
  };
  await crmPrisma.campaign.upsert({
    where: { campaign_id: campaign.campaign_id },
    update: campaign,
    create: campaign,
  });
  return campaign;
}

export async function seedCrmRetentionRisk(overrides: Record<string, any> = {}) {
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
  await crmPrisma.retentionRisk.upsert({
    where: { client_id: risk.client_id },
    update: risk,
    create: risk,
  });
  return risk;
}

export async function seedEcmDocument(overrides: Record<string, any> = {}) {
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
  await ecmPrisma.document.upsert({
    where: { document_id: doc.document_id },
    update: doc,
    create: doc,
  });
  return doc;
}

export async function seedEcmAsset(overrides: Record<string, any> = {}) {
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
  await ecmPrisma.marketingAsset.upsert({
    where: { asset_id: asset.asset_id },
    update: asset,
    create: asset,
  });
  return asset;
}

export async function seedCommMessage(overrides: Record<string, any> = {}) {
  const msg = {
    message_id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    client_id: "CLI-001",
    direction: "inbound",
    channel: "email",
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
  await commPrisma.message.upsert({
    where: { message_id: msg.message_id },
    update: msg,
    create: msg,
  });
  return msg;
}
