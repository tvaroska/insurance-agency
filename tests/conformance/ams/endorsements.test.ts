import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { book, endorsement, endorsementBody, ENDORSEMENT_ID, fieldCodes, ISO_UTC, start, type Ctx } from "./support";

const contract = loadContract("ams");
let ctx: Ctx;

const CHANGE_TYPES = [
  "add_coverage",
  "remove_coverage",
  "modify_coverage",
  "add_vehicle",
  "remove_vehicle",
  "add_driver",
  "remove_driver",
  "address_change",
  "other",
];

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({
    tables: book({
      endorsements: [
        endorsement("END-2", "POL-A-AUTO", {
          created_at: "2025-08-02T00:00:00.000Z",
          status: "pending_review",
          change_type: "other",
          changes: JSON.stringify({ note: "second" }),
          premium_delta: null,
          notes: "Second by creation time.",
        }),
        endorsement("END-1", "POL-A-AUTO", { created_at: "2025-08-01T00:00:00.000Z" }),
        endorsement("END-3", "POL-A-HOME", { created_at: "2025-07-01T00:00:00.000Z" }),
      ],
    }),
  });
});

describe("listPolicyEndorsements", () => {
  test("AMS-R54: returns the policy's endorsements, oldest first, with changes parsed", async () => {
    const res = await ctx.api.get("/v1/policies/POL-A-AUTO/endorsements");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["data"]);
    expect(res.body.data).toEqual([
      {
        endorsement_id: "END-1",
        policy_id: "POL-A-AUTO",
        effective_date: "2025-09-01",
        change_type: "add_vehicle",
        changes: { vehicle: { vin: "VIN1" } },
        premium_delta: 120,
        status: "approved",
        notes: null,
        created_at: "2025-08-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:00:00.000Z",
      },
      {
        endorsement_id: "END-2",
        policy_id: "POL-A-AUTO",
        effective_date: "2025-09-01",
        change_type: "other",
        changes: { note: "second" },
        premium_delta: null,
        status: "pending_review",
        notes: "Second by creation time.",
        created_at: "2025-08-02T00:00:00.000Z",
        updated_at: "2025-01-01T00:00:00.000Z",
      },
    ]);
    contract.check(res);
  });

  test("AMS-R54, AMS-R3: the stored changes column is JSON text", async () => {
    const row = (await ctx.svc.table("endorsements")).find((r) => r.endorsement_id === "END-1")!;
    expect(row.changes).toBe('{"vehicle":{"vin":"VIN1"}}');
  });

  test("AMS-R54: a policy without endorsements returns an empty list; an unknown policy is 404", async () => {
    expect((await ctx.api.get("/v1/policies/POL-B-AUTO/endorsements")).body).toEqual({ data: [] });
    const res = await ctx.api.get("/v1/policies/POL-ZZ/endorsements");
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("policy not found.");
    contract.check(res);
  });
});

