import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { book, fieldCodes, ISO_UTC, POLICY_GAPS, POLICY_ID, policyBody, start, type Ctx } from "./support";

const contract = loadContract("ams");
let ctx: Ctx;

const POLICY_TYPES =
  "personal_auto, homeowners, renters, umbrella, bop, workers_comp, general_liability, professional_liability";
const POLICY_STATUSES = "active, pending, cancelled, expired, non_renewed";

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({ tables: book() });
});

const ids = (res: { body: any }) => res.body.data.map((p: any) => p.policy_id);

describe("listPolicies", () => {
  test("AMS-R42: policies are sorted by expiration date, latest first, then by policy id descending", async () => {
    const res = await ctx.api.get("/v1/policies");
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([
      "POL-B-AUTO",
      "POL-D-AUTO",
      "POL-A-HOME",
      "POL-A-AUTO",
      "POL-C-OLD",
      "POL-C-NR",
      "POL-C-CAN",
      "POL-C-EXP",
    ]);
    contract.check(res, { allow: [...POLICY_GAPS, "is missing required property 'coverages'"] });
  });

  test("AMS-R42: list items are the policy columns, without coverages", async () => {
    const res = await ctx.api.get("/v1/policies", { query: { client_id: "CLI-B" } });
    expect(res.body.data).toEqual([
      {
        policy_id: "POL-B-AUTO",
        client_id: "CLI-B",
        carrier_code: "SMIT",
        policy_type: "personal_auto",
        effective_date: "2026-03-01",
        expiration_date: "2027-03-01",
        premium_current: 500,
        premium_prior: null,
        status: "pending",
        multi_policy_discount: false,
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:00:00.000Z",
      },
    ]);
  });

  test("AMS-R43: status, client_id and policy_type filter exactly and combine with AND", async () => {
    expect(ids(await ctx.api.get("/v1/policies", { query: { status: "pending" } }))).toEqual(["POL-B-AUTO"]);
    expect(ids(await ctx.api.get("/v1/policies", { query: { status: "non_renewed" } }))).toEqual(["POL-C-NR"]);
    expect(ids(await ctx.api.get("/v1/policies", { query: { client_id: "CLI-A" } }))).toEqual(["POL-A-HOME", "POL-A-AUTO"]);
    expect(ids(await ctx.api.get("/v1/policies", { query: { policy_type: "renters" } }))).toEqual(["POL-C-EXP"]);
    expect(ids(await ctx.api.get("/v1/policies", { query: { client_id: "CLI-A", policy_type: "homeowners" } }))).toEqual(["POL-A-HOME"]);
    expect(ids(await ctx.api.get("/v1/policies", { query: { client_id: "CLI-A", status: "pending" } }))).toEqual([]);
  });

  test("AMS-R43, AMS-R2: expiration_before and expiration_after are inclusive string comparisons", async () => {
    expect(ids(await ctx.api.get("/v1/policies", { query: { expiration_before: "2025-06-01" } }))).toEqual(["POL-C-CAN", "POL-C-EXP"]);
    expect(ids(await ctx.api.get("/v1/policies", { query: { expiration_after: "2026-09-01" } }))).toEqual([
      "POL-B-AUTO",
      "POL-D-AUTO",
      "POL-A-HOME",
    ]);
    expect(
      ids(await ctx.api.get("/v1/policies", { query: { expiration_after: "2026-01-01", expiration_before: "2026-06-01" } })),
    ).toEqual(["POL-A-AUTO", "POL-C-OLD"]);
    // Not validated: a partial date still compares as text.
    expect(ids(await ctx.api.get("/v1/policies", { query: { expiration_after: "2027" } }))).toEqual(["POL-B-AUTO"]);
    expect((await ctx.api.get("/v1/policies", { query: { expiration_before: "garbage" } })).status).toBe(200);
  });

  test("AMS-R44: status is validated first and reported alone; then policy_type", async () => {
    const both = await ctx.api.get("/v1/policies", { query: { status: "lapsed", policy_type: "boat" } });
    expectError(both, 400, "VALIDATION_ERROR");
    expect(both.body.details).toEqual([
      { field: "status", message: `status must be one of: ${POLICY_STATUSES}.`, code: "invalid_enum" },
    ]);
    contract.check(both);

    const type = await ctx.api.get("/v1/policies", { query: { status: "active", policy_type: "boat" } });
    expect(type.body.details).toEqual([
      { field: "policy_type", message: `policy_type must be one of: ${POLICY_TYPES}.`, code: "invalid_enum" },
    ]);
  });

  test("AMS-R44: empty filter values are ignored", async () => {
    const res = await ctx.api.get("/v1/policies", { query: { status: "", policy_type: "" } });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(8);
  });
});

