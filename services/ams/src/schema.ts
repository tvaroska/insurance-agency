import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

// ── Clients ──────────────────────────────────────────────────────────

export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  first_name: text("first_name").notNull(),
  last_name: text("last_name").notNull(),
  dob: text("dob"),
  email: text("email").notNull(),
  phone: text("phone"),
  address_street: text("address_street"),
  address_city: text("address_city"),
  address_state: text("address_state"),
  address_zip: text("address_zip"),
  driver_license_number: text("driver_license_number"),
  occupation: text("occupation"),
  marital_status: text("marital_status"),
  household_id: text("household_id"),
  preferred_contact_method: text("preferred_contact_method"),
  preferred_contact_time: text("preferred_contact_time"),
  status: text("status").notNull().default("active"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

// ── Policies ─────────────────────────────────────────────────────────

export const policies = sqliteTable("policies", {
  policy_id: text("policy_id").primaryKey(),
  client_id: text("client_id")
    .notNull()
    .references(() => clients.id),
  carrier_code: text("carrier_code").notNull(),
  policy_type: text("policy_type").notNull(),
  effective_date: text("effective_date").notNull(),
  expiration_date: text("expiration_date").notNull(),
  premium_current: real("premium_current").notNull(),
  premium_prior: real("premium_prior"),
  status: text("status").notNull().default("active"),
  multi_policy_discount: integer("multi_policy_discount", { mode: "boolean" }).default(false),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

// ── Coverages ────────────────────────────────────────────────────────

export const coverages = sqliteTable("coverages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  policy_id: text("policy_id")
    .notNull()
    .references(() => policies.policy_id),
  type: text("type").notNull(),
  limit: text("limit"),
  deductible: real("deductible"),
});

// ── Endorsements ─────────────────────────────────────────────────────

export const endorsements = sqliteTable("endorsements", {
  endorsement_id: text("endorsement_id").primaryKey(),
  policy_id: text("policy_id")
    .notNull()
    .references(() => policies.policy_id),
  effective_date: text("effective_date").notNull(),
  change_type: text("change_type").notNull(),
  changes: text("changes").notNull(), // JSON string
  premium_delta: real("premium_delta"),
  status: text("status").notNull().default("pending_review"),
  notes: text("notes"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

// ── Commissions ──────────────────────────────────────────────────────

export const commissions = sqliteTable("commissions", {
  commission_id: text("commission_id").primaryKey(),
  policy_id: text("policy_id")
    .notNull()
    .references(() => policies.policy_id),
  carrier_code: text("carrier_code").notNull(),
  transaction_type: text("transaction_type").notNull(),
  gross_amount: real("gross_amount").notNull(),
  net_amount: real("net_amount").notNull(),
  commission_rate: real("commission_rate").notNull(),
  effective_date: text("effective_date").notNull(),
  payment_date: text("payment_date"),
  status: text("status").notNull().default("pending"),
  producer_id: text("producer_id"),
  created_at: text("created_at").notNull(),
});

// ── Escalations ─────────────────────────────────────────────────────

export const escalations = sqliteTable("escalations", {
  escalation_id: text("escalation_id").primaryKey(),
  client_id: text("client_id").notNull(),
  policy_id: text("policy_id"),
  reason: text("reason").notNull(),
  summary: text("summary").notNull(),
  context: text("context"), // JSON string
  status: text("status").notNull().default("pending"),
  manager_response: text("manager_response"), // JSON string
  poll_count: integer("poll_count").notNull().default(0),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const escalationEvents = sqliteTable("escalation_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  escalation_id: text("escalation_id")
    .notNull()
    .references(() => escalations.escalation_id),
  event_type: text("event_type").notNull(),
  from_status: text("from_status"),
  to_status: text("to_status"),
  details: text("details"), // JSON string
  created_at: text("created_at").notNull(),
});

// ── Tasks ────────────────────────────────────────────────────────────

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("medium"),
  task_type: text("task_type"),
  assigned_to: text("assigned_to"),
  related_client_id: text("related_client_id"),
  related_policy_id: text("related_policy_id"),
  due_date: text("due_date"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});
