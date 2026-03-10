import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

// ── Quotes ──────────────────────────────────────────────────────────

export const quotes = sqliteTable("quotes", {
  quote_id: text("quote_id").primaryKey(),
  request_id: text("request_id").notNull(),
  client_id: text("client_id").notNull(),
  policy_type: text("policy_type").notNull(),
  premium_annual: real("premium_annual"),
  premium_monthly: real("premium_monthly"),
  coverages: text("coverages").notNull(), // JSON array
  deductibles: text("deductibles").notNull(), // JSON object
  status: text("status").notNull().default("quoted"),
  decline_reason: text("decline_reason"),
  valid_until: text("valid_until"),
  submitted_at: text("submitted_at").notNull(),
  underwriting_status: text("underwriting_status").notNull().default("pending_review"),
  underwriting_notes: text("underwriting_notes"),
  // Property submission fields
  property_address: text("property_address"), // JSON: {street, city, state, zip}
  property_details: text("property_details"), // JSON: {year_built, sqft, construction_type, roof_type, ...}
  photo_checklist: text("photo_checklist"), // JSON array: [{type, uploaded}]
  inspection_status: text("inspection_status").default("not_scheduled"),
  inspection_scheduled_at: text("inspection_scheduled_at"),
  inspection_completed_at: text("inspection_completed_at"),
  inspection_notes: text("inspection_notes"),
});

// ── Policies ────────────────────────────────────────────────────────

export const policies = sqliteTable("policies", {
  policy_id: text("policy_id").primaryKey(),
  client_id: text("client_id").notNull(),
  policy_type: text("policy_type").notNull(),
  effective_date: text("effective_date").notNull(),
  expiration_date: text("expiration_date").notNull(),
  premium_current: real("premium_current").notNull(),
  status: text("status").notNull().default("active"),
  coverages: text("coverages").notNull(), // JSON array
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

// ── Policy Documents ────────────────────────────────────────────────

export const policyDocuments = sqliteTable("policy_documents", {
  document_id: text("document_id").primaryKey(),
  policy_id: text("policy_id")
    .notNull()
    .references(() => policies.policy_id),
  document_type: text("document_type").notNull(),
  filename: text("filename").notNull(),
  file_size_bytes: integer("file_size_bytes").notNull(),
  version: integer("version").notNull().default(1),
  supersedes: text("supersedes"),
  created_at: text("created_at").notNull(),
});

// ── Underwriting Conditions ─────────────────────────────────────────

export const underwritingConditions = sqliteTable("underwriting_conditions", {
  condition_id: text("condition_id").primaryKey(),
  quote_id: text("quote_id")
    .notNull()
    .references(() => quotes.quote_id),
  condition_type: text("condition_type").notNull(), // document_required | inspection_required | info_required
  description: text("description").notNull(),
  status: text("status").notNull().default("pending"), // pending | satisfied | waived
  created_at: text("created_at").notNull(),
  resolved_at: text("resolved_at"),
});
