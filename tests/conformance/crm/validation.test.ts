import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expectError, expectStatus, type Tables } from "../harness";
import { start, type Ctx } from "./support";

const REPO_ROOT = join(import.meta.dir, "../../..");

function loadFixture(file: string): { description: string; tables: Tables } {
  return JSON.parse(readFileSync(join(REPO_ROOT, "data/validation/crm", file), "utf8"));
}

describe("held-out validation fixtures (data/validation/crm)", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await start();
  }, 30_000);

  test("CRM-R10, CRM-R50, CRM-R110: 115-lead cursor pagination, duplicate/paused enrollment guards, and time-travel steps", async () => {
    const fixture = loadFixture("stress-pagination-and-campaigns.json");
    await ctx.svc.seed({ base: "empty", tables: fixture.tables });

    // Multi-page cursor walk with limit clamping (200 -> 100).
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    while (true) {
      const res = await ctx.api.get("/v1/leads", { query: { limit: 200, cursor } });
      const body = expectStatus(res, 200);
      expect(body.pagination.limit).toBe(100);
      for (const row of body.data) seen.push(row.lead_id);
      pages += 1;
      if (!body.pagination.has_more) break;
      cursor = body.pagination.next_cursor;
      if (pages > 5) throw new Error("pagination did not terminate");
    }
    expect(pages).toBe(2);
    expect(seen.length).toBe(115);
    expect(new Set(seen).size).toBe(115);

    // Duplicate enrollment for CLI-VAL-0001 returns 409 CONFLICT; paused campaign is rejected.
    expectError(
      await ctx.api.post("/v1/leads/lead_val_0001/enroll", { campaign_id: "camp_val_active" }),
      409,
      "CONFLICT",
    );
    const pausedRes = await ctx.api.post("/v1/leads/lead_val_0002/enroll", { campaign_id: "camp_val_paused" });
    expect([400, 409]).toContain(pausedRes.status);

    // Time travel +21 days adds floor(21/7)=3 to sequence_step (1 -> 4).
    const tt = await ctx.svc.timeTravel({ days: 21 });
    expect(tt).toMatchObject({
      status: "ok",
      service: "crm",
      days_advanced: 21,
      transitions: { campaign_enrollments_advanced: 1 },
    });
    const enrollments = await ctx.svc.table("campaign_enrollments");
    expect(enrollments[0].sequence_step).toBe(4);
  });
});
