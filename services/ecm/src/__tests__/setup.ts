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

export const TEST_SECRET = "test-secret-for-ecm-tests";
process.env.JWT_SECRET = TEST_SECRET;

// ── Database helpers ──

export function createTables(sqlite: Database) {
  sqlite.exec(`
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

// ── App factory ──

export function createTestApp(routers: {
  documents?: Hono<{ Variables: AppVariables }>;
  envelopes?: Hono<{ Variables: AppVariables }>;
  assets?: Hono<{ Variables: AppVariables }>;
  acord?: Hono<{ Variables: AppVariables }>;
  coi?: Hono<{ Variables: AppVariables }>;
}) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", correlationId);
  app.onError(errorHandler);

  const api = new Hono<{ Variables: AppVariables }>();
  api.use("*", jwtAuth);
  if (routers.acord) api.route("/documents/acord", routers.acord);
  if (routers.coi) api.route("/documents/coi", routers.coi);
  if (routers.documents) api.route("/documents", routers.documents);
  if (routers.envelopes) api.route("/envelopes", routers.envelopes);
  if (routers.assets) api.route("/assets", routers.assets);

  app.route("/v1", api);
  return app;
}

// ── Auth helpers ──

export async function authHeader(scopes: string[]) {
  return _authHeader(TEST_SECRET, scopes);
}

// ── Entity factories ──

const now = new Date().toISOString();

export function makeDocument(
  overrides: Partial<typeof schema.documents.$inferInsert> = {},
) {
  return {
    document_id: `doc_${Math.random().toString(36).slice(2, 10)}`,
    client_id: "CLI-001",
    document_type: "signed_application",
    filename: "test_document.pdf",
    mime_type: "application/pdf",
    file_size_bytes: 12345,
    status: "uploaded",
    upload_date: now,
    signer_name: null,
    signer_email: null,
    signed_date: null,
    expiration_date: null,
    tags: JSON.stringify([]),
    ...overrides,
  };
}

export function makeEnvelope(
  overrides: Partial<typeof schema.envelopes.$inferInsert> = {},
) {
  return {
    envelope_id: `env_${Math.random().toString(36).slice(2, 10)}`,
    client_id: "CLI-001",
    document_ids: JSON.stringify(["doc_001"]),
    signers: JSON.stringify([
      {
        name: "Test Signer",
        email: "signer@example.com",
        role: "policyholder",
        status: "pending",
        signed_at: null,
      },
    ]),
    status: "created",
    message: null,
    redirect_url: null,
    created_at: now,
    completed_at: null,
    expiration_date: new Date(Date.now() + 30 * 86400000).toISOString(),
    ...overrides,
  };
}

export function makeAsset(
  overrides: Partial<typeof schema.marketingAssets.$inferInsert> = {},
) {
  return {
    asset_id: `asset_${Math.random().toString(36).slice(2, 10)}`,
    name: "Test Asset",
    description: "A test marketing asset",
    category: "flyer",
    mime_type: "application/pdf",
    url: "https://cdn.evergreen-insurance.com/assets/test.pdf",
    version: "1.0",
    published_date: now,
    ...overrides,
  };
}
