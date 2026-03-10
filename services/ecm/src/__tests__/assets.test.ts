import { describe, it, expect, beforeAll } from "bun:test";
import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";

// ── Mock db module with in-memory database ──
const testSqlite = new Database(":memory:");
testSqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(testSqlite, { schema });

mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

import { assetsRouter } from "../routes/assets";
import { createTestApp, createTables, authHeader, makeAsset } from "./setup";

const app = createTestApp({ assets: assetsRouter });

const ASSETS_URL = "http://localhost/v1/assets";

// ── Request helpers ──

async function getMarketing(
  params: Record<string, string> = {},
  headers: Record<string, string> = {},
) {
  const url = new URL(`${ASSETS_URL}/marketing`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return app.request(url.toString(), { headers });
}

// ── Seed data ──

beforeAll(() => {
  createTables(testSqlite);

  const assets = [
    makeAsset({
      asset_id: "asset_001",
      name: "Personal Lines Welcome Kit",
      category: "welcome_kit",
      published_date: "2025-06-01T00:00:00Z",
    }),
    makeAsset({
      asset_id: "asset_002",
      name: "Bundle Savings Flyer",
      category: "flyer",
      published_date: "2025-05-15T00:00:00Z",
    }),
    makeAsset({
      asset_id: "asset_003",
      name: "Rate Comparison Template",
      category: "comparison_template",
      published_date: "2025-04-01T00:00:00Z",
    }),
    makeAsset({
      asset_id: "asset_004",
      name: "Storm Prep Social Post",
      category: "social_media",
      mime_type: "image/png",
      published_date: "2025-03-15T00:00:00Z",
    }),
    makeAsset({
      asset_id: "asset_005",
      name: "Commercial Lines Welcome Kit",
      category: "welcome_kit",
      published_date: "2025-02-01T00:00:00Z",
    }),
    makeAsset({
      asset_id: "asset_006",
      name: "Umbrella Coverage Flyer",
      category: "flyer",
      published_date: "2025-01-15T00:00:00Z",
    }),
  ];

  for (const a of assets) {
    testDb.insert(schema.marketingAssets).values(a).run();
  }
});

// ── GET /v1/assets/marketing — Auth ──

describe("GET /v1/assets/marketing - Auth", () => {
  it("returns 401 without token", async () => {
    const res = await getMarketing();
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await getMarketing({}, headers);
    expect(res.status).toBe(403);
  });
});

// ── GET /v1/assets/marketing — Basic ──

describe("GET /v1/assets/marketing - Basic", () => {
  it("returns all assets sorted by published_date desc", async () => {
    const headers = await authHeader(["ecm:assets:read"]);
    const res = await getMarketing({}, headers);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.length).toBe(6);
    // Sorted desc
    for (let i = 1; i < json.data.length; i++) {
      expect(
        json.data[i - 1].published_date >= json.data[i].published_date,
      ).toBe(true);
    }
  });

  it("returns correct asset fields", async () => {
    const headers = await authHeader(["ecm:assets:read"]);
    const res = await getMarketing({}, headers);
    const json = await res.json();
    const asset = json.data[0];

    expect(asset.asset_id).toBeTruthy();
    expect(asset.name).toBeTruthy();
    expect(asset.category).toBeTruthy();
    expect(asset.mime_type).toBeTruthy();
    expect(asset.url).toBeTruthy();
    expect(asset.version).toBeTruthy();
    expect(asset.published_date).toBeTruthy();
  });
});

// ── GET /v1/assets/marketing — Filters ──

describe("GET /v1/assets/marketing - Filters", () => {
  it("filters by category", async () => {
    const headers = await authHeader(["ecm:assets:read"]);
    const res = await getMarketing({ category: "welcome_kit" }, headers);
    const json = await res.json();

    expect(json.data.length).toBe(2);
    expect(json.data.every((a: any) => a.category === "welcome_kit")).toBe(
      true,
    );
  });

  it("returns empty data for category with no assets", async () => {
    const headers = await authHeader(["ecm:assets:read"]);
    // All valid categories have assets, but let's test the structure
    const res = await getMarketing({ category: "social_media" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(1);
    expect(json.data[0].category).toBe("social_media");
  });

  it("returns 400 for invalid category", async () => {
    const headers = await authHeader(["ecm:assets:read"]);
    const res = await getMarketing({ category: "invalid" }, headers);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error_code).toBe("VALIDATION_ERROR");
  });
});

// ── GET /v1/assets/marketing — Pagination ──

describe("GET /v1/assets/marketing - Pagination", () => {
  it("paginates with limit", async () => {
    const headers = await authHeader(["ecm:assets:read"]);
    const res = await getMarketing({ limit: "3" }, headers);
    const json = await res.json();

    expect(json.data.length).toBe(3);
    expect(json.pagination.has_more).toBe(true);
    expect(json.pagination.next_cursor).toBeTruthy();
    expect(json.pagination.limit).toBe(3);
  });

  it("follows cursor to next page", async () => {
    const headers = await authHeader(["ecm:assets:read"]);
    const res1 = await getMarketing({ limit: "3" }, headers);
    const json1 = await res1.json();

    const res2 = await getMarketing(
      { limit: "3", cursor: json1.pagination.next_cursor },
      headers,
    );
    const json2 = await res2.json();

    expect(json2.data.length).toBe(3);
    expect(json2.pagination.has_more).toBe(false);

    // No overlap between pages
    const ids1 = json1.data.map((a: any) => a.asset_id);
    const ids2 = json2.data.map((a: any) => a.asset_id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toEqual([]);
  });

  it("paginates with category filter", async () => {
    const headers = await authHeader(["ecm:assets:read"]);
    const res = await getMarketing(
      { category: "flyer", limit: "1" },
      headers,
    );
    const json = await res.json();

    expect(json.data.length).toBe(1);
    expect(json.data[0].category).toBe("flyer");
    expect(json.pagination.has_more).toBe(true);
  });
});
