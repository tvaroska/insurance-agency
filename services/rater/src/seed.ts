import { db, sqlite } from "./db";
import { quoteRequests, carrierQuotes, carriers } from "./schema";
import { join } from "path";
import { sql } from "drizzle-orm";

const SEED_DIR = join(import.meta.dir, "..", "..", "..", "data", "seed");

interface SeedCoverage {
  type: string;
  limit?: string | number | null;
  deductible?: number | null;
}

interface SeedQuoteResult {
  quote_id: string | null;
  carrier_code: string;
  carrier_name: string;
  premium_annual: number | null;
  premium_monthly: number | null;
  coverages: SeedCoverage[];
  deductibles: Record<string, number>;
  status: string;
  decline_reason?: string;
  valid_until: string | null;
}

interface SeedQuoteRequest {
  request_id: string;
  client_id: string;
  policy_type: string;
  submitted_at: string;
  status: string;
  effective_date?: string;
  drivers?: unknown[];
  vehicles?: unknown[];
  property?: Record<string, unknown>;
  business?: Record<string, unknown>;
  requested_coverages: SeedCoverage[];
  missing_fields?: string[];
  results: SeedQuoteResult[];
  expires_at: string | null;
}

interface SeedCarrier {
  carrier_code: string;
  carrier_name: string;
  states: string[];
  policy_types: string[];
  risk_categories: string[];
  appetite_level: string;
  min_driver_age: number;
  max_vehicles: number;
  accepts_sr22: boolean;
  surplus_lines_only: boolean;
  sr22_available: boolean;
  citizens_eligible: boolean;
  state_restrictions: string[];
}

async function loadJson<T>(filename: string): Promise<T> {
  const path = join(SEED_DIR, filename);
  const file = Bun.file(path);
  return file.json() as Promise<T>;
}

function createTables() {
  sqlite.exec(`
    DROP TABLE IF EXISTS carrier_quotes;
    DROP TABLE IF EXISTS quote_requests;
    DROP TABLE IF EXISTS carriers;

    CREATE TABLE IF NOT EXISTS quote_requests (
      request_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      policy_type TEXT NOT NULL,
      effective_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      submitted_at TEXT NOT NULL,
      completed_at TEXT,
      expires_at TEXT,
      risk_data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS carrier_quotes (
      quote_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES quote_requests(request_id),
      carrier_code TEXT NOT NULL,
      carrier_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      premium_annual REAL,
      premium_monthly REAL,
      coverages TEXT NOT NULL DEFAULT '[]',
      deductibles TEXT NOT NULL DEFAULT '{}',
      decline_reason TEXT,
      valid_until TEXT,
      bound_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS carriers (
      carrier_code TEXT PRIMARY KEY,
      carrier_name TEXT NOT NULL,
      states TEXT NOT NULL,
      policy_types TEXT NOT NULL,
      risk_categories TEXT NOT NULL,
      appetite_level TEXT NOT NULL,
      min_driver_age INTEGER,
      max_vehicles INTEGER,
      accepts_sr22 INTEGER DEFAULT 0,
      surplus_lines_only INTEGER DEFAULT 0,
      sr22_available INTEGER DEFAULT 0,
      citizens_eligible INTEGER DEFAULT 0,
      state_restrictions TEXT NOT NULL DEFAULT '[]'
    );
  `);
}

async function seed() {
  console.log("Creating tables...");
  createTables();

  console.log("Loading seed data...");
  const [quotesData, carriersData] = await Promise.all([
    loadJson<SeedQuoteRequest[]>("quotes.json"),
    loadJson<SeedCarrier[]>("carriers.json"),
  ]);

  console.log(
    `Loaded: ${quotesData.length} quote requests, ${carriersData.length} carriers`,
  );

  // Clear existing data (reverse FK order)
  console.log("Clearing existing data...");
  db.delete(carrierQuotes).run();
  db.delete(quoteRequests).run();
  db.delete(carriers).run();

  // Insert carriers
  console.log("Seeding carriers...");
  for (const c of carriersData) {
    db.insert(carriers)
      .values({
        carrier_code: c.carrier_code,
        carrier_name: c.carrier_name,
        states: JSON.stringify(c.states),
        policy_types: JSON.stringify(c.policy_types),
        risk_categories: JSON.stringify(c.risk_categories),
        appetite_level: c.appetite_level,
        min_driver_age: c.min_driver_age,
        max_vehicles: c.max_vehicles,
        accepts_sr22: c.accepts_sr22,
        surplus_lines_only: c.surplus_lines_only,
        sr22_available: c.sr22_available,
        citizens_eligible: c.citizens_eligible,
        state_restrictions: JSON.stringify(c.state_restrictions),
      })
      .run();
  }

  // Insert quote requests + carrier quotes
  console.log("Seeding quote requests and carrier quotes...");
  let totalQuotes = 0;

  for (const q of quotesData) {
    // Build risk_data from the various risk fields
    const riskData: Record<string, unknown> = {
      requested_coverages: q.requested_coverages,
    };
    if (q.drivers) riskData.drivers = q.drivers;
    if (q.vehicles) riskData.vehicles = q.vehicles;
    if (q.property) riskData.property = q.property;
    if (q.business) riskData.business = q.business;
    if (q.missing_fields) riskData.missing_fields = q.missing_fields;

    db.insert(quoteRequests)
      .values({
        request_id: q.request_id,
        client_id: q.client_id,
        policy_type: q.policy_type,
        effective_date: q.effective_date ?? null,
        status: q.status,
        submitted_at: q.submitted_at,
        completed_at:
          q.status === "completed" ? q.submitted_at : null,
        expires_at: q.expires_at ?? null,
        risk_data: JSON.stringify(riskData),
        created_at: q.submitted_at,
      })
      .run();

    // Insert each carrier result
    for (const r of q.results) {
      // Generate a synthetic quote_id for declined quotes that have null quote_id
      const quoteId =
        r.quote_id ?? `${q.request_id}-${r.carrier_code}-declined`;

      db.insert(carrierQuotes)
        .values({
          quote_id: quoteId,
          request_id: q.request_id,
          carrier_code: r.carrier_code,
          carrier_name: r.carrier_name,
          status: r.status,
          premium_annual: r.premium_annual ?? null,
          premium_monthly: r.premium_monthly ?? null,
          coverages: JSON.stringify(r.coverages),
          deductibles: JSON.stringify(r.deductibles),
          decline_reason: r.decline_reason ?? null,
          valid_until: r.valid_until ?? null,
          bound_at: r.status === "bound" ? q.submitted_at : null,
          created_at: q.submitted_at,
        })
        .run();
      totalQuotes++;
    }
  }

  // Verify counts
  const counts = {
    carriers: db
      .select({ count: sql<number>`count(*)` })
      .from(carriers)
      .get()!.count,
    quote_requests: db
      .select({ count: sql<number>`count(*)` })
      .from(quoteRequests)
      .get()!.count,
    carrier_quotes: db
      .select({ count: sql<number>`count(*)` })
      .from(carrierQuotes)
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
