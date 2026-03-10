import { db, sqlite } from "./db";
import { messages } from "./schema";
import { join } from "path";
import { sql } from "drizzle-orm";

const SEED_DIR = join(import.meta.dir, "..", "..", "..", "data", "seed");

interface SeedMessage {
  message_id: string;
  client_id: string;
  direction: string;
  channel: string;
  subject?: string;
  body?: string;
  from: string;
  to: string;
  timestamp: string;
  read?: boolean;
  call_id?: string;
  duration_seconds?: number;
  transcript?: string;
  sentiment?: string;
  topics?: string[];
}

async function loadJson<T>(filename: string): Promise<T> {
  const path = join(SEED_DIR, filename);
  const file = Bun.file(path);
  return file.json() as Promise<T>;
}

function createTables() {
  sqlite.exec(`
    DROP TABLE IF EXISTS webhook_deliveries;
    DROP TABLE IF EXISTS webhooks;
    DROP TABLE IF EXISTS messages;

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

async function seed() {
  console.log("Creating tables...");
  createTables();

  console.log("Loading seed data...");
  const messagesData = await loadJson<SeedMessage[]>("communications.json");
  console.log(`Loaded: ${messagesData.length} messages`);

  // Clear existing data
  console.log("Clearing existing data...");
  db.delete(messages).run();

  // Insert messages (map from/to → from_addr/to_addr)
  console.log("Seeding messages...");
  for (const m of messagesData) {
    db.insert(messages)
      .values({
        message_id: m.message_id,
        client_id: m.client_id,
        direction: m.direction,
        channel: m.channel,
        subject: m.subject ?? null,
        body: m.body ?? null,
        from_addr: m.from ?? (m.channel === "phone" ? "caller" : ""),
        to_addr: m.to ?? (m.channel === "phone" ? "800-555-EVER" : ""),
        timestamp: m.timestamp,
        read: m.read ?? false,
        call_id: m.call_id ?? null,
        duration_seconds: m.duration_seconds ?? null,
        transcript: m.transcript ?? null,
        sentiment: m.sentiment ?? null,
        topics: JSON.stringify(m.topics ?? []),
        status: "delivered",
        template_id: null,
        attachments: "[]",
      })
      .run();
  }

  // Verify counts
  const count = db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .get()!.count;

  console.log("\nSeed complete:");
  console.log(`  messages: ${count} rows`);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
