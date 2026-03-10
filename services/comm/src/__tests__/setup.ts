import { Database } from "bun:sqlite";
import { createTestDatabase } from "@evergreen/shared";
import * as schema from "../schema";

export function createTestDb() {
  const { sqlite, db } = createTestDatabase(schema);
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
  return { sqlite, db };
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