describe("getPolicyById", () => {
  test("AMS-R45: returns the policy with its full coverage rows", async () => {
    const res = await ctx.api.get("/v1/policies/POL-A-AUTO");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      policy_id: "POL-A-AUTO",
      client_id: "CLI-A",
      carrier_code: "SMIT",
      policy_type: "personal_auto",
      effective_date: "2025-06-01",
      expiration_date: "2026-06-01",
      premium_current: 1000,
      premium_prior: 900,
      status: "active",
      multi_policy_discount: true,
    });
    expect(res.body.coverages.map(({ id, ...rest }: any) => rest)).toEqual([
      { policy_id: "POL-A-AUTO", type: "bodily_injury", limit: "100000/300000", deductible: null },
      { policy_id: "POL-A-AUTO", type: "property_damage", limit: "50000", deductible: null },
      { policy_id: "POL-A-AUTO", type: "collision", limit: null, deductible: 500 },
    ]);
    for (const cov of res.body.coverages) expect(Number.isInteger(cov.id)).toBe(true);
    contract.check(res, { allow: POLICY_GAPS });
  });

  test("AMS-R45: a policy without coverages returns an empty array; an unknown id is 404", async () => {
    expect((await ctx.api.get("/v1/policies/POL-C-EXP")).body.coverages).toEqual([]);
    const res = await ctx.api.get("/v1/policies/POL-ZZ");
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("policy not found.");
  });
});

describe("createPolicy validation", () => {
  test("AMS-R46: step 1 reports required fields, enums and date formats together, in order", async () => {
    const empty = await ctx.api.post("/v1/policies", {});
    expectError(empty, 400, "VALIDATION_ERROR");
    expect(empty.body.details).toEqual(
      ["client_id", "policy_type", "carrier_code", "effective_date", "expiration_date", "annual_premium"].map((field) => ({
        field,
        message: `${field} is required.`,
        code: "required",
      })),
    );
    contract.check(empty);

    const bad = await ctx.api.post(
      "/v1/policies",
      policyBody({ policy_type: "boat", status: "lapsed", effective_date: "03/01/2026", expiration_date: "next year" }),
    );
    expect(bad.body.details).toEqual([
      { field: "policy_type", message: `policy_type must be one of: ${POLICY_TYPES}.`, code: "invalid_enum" },
      { field: "status", message: `status must be one of: ${POLICY_STATUSES}.`, code: "invalid_enum" },
      { field: "effective_date", message: "effective_date must be YYYY-MM-DD.", code: "invalid_format" },
      { field: "expiration_date", message: "expiration_date must be YYYY-MM-DD.", code: "invalid_format" },
    ]);
  });

  test("AMS-R15, AMS-R46: a required field sent as an empty string yields only 'required'", async () => {
    const res = await ctx.api.post("/v1/policies", policyBody({ policy_type: "", effective_date: "", expiration_date: "", status: "" }));
    expect(fieldCodes(res)).toEqual(["policy_type:required", "effective_date:required", "expiration_date:required", "status:invalid_enum"]);
  });

  test("AMS-R47: annual_premium must be a non-negative JSON number; zero is allowed", async () => {
    for (const annual_premium of [-1, "1200"]) {
      const res = await ctx.api.post("/v1/policies", policyBody({ annual_premium }));
      expectError(res, 400, "VALIDATION_ERROR");
      expect(res.body.details).toEqual([
        { field: "annual_premium", message: "annual_premium must be a non-negative number.", code: "invalid" },
      ]);
    }
    const zero = await ctx.api.post("/v1/policies", policyBody({ annual_premium: 0 }));
    expect(zero.status).toBe(201);
    expect(zero.body.annual_premium).toBe(0);
  });

  test("AMS-R47: step 2 runs only after step 1 passes", async () => {
    const res = await ctx.api.post("/v1/policies", policyBody({ annual_premium: -1, policy_type: "boat" }));
    expect(fieldCodes(res)).toEqual(["policy_type:invalid_enum"]);
  });

  test("AMS-R48: coverages must be a non-empty array", async () => {
    for (const coverages of [undefined, [], "dwelling", { type: "dwelling" }]) {
      const res = await ctx.api.post("/v1/policies", policyBody({ coverages }));
      expectError(res, 400, "VALIDATION_ERROR");
      expect(res.body.details).toEqual([
        { field: "coverages", message: "coverages must be a non-empty array.", code: "required" },
      ]);
    }
  });

  test("AMS-R49: every coverage needs a string type; the first offender is reported by index", async () => {
    const res = await ctx.api.post(
      "/v1/policies",
      policyBody({ coverages: [{ type: "dwelling" }, { limit: "1000" }, { type: 7 }] }),
    );
    expectError(res, 400, "VALIDATION_ERROR");
    expect(res.body.details).toEqual([
      { field: "coverages[1].type", message: "Each coverage must have a type.", code: "required" },
    ]);
    const second = await ctx.api.post("/v1/policies", policyBody({ coverages: [{ type: "dwelling" }, { type: "" }] }));
    expect(fieldCodes(second)).toEqual(["coverages[1].type:required"]);
  });

  test("AMS-R50: an unknown client is 404, after validation and before the compliance checks", async () => {
    const invalid = await ctx.api.post("/v1/policies", policyBody({ client_id: "NO-SUCH", coverages: [] }));
    expectError(invalid, 400, "VALIDATION_ERROR");

    const { result, diff } = await ctx.svc.changes(() =>
      ctx.api.post("/v1/policies", policyBody({ client_id: "NO-SUCH", annual_premium: 50_000, effective_date: "2020-01-01" })),
    );
    expectError(result, 404, "NOT_FOUND");
    expect(result.body.message).toBe("client not found.");
    expect(diff).toEqual({});
    contract.check(result);
  });
});

