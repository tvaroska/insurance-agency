import { prisma } from "./prisma";
import { join } from "path";

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

async function createTables() {
  await prisma.$executeRawUnsafe(`
    DROP TABLE IF EXISTS underwriting_conditions;
    DROP TABLE IF EXISTS policy_documents;
    DROP TABLE IF EXISTS policies;
    DROP TABLE IF EXISTS quotes;
  `);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS quotes (
    quote_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    policy_type TEXT NOT NULL,
    premium_annual REAL,
    premium_monthly REAL,
    coverages TEXT NOT NULL,
    deductibles TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'quoted',
    decline_reason TEXT,
    valid_until TEXT,
    submitted_at TEXT NOT NULL,
    underwriting_status TEXT NOT NULL DEFAULT 'pending_review',
    underwriting_notes TEXT,
    property_address TEXT,
    property_details TEXT,
    photo_checklist TEXT,
    inspection_status TEXT DEFAULT 'not_scheduled',
    inspection_scheduled_at TEXT,
    inspection_completed_at TEXT,
    inspection_notes TEXT
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS policies (
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
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS policy_documents (
    document_id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL REFERENCES policies(policy_id),
    document_type TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    supersedes TEXT,
    created_at TEXT NOT NULL
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS underwriting_conditions (
    condition_id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL REFERENCES quotes(quote_id),
    condition_type TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    resolved_at TEXT
  )`);
}

async function seed() {
  console.log(`Seed mode: ${SEED_MODE} (SEED_MODE=${process.env.SEED_MODE ?? "unset"})`);
  console.log("Creating tables...");
  await createTables();

  console.log("Loading seed data...");
  const [quoteRequests, allPolicies] = await Promise.all([
    loadJson<SeedQuoteRequest[]>("quotes.json"),
    loadJson<SeedPolicy[]>("policies.json"),
  ]);

  // Extract Summit quotes from quote requests
  const summitQuotes: Array<{
    result: SeedQuoteResult;
    request: SeedQuoteRequest;
  }> = [];
  for (const req of quoteRequests) {
    for (const result of req.results) {
      if (result.carrier_code === "SMIT") {
        summitQuotes.push({ result, request: req });
      }
    }
  }

  // Filter Summit policies
  const summitPolicies = allPolicies.filter((p) => p.carrier_code === "SMIT");

  console.log(
    `Found: ${summitQuotes.length} Summit quotes, ${summitPolicies.length} Summit policies`,
  );

  // Insert quotes
  console.log("Seeding quotes...");
  await prisma.quote.createMany({
    data: summitQuotes.map(({ result, request }) => {
      const uwStatus =
        result.status === "declined"
          ? "declined"
          : result.status === "bound"
            ? "approved"
            : "pending_review";

      return {
        quote_id: result.quote_id,
        request_id: request.request_id,
        client_id: request.client_id,
        policy_type: request.policy_type,
        premium_annual: result.premium_annual,
        premium_monthly: result.premium_monthly,
        coverages: JSON.stringify(result.coverages),
        deductibles: JSON.stringify(result.deductibles),
        status: result.status,
        decline_reason: result.decline_reason ?? null,
        valid_until: result.valid_until ?? null,
        submitted_at: request.submitted_at,
        underwriting_status: uwStatus,
        underwriting_notes: null,
      };
    }),
  });

  // Insert policies
  console.log("Seeding policies...");
  await prisma.policy.createMany({
    data: summitPolicies.map((p) => ({
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
    })),
  });

  // Generate policy documents for each Summit policy
  console.log("Seeding policy documents...");
  const docTypes = [
    { type: "dec_page", suffix: "declarations", size: 180000 },
    { type: "id_cards", suffix: "id_cards", size: 95000 },
    { type: "policy_jacket", suffix: "policy_jacket", size: 450000 },
  ];

  let docCounter = 1;
  for (const p of summitPolicies) {
    const policySlug = p.policy_id.toLowerCase().replace(/[^a-z0-9]/g, "_");
    for (const dt of docTypes) {
      await prisma.policyDocument.create({
        data: {
          document_id: `SDOC-${String(docCounter++).padStart(3, "0")}`,
          policy_id: p.policy_id,
          document_type: dt.type,
          filename: `${policySlug}_${dt.suffix}.pdf`,
          file_size_bytes: dt.size + Math.floor(Math.random() * 50000),
          created_at: p.created_at,
        },
      });
    }
  }

  // Verify counts
  const counts = {
    quotes: await prisma.quote.count(),
    policies: await prisma.policy.count(),
    policy_documents: await prisma.policyDocument.count(),
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
