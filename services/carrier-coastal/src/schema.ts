import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

// ── Quotes ──────────────────────────────────────────────────────────

export const quotes = sqliteTable("quotes", {
  quote_id: text("quote_id").primaryKey(),
  request_id: text("request_id").notNull(),
  client_id: text("client_id").notNull(),
  policy_type: text("policy_type").notNull(),
  premium_annual: real("premium_annual"),
  premium_monthly: real("premium_monthly"),
  premium_semi_annual: real("premium_semi_annual"),
  coverages: text("coverages").notNull(), // JSON array
  deductibles: text("deductibles").notNull(), // JSON object
  status: text("status").notNull().default("quoted"),
  decline_reason: text("decline_reason"),
  valid_until: text("valid_until"),
  submitted_at: text("submitted_at").notNull(),
  // Risk assessment fields
  risk_score: integer("risk_score"),
  risk_tier: text("risk_tier"),
  risk_factors: text("risk_factors"), // JSON array
  assessed_at: text("assessed_at"),
  // Binding fields
  bind_status: text("bind_status").notNull().default("unbound"),
  bound_at: text("bound_at"),
  policy_id: text("policy_id"),
  // Quick quote vehicle fields
  vin: text("vin"),
  vehicle_year: integer("vehicle_year"),
  vehicle_make: text("vehicle_make"),
  vehicle_model: text("vehicle_model"),
  driver_name: text("driver_name"),
  driver_dob: text("driver_dob"),
  driver_license: text("driver_license"),
  coverage_config: text("coverage_config"), // JSON: current coverage configuration
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

// ── Digital ID Cards ────────────────────────────────────────────────

export const idCards = sqliteTable("id_cards", {
  card_id: text("card_id").primaryKey(),
  policy_id: text("policy_id")
    .notNull()
    .references(() => policies.policy_id),
  card_data: text("card_data").notNull(), // JSON: display fields
  issued_at: text("issued_at").notNull(),
});
