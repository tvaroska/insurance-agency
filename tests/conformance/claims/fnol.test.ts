import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import {
  CLAIM_ID,
  CLAIM_TYPES,
  EVENT_ID,
  ISO_UTC,
  adjuster,
  claim,
  fnolBody,
  seedTables,
  start,
  todayUtc,
  type Ctx,
} from "./support";

const contract = loadContract("claims");
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({ tables: seedTables() });
});

const PATHS = ["/v1/claims", "/v1/claims/fnol"];

for (const path of PATHS) {
  describe(`CLM-R10: POST ${path}`, () => {
    test("CLM-R19, CLM-R21: creates a reported claim and one timeline row, and nothing else", async () => {
      const before = Date.now();
      const { result: res, diff } = await ctx.svc.changes(() =>
        ctx.api.post(path, fnolBody({ loss_location: "12 Elm St", notes: "Caller was the tenant." })),
      );
      expect(res.status).toBe(201);
      contract.check(res);

      expect(res.body).toEqual({
        claim_id: expect.stringMatching(CLAIM_ID),
        policy_id: "POL-9",
        client_id: "CLI-9",
        claim_type: "water",
        status: "reported",
        loss_date: "2024-06-01",
        reported_date: todayUtc(),
        loss_description: "Burst pipe in the basement.",
        loss_location: "12 Elm St",
        reserve_amount: null,
        settlement_amount: null,
        adjuster_id: null,
        notes: "Caller was the tenant.",
        created_at: expect.stringMatching(ISO_UTC),
        updated_at: res.body.created_at,
      });
      expect(Date.parse(res.body.created_at)).toBeGreaterThanOrEqual(before - 1000);

      expect(Object.keys(diff).sort()).toEqual(["claim_timeline", "claims"]);
      expect(diff.claims.added).toEqual([res.body]);
      expect(diff.claim_timeline.added).toEqual([
        {
          event_id: expect.stringMatching(EVENT_ID),
          claim_id: res.body.claim_id,
          event_type: "status_change",
          description: "Claim filed — status set to reported.",
          old_value: null,
          new_value: "reported",
          created_by: null,
          created_at: expect.stringMatching(ISO_UTC),
        },
      ]);
    });

    test("CLM-R19: optional fields default to null", async () => {
      const res = await ctx.api.post(path, fnolBody());
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ loss_location: null, notes: null, reserve_amount: null, adjuster_id: null });
    });

    test("CLM-R11: loss_type, description and estimated_loss stand in for the canonical names", async () => {
      const res = await ctx.api.post(path, {
        policy_id: "POL-9",
        client_id: "CLI-9",
        loss_type: "theft",
        loss_date: "2024-06-01",
        description: "Bike stolen from garage.",
        estimated_loss: 750.5,
      });
      expect(res.status).toBe(201);
      contract.check(res);
      expect(res.body).toMatchObject({
        claim_type: "theft",
        loss_description: "Bike stolen from garage.",
        reserve_amount: 750.5,
      });
    });

    test("CLM-R11: a canonical name wins over its alias", async () => {
      const res = await ctx.api.post(
        path,
        fnolBody({ loss_type: "theft", description: "alias text", reserve_amount: 100, estimated_loss: 999 }),
      );
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        claim_type: "water",
        loss_description: "Burst pipe in the basement.",
        reserve_amount: 100,
      });
    });

    test("CLM-R12: each required field is reported when missing, null or empty", async () => {
      for (const field of ["policy_id", "client_id", "claim_type", "loss_date", "loss_description"]) {
        for (const value of [undefined, null, ""]) {
          const { result, diff } = await ctx.svc.changes(() => ctx.api.post(path, fnolBody({ [field]: value })));
          expectError(result, 400, "VALIDATION_ERROR", { field, code: "required" });
          contract.check(result);
          expect(diff).toEqual({});
        }
      }
    });

    test("CLM-R12: all missing required fields are reported in one response", async () => {
      const res = await ctx.api.post(path, {});
      expectError(
        res,
        400,
        "VALIDATION_ERROR",
        { field: "policy_id", code: "required" },
        { field: "client_id", code: "required" },
        { field: "claim_type", code: "required" },
        { field: "loss_date", code: "required" },
        { field: "loss_description", code: "required" },
      );
      expect(res.body.details).toHaveLength(5);
    });

    test("CLM-R13: claim_type must be one of the nine claim types", async () => {
      for (const claim_type of CLAIM_TYPES) {
        const ok = await ctx.api.post(path, fnolBody({ claim_type }));
        expect(ok.status).toBe(201);
        expect(ok.body.claim_type).toBe(claim_type);
      }
      const bad = await ctx.api.post(path, fnolBody({ claim_type: "flood" }));
      expectError(bad, 400, "VALIDATION_ERROR", { field: "claim_type", code: "invalid_enum" });
      const viaAlias = await ctx.api.post(path, fnolBody({ claim_type: undefined, loss_type: "flood" }));
      expectError(viaAlias, 400, "VALIDATION_ERROR", { field: "claim_type", code: "invalid_enum" });
    });

    test("CLM-R14: loss_date must look like YYYY-MM-DD", async () => {
      for (const loss_date of ["06/01/2024", "2024-6-1", "2024-06-01T00:00:00Z", "yesterday"]) {
        const res = await ctx.api.post(path, fnolBody({ loss_date }));
        expectError(res, 400, "VALIDATION_ERROR", { field: "loss_date", code: "invalid_format" });
      }
    });

    test("CLM-R14: a well-formed loss_date is stored as sent, without a calendar check", async () => {
      const res = await ctx.api.post(path, fnolBody({ loss_date: "2024-02-31" }));
      expect(res.status).toBe(201);
      expect(res.body.loss_date).toBe("2024-02-31");
    });

    test("CLM-R15: loss_description over 5000 and loss_location over 500 characters are too long", async () => {
      const edge = await ctx.api.post(
        path,
        fnolBody({ loss_description: "d".repeat(5000), loss_location: "l".repeat(500) }),
      );
      expect(edge.status).toBe(201);
      const res = await ctx.api.post(
        path,
        fnolBody({ loss_description: "d".repeat(5001), loss_location: "l".repeat(501) }),
      );
      expectError(
        res,
        400,
        "VALIDATION_ERROR",
        { field: "loss_description", code: "too_long" },
        { field: "loss_location", code: "too_long" },
      );
    });

    test("CLM-R16: a negative loss estimate is out of range, zero is accepted", async () => {
      const viaAlias = await ctx.api.post(path, fnolBody({ estimated_loss: -1 }));
      expectError(viaAlias, 400, "VALIDATION_ERROR", { field: "reserve_amount", code: "out_of_range" });
      const direct = await ctx.api.post(path, fnolBody({ reserve_amount: -0.01 }));
      expectError(direct, 400, "VALIDATION_ERROR", { field: "reserve_amount", code: "out_of_range" });
      const zero = await ctx.api.post(path, fnolBody({ estimated_loss: 0 }));
      expect(zero.status).toBe(201);
      expect(zero.body.reserve_amount).toBe(0);
    });

    test("CLM-R17: a loss_date after today (UTC) is out of range, today is accepted", async () => {
      const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      const { result, diff } = await ctx.svc.changes(() => ctx.api.post(path, fnolBody({ loss_date: tomorrow })));
      expectError(result, 400, "VALIDATION_ERROR", { field: "loss_date", code: "out_of_range" });
      expect(diff).toEqual({});

      const today = await ctx.api.post(path, fnolBody({ loss_date: todayUtc() }));
      expect(today.status).toBe(201);
    });

    test("CLM-R17: the future-date check runs only after the field checks pass", async () => {
      const res = await ctx.api.post(path, fnolBody({ loss_date: "2999-01-01", claim_type: "flood" }));
      expectError(res, 400, "VALIDATION_ERROR", { field: "claim_type", code: "invalid_enum" });
      expect(res.body.details.map((d: any) => d.field)).not.toContain("loss_date");
    });

    test("CLM-R18: an unknown adjuster_id is 404 and writes nothing", async () => {
      const { result, diff } = await ctx.svc.changes(() => ctx.api.post(path, fnolBody({ adjuster_id: "ADJ-NOPE" })));
      expectError(result, 404, "NOT_FOUND");
      expect(result.body.message).toBe("adjuster not found.");
      expect(diff).toEqual({});
    });

    test("CLM-R18: an inactive adjuster_id is a validation error", async () => {
      const { result, diff } = await ctx.svc.changes(() => ctx.api.post(path, fnolBody({ adjuster_id: "ADJ-OFF" })));
      expectError(result, 400, "VALIDATION_ERROR", { field: "adjuster_id", code: "invalid_enum" });
      expect(diff).toEqual({});
    });

    test("CLM-R18: the adjuster check runs after the future-date check", async () => {
      const res = await ctx.api.post(path, fnolBody({ adjuster_id: "ADJ-NOPE", loss_date: "2999-01-01" }));
      expectError(res, 400, "VALIDATION_ERROR", { field: "loss_date", code: "out_of_range" });
    });

    test("CLM-R18, CLM-R19: an active adjuster_id is stored (trimmed) but the claim stays reported", async () => {
      const { result: res, diff } = await ctx.svc.changes(() => ctx.api.post(path, fnolBody({ adjuster_id: " ADJ-A " })));
      expect(res.status).toBe(201);
      contract.check(res);
      expect(res.body).toMatchObject({ adjuster_id: "ADJ-A", status: "reported" });
      expect(diff.claim_timeline.added.map((e) => e.event_type)).toEqual(["status_change"]);
    });

    test("CLM-R18: a blank or non-string adjuster_id is ignored", async () => {
      for (const adjuster_id of ["", "   ", 42, null]) {
        const res = await ctx.api.post(path, fnolBody({ adjuster_id }));
        expect(res.status).toBe(201);
        expect(res.body.adjuster_id).toBeNull();
      }
    });

    test("CLM-R18: intake does not check the adjuster's capacity", async () => {
      await ctx.svc.seed({
        tables: {
          adjusters: [adjuster({ max_open_claims: 1 })],
          claims: [claim({ adjuster_id: "ADJ-A", status: "assigned" })],
        },
      });
      const res = await ctx.api.post(path, fnolBody({ adjuster_id: "ADJ-A" }));
      expect(res.status).toBe(201);
      expect(res.body.adjuster_id).toBe("ADJ-A");
    });

    test("CLM-R20: claim ids are CLM-<current year>-<six digit sequence>, starting at 000001", async () => {
      const year = new Date().getFullYear();
      const first = await ctx.api.post(path, fnolBody());
      const second = await ctx.api.post(path, fnolBody());
      expect(first.body.claim_id).toBe(`CLM-${year}-000001`);
      expect(second.body.claim_id).toBe(`CLM-${year}-000002`);
    });

    test("CLM-R20: the sequence continues after the highest id of the current year and ignores other years", async () => {
      const year = new Date().getFullYear();
      await ctx.svc.seed({
        tables: seedTables([
          claim({ claim_id: `CLM-${year}-000041` }),
          claim({ claim_id: `CLM-${year}-000007` }),
          claim({ claim_id: `CLM-${year - 1}-000900` }),
        ]),
      });
      const res = await ctx.api.post(path, fnolBody());
      expect(res.body.claim_id).toBe(`CLM-${year}-000042`);
    });

    test("CLM-R20: when the id that sorts last is not numeric, the count of this year's ids sets the sequence", async () => {
      const year = new Date().getFullYear();
      await ctx.svc.seed({
        tables: seedTables([claim({ claim_id: `CLM-${year}-000001` }), claim({ claim_id: `CLM-${year}-zzzzzz` })]),
      });
      const res = await ctx.api.post(path, fnolBody());
      expect(res.body.claim_id).toBe(`CLM-${year}-000003`);
    });

    test("CLM-R20: the count wins when it is larger than the highest number", async () => {
      const year = new Date().getFullYear();
      await ctx.svc.seed({
        tables: seedTables([
          claim({ claim_id: `CLM-${year}-00000a` }),
          claim({ claim_id: `CLM-${year}-00000b` }),
          claim({ claim_id: `CLM-${year}-000002` }),
        ]),
      });
      const res = await ctx.api.post(path, fnolBody());
      expect(res.body.claim_id).toBe(`CLM-${year}-000004`);
    });

    test("CLM-R12: an empty claim_type or loss_date is reported as required and as invalid", async () => {
      const res = await ctx.api.post(path, fnolBody({ claim_type: "", loss_date: "" }));
      expect(res.body.details.map((d: any) => [d.field, d.code])).toEqual([
        ["claim_type", "required"],
        ["loss_date", "required"],
        ["claim_type", "invalid_enum"],
        ["loss_date", "invalid_format"],
      ]);
    });
  });
}

test.todo(
  "CLM-G02: specs/claims.behavior.yaml names the length error code max_length; the service sends too_long (CLM-R15)",
);
test.todo(
  "CLM-G03: a stored loss_date such as 2024-02-31 breaks `format: date` of Claim.loss_date in specs/claims.yaml (CLM-R14)",
);
test.todo(
  "CLM-G04: specs/claims.yaml says adjuster_id is used to 'assign immediately'; the service keeps status reported and writes no assignment event (CLM-R19)",
);
