import { db, sqlite } from "./db";
import { claims, adjusters, claimDocuments, claimTimeline } from "./schema";
import { join } from "path";
import { sql } from "drizzle-orm";

const SEED_MODE = process.env.SEED_MODE === "clean" ? "seed-clean" : "seed";
const SEED_DIR = join(import.meta.dir, "..", "..", "..", "data", SEED_MODE);

interface SeedAdjuster {
  adjuster_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  specialty: string;
  active: number;
  max_open_claims: number;
  created_at: string;
}

interface SeedClaim {
  claim_id: string;
  policy_id: string;
  client_id: string;
  claim_type: string;
  status: string;
  loss_date: string;
  reported_date: string;
  loss_description: string;
  loss_location: string | null;
  reserve_amount: number | null;
  settlement_amount: number | null;
  adjuster_id: string | null;
  notes: string | null;
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
    DROP TABLE IF EXISTS claim_timeline;
    DROP TABLE IF EXISTS claim_documents;
    DROP TABLE IF EXISTS claims;
    DROP TABLE IF EXISTS adjusters;

    CREATE TABLE IF NOT EXISTS adjusters (
      adjuster_id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      specialty TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      max_open_claims INTEGER NOT NULL DEFAULT 25,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS claims (
      claim_id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      claim_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'reported',
      loss_date TEXT NOT NULL,
      reported_date TEXT NOT NULL,
      loss_description TEXT NOT NULL,
      loss_location TEXT,
      reserve_amount REAL,
      settlement_amount REAL,
      adjuster_id TEXT REFERENCES adjusters(adjuster_id),
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS claim_documents (
      document_id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(claim_id),
      document_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      uploaded_by TEXT,
      uploaded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS claim_timeline (
      event_id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(claim_id),
      event_type TEXT NOT NULL,
      description TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

async function seed() {
  console.log(`Seed mode: ${SEED_MODE} (SEED_MODE=${process.env.SEED_MODE ?? "unset"})`);
  console.log("Creating tables...");
  createTables();

  console.log("Loading seed data...");
  const [adjustersData, claimsData] = await Promise.all([
    loadJson<SeedAdjuster[]>("adjusters.json"),
    loadJson<SeedClaim[]>("claims.json"),
  ]);

  console.log(
    `Loaded: ${adjustersData.length} adjusters, ${claimsData.length} claims`,
  );

  // Clear existing data (reverse FK order)
  console.log("Clearing existing data...");
  db.delete(claimTimeline).run();
  db.delete(claimDocuments).run();
  db.delete(claims).run();
  db.delete(adjusters).run();

  // Insert adjusters first (claims reference them)
  console.log("Seeding adjusters...");
  for (const a of adjustersData) {
    db.insert(adjusters)
      .values({
        adjuster_id: a.adjuster_id,
        first_name: a.first_name,
        last_name: a.last_name,
        email: a.email,
        phone: a.phone,
        specialty: a.specialty,
        active: a.active,
        max_open_claims: a.max_open_claims,
        created_at: a.created_at,
      })
      .run();
  }

  // Insert claims
  console.log("Seeding claims...");
  for (const c of claimsData) {
    db.insert(claims)
      .values({
        claim_id: c.claim_id,
        policy_id: c.policy_id,
        client_id: c.client_id,
        claim_type: c.claim_type,
        status: c.status,
        loss_date: c.loss_date,
        reported_date: c.reported_date,
        loss_description: c.loss_description,
        loss_location: c.loss_location,
        reserve_amount: c.reserve_amount,
        settlement_amount: c.settlement_amount,
        adjuster_id: c.adjuster_id,
        notes: c.notes,
        created_at: c.created_at,
        updated_at: c.updated_at,
      })
      .run();
  }

  // Verify counts
  const counts = {
    adjusters: db
      .select({ count: sql<number>`count(*)` })
      .from(adjusters)
      .get()!.count,
    claims: db
      .select({ count: sql<number>`count(*)` })
      .from(claims)
      .get()!.count,
    claim_documents: db
      .select({ count: sql<number>`count(*)` })
      .from(claimDocuments)
      .get()!.count,
    claim_timeline: db
      .select({ count: sql<number>`count(*)` })
      .from(claimTimeline)
      .get()!.count,
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
