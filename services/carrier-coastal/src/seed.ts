import { db, sqlite } from "./db";
import { quotes, policies, idCards } from "./schema";
import { join } from "path";
import { sql } from "drizzle-orm";

const SEED_MODE = process.env.SEED_MODE === "clean" ? "seed-clean" : "seed";
const SEED_DIR = join(import.meta.dir, "..", "..", "..", "data", SEED_MODE);

interface SeedCoverage {
  type: string;
  limit?: string | number | null;
  deductible?: number | null;
}

interface SeedQuoteResult {
  quote_id: string;
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
  results: SeedQuoteResult[];
}

interface SeedPolicy {
  policy_id: string;
  client_id: string;
  carrier_code: string;
  policy_type: string;
  effective_date: string;
  expiration_date: string;
  premium_current: number;
  status: string;
  coverages: SeedCoverage[];
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
    DROP TABLE IF EXISTS id_cards;
    DROP TABLE IF EXISTS policies;
    DROP TABLE IF EXISTS quotes;

    CREATE TABLE IF NOT EXISTS quotes (
      quote_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      policy_type TEXT NOT NULL,
      premium_annual REAL,
      premium_monthly REAL,
      premium_semi_annual REAL,
      coverages TEXT NOT NULL,
      deductibles TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'quoted',
      decline_reason TEXT,
      valid_until TEXT,
      submitted_at TEXT NOT NULL,
      risk_score INTEGER,
      risk_tier TEXT,
      risk_factors TEXT,
      assessed_at TEXT,
      bind_status TEXT NOT NULL DEFAULT 'unbound',
      bound_at TEXT,
      policy_id TEXT,
      vin TEXT,
      vehicle_year INTEGER,
      vehicle_make TEXT,
      vehicle_model TEXT,
      driver_name TEXT,
      driver_dob TEXT,
      driver_license TEXT,
      coverage_config TEXT
    );

    CREATE TABLE IF NOT EXISTS policies (
      policy_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      policy_type TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      expiration_date TEXT NOT NULL,
      premium_current REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      coverages TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS id_cards (
      card_id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL REFERENCES policies(policy_id),
      card_data TEXT NOT NULL,
      issued_at TEXT NOT NULL
    );
  `);
}

function computeRiskScore(quoteId: string): number {
  let hash = 0;
  for (let i = 0; i < quoteId.length; i++) {
    hash = (hash * 31 + quoteId.charCodeAt(i)) & 0x7fffffff;
  }
  return (hash % 60) + 30; // range 30–89
}

function riskTier(score: number): string {
  if (score >= 75) return "preferred";
  if (score >= 50) return "standard";
  return "non_standard";
}

function generateRiskFactors(score: number) {
  return [
    {
      factor: "driver_age",
      impact: score >= 60 ? "positive" : "neutral",
      detail: score >= 60 ? "Primary driver in preferred age range" : "Driver age within acceptable range",
    },
    {
      factor: "vehicle_value",
      impact: score >= 70 ? "positive" : "neutral",
      detail: score >= 70 ? "Vehicle value within low-risk tier" : "Vehicle value is moderate",
    },
    {
      factor: "claims_history",
      impact: score >= 50 ? "positive" : "negative",
      detail: score >= 50 ? "No claims in past 3 years" : "Recent claims on file",
    },
  ];
}

async function seed() {
  console.log(`Seed mode: ${SEED_MODE} (SEED_MODE=${process.env.SEED_MODE ?? "unset"})`);
  console.log("Creating tables...");
  createTables();

  console.log("Loading seed data...");
  const [quoteRequests, allPolicies] = await Promise.all([
    loadJson<SeedQuoteRequest[]>("quotes.json"),
    loadJson<SeedPolicy[]>("policies.json"),
  ]);

  // Extract Coastal Star quotes from quote requests
  const coastalQuotes: Array<{
    result: SeedQuoteResult;
    request: SeedQuoteRequest;
  }> = [];
  for (const req of quoteRequests) {
    for (const result of req.results) {
      if (result.carrier_code === "CSTL") {
        coastalQuotes.push({ result, request: req });
      }
    }
  }

  // Filter Coastal Star policies
  const coastalPolicies = allPolicies.filter((p) => p.carrier_code === "CSTL");

  console.log(
    `Found: ${coastalQuotes.length} Coastal Star quotes, ${coastalPolicies.length} Coastal Star policies`,
  );

  // Clear existing data (reverse FK order)
  console.log("Clearing existing data...");
  db.delete(policies).run();
  db.delete(quotes).run();

  // Insert policies first (quotes may reference them)
  console.log("Seeding policies...");
  for (const p of coastalPolicies) {
    db.insert(policies)
      .values({
        policy_id: p.policy_id,
        client_id: p.client_id,
        policy_type: p.policy_type,
        effective_date: p.effective_date,
        expiration_date: p.expiration_date,
        premium_current: p.premium_current,
        status: p.status,
        coverages: JSON.stringify(p.coverages),
        created_at: p.created_at,
        updated_at: p.updated_at,
      })
      .run();
  }

  // Insert quotes with risk assessment data
  console.log("Seeding quotes...");
  for (const { result, request } of coastalQuotes) {
    const score = computeRiskScore(result.quote_id);
    const tier = riskTier(score);
    const factors = generateRiskFactors(score);
    const isBound = result.status === "bound";

    // Find matching policy for bound quotes (match by client_id)
    let linkedPolicyId: string | null = null;
    if (isBound) {
      const matchingPolicy = coastalPolicies.find(
        (p) => p.client_id === request.client_id && p.status === "active",
      );
      linkedPolicyId = matchingPolicy?.policy_id ?? null;
    }

    db.insert(quotes)
      .values({
        quote_id: result.quote_id,
        request_id: request.request_id,
        client_id: request.client_id,
        policy_type: request.policy_type,
        premium_annual: result.premium_annual,
        premium_monthly: result.premium_monthly,
        coverages: JSON.stringify(result.coverages),
        deductibles: JSON.stringify(result.deductibles),
        status: isBound ? "bound" : "assessed",
        decline_reason: result.decline_reason ?? null,
        valid_until: result.valid_until ?? null,
        submitted_at: request.submitted_at,
        risk_score: score,
        risk_tier: tier,
        risk_factors: JSON.stringify(factors),
        assessed_at: request.submitted_at,
        bind_status: isBound ? "bound" : "unbound",
        bound_at: isBound ? request.submitted_at : null,
        policy_id: linkedPolicyId,
      })
      .run();
  }

  // Verify counts
  const counts = {
    quotes: db.select({ count: sql<number>`count(*)` }).from(quotes).get()!
      .count,
    policies: db
      .select({ count: sql<number>`count(*)` })
      .from(policies)
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
