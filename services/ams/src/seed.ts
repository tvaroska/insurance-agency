import { db, sqlite } from "./db";
import { clients, policies, coverages, endorsements, commissions, tasks, escalations, escalationEvents } from "./schema";
import { join } from "path";
import { sql } from "drizzle-orm";

const SEED_MODE = process.env.SEED_MODE === "clean" ? "seed-clean" : "seed";
const SEED_DIR = join(import.meta.dir, "..", "..", "..", "data", SEED_MODE);

interface SeedClient {
  id: string;
  first_name: string;
  last_name: string;
  dob?: string;
  email: string;
  phone?: string;
  address?: { street: string; city: string; state: string; zip: string };
  driver_license_number?: string;
  occupation?: string;
  marital_status?: string;
  household_id?: string;
  preferred_contact_method?: string;
  preferred_contact_time?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface SeedCoverage {
  type: string;
  limit: string | number | null;
  deductible: number | null;
}

interface SeedPolicy {
  policy_id: string;
  client_id: string;
  carrier_code: string;
  policy_type: string;
  effective_date: string;
  expiration_date: string;
  premium_current: number;
  premium_prior?: number | null;
  status: string;
  coverages: SeedCoverage[];
  multi_policy_discount?: boolean;
  created_at: string;
  updated_at: string;
}

interface SeedEndorsement {
  endorsement_id: string;
  policy_id: string;
  effective_date: string;
  change_type: string;
  changes: Record<string, unknown>;
  premium_delta?: number | null;
  status: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

interface SeedCommission {
  commission_id: string;
  policy_id: string;
  carrier_code: string;
  transaction_type: string;
  gross_amount: number;
  net_amount: number;
  commission_rate: number;
  effective_date: string;
  payment_date?: string | null;
  status: string;
  producer_id?: string | null;
  created_at: string;
}

interface SeedTask {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  assigned_to?: string | null;
  related_client_id?: string | null;
  related_policy_id?: string | null;
  due_date?: string | null;
  created_at: string;
  updated_at: string;
}

async function loadJson<T>(filename: string): Promise<T> {
  const path = join(SEED_DIR, filename);
  const file = Bun.file(path);
  return file.json() as Promise<T>;
}

function createTables() {
  sqlite.exec(`
    DROP TABLE IF EXISTS escalations;
    DROP TABLE IF EXISTS tasks;
    DROP TABLE IF EXISTS commissions;
    DROP TABLE IF EXISTS endorsements;
    DROP TABLE IF EXISTS coverages;
    DROP TABLE IF EXISTS policies;
    DROP TABLE IF EXISTS clients;

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      dob TEXT,
      email TEXT NOT NULL,
      phone TEXT,
      address_street TEXT,
      address_city TEXT,
      address_state TEXT,
      address_zip TEXT,
      driver_license_number TEXT,
      occupation TEXT,
      marital_status TEXT,
      household_id TEXT,
      preferred_contact_method TEXT,
      preferred_contact_time TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS policies (
      policy_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id),
      carrier_code TEXT NOT NULL,
      policy_type TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      expiration_date TEXT NOT NULL,
      premium_current REAL NOT NULL,
      premium_prior REAL,
      status TEXT NOT NULL DEFAULT 'active',
      multi_policy_discount INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS coverages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      policy_id TEXT NOT NULL REFERENCES policies(policy_id),
      type TEXT NOT NULL,
      "limit" TEXT,
      deductible REAL
    );

    CREATE TABLE IF NOT EXISTS endorsements (
      endorsement_id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL REFERENCES policies(policy_id),
      effective_date TEXT NOT NULL,
      change_type TEXT NOT NULL,
      changes TEXT NOT NULL,
      premium_delta REAL,
      status TEXT NOT NULL DEFAULT 'pending_review',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commissions (
      commission_id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL REFERENCES policies(policy_id),
      carrier_code TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      gross_amount REAL NOT NULL,
      net_amount REAL NOT NULL,
      commission_rate REAL NOT NULL,
      effective_date TEXT NOT NULL,
      payment_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      producer_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'medium',
      task_type TEXT,
      assigned_to TEXT,
      related_client_id TEXT,
      related_policy_id TEXT,
      due_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS escalations (
      escalation_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      policy_id TEXT,
      reason TEXT NOT NULL,
      summary TEXT NOT NULL,
      context TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      manager_response TEXT,
      poll_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS escalation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      escalation_id TEXT NOT NULL REFERENCES escalations(escalation_id),
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      details TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

async function seed() {
  console.log(`Seed mode: ${SEED_MODE} (SEED_MODE=${process.env.SEED_MODE ?? "unset"})`);
  console.log("Creating tables...");
  createTables();

  console.log("Loading seed data...");
  const [
    clientsData,
    policiesData,
    endorsementsData,
    commissionsData,
    tasksData,
  ] = await Promise.all([
    loadJson<SeedClient[]>("clients.json"),
    loadJson<SeedPolicy[]>("policies.json"),
    loadJson<SeedEndorsement[]>("endorsements.json"),
    loadJson<SeedCommission[]>("commissions.json"),
    loadJson<SeedTask[]>("tasks.json"),
  ]);

  console.log(
    `Loaded: ${clientsData.length} clients, ${policiesData.length} policies, ` +
    `${endorsementsData.length} endorsements, ${commissionsData.length} commissions, ` +
    `${tasksData.length} tasks`
  );

  // Clear existing data (reverse FK order)
  console.log("Clearing existing data...");
  db.delete(escalationEvents).run();
  db.delete(escalations).run();
  db.delete(tasks).run();
  db.delete(commissions).run();
  db.delete(endorsements).run();
  db.delete(coverages).run();
  db.delete(policies).run();
  db.delete(clients).run();

  // Insert clients
  console.log("Seeding clients...");
  for (const c of clientsData) {
    db.insert(clients).values({
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      dob: c.dob ?? null,
      email: c.email,
      phone: c.phone ?? null,
      address_street: c.address?.street ?? null,
      address_city: c.address?.city ?? null,
      address_state: c.address?.state ?? null,
      address_zip: c.address?.zip ?? null,
      driver_license_number: c.driver_license_number ?? null,
      occupation: c.occupation ?? null,
      marital_status: c.marital_status ?? null,
      household_id: c.household_id ?? null,
      preferred_contact_method: c.preferred_contact_method ?? null,
      preferred_contact_time: c.preferred_contact_time ?? null,
      status: c.status,
      created_at: c.created_at,
      updated_at: c.updated_at,
    }).run();
  }

  // Insert policies + coverages
  console.log("Seeding policies and coverages...");
  for (const p of policiesData) {
    db.insert(policies).values({
      policy_id: p.policy_id,
      client_id: p.client_id,
      carrier_code: p.carrier_code,
      policy_type: p.policy_type,
      effective_date: p.effective_date,
      expiration_date: p.expiration_date,
      premium_current: p.premium_current,
      premium_prior: p.premium_prior ?? null,
      status: p.status,
      multi_policy_discount: p.multi_policy_discount ?? false,
      created_at: p.created_at,
      updated_at: p.updated_at,
    }).run();

    for (const cov of p.coverages) {
      db.insert(coverages).values({
        policy_id: p.policy_id,
        type: cov.type,
        limit: cov.limit != null ? String(cov.limit) : null,
        deductible: cov.deductible ?? null,
      }).run();
    }
  }

  // Insert endorsements
  console.log("Seeding endorsements...");
  for (const e of endorsementsData) {
    db.insert(endorsements).values({
      endorsement_id: e.endorsement_id,
      policy_id: e.policy_id,
      effective_date: e.effective_date,
      change_type: e.change_type,
      changes: JSON.stringify(e.changes),
      premium_delta: e.premium_delta ?? null,
      status: e.status,
      notes: e.notes ?? null,
      created_at: e.created_at,
      updated_at: e.updated_at,
    }).run();
  }

  // Insert commissions
  console.log("Seeding commissions...");
  for (const com of commissionsData) {
    db.insert(commissions).values({
      commission_id: com.commission_id,
      policy_id: com.policy_id,
      carrier_code: com.carrier_code,
      transaction_type: com.transaction_type,
      gross_amount: com.gross_amount,
      net_amount: com.net_amount,
      commission_rate: com.commission_rate,
      effective_date: com.effective_date,
      payment_date: com.payment_date ?? null,
      status: com.status,
      producer_id: com.producer_id ?? null,
      created_at: com.created_at,
    }).run();
  }

  // Insert tasks
  console.log("Seeding tasks...");
  for (const t of tasksData) {
    db.insert(tasks).values({
      id: t.id,
      title: t.title,
      description: t.description ?? null,
      status: t.status,
      priority: t.priority,
      assigned_to: t.assigned_to ?? null,
      related_client_id: t.related_client_id ?? null,
      related_policy_id: t.related_policy_id ?? null,
      due_date: t.due_date ?? null,
      created_at: t.created_at,
      updated_at: t.updated_at,
    }).run();
  }

  // Verify counts
  const counts = {
    clients: db.select({ count: sql<number>`count(*)` }).from(clients).get()!.count,
    policies: db.select({ count: sql<number>`count(*)` }).from(policies).get()!.count,
    coverages: db.select({ count: sql<number>`count(*)` }).from(coverages).get()!.count,
    endorsements: db.select({ count: sql<number>`count(*)` }).from(endorsements).get()!.count,
    commissions: db.select({ count: sql<number>`count(*)` }).from(commissions).get()!.count,
    tasks: db.select({ count: sql<number>`count(*)` }).from(tasks).get()!.count,
  };

  console.log("\nSeed complete:");
  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table}: ${count} rows`);
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
