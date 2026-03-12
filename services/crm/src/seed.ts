import { db, sqlite } from "./db";
import { leads, campaigns, campaignEnrollments, retentionRisks } from "./schema";
import { join } from "path";
import { sql } from "drizzle-orm";

const SEED_MODE = process.env.SEED_MODE === "clean" ? "seed-clean" : "seed";
const SEED_DIR = join(import.meta.dir, "..", "..", "..", "data", SEED_MODE);

interface SeedLead {
  lead_id: string;
  client_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  source: string;
  status: string;
  score: number;
  assigned_producer: string | null;
  tags: string[];
  notes: string | null;
  last_activity_date: string;
  created_at: string;
  updated_at: string;
}

interface SeedCampaign {
  campaign_id: string;
  name: string;
  type: string;
  status: string;
  enrolled_count: number;
  conversion_rate: number;
}

interface SeedRetentionRisk {
  client_id: string;
  client_name: string;
  risk_score: number;
  rate_increase_pct: number;
  months_since_contact: number;
  email_open_rate: number;
  policies_count: number;
  recommended_action: string;
  assigned_producer: string | null;
}

async function loadJson<T>(filename: string): Promise<T> {
  const path = join(SEED_DIR, filename);
  const file = Bun.file(path);
  return file.json() as Promise<T>;
}

function createTables() {
  sqlite.exec(`
    DROP TABLE IF EXISTS campaign_enrollments;
    DROP TABLE IF EXISTS retention_risks;
    DROP TABLE IF EXISTS campaigns;
    DROP TABLE IF EXISTS leads;

    CREATE TABLE IF NOT EXISTS leads (
      lead_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      score INTEGER NOT NULL DEFAULT 0,
      assigned_producer TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      last_activity_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      campaign_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      enrolled_count INTEGER NOT NULL DEFAULT 0,
      conversion_rate REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS campaign_enrollments (
      enrollment_id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id),
      client_id TEXT NOT NULL,
      trigger_reason TEXT,
      metadata TEXT,
      enrolled_at TEXT NOT NULL,
      sequence_step INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS retention_risks (
      client_id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      risk_score INTEGER NOT NULL,
      rate_increase_pct REAL,
      months_since_contact INTEGER,
      email_open_rate REAL,
      policies_count INTEGER,
      recommended_action TEXT,
      assigned_producer TEXT
    );
  `);
}

async function seed() {
  console.log(`Seed mode: ${SEED_MODE} (SEED_MODE=${process.env.SEED_MODE ?? "unset"})`);
  console.log("Creating tables...");
  createTables();

  console.log("Loading seed data...");
  const [leadsData, campaignsData, risksData] = await Promise.all([
    loadJson<SeedLead[]>("leads.json"),
    loadJson<SeedCampaign[]>("campaigns.json"),
    loadJson<SeedRetentionRisk[]>("retention_risks.json"),
  ]);

  console.log(
    `Loaded: ${leadsData.length} leads, ${campaignsData.length} campaigns, ${risksData.length} retention risks`,
  );

  // Clear existing data (reverse FK order)
  console.log("Clearing existing data...");
  db.delete(campaignEnrollments).run();
  db.delete(retentionRisks).run();
  db.delete(leads).run();
  db.delete(campaigns).run();

  // Insert campaigns
  console.log("Seeding campaigns...");
  for (const c of campaignsData) {
    db.insert(campaigns)
      .values({
        campaign_id: c.campaign_id,
        name: c.name,
        type: c.type,
        status: c.status,
        enrolled_count: c.enrolled_count,
        conversion_rate: c.conversion_rate,
      })
      .run();
  }

  // Insert leads
  console.log("Seeding leads...");
  for (const l of leadsData) {
    db.insert(leads)
      .values({
        lead_id: l.lead_id,
        client_id: l.client_id,
        first_name: l.first_name,
        last_name: l.last_name,
        email: l.email,
        phone: l.phone,
        source: l.source,
        status: l.status,
        score: l.score,
        assigned_producer: l.assigned_producer,
        tags: JSON.stringify(l.tags),
        notes: l.notes,
        last_activity_date: l.last_activity_date,
        created_at: l.created_at,
        updated_at: l.updated_at,
      })
      .run();
  }

  // Insert retention risks
  console.log("Seeding retention risks...");
  for (const r of risksData) {
    db.insert(retentionRisks)
      .values({
        client_id: r.client_id,
        client_name: r.client_name,
        risk_score: r.risk_score,
        rate_increase_pct: r.rate_increase_pct,
        months_since_contact: r.months_since_contact,
        email_open_rate: r.email_open_rate,
        policies_count: r.policies_count,
        recommended_action: r.recommended_action,
        assigned_producer: r.assigned_producer,
      })
      .run();
  }

  // Verify counts
  const counts = {
    leads: db
      .select({ count: sql<number>`count(*)` })
      .from(leads)
      .get()!.count,
    campaigns: db
      .select({ count: sql<number>`count(*)` })
      .from(campaigns)
      .get()!.count,
    campaign_enrollments: db
      .select({ count: sql<number>`count(*)` })
      .from(campaignEnrollments)
      .get()!.count,
    retention_risks: db
      .select({ count: sql<number>`count(*)` })
      .from(retentionRisks)
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
