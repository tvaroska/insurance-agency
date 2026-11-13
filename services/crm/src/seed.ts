import { prisma } from "./prisma";
import { join } from "path";

interface SeedLead {
  lead_id: string;
  client_id: string | null;
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

async function loadJson<T>(seedDir: string, filename: string): Promise<T> {
  const path = join(seedDir, filename);
  const file = Bun.file(path);
  return file.json() as Promise<T>;
}

async function createTables() {
  for (const table of [
    "campaign_enrollments",
    "retention_risks",
    "campaigns",
    "leads",
  ]) {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${table}`);
  }
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS leads (
    lead_id TEXT PRIMARY KEY,
    client_id TEXT,
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
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS campaigns (
    campaign_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    enrolled_count INTEGER NOT NULL DEFAULT 0,
    conversion_rate REAL NOT NULL DEFAULT 0
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS campaign_enrollments (
    enrollment_id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id),
    client_id TEXT NOT NULL,
    trigger_reason TEXT,
    metadata TEXT,
    enrolled_at TEXT NOT NULL,
    sequence_step INTEGER NOT NULL DEFAULT 1
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS retention_risks (
    client_id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    risk_score INTEGER NOT NULL,
    rate_increase_pct REAL,
    months_since_contact INTEGER,
    email_open_rate REAL,
    policies_count INTEGER,
    recommended_action TEXT,
    assigned_producer TEXT
  )`);
}

export async function seedDatabase(
  seedMode = process.env.SEED_MODE || "realistic",
): Promise<void> {
  const seedFolder = seedMode === "clean" ? "seed-clean" : "seed";
  const seedDir = join(import.meta.dir, "..", "..", "..", "data", seedFolder);
  const verbose = import.meta.main;

  if (verbose) {
    console.log(`Seed mode: ${seedFolder} (seedMode=${seedMode})`);
    console.log("Creating tables...");
  }
  await createTables();
  if (seedMode === "empty") return;

  const [leadsData, campaignsData, risksData] = await Promise.all([
    loadJson<SeedLead[]>(seedDir, "leads.json"),
    loadJson<SeedCampaign[]>(seedDir, "campaigns.json"),
    loadJson<SeedRetentionRisk[]>(seedDir, "retention_risks.json"),
  ]);

  if (verbose) {
    console.log(
      `Loaded: ${leadsData.length} leads, ${campaignsData.length} campaigns, ${risksData.length} retention risks`,
    );
  }

  await prisma.campaign.createMany({
    data: campaignsData.map((c) => ({
      campaign_id: c.campaign_id,
      name: c.name,
      type: c.type,
      status: c.status,
      enrolled_count: c.enrolled_count,
      conversion_rate: c.conversion_rate,
    })),
  });

  await prisma.lead.createMany({
    data: leadsData.map((l) => ({
      lead_id: l.lead_id,
      client_id: l.client_id ?? null,
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
    })),
  });

  await prisma.retentionRisk.createMany({
    data: risksData.map((r) => ({
      client_id: r.client_id,
      client_name: r.client_name,
      risk_score: r.risk_score,
      rate_increase_pct: r.rate_increase_pct,
      months_since_contact: r.months_since_contact,
      email_open_rate: r.email_open_rate,
      policies_count: r.policies_count,
      recommended_action: r.recommended_action,
      assigned_producer: r.assigned_producer,
    })),
  });

  if (verbose) {
    const counts = {
      leads: await prisma.lead.count(),
      campaigns: await prisma.campaign.count(),
      campaign_enrollments: await prisma.campaignEnrollment.count(),
      retention_risks: await prisma.retentionRisk.count(),
    };
    console.log("\nSeed complete:");
    for (const [table, count] of Object.entries(counts)) {
      console.log(`  ${table}: ${count} rows`);
    }
  }
}

if (import.meta.main) {
  seedDatabase().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
}
