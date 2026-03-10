import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ── Leads ────────────────────────────────────────────────────────────

export const leads = sqliteTable("leads", {
  lead_id: text("lead_id").primaryKey(),
  client_id: text("client_id").notNull(),
  first_name: text("first_name").notNull(),
  last_name: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  source: text("source").notNull(), // referral, web, cold_call, partner, event
  status: text("status").notNull().default("new"), // new, contacted, qualified, proposal_sent, closed_won, closed_lost
  score: integer("score").notNull().default(0), // 0-100
  assigned_producer: text("assigned_producer"),
  tags: text("tags").notNull().default("[]"), // JSON array
  notes: text("notes"),
  last_activity_date: text("last_activity_date"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

// ── Campaigns ────────────────────────────────────────────────────────

export const campaigns = sqliteTable("campaigns", {
  campaign_id: text("campaign_id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // nurture, retention, cross_sell, welcome
  status: text("status").notNull().default("active"), // active, paused, completed
  enrolled_count: integer("enrolled_count").notNull().default(0),
  conversion_rate: real("conversion_rate").notNull().default(0),
});

// ── Campaign Enrollments ─────────────────────────────────────────────

export const campaignEnrollments = sqliteTable("campaign_enrollments", {
  enrollment_id: text("enrollment_id").primaryKey(),
  campaign_id: text("campaign_id")
    .notNull()
    .references(() => campaigns.campaign_id),
  client_id: text("client_id").notNull(),
  trigger_reason: text("trigger_reason"),
  metadata: text("metadata"), // JSON
  enrolled_at: text("enrolled_at").notNull(),
  sequence_step: integer("sequence_step").notNull().default(1),
});

// ── Retention Risks ──────────────────────────────────────────────────

export const retentionRisks = sqliteTable("retention_risks", {
  client_id: text("client_id").primaryKey(),
  client_name: text("client_name").notNull(),
  risk_score: integer("risk_score").notNull(), // 0-100
  rate_increase_pct: real("rate_increase_pct"),
  months_since_contact: integer("months_since_contact"),
  email_open_rate: real("email_open_rate"),
  policies_count: integer("policies_count"),
  recommended_action: text("recommended_action"),
  assigned_producer: text("assigned_producer"),
});
