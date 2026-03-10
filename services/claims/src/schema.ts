import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

// ── Claims ──────────────────────────────────────────────────────────

export const claims = sqliteTable("claims", {
  claim_id: text("claim_id").primaryKey(),
  policy_id: text("policy_id").notNull(),
  client_id: text("client_id").notNull(),
  claim_type: text("claim_type").notNull(), // auto_collision, auto_comprehensive, property_damage, theft, liability, medical, fire, water, weather
  status: text("status").notNull().default("reported"), // reported, assigned, investigating, reserved, settled, denied
  loss_date: text("loss_date").notNull(), // YYYY-MM-DD
  reported_date: text("reported_date").notNull(), // YYYY-MM-DD
  loss_description: text("loss_description").notNull(),
  loss_location: text("loss_location"),
  reserve_amount: real("reserve_amount"),
  settlement_amount: real("settlement_amount"),
  adjuster_id: text("adjuster_id").references(() => adjusters.adjuster_id),
  notes: text("notes"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

// ── Adjusters ───────────────────────────────────────────────────────

export const adjusters = sqliteTable("adjusters", {
  adjuster_id: text("adjuster_id").primaryKey(),
  first_name: text("first_name").notNull(),
  last_name: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  specialty: text("specialty").notNull(), // auto, property, liability, general
  active: integer("active").notNull().default(1),
  max_open_claims: integer("max_open_claims").notNull().default(25),
  created_at: text("created_at").notNull(),
});

// ── Claim Documents ─────────────────────────────────────────────────

export const claimDocuments = sqliteTable("claim_documents", {
  document_id: text("document_id").primaryKey(),
  claim_id: text("claim_id")
    .notNull()
    .references(() => claims.claim_id),
  document_type: text("document_type").notNull(), // police_report, medical_records, photos, estimate, correspondence, other
  file_name: text("file_name").notNull(),
  file_path: text("file_path").notNull(),
  uploaded_by: text("uploaded_by"),
  uploaded_at: text("uploaded_at").notNull(),
});

// ── Claim Timeline ──────────────────────────────────────────────────

export const claimTimeline = sqliteTable("claim_timeline", {
  event_id: text("event_id").primaryKey(),
  claim_id: text("claim_id")
    .notNull()
    .references(() => claims.claim_id),
  event_type: text("event_type").notNull(), // status_change, assignment, note, document_upload, reserve_change, payment
  description: text("description").notNull(),
  old_value: text("old_value"),
  new_value: text("new_value"),
  created_by: text("created_by"),
  created_at: text("created_at").notNull(),
});
