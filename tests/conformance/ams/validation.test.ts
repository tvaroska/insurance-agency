import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expectStatus, type Tables } from "../harness";
import { start, type Ctx } from "./support";

const REPO_ROOT = join(import.meta.dir, "../../..");

function loadFixture(file: string): { description: string; tables: Tables } {
  return JSON.parse(readFileSync(join(REPO_ROOT, "data/validation/ams", file), "utf8"));
}

describe("held-out validation fixtures (data/validation/ams)", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await start();
  }, 30_000);

  test("AMS-R18, AMS-R20, AMS-R92, AMS-R98: 115-client cursor walk, E&O firewall, and exact time-travel boundary", async () => {
    const fixture = loadFixture("stress-and-firewall.json");
    await ctx.svc.seed({ base: "empty", tables: fixture.tables });

    // Multi-page cursor walk with limit clamping (200 -> 100) across tied timestamps.
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    while (true) {
      const res = await ctx.api.get("/v1/clients", { query: { limit: 200, cursor } });
      const body = expectStatus(res, 200);
      expect(body.pagination.limit).toBe(100);
      for (const row of body.data) seen.push(row.id);
      pages += 1;
      if (!body.pagination.has_more) break;
      cursor = body.pagination.next_cursor;
      if (pages > 5) throw new Error("pagination did not terminate");
    }
    expect(pages).toBe(2);
    expect(seen.length).toBe(115);
    expect(new Set(seen).size).toBe(115);

    // E&O firewall blocks CA auto below 30/60/15 minimum and backdating.
    const caMin = await ctx.api.post("/v1/policies", {
      client_id: "CL-VAL-0002",
      carrier_code: "CSTL",
      policy_type: "personal_auto",
      effective_date: "2026-10-14",
      expiration_date: "2027-10-14",
      annual_premium: 1200,
      coverages: [{ type: "bodily_injury", limit: "15/30" }],
    });
    expect(caMin.status).toBe(422);

    const overCap = await ctx.api.post("/v1/policies", {
      client_id: "CL-VAL-0001",
      carrier_code: "SMIT",
      policy_type: "homeowners",
      effective_date: "2026-10-14",
      expiration_date: "2027-10-14",
      annual_premium: 15000,
      coverages: [{ type: "dwelling", limit: "500000" }],
    });
    expect(overCap.status).toBe(422);

    // Time travel +3 days (2026-10-14 -> 2026-10-17):
    // POL-VAL-EXP-1 (2026-10-16 < 2026-10-17) expires; POL-VAL-KEEP-1 (2026-10-17) stays active.
    // END-2026-000010 (2026-10-17 <= 2026-10-17) applies; END-2026-000011 (2026-10-18) stays pending_review.
    const tt = await ctx.svc.timeTravel({ days: 3 });
    expect(tt).toMatchObject({
      status: "ok",
      service: "ams",
      days_advanced: 3,
      transitions: { policies_expired: 1, endorsements_applied: 1 },
    });
  });
});
