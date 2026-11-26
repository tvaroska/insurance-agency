import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expectError, expectStatus, loadContract, type Tables } from "../harness";
import { fnolBody, start, type Ctx } from "./support";

const REPO_ROOT = join(import.meta.dir, "../../..");

interface ValidationFixture {
  description: string;
  tables: Tables;
}

function loadFixture(file: string): ValidationFixture {
  const path = join(REPO_ROOT, "data/validation/claims", file);
  return JSON.parse(readFileSync(path, "utf8")) as ValidationFixture;
}

describe("held-out validation fixtures (data/validation/claims)", () => {
  const contract = loadContract("claims");
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await start();
  }, 30_000);

  test("CLM-R30, CLM-R33, CLM-R34: 120-row pagination with timestamp ties walks every row once", async () => {
    const fixture = loadFixture("stress-pagination.json");
    await ctx.svc.seed({ base: "empty", tables: fixture.tables });

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;

    // Request limit=200 to verify clamping to 100 on the first page.
    while (true) {
      const res = await ctx.api.get("/v1/claims", { query: { limit: 200, cursor } });
      const body = expectStatus(res, 200);
      contract.check(res, { allow: ["query/limit:"] });
      expect(body.pagination.limit).toBe(100);
      for (const row of body.data) seen.push(row.claim_id);
      pages += 1;
      if (!body.pagination.has_more) {
        expect(body.pagination.next_cursor).toBeNull();
        break;
      }
      expect(typeof body.pagination.next_cursor).toBe("string");
      cursor = body.pagination.next_cursor;
      if (pages > 5) throw new Error("pagination did not terminate");
    }

    expect(pages).toBe(2);
    expect(seen.length).toBe(120);
    expect(new Set(seen).size).toBe(120);

    // Filtered cursor walk across tied timestamps.
    const filteredIds: string[] = [];
    cursor = undefined;
    while (true) {
      const res = await ctx.api.get("/v1/claims", {
        query: { status: "investigating", limit: 15, cursor },
      });
      const body = expectStatus(res, 200);
      contract.check(res);
      for (const row of body.data) {
        expect(row.status).toBe("investigating");
        filteredIds.push(row.claim_id);
      }
      if (!body.pagination.has_more) break;
      cursor = body.pagination.next_cursor;
    }
    const expectedInvestigating = fixture.tables.claims.filter((c) => c.status === "investigating").length;
    expect(filteredIds.length).toBe(expectedInvestigating);
    expect(new Set(filteredIds).size).toBe(expectedInvestigating);
  });

  test("CLM-R20, CLM-R51, CLM-R52, CLM-R90, CLM-R110: capacity boundaries, cross-year IDs, and legacy open time-travel", async () => {
    const fixture = loadFixture("capacity-and-edge-cases.json");
    await ctx.svc.seed({ base: "empty", tables: fixture.tables });

    // Adjuster open_claims_count excludes settled & denied claims.
    const adjRes = await ctx.api.get("/v1/adjusters");
    const adjBody = expectStatus(adjRes, 200);
    contract.check(adjRes);
    const byId = Object.fromEntries(adjBody.data.map((a: any) => [a.adjuster_id, a]));
    expect(byId["ADJ-VAL-CAP"].open_claims_count).toBe(2);
    expect(byId["ADJ-VAL-ONE"].open_claims_count).toBe(1);
    expect(byId["ADJ-VAL-OFF"].open_claims_count).toBe(0);

    // Assigning to ADJ-VAL-CAP (2/2 open) fails with out_of_range; ADJ-VAL-OFF fails with invalid_enum.
    const capRes = await ctx.api.post("/v1/claims/CLM-2026-000041/assign", { adjuster_id: "ADJ-VAL-CAP" });
    expectError(capRes, 400, "VALIDATION_ERROR", { field: "adjuster_id", code: "out_of_range" });

    const offRes = await ctx.api.post("/v1/claims/CLM-2026-000041/assign", { adjuster_id: "ADJ-VAL-OFF" });
    expectError(offRes, 400, "VALIDATION_ERROR", { field: "adjuster_id", code: "invalid_enum" });

    // Self-reassigning an open claim already held by ADJ-VAL-ONE (1/1) still fails capacity check.
    const selfRes = await ctx.api.post("/v1/claims/CLM-2026-000040/assign", { adjuster_id: "ADJ-VAL-ONE" });
    expectError(selfRes, 400, "VALIDATION_ERROR", { field: "adjuster_id", code: "out_of_range" });

    // Cross-year sequence: CLM-2025-999999 must be ignored; next 2026 claim is CLM-2026-000043.
    const created = expectStatus(await ctx.api.post("/v1/claims", fnolBody()), 201);
    expect(created.claim_id).toBe("CLM-2026-000043");

    // Time-travel advances reported (41, 43), assigned (40), and legacy open (42) -> 4 claims.
    const tt = await ctx.svc.timeTravel({ days: 2 });
    expect(tt).toMatchObject({
      status: "ok",
      service: "claims",
      days_advanced: 2,
      transitions: { claims_advanced: 4 },
    });
  });
});
