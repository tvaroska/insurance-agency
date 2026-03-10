import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

// ── Quote Requests ───────────────────────────────────────────────────

export const quoteRequests = sqliteTable("quote_requests", {
  request_id: text("request_id").primaryKey(),
  client_id: text("client_id").notNull(),
  policy_type: text("policy_type").notNull(),
  effective_date: text("effective_date"),
  status: text("status").notNull().default("pending"),
  submitted_at: text("submitted_at").notNull(),
  completed_at: text("completed_at"),
  expires_at: text("expires_at"),
  risk_data: text("risk_data").notNull(), // JSON: drivers, vehicles, property, business, coverages
  created_at: text("created_at").notNull(),
});

// ── Carrier Quotes ───────────────────────────────────────────────────

export const carrierQuotes = sqliteTable("carrier_quotes", {
  quote_id: text("quote_id").primaryKey(),
  request_id: text("request_id")
    .notNull()
    .references(() => quoteRequests.request_id),
  carrier_code: text("carrier_code").notNull(),
  carrier_name: text("carrier_name").notNull(),
  status: text("status").notNull().default("pending"),
  premium_annual: real("premium_annual"),
  premium_monthly: real("premium_monthly"),
  coverages: text("coverages").notNull().default("[]"), // JSON array
  deductibles: text("deductibles").notNull().default("{}"), // JSON object
  decline_reason: text("decline_reason"),
  valid_until: text("valid_until"),
  bound_at: text("bound_at"),
  created_at: text("created_at").notNull(),
});

// ── Carriers (Appetite) ──────────────────────────────────────────────

export const carriers = sqliteTable("carriers", {
  carrier_code: text("carrier_code").primaryKey(),
  carrier_name: text("carrier_name").notNull(),
  states: text("states").notNull(), // JSON array of state codes
  policy_types: text("policy_types").notNull(), // JSON array
  risk_categories: text("risk_categories").notNull(), // JSON array
  appetite_level: text("appetite_level").notNull(),
  min_driver_age: integer("min_driver_age"),
  max_vehicles: integer("max_vehicles"),
  accepts_sr22: integer("accepts_sr22", { mode: "boolean" }).default(false),
  surplus_lines_only: integer("surplus_lines_only", { mode: "boolean" }).default(false),
  sr22_available: integer("sr22_available", { mode: "boolean" }).default(false),
  citizens_eligible: integer("citizens_eligible", { mode: "boolean" }).default(false),
  state_restrictions: text("state_restrictions").notNull().default("[]"), // JSON array of restricted state codes
});
