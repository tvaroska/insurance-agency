import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expectError, expectStatus, type Tables } from "../harness";
import { start, type Ctx } from "./support";

const REPO_ROOT = join(import.meta.dir, "../../..");

function loadFixture(file: string): { description: string; tables: Tables } {
  return JSON.parse(readFileSync(join(REPO_ROOT, "data/validation/rater", file), "utf8"));
}

describe("held-out validation fixtures (data/validation/rater)", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await start();
  }, 30_000);

  test("RTR-R21, RTR-R41, RTR-R110: carrier eligibility filtering, bind conflicts, and time-travel expiry", async () => {
    const fixture = loadFixture("carriers-and-expiry.json");
    await ctx.svc.seed({ base: "empty", tables: fixture.tables });

    // TX homeowners matches both VAL-TX-HOME and VAL-ALL-AUTO -> 2 carriers.
    const txRes = expectStatus(
      await ctx.api.post("/v1/quotes/request", {
        policy_type: "homeowners",
        effective_date: "2026-11-01",
        client: {
          first_name: "Val",
          last_name: "Home",
          address: { street: "1 Main", city: "Austin", state: "TX", zip: "78701" },
        },
        property: { year_built: 2012, square_feet: 2000 },
        requested_coverages: [{ type: "dwelling", limit: "300000" }],
      }),
      202,
    );
    expect(txRes.carriers_queried).toBe(2);

    // CA personal_auto matches only VAL-ALL-AUTO -> 1 carrier.
    const caRes = expectStatus(
      await ctx.api.post("/v1/quotes/request", {
        policy_type: "personal_auto",
        effective_date: "2026-11-01",
        client: {
          first_name: "Val",
          last_name: "Auto",
          address: { street: "2 Oak", city: "LA", state: "CA", zip: "90001" },
        },
        drivers: [{ name: "Val Auto", age: 35 }],
        vehicles: [{ year: 2022, make: "Honda", model: "Civic" }],
        requested_coverages: [{ type: "bodily_injury", limit: "100/300" }],
      }),
      202,
    );
    expect(caRes.carriers_queried).toBe(1);

    // Binding already-bound or expired quote returns 409 CONFLICT.
    const bindBody = {
      payment_method: "eft",
      effective_date: "2026-11-01",
      producer_id: "PROD-1",
      insured_signature_collected: true,
      insured_signature_date: "2026-10-14",
    };
    expectError(await ctx.api.post("/v1/quotes/QT-VAL-ALREADY-BOUND/bind", bindBody), 409, "CONFLICT");
    expectError(await ctx.api.post("/v1/quotes/QT-VAL-EXPIRED/bind", bindBody), 409, "CONFLICT");

    // Time travel +3 days expires QR-VAL-1 and both QT-VAL-EXP-SOON + QT-VAL-EXPIRED.
    const tt = await ctx.svc.timeTravel({ days: 3 });
    expect(tt).toMatchObject({
      status: "ok",
      service: "rater",
      days_advanced: 3,
      transitions: { quote_requests_expired: 1, carrier_quotes_expired: 2 },
    });
  });
});
