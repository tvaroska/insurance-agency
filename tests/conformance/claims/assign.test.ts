import { beforeAll, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { CLAIM_STATUSES, EVENT_ID, ISO_UTC, adjuster, claim, seedTables, start, type Ctx } from "./support";

const contract = loadContract("claims");
let ctx: Ctx;
const ID = "CLM-2024-000001";
const assign = (claimId: string, body: unknown) => ctx.api.post(`/v1/claims/${claimId}/assign`, body);

beforeAll(async () => {
  ctx = await start();
}, 30_000);

describe("POST /v1/claims/{claim_id}/assign", () => {
  test("CLM-R50: adjuster_id is required, and that is checked before the claim is looked up", async () => {
    await ctx.svc.seed({ tables: seedTables([claim()]) });
    for (const body of [{}, { adjuster_id: null }, { adjuster_id: "" }]) {
      const res = await assign("CLM-0000-000000", body);
      expectError(res, 400, "VALIDATION_ERROR", { field: "adjuster_id", code: "required" });
      contract.check(res);
    }
  });

  test("CLM-R50: an unknown claim is 404 before the adjuster is looked up", async () => {
    await ctx.svc.seed({ tables: seedTables([claim()]) });
    const res = await assign("CLM-0000-000000", { adjuster_id: "ADJ-NOPE" });
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("claim not found.");
    contract.check(res);
  });

  test("CLM-R50: an unknown adjuster is 404 and writes nothing", async () => {
    await ctx.svc.seed({ tables: seedTables([claim()]) });
    const { result, diff } = await ctx.svc.changes(() => assign(ID, { adjuster_id: "ADJ-NOPE" }));
    expectError(result, 404, "NOT_FOUND");
    expect(result.body.message).toBe("adjuster not found.");
    expect(diff).toEqual({});
  });

  test("CLM-R51: an inactive adjuster is rejected and nothing is written", async () => {
    await ctx.svc.seed({ tables: seedTables([claim()]) });
    const { result, diff } = await ctx.svc.changes(() => assign(ID, { adjuster_id: "ADJ-OFF" }));
    expectError(result, 400, "VALIDATION_ERROR", { field: "adjuster_id", code: "invalid_enum" });
    contract.check(result);
    expect(diff).toEqual({});
  });

  test("CLM-R51: the inactive check comes before the capacity check", async () => {
    await ctx.svc.seed({
      tables: {
        adjusters: [adjuster({ active: 0, max_open_claims: 0 })],
        claims: [claim()],
      },
    });
    const res = await assign(ID, { adjuster_id: "ADJ-A" });
    expectError(res, 400, "VALIDATION_ERROR", { field: "adjuster_id", code: "invalid_enum" });
    expect(res.body.details).toHaveLength(1);
  });

  test("CLM-R52: an adjuster at max_open_claims is rejected; settled and denied claims do not count", async () => {
    const load = (openStatus: string) => ({
      adjusters: [adjuster({ max_open_claims: 2 })],
      claims: [
        claim(),
        claim({ claim_id: "CLM-2024-000002", adjuster_id: "ADJ-A", status: "investigating" }),
        claim({ claim_id: "CLM-2024-000003", adjuster_id: "ADJ-A", status: openStatus }),
        claim({ claim_id: "CLM-2024-000004", adjuster_id: "ADJ-A", status: "settled" }),
        claim({ claim_id: "CLM-2024-000005", adjuster_id: "ADJ-A", status: "denied" }),
      ],
    });

    for (const status of ["reported", "assigned", "investigating", "reserved"]) {
      await ctx.svc.seed({ tables: load(status) });
      const { result, diff } = await ctx.svc.changes(() => assign(ID, { adjuster_id: "ADJ-A" }));
      expectError(result, 400, "VALIDATION_ERROR", { field: "adjuster_id", code: "out_of_range" });
      contract.check(result);
      expect(diff).toEqual({});
    }
    for (const status of ["settled", "denied"]) {
      await ctx.svc.seed({ tables: load(status) });
      const res = await assign(ID, { adjuster_id: "ADJ-A" });
      expect(res.status).toBe(200);
    }
  });

  test("CLM-R52: the claim being assigned counts when it is already open with that adjuster", async () => {
    await ctx.svc.seed({
      tables: {
        adjusters: [adjuster({ max_open_claims: 1 })],
        claims: [claim({ adjuster_id: "ADJ-A", status: "assigned" })],
      },
    });
    const res = await assign(ID, { adjuster_id: "ADJ-A" });
    expectError(res, 400, "VALIDATION_ERROR", { field: "adjuster_id", code: "out_of_range" });
  });

  test("CLM-R53, CLM-R54: assigning a reported claim sets the adjuster, moves it to assigned and writes two events", async () => {
    await ctx.svc.seed({ tables: seedTables([claim(), claim({ claim_id: "CLM-2024-000002" })]) });
    const { result: res, diff } = await ctx.svc.changes(() => assign(ID, { adjuster_id: "ADJ-B" }));
    expect(res.status).toBe(200);
    contract.check(res);
    expect(res.body).toEqual({
      ...claim(),
      adjuster_id: "ADJ-B",
      status: "assigned",
      updated_at: expect.stringMatching(ISO_UTC),
    });
    expect(res.body.updated_at > claim().updated_at).toBe(true);

    expect(Object.keys(diff).sort()).toEqual(["claim_timeline", "claims"]);
    expect(diff.claims.added).toEqual([]);
    expect(diff.claims.changed).toHaveLength(1);
    expect(diff.claims.changed[0].after).toEqual(res.body);
    expect(diff.claims.changed[0].fields.sort()).toEqual(["adjuster_id", "status", "updated_at"]);

    const events = diff.claim_timeline.added.sort((a: any, b: any) => a.event_type.localeCompare(b.event_type));
    expect(events).toEqual([
      {
        event_id: expect.stringMatching(EVENT_ID),
        claim_id: ID,
        event_type: "assignment",
        description: "Adjuster Ben Baker assigned.",
        old_value: null,
        new_value: "ADJ-B",
        created_by: null,
        created_at: expect.stringMatching(ISO_UTC),
      },
      {
        event_id: expect.stringMatching(EVENT_ID),
        claim_id: ID,
        event_type: "status_change",
        description: "Status changed from reported to assigned.",
        old_value: "reported",
        new_value: "assigned",
        created_by: null,
        created_at: expect.stringMatching(ISO_UTC),
      },
    ]);
    expect((events[0] as any).created_at <= (events[1] as any).created_at).toBe(true);
  });

  for (const status of CLAIM_STATUSES.filter((s) => s !== "reported")) {
    test(`CLM-R53, CLM-R54: reassigning a claim in status ${status} keeps the status and writes one assignment event`, async () => {
      await ctx.svc.seed({ tables: seedTables([claim({ status, adjuster_id: "ADJ-A" })]) });
      const { result: res, diff } = await ctx.svc.changes(() => assign(ID, { adjuster_id: "ADJ-B" }));
      expect(res.status).toBe(200);
      contract.check(res);
      expect(res.body).toMatchObject({ status, adjuster_id: "ADJ-B" });
      expect(diff.claims.changed[0].fields.sort()).toEqual(["adjuster_id", "updated_at"]);
      expect(diff.claim_timeline.added).toHaveLength(1);
      expect(diff.claim_timeline.added[0]).toMatchObject({
        event_type: "assignment",
        old_value: "ADJ-A",
        new_value: "ADJ-B",
        description: "Adjuster Ben Baker assigned.",
      });
    });
  }
});
