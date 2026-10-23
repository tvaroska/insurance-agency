import { Database } from "bun:sqlite";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { createTestPrismaClient, getTestDatabaseUrl } from "@evergreen/shared";
import { mkdtempSync } from "fs";
import { join } from "path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";

export { getTestDatabaseUrl };

export function createTables(sqlite: Database) {
  sqlite.exec(`
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

export function createTestPrisma() {
  const ctx = createTestPrismaClient(PrismaClient, "test-comm-");
  createTables(ctx.sqlite);
  return ctx;
}

export function createTestDb() {
  const tmpDir = mkdtempSync("/tmp/test-comm-");
  const dbPath = join(tmpDir, "test.db");
  const sqlite = new Database(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const db = drizzle(sqlite, { schema });
  createTables(sqlite);
  const adapter = new PrismaLibSql({ url: getTestDatabaseUrl(dbPath) });
  const prisma = new PrismaClient({ adapter });
  return { sqlite, db, prisma };
}

// ── Entity factories ──

const now = new Date().toISOString();

export function makeMessage(
  overrides: Partial<typeof schema.messages.$inferInsert> = {},
) {
  return {
    message_id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    client_id: "CLI-001",
    direction: "inbound" as const,
    channel: "email" as const,
    subject: "Test subject",
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
}

export function makePhoneMessage(
  overrides: Partial<typeof schema.messages.$inferInsert> = {},
) {
  return makeMessage({
    channel: "phone",
    call_id: `CALL-${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
    duration_seconds: 300,
    transcript:
      "Agent: Thank you for calling. This is Amy speaking.\nCaller: Hi Amy, I have a question.",
    sentiment: "positive",
    topics: JSON.stringify(["general_inquiry"]),
    subject: null,
    body: null,
    from_addr: "caller",
    to_addr: "800-555-EVER",
    ...overrides,
  });
}

export function makeWebhook(
  overrides: Partial<typeof schema.webhooks.$inferInsert> = {},
) {
  return {
    webhook_id: `whk_${Math.random().toString(36).slice(2, 10)}`,
    url: "https://example.com/webhook",
    events: JSON.stringify(["message.delivered"]),
    secret: "whsec_testsecret123",
    active: true,
    created_at: now,
    ...overrides,
  };
}
