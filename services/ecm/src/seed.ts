import { db, sqlite } from "./db";
import { documents, envelopes, marketingAssets } from "./schema";
import { join } from "path";
import { sql } from "drizzle-orm";

const SEED_DIR = join(import.meta.dir, "..", "..", "..", "data", "seed");

interface SeedDocument {
  document_id: string;
  client_id: string;
  document_type: string;
  filename: string;
  mime_type: string;
  file_size_bytes: number;
  status: string;
  upload_date: string;
  signer_name: string | null;
  signer_email: string | null;
  signed_date: string | null;
  expiration_date: string | null;
  tags: string[];
}

interface SeedSigner {
  name: string;
  email: string;
  role: string;
  status: string;
  signed_at: string | null;
}

interface SeedEnvelope {
  envelope_id: string;
  client_id: string;
  document_ids: string[];
  signers: SeedSigner[];
  status: string;
  message: string | null;
  redirect_url: string | null;
  created_at: string;
  completed_at: string | null;
  expiration_date: string;
}

interface SeedMarketingAsset {
  asset_id: string;
  name: string;
  description: string | null;
  category: string;
  mime_type: string;
  url: string;
  version: string;
  published_date: string;
}

async function loadJson<T>(filename: string): Promise<T> {
  const path = join(SEED_DIR, filename);
  const file = Bun.file(path);
  return file.json() as Promise<T>;
}

function createTables() {
  sqlite.exec(`
    DROP TABLE IF EXISTS marketing_assets;
    DROP TABLE IF EXISTS envelopes;
    DROP TABLE IF EXISTS documents;

    CREATE TABLE IF NOT EXISTS documents (
      document_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      document_type TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'uploaded',
      upload_date TEXT NOT NULL,
      signer_name TEXT,
      signer_email TEXT,
      signed_date TEXT,
      expiration_date TEXT,
      tags TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS envelopes (
      envelope_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      document_ids TEXT NOT NULL DEFAULT '[]',
      signers TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'created',
      message TEXT,
      redirect_url TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      expiration_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS marketing_assets (
      asset_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      url TEXT NOT NULL,
      version TEXT NOT NULL,
      published_date TEXT NOT NULL
    );
  `);
}

async function seed() {
  console.log("Creating tables...");
  createTables();

  console.log("Loading seed data...");
  const [docsData, envelopesData, assetsData] = await Promise.all([
    loadJson<SeedDocument[]>("documents.json"),
    loadJson<SeedEnvelope[]>("envelopes.json"),
    loadJson<SeedMarketingAsset[]>("marketing_assets.json"),
  ]);

  console.log(
    `Loaded: ${docsData.length} documents, ${envelopesData.length} envelopes, ${assetsData.length} marketing assets`,
  );

  // Clear existing data
  console.log("Clearing existing data...");
  db.delete(envelopes).run();
  db.delete(documents).run();
  db.delete(marketingAssets).run();

  // Insert documents
  console.log("Seeding documents...");
  for (const d of docsData) {
    db.insert(documents)
      .values({
        document_id: d.document_id,
        client_id: d.client_id,
        document_type: d.document_type,
        filename: d.filename,
        mime_type: d.mime_type,
        file_size_bytes: d.file_size_bytes,
        status: d.status,
        upload_date: d.upload_date,
        signer_name: d.signer_name,
        signer_email: d.signer_email,
        signed_date: d.signed_date,
        expiration_date: d.expiration_date ?? null,
        tags: JSON.stringify(d.tags ?? []),
      })
      .run();
  }

  // Insert envelopes
  console.log("Seeding envelopes...");
  for (const e of envelopesData) {
    db.insert(envelopes)
      .values({
        envelope_id: e.envelope_id,
        client_id: e.client_id,
        document_ids: JSON.stringify(e.document_ids),
        signers: JSON.stringify(e.signers),
        status: e.status,
        message: e.message,
        redirect_url: e.redirect_url,
        created_at: e.created_at,
        completed_at: e.completed_at,
        expiration_date: e.expiration_date,
      })
      .run();
  }

  // Insert marketing assets
  console.log("Seeding marketing assets...");
  for (const a of assetsData) {
    db.insert(marketingAssets)
      .values({
        asset_id: a.asset_id,
        name: a.name,
        description: a.description,
        category: a.category,
        mime_type: a.mime_type,
        url: a.url,
        version: a.version,
        published_date: a.published_date,
      })
      .run();
  }

  // Verify counts
  const counts = {
    documents: db
      .select({ count: sql<number>`count(*)` })
      .from(documents)
      .get()!.count,
    envelopes: db
      .select({ count: sql<number>`count(*)` })
      .from(envelopes)
      .get()!.count,
    marketing_assets: db
      .select({ count: sql<number>`count(*)` })
      .from(marketingAssets)
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