describe("createPolicy success", () => {
  test("AMS-R52: the response echoes the request with defaults filled in", async () => {
    const res = await ctx.api.post("/v1/policies", policyBody());
    expect(res.status).toBe(201);
    expect(res.body.policy_id).toMatch(POLICY_ID);
    expect(res.body).toEqual({
      policy_id: res.body.policy_id,
      client_id: "CLI-A",
      carrier_code: "SMIT",
      policy_type: "homeowners",
      effective_date: "2026-03-01",
      expiration_date: "2027-03-01",
      annual_premium: 1200,
      status: "pending",
      multi_policy_discount: false,
      coverages: [{ type: "dwelling", limit: "300000", deductible: 1000 }],
      created_at: res.body.created_at,
      updated_at: res.body.created_at,
    });
    expect(res.body.created_at).toMatch(ISO_UTC);
    contract.check(res, { allow: [...POLICY_GAPS, "is missing required property 'premium_current'"] });
  });

  test("AMS-R52: status and multi_policy_discount may be given; every listed status and policy type is accepted", async () => {
    const res = await ctx.api.post("/v1/policies", policyBody({ status: "active", multi_policy_discount: true }));
    expect(res.body).toMatchObject({ status: "active", multi_policy_discount: true });
    for (const status of POLICY_STATUSES.split(", ")) {
      expect((await ctx.api.post("/v1/policies", policyBody({ status }))).body.status).toBe(status);
    }
    for (const policy_type of POLICY_TYPES.split(", ").filter((t) => t !== "personal_auto")) {
      expect((await ctx.api.post("/v1/policies", policyBody({ policy_type }))).status).toBe(201);
    }
  });

  test("AMS-R53: one policy row and one coverage row per coverage are written, and nothing else", async () => {
    const coverages = [{ type: "dwelling", limit: "300000", deductible: 1000 }, { type: "liability" }, { type: "flood", deductible: 250 }];
    const { result, diff } = await ctx.svc.changes(() =>
      ctx.api.post("/v1/policies", policyBody({ coverages, policy_number: "PN-1", state: "TX", carrier_code: "ANY-TEXT" })),
    );
    expect(result.status).toBe(201);
    expect(Object.keys(diff).sort()).toEqual(["coverages", "policies"]);
    expect(diff.policies.added).toEqual([
      {
        policy_id: result.body.policy_id,
        client_id: "CLI-A",
        carrier_code: "ANY-TEXT",
        policy_type: "homeowners",
        effective_date: "2026-03-01",
        expiration_date: "2027-03-01",
        premium_current: 1200,
        premium_prior: null,
        status: "pending",
        multi_policy_discount: false,
        created_at: result.body.created_at,
        updated_at: result.body.created_at,
      },
    ]);
    expect(diff.policies.changed).toEqual([]);
    expect(diff.coverages.added.map(({ id, ...rest }) => rest)).toEqual([
      { policy_id: result.body.policy_id, type: "dwelling", limit: "300000", deductible: 1000 },
      { policy_id: result.body.policy_id, type: "liability", limit: null, deductible: null },
      { policy_id: result.body.policy_id, type: "flood", limit: null, deductible: 250 },
    ]);
  });

  test("AMS-R53: the new policy is readable through the other operations", async () => {
    const created = await ctx.api.post("/v1/policies", policyBody());
    const read = await ctx.api.get(`/v1/policies/${created.body.policy_id}`);
    expect(read.body).toMatchObject({ policy_id: created.body.policy_id, premium_current: 1200, premium_prior: null, status: "pending" });
    expect(read.body.coverages).toHaveLength(1);
    const listed = await ctx.api.get("/v1/clients/CLI-A/policies");
    expect(listed.body.data.map((p: any) => p.policy_id)).toContain(created.body.policy_id);
  });

  test("AMS-R53: date order is not checked", async () => {
    const res = await ctx.api.post("/v1/policies", policyBody({ effective_date: "2027-01-01", expiration_date: "2026-06-01" }));
    expect(res.status).toBe(201);
  });
});
