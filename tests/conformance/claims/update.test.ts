import { beforeAll, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { CLAIM_STATUSES, EVENT_ID, ISO_UTC, TRANSITIONS, claim, seedTables, start, type Ctx } from "./support";

const contract = loadContract("claims");
let ctx: Ctx;
const ID = "CLM-2024-000001";
const patch = (body: unknown, claimId = ID) => ctx.api.patch(`/v1/claims/${claimId}`, body);
const seedOne = (overrides: Record<string, unknown> = {}) => ctx.svc.seed({ tables: seedTables([claim(overrides)]) });

beforeAll(async () => {
  ctx = await start();
}, 30_000);

describe("PATCH /v1/claims/{claim_id}: validation", () => {
  test("CLM-R60: a body without status, reserve_amount, settlement_amount or notes is rejected", async () => {
    await seedOne();
    for (const body of [{}, { adjuster_id: "ADJ-B" }, { claim_type: "theft", loss_date: "2024-01-01" }]) {
      const { result, diff } = await ctx.svc.changes(() => patch(body));
      expectError(result, 400, "VALIDATION_ERROR", { field: "body", code: "required" });
      contract.check(result);
      expect(diff).toEqual({});
    }
  });

  test("CLM-R60: the empty-body check comes before the claim is looked up", async () => {
    await seedOne();
    expectError(await patch({}, "CLM-0000-000000"), 400, "VALIDATION_ERROR", { field: "body", code: "required" });
  });

  test("CLM-R61: bad field values are reported together, before the claim is looked up", async () => {
    await seedOne();
    const res = await patch(
      { status: "closed", reserve_amount: -1, settlement_amount: -0.5, notes: "n".repeat(5001) },
      "CLM-0000-000000",
    );
    expectError(
      res,
      400,
      "VALIDATION_ERROR",
      { field: "status", code: "invalid_enum" },
      { field: "reserve_amount", code: "out_of_range" },
      { field: "settlement_amount", code: "out_of_range" },
      { field: "notes", code: "too_long" },
    );
    expect(res.body.details).toHaveLength(4);
    contract.check(res);
  });

  test("CLM-R61: zero amounts and 5000-character notes are accepted", async () => {
    await seedOne();
    const res = await patch({ reserve_amount: 0, settlement_amount: 0, notes: "n".repeat(5000) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reserve_amount: 0, settlement_amount: 0 });
  });

  test("CLM-R62: an unknown claim is 404 NOT_FOUND", async () => {
    await seedOne();
    const res = await patch({ notes: "x" }, "CLM-0000-000000");
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("claim not found.");
    contract.check(res);
  });
});

describe("PATCH /v1/claims/{claim_id}: status state machine", () => {
  for (const from of CLAIM_STATUSES) {
    for (const to of CLAIM_STATUSES) {
      if (from === to) {
        test(`CLM-R63: ${from} -> ${to} (same status) succeeds and writes no event`, async () => {
          await seedOne({ status: from });
          const { result, diff } = await ctx.svc.changes(() => patch({ status: to }));
          expect(result.status).toBe(200);
          expect(result.body.status).toBe(from);
          expect(Object.keys(diff)).toEqual(["claims"]);
          expect(diff.claims.changed[0].fields).toEqual(["updated_at"]);
        });
      } else if (TRANSITIONS[from].includes(to)) {
        test(`CLM-R63, CLM-R65: ${from} -> ${to} is allowed and writes a status_change event`, async () => {
          await seedOne({ status: from });
          const { result, diff } = await ctx.svc.changes(() => patch({ status: to }));
          expect(result.status).toBe(200);
          contract.check(result);
          expect(result.body.status).toBe(to);
          expect(diff.claims.changed[0].fields.sort()).toEqual(["status", "updated_at"]);
          expect(diff.claim_timeline.added).toEqual([
            {
              event_id: expect.stringMatching(EVENT_ID),
              claim_id: ID,
              event_type: "status_change",
              description: `Status changed from ${from} to ${to}.`,
              old_value: from,
              new_value: to,
              created_by: null,
              created_at: expect.stringMatching(ISO_UTC),
            },
          ]);
        });
      } else {
        test(`CLM-R63: ${from} -> ${to} is rejected and writes nothing`, async () => {
          await seedOne({ status: from });
          const { result, diff } = await ctx.svc.changes(() => patch({ status: to, notes: "should not be saved" }));
          expectError(result, 400, "VALIDATION_ERROR", { field: "status", code: "invalid_enum" });
          expect(result.body.details[0].message).toBe(`Cannot transition from '${from}' to '${to}'.`);
          contract.check(result);
          expect(diff).toEqual({});
        });
      }
    }
  }

  test("CLM-R61, CLM-R63: a null status passes the field checks and is then refused as a transition", async () => {
    for (const from of CLAIM_STATUSES) {
      await seedOne({ status: from });
      const { result, diff } = await ctx.svc.changes(() => patch({ status: null, notes: "should not be saved" }));
      expectError(result, 400, "VALIDATION_ERROR", { field: "status", code: "invalid_enum" });
      expect(result.body.details[0].message).toBe(`Cannot transition from '${from}' to 'null'.`);
      expect(diff).toEqual({});
    }
    await seedOne();
    expectError(await patch({ status: null }, "CLM-0000-000000"), 404, "NOT_FOUND");
  });

  test("CLM-R64: moving to assigned does not require an adjuster, and settling does not require an amount", async () => {
    await seedOne({ status: "reported" });
    const assigned = await patch({ status: "assigned" });
    expect(assigned.body).toMatchObject({ status: "assigned", adjuster_id: null });

    await seedOne({ status: "reserved" });
    const settled = await patch({ status: "settled" });
    expect(settled.body).toMatchObject({ status: "settled", settlement_amount: null });
  });
});

describe("PATCH /v1/claims/{claim_id}: fields and timeline", () => {
  test("CLM-R64: only the four updatable fields change; other body fields are ignored", async () => {
    await seedOne({ adjuster_id: "ADJ-A", status: "assigned" });
    const { result: res, diff } = await ctx.svc.changes(() =>
      patch({
        notes: "Spoke with insured.",
        settlement_amount: 10,
        adjuster_id: "ADJ-B",
        claim_type: "theft",
        policy_id: "POL-OTHER",
        loss_date: "2020-01-01",
        claim_id: "CLM-2024-999999",
      }),
    );
    expect(res.status).toBe(200);
    contract.check(res);
    expect(res.body).toEqual({
      ...claim({ adjuster_id: "ADJ-A", status: "assigned" }),
      notes: "Spoke with insured.",
      settlement_amount: 10,
      updated_at: expect.stringMatching(ISO_UTC),
    });
    expect(res.body.updated_at > claim().updated_at).toBe(true);
    expect(diff.claims.added).toEqual([]);
    expect(diff.claims.changed[0].after).toEqual(res.body);
  });

  test("CLM-R64: null clears reserve_amount, settlement_amount and notes", async () => {
    await seedOne({ reserve_amount: 500, settlement_amount: 400, notes: "old" });
    const res = await patch({ reserve_amount: null, settlement_amount: null, notes: null });
    expect(res.status).toBe(200);
    contract.check(res);
    expect(res.body).toMatchObject({ reserve_amount: null, settlement_amount: null, notes: null });
  });

  test("CLM-R65: a reserve change writes reserve_change with old and new values as strings", async () => {
    await seedOne({ reserve_amount: 1000 });
    const { diff } = await ctx.svc.changes(() => patch({ reserve_amount: 2500.5 }));
    expect(diff.claim_timeline.added).toEqual([
      {
        event_id: expect.stringMatching(EVENT_ID),
        claim_id: ID,
        event_type: "reserve_change",
        description: "Reserve amount changed from 1000 to 2500.5.",
        old_value: "1000",
        new_value: "2500.5",
        created_by: null,
        created_at: expect.stringMatching(ISO_UTC),
      },
    ]);
  });

  test("CLM-R65: a first reserve has old_value null, and clearing a reserve has new_value null", async () => {
    await seedOne({ reserve_amount: null });
    const first = await ctx.svc.changes(() => patch({ reserve_amount: 300 }));
    expect(first.diff.claim_timeline.added[0]).toMatchObject({
      event_type: "reserve_change",
      description: "Reserve amount changed from none to 300.",
      old_value: null,
      new_value: "300",
    });
    const cleared = await ctx.svc.changes(() => patch({ reserve_amount: null }));
    expect(cleared.diff.claim_timeline.added[0]).toMatchObject({
      event_type: "reserve_change",
      description: "Reserve amount changed from 300 to null.",
      old_value: "300",
      new_value: null,
    });
  });

  test("CLM-R65: a notes change writes a note event without values", async () => {
    await seedOne({ notes: "old" });
    const { diff } = await ctx.svc.changes(() => patch({ notes: "new" }));
    expect(diff.claim_timeline.added).toEqual([
      {
        event_id: expect.stringMatching(EVENT_ID),
        claim_id: ID,
        event_type: "note",
        description: "Notes updated.",
        old_value: null,
        new_value: null,
        created_by: null,
        created_at: expect.stringMatching(ISO_UTC),
      },
    ]);
  });

  test("CLM-R65: unchanged values and settlement_amount write no event", async () => {
    await seedOne({ status: "reserved", reserve_amount: 1000, notes: "same", settlement_amount: 5 });
    const { result, diff } = await ctx.svc.changes(() =>
      patch({ status: "reserved", reserve_amount: 1000, notes: "same", settlement_amount: 900 }),
    );
    expect(result.status).toBe(200);
    expect(result.body.settlement_amount).toBe(900);
    expect(Object.keys(diff)).toEqual(["claims"]);
    expect(diff.claims.changed[0].fields.sort()).toEqual(["settlement_amount", "updated_at"]);
  });

  test("CLM-R65: one request that changes status, reserve and notes writes one event of each type", async () => {
    await seedOne({ status: "investigating" });
    const { result, diff } = await ctx.svc.changes(() =>
      patch({ status: "reserved", reserve_amount: 12000, notes: "Reserve set." }),
    );
    expect(result.status).toBe(200);
    const events = diff.claim_timeline.added as any[];
    expect(events.map((e) => e.event_type).sort()).toEqual(["note", "reserve_change", "status_change"]);
    const at = (type: string) => events.find((e) => e.event_type === type).created_at;
    expect(at("status_change") <= at("reserve_change")).toBe(true);
    expect(at("reserve_change") <= at("note")).toBe(true);
  });
});
