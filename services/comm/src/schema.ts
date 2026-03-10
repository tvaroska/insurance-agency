import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ── Messages ────────────────────────────────────────────────────────

export const messages = sqliteTable("messages", {
  message_id: text("message_id").primaryKey(),
  client_id: text("client_id").notNull(),
  direction: text("direction").notNull(), // inbound | outbound
  channel: text("channel").notNull(), // email | sms | phone | whatsapp
  subject: text("subject"),
  body: text("body"),
  from_addr: text("from_addr").notNull(),
  to_addr: text("to_addr").notNull(),
  timestamp: text("timestamp").notNull(),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
  // Phone-specific fields
  call_id: text("call_id"),
  duration_seconds: integer("duration_seconds"),
  transcript: text("transcript"),
  sentiment: text("sentiment"), // positive | neutral | negative
  topics: text("topics").notNull().default("[]"), // JSON array
  // Outbound tracking
  status: text("status").notNull().default("delivered"),
  template_id: text("template_id"),
  attachments: text("attachments").notNull().default("[]"), // JSON array
});

// ── Webhooks ────────────────────────────────────────────────────────

export const webhooks = sqliteTable("webhooks", {
  webhook_id: text("webhook_id").primaryKey(),
  url: text("url").notNull(),
  events: text("events").notNull().default("[]"), // JSON array of event types
  secret: text("secret").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  created_at: text("created_at").notNull(),
});

// ── Webhook Deliveries ──────────────────────────────────────────────

export const webhookDeliveries = sqliteTable("webhook_deliveries", {
  delivery_id: text("delivery_id").primaryKey(),
  webhook_id: text("webhook_id").notNull(),
  event_id: text("event_id").notNull(),
  event_type: text("event_type").notNull(),
  payload: text("payload").notNull(), // JSON string
  status: text("status").notNull().default("pending"), // pending | delivered | failed
  attempts: integer("attempts").notNull().default(0),
  last_attempt_at: text("last_attempt_at"),
  next_retry_at: text("next_retry_at"),
  response_status: integer("response_status"),
  created_at: text("created_at").notNull(),
});