describe("createEndorsement", () => {
  test("AMS-R55: the body is validated in one step, in the documented order", async () => {
    const empty = await ctx.api.post("/v1/policies/POL-A-AUTO/endorsements", {});
    expectError(empty, 400, "VALIDATION_ERROR");
    expect(empty.body.details).toEqual([
      { field: "effective_date", message: "effective_date is required.", code: "required" },
      { field: "change_type", message: "change_type is required.", code: "required" },
      { field: "changes", message: "changes is required.", code: "required" },
    ]);
    contract.check(empty);

    const bad = await ctx.api.post("/v1/policies/POL-A-AUTO/endorsements", {
      effective_date: "March 1st",
      change_type: "rewrite",
      changes: "",
      notes: "n".repeat(2001),
    });
    expect(bad.body.details).toEqual([
      { field: "effective_date", message: "effective_date must be YYYY-MM-DD.", code: "invalid_format" },
      { field: "change_type", message: `change_type must be one of: ${CHANGE_TYPES.join(", ")}.`, code: "invalid_enum" },
      { field: "changes", message: "changes is required.", code: "required" },
      { field: "notes", message: "notes must be at most 2000 characters.", code: "too_long" },
    ]);
  });

  test("AMS-R55: an empty effective_date or change_type fails both its required check and its format or enum check", async () => {
    const res = await ctx.api.post("/v1/policies/POL-A-AUTO/endorsements", { effective_date: "", change_type: "", changes: "" });
    expect(fieldCodes(res)).toEqual([
      "effective_date:required",
      "effective_date:invalid_format",
      "change_type:required",
      "change_type:invalid_enum",
      "changes:required",
    ]);
  });

  test("AMS-R55: every change type is accepted, and notes may be 2000 characters long", async () => {
    for (const change_type of CHANGE_TYPES) {
      const res = await ctx.api.post("/v1/policies/POL-A-AUTO/endorsements", endorsementBody({ change_type }));
      expect([change_type, res.status]).toEqual([change_type, 201]);
    }
    const res = await ctx.api.post("/v1/policies/POL-A-AUTO/endorsements", endorsementBody({ notes: "n".repeat(2000) }));
    expect(res.status).toBe(201);
  });

  test("AMS-R55, AMS-R56: validation comes before the policy lookup; a valid body for an unknown policy is 404", async () => {
    expect(fieldCodes(await ctx.api.post("/v1/policies/POL-ZZ/endorsements", {}))).toEqual([
      "effective_date:required",
      "change_type:required",
      "changes:required",
    ]);
    const res = await ctx.api.post("/v1/policies/POL-ZZ/endorsements", endorsementBody());
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("policy not found.");
    contract.check(res);
  });

  test("AMS-R57: cancelled, expired and non-renewed policies cannot be endorsed", async () => {
    for (const [policyId, status] of [["POL-C-CAN", "cancelled"], ["POL-C-EXP", "expired"], ["POL-C-NR", "non_renewed"]]) {
      const { result, diff } = await ctx.svc.changes(() => ctx.api.post(`/v1/policies/${policyId}/endorsements`, endorsementBody()));
      expectError(result, 409, "CONFLICT");
      expect(result.body.message).toBe(`Cannot endorse policy ${policyId}: policy status is '${status}'.`);
      expect(diff).toEqual({});
      contract.check(result);
    }
  });

  test("AMS-R57: the status check comes after validation and before the compliance checks", async () => {
    expectError(await ctx.api.post("/v1/policies/POL-C-CAN/endorsements", {}), 400, "VALIDATION_ERROR");
    const backdated = await ctx.api.post("/v1/policies/POL-C-CAN/endorsements", endorsementBody({ effective_date: "2001-01-01" }));
    expectError(backdated, 409, "CONFLICT");
  });

  test("AMS-R57: active and pending policies can be endorsed", async () => {
    expect((await ctx.api.post("/v1/policies/POL-A-AUTO/endorsements", endorsementBody())).status).toBe(201);
    expect((await ctx.api.post("/v1/policies/POL-B-AUTO/endorsements", endorsementBody())).status).toBe(201);
  });

  test("AMS-R59: a new endorsement is pending review with a zero premium delta, whatever the request says", async () => {
    const body = endorsementBody({
      change_type: "add_vehicle",
      changes: { vehicle: { vin: "VIN9", year: 2026 }, drivers: ["a", "b"] },
      notes: "Bought a car.",
      premium_delta: 999,
      status: "applied",
    });
    const { result, diff } = await ctx.svc.changes(() => ctx.api.post("/v1/policies/POL-A-AUTO/endorsements", body));
    expect(result.status).toBe(201);
    expect(result.body.endorsement_id).toMatch(ENDORSEMENT_ID);
    expect(result.body.endorsement_id.slice(4, 8)).toBe(String((await ctx.svc.now()).getUTCFullYear()));
    expect(result.body).toEqual({
      endorsement_id: result.body.endorsement_id,
      policy_id: "POL-A-AUTO",
      effective_date: "2026-11-01",
      change_type: "add_vehicle",
      changes: { vehicle: { vin: "VIN9", year: 2026 }, drivers: ["a", "b"] },
      premium_delta: 0,
      status: "pending_review",
      notes: "Bought a car.",
      created_at: result.body.created_at,
      updated_at: result.body.created_at,
    });
    expect(result.body.created_at).toMatch(ISO_UTC);
    contract.check(result);

    expect(Object.keys(diff)).toEqual(["endorsements"]);
    expect(diff.endorsements.changed).toEqual([]);
    expect(diff.endorsements.added).toEqual([
      { ...result.body, changes: JSON.stringify(body.changes) },
    ]);
  });

  test("AMS-R59: notes default to null and the new endorsement is listed last", async () => {
    const created = await ctx.api.post("/v1/policies/POL-A-AUTO/endorsements", endorsementBody());
    expect(created.body.notes).toBeNull();
    const list = await ctx.api.get("/v1/policies/POL-A-AUTO/endorsements");
    expect(list.body.data.map((e: any) => e.endorsement_id)).toEqual(["END-1", "END-2", created.body.endorsement_id]);
    expect(list.body.data[2]).toEqual(created.body);
  });

  test("AMS-R59: changes may be any JSON value and is returned as sent", async () => {
    const res = await ctx.api.post("/v1/policies/POL-A-AUTO/endorsements", endorsementBody({ changes: "Add a named driver." }));
    expect(res.status).toBe(201);
    expect(res.body.changes).toBe("Add a named driver.");
    contract.check(res);
    const list = await ctx.api.get("/v1/policies/POL-A-AUTO/endorsements");
    expect(list.body.data.at(-1).changes).toBe("Add a named driver.");
    contract.check(list);
  });
});

test("AMS-G16 & AMS-G12: Endorsement.notes/premium_delta are nullable and Endorsement.changes accepts any JSON value", async () => {
  const created = await ctx.api.post("/v1/policies/POL-A-AUTO/endorsements", endorsementBody({ changes: ["a", "b"] }));
  expect(created.status).toBe(201);
  expect(created.body.notes).toBeNull();
  contract.check(created);
  const listed = await ctx.api.get("/v1/policies/POL-A-AUTO/endorsements");
  expect(listed.body.data.some((e: any) => e.premium_delta === null)).toBe(true);
  contract.check(listed);
});
