import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expectError, type Tables } from "../harness";
import { API, start, type Ctx } from "./support";

const REPO_ROOT = join(import.meta.dir, "../../..");

function loadFixture(file: string): { description: string; tables: Tables } {
  return JSON.parse(readFileSync(join(REPO_ROOT, "data/validation/carrier-coastal", file), "utf8"));
}

describe("held-out validation fixtures (data/validation/carrier-coastal)", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await start();
  }, 30_000);

  test("CST-R39, CST-R53: unassessed bind refusal, double-bind conflict, and exact date expiry boundary", async () => {
    const fixture = loadFixture("quotes-and-expiry.json");
    await ctx.svc.seed({ base: "empty", tables: fixture.tables });

    const bindBody = { effective_date: "2026-11-01", payment_plan: "monthly" };
    // Unassessed quote cannot be bound (400 VALIDATION_ERROR); already-bound quote returns 409 CONFLICT.
    expectError(await ctx.api.post(`${API}/quotes/QT-CSTL-VAL-RAW/bind`, bindBody), 400, "VALIDATION_ERROR");
    expectError(await ctx.api.post(`${API}/quotes/QT-CSTL-VAL-BOUND/bind`, bindBody), 409, "CONFLICT");

    // 2026-10-14 + 3 days = 2026-10-17: 2026-10-16 expires, 2026-10-17 stays active/quoted.
    const tt = await ctx.svc.timeTravel({ days: 3 });
    expect(tt).toMatchObject({
      status: "ok",
      service: "carrier-coastal",
      days_advanced: 3,
      transitions: { quotes_expired: 1, policies_expired: 1 },
    });

    const quotes = Object.fromEntries((await ctx.svc.table("quotes")).map((q: any) => [q.quote_id, q.status]));
    const policies = Object.fromEntries((await ctx.svc.table("policies")).map((p: any) => [p.policy_id, p.status]));
    expect(quotes["QT-CSTL-VAL-RAW"]).toBe("expired");
    expect(quotes["QT-CSTL-VAL-EQ"]).toBe("quoted");
    expect(policies["POL-CSTL-VAL-EXP"]).toBe("expired");
    expect(policies["POL-CSTL-VAL-EQ"]).toBe("active");
  });
});
