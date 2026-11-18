import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Tables } from "../harness";
import { start, type Ctx } from "./support";

const REPO_ROOT = join(import.meta.dir, "../../..");

function loadFixture(file: string): { description: string; tables: Tables } {
  return JSON.parse(readFileSync(join(REPO_ROOT, "data/validation/carrier-summit", file), "utf8"));
}

describe("held-out validation fixtures (data/validation/carrier-summit)", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await start();
  }, 30_000);

  test("SMT-R46: strict less-than vs equal-date expiry boundary on quotes and policies", async () => {
    const fixture = loadFixture("quotes-and-expiry.json");
    await ctx.svc.seed({ base: "empty", tables: fixture.tables });

    // 2026-10-14 + 3 days = 2026-10-17: 2026-10-16 expires, 2026-10-17 stays active/quoted.
    const tt = await ctx.svc.timeTravel({ days: 3 });
    expect(tt).toMatchObject({
      status: "ok",
      service: "carrier-summit",
      days_advanced: 3,
      transitions: { quotes_expired: 1, policies_expired: 1 },
    });

    const quotes = Object.fromEntries((await ctx.svc.table("quotes")).map((q: any) => [q.quote_id, q.status]));
    const policies = Object.fromEntries((await ctx.svc.table("policies")).map((p: any) => [p.policy_id, p.status]));
    expect(quotes["QT-SMIT-VAL-EXP"]).toBe("expired");
    expect(quotes["QT-SMIT-VAL-EQ"]).toBe("quoted");
    expect(policies["POL-SMIT-VAL-EXP"]).toBe("expired");
    expect(policies["POL-SMIT-VAL-EQ"]).toBe("active");
  });
});
