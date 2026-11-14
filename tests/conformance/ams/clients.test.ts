import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { book, CLIENT_GAPS, CLIENT_ID, client, fieldCodes, ISO_UTC, POLICY_GAPS, start, task, type Ctx } from "./support";

const contract = loadContract("ams");
let ctx: Ctx;

const UPDATABLE =
  "first_name, last_name, dob, email, phone, address, driver_license_number, occupation, marital_status, household_id, preferred_contact_method, preferred_contact_time, status";

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({
    tables: book({
      tasks: [
        task("T-B1", { related_client_id: "CLI-B" }),
        task("T-B2", { related_client_id: "CLI-B" }),
        task("T-A1", { related_client_id: "CLI-A" }),
      ],
    }),
  });
});

const ids = (res: { body: any }) => res.body.data.map((c: any) => c.id);

describe("listClients", () => {
  test("AMS-R22: clients are sorted by last name, first name, then id", async () => {
    await ctx.svc.seed({
      tables: {
        clients: [
          client("C-3", { first_name: "Zed", last_name: "Adams" }),
          client("C-2", { first_name: "Amy", last_name: "Young" }),
          client("C-9", { first_name: "Amy", last_name: "Adams" }),
          client("C-1", { first_name: "Amy", last_name: "Adams" }),
        ],
      },
    });
    const res = await ctx.api.get("/v1/clients");
    expect(ids(res)).toEqual(["C-1", "C-9", "C-3", "C-2"]);
    contract.check(res, { allow: CLIENT_GAPS });
  });

  test("AMS-R4: a client carries a nested address and null for every unset field", async () => {
    const res = await ctx.api.get("/v1/clients", { query: { last_name: "Cole" } });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toEqual({
      id: "CLI-D",
      first_name: "Dan",
      last_name: "Cole",
      dob: null,
      email: "dan@example.test",
      phone: null,
      address: { street: null, city: null, state: null, zip: null },
      driver_license_number: null,
      occupation: null,
      marital_status: null,
      household_id: null,
      preferred_contact_method: null,
      preferred_contact_time: null,
      status: "inactive",
      created_at: "2025-01-01T00:00:00.000Z",
      updated_at: "2025-01-01T00:00:00.000Z",
    });
  });

  test("AMS-R23: status, email and household_id filter exactly; the filters combine with AND", async () => {
    expect(ids(await ctx.api.get("/v1/clients", { query: { status: "prospect" } }))).toEqual(["CLI-C"]);
    expect(ids(await ctx.api.get("/v1/clients", { query: { status: "inactive" } }))).toEqual(["CLI-D"]);
    expect(ids(await ctx.api.get("/v1/clients", { query: { household_id: "HH-1" } }))).toEqual(["CLI-A", "CLI-B"]);
    expect(ids(await ctx.api.get("/v1/clients", { query: { email: "bob@example.test" } }))).toEqual(["CLI-B"]);
    expect(ids(await ctx.api.get("/v1/clients", { query: { email: "BOB@example.test" } }))).toEqual([]);
    expect(ids(await ctx.api.get("/v1/clients", { query: { household_id: "HH-1", first_name: "Bob" } }))).toEqual(["CLI-B"]);
    expect(ids(await ctx.api.get("/v1/clients", { query: { household_id: "HH-1", status: "prospect" } }))).toEqual([]);
  });

  test("AMS-R23: last_name and first_name are prefix matches that ignore ASCII case", async () => {
    expect(ids(await ctx.api.get("/v1/clients", { query: { last_name: "Arch" } }))).toEqual(["CLI-A", "CLI-B"]);
    expect(ids(await ctx.api.get("/v1/clients", { query: { last_name: "arch" } }))).toEqual(["CLI-A", "CLI-B"]);
    expect(ids(await ctx.api.get("/v1/clients", { query: { last_name: "rcher" } }))).toEqual([]);
    expect(ids(await ctx.api.get("/v1/clients", { query: { first_name: "ca" } }))).toEqual(["CLI-C"]);
    expect(ids(await ctx.api.get("/v1/clients", { query: { first_name: "ara" } }))).toEqual([]);
  });

  test("AMS-R24: status and name lengths are validated together", async () => {
    const res = await ctx.api.get("/v1/clients", {
      query: { status: "gone", last_name: "a".repeat(101), first_name: "b".repeat(101) },
    });
    expectError(res, 400, "VALIDATION_ERROR");
    expect(res.body.details).toEqual([
      { field: "status", message: "status must be one of: active, inactive, prospect.", code: "invalid_enum" },
      { field: "last_name", message: "last_name must be at most 100 characters.", code: "too_long" },
      { field: "first_name", message: "first_name must be at most 100 characters.", code: "too_long" },
    ]);
    contract.check(res);
    expect((await ctx.api.get("/v1/clients", { query: { last_name: "a".repeat(100) } })).status).toBe(200);
  });

  test("AMS-R24: an empty status value is an error on this operation", async () => {
    const res = await ctx.api.get("/v1/clients", { query: { status: "" } });
    expectError(res, 400, "VALIDATION_ERROR", { field: "status", code: "invalid_enum" });
  });
});

describe("getClient", () => {
  test("AMS-R25: returns the client, with the address columns folded into one object", async () => {
    const res = await ctx.api.get("/v1/clients/CLI-A");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "CLI-A",
      first_name: "Ann",
      last_name: "Archer",
      email: "ann@example.test",
      phone: "555-0100",
      address: { street: "1 Main St", city: "Fresno", state: "CA", zip: "93650" },
      marital_status: "married",
      household_id: "HH-1",
      preferred_contact_method: "email",
      status: "active",
    });
    expect(res.body.address_street).toBeUndefined();
    contract.check(res, { allow: CLIENT_GAPS });
  });

  test("AMS-R25: an unknown id is 404", async () => {
    const res = await ctx.api.get("/v1/clients/CLI-ZZ");
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("client not found.");
  });
});

describe("createClient", () => {
  const minimal = { first_name: "New", last_name: "Client", email: "new@example.test" };

  test("AMS-R26: required fields, lengths and enums are validated in one step, in the documented order", async () => {
    const res = await ctx.api.post("/v1/clients", {
      status: "gone",
      marital_status: "complicated",
      preferred_contact_method: "sms",
    });
    expectError(res, 400, "VALIDATION_ERROR");
    expect(res.body.details).toEqual([
      { field: "first_name", message: "first_name is required.", code: "required" },
      { field: "last_name", message: "last_name is required.", code: "required" },
      { field: "email", message: "email is required.", code: "required" },
      { field: "status", message: "status must be one of: active, inactive, prospect.", code: "invalid_enum" },
      { field: "marital_status", message: "marital_status must be one of: single, married, divorced, widowed.", code: "invalid_enum" },
      {
        field: "preferred_contact_method",
        message: "preferred_contact_method must be one of: email, phone, mail.",
        code: "invalid_enum",
      },
    ]);
    contract.check(res);
  });

  test("AMS-R26: name and email lengths are limited to 100, 100 and 255", async () => {
    const tooLong = await ctx.api.post("/v1/clients", {
      first_name: "f".repeat(101),
      last_name: "l".repeat(101),
      email: "e".repeat(256),
    });
    expect(fieldCodes(tooLong)).toEqual(["first_name:too_long", "last_name:too_long", "email:too_long"]);
    const atLimit = await ctx.api.post("/v1/clients", {
      first_name: "f".repeat(100),
      last_name: "l".repeat(100),
      email: "e".repeat(255),
    });
    expect(atLimit.status).toBe(201);
  });

  test("AMS-R26: null is accepted for marital_status and preferred_contact_method; the email format is not checked", async () => {
    const res = await ctx.api.post("/v1/clients", {
      ...minimal,
      email: "not-an-email",
      marital_status: null,
      preferred_contact_method: null,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: "not-an-email", marital_status: null, preferred_contact_method: null });
  });

  test("AMS-R15, AMS-R26: a required field sent as an empty string yields only 'required'; an optional enum sent empty is invalid", async () => {
    const res = await ctx.api.post("/v1/clients", { first_name: "", last_name: "", email: "", status: "" });
    expect(fieldCodes(res)).toEqual(["first_name:required", "last_name:required", "email:required", "status:invalid_enum"]);
  });

  test("AMS-R27: an email that already exists is a conflict, compared exactly", async () => {
    const { result, diff } = await ctx.svc.changes(() => ctx.api.post("/v1/clients", { ...minimal, email: "ann@example.test" }));
    expectError(result, 409, "CONFLICT");
    expect(result.body.message).toBe("A client with email 'ann@example.test' already exists.");
    expect(diff).toEqual({});
    contract.check(result);

    expect((await ctx.api.post("/v1/clients", { ...minimal, email: "ANN@example.test" })).status).toBe(201);
  });

  test("AMS-R27: validation is reported before the duplicate check", async () => {
    const res = await ctx.api.post("/v1/clients", { first_name: "X", email: "ann@example.test" });
    expectError(res, 400, "VALIDATION_ERROR", { field: "last_name", code: "required" });
  });

  test("AMS-R28: a minimal create fills the defaults and inserts one row", async () => {
    const before = Date.now();
    const { result, diff } = await ctx.svc.changes(() => ctx.api.post("/v1/clients", minimal));
    expect(result.status).toBe(201);
    expect(result.body.id).toMatch(CLIENT_ID);
    expect(result.body).toMatchObject({
      ...minimal,
      dob: null,
      phone: null,
      address: { street: null, city: null, state: null, zip: null },
      driver_license_number: null,
      occupation: null,
      marital_status: null,
      household_id: null,
      preferred_contact_method: null,
      preferred_contact_time: null,
      status: "active",
    });
    expect(result.body.created_at).toMatch(ISO_UTC);
    expect(result.body.updated_at).toBe(result.body.created_at);
    expect(Date.parse(result.body.created_at)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(result.body.created_at)).toBeLessThanOrEqual(Date.now() + 1000);
    contract.check(result, { allow: CLIENT_GAPS });

    expect(Object.keys(diff)).toEqual(["clients"]);
    expect(diff.clients.added).toHaveLength(1);
    expect(diff.clients.changed).toEqual([]);
    expect(diff.clients.added[0]).toMatchObject({ id: result.body.id, email: "new@example.test", status: "active", address_state: null });
  });

  test("AMS-R28: every optional field is stored as given", async () => {
    const full = {
      ...minimal,
      dob: "1990-02-03",
      phone: "555-0199",
      address: { street: "9 Elm St", city: "Austin", state: "TX", zip: "73301" },
      driver_license_number: "TX-1",
      occupation: "Baker",
      marital_status: "single",
      household_id: "HH-9",
      preferred_contact_method: "mail",
      preferred_contact_time: "mornings",
      status: "prospect",
    };
    const res = await ctx.api.post("/v1/clients", full);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject(full);
    const row = (await ctx.svc.table("clients")).find((r) => r.id === res.body.id)!;
    expect(row).toMatchObject({ address_street: "9 Elm St", address_city: "Austin", address_state: "TX", address_zip: "73301" });
    expect((await ctx.api.get(`/v1/clients/${res.body.id}`)).body).toEqual(res.body);
  });

  test("AMS-R28: a partial address stores the given parts and null for the rest", async () => {
    const res = await ctx.api.post("/v1/clients", { ...minimal, address: { city: "Reno" } });
    expect(res.body.address).toEqual({ street: null, city: "Reno", state: null, zip: null });
  });
});

describe("updateClient", () => {
  test("AMS-R29: a body without any updatable field is rejected", async () => {
    for (const body of [{}, { id: "X", created_at: "2000-01-01", nickname: "Annie" }]) {
      const res = await ctx.api.patch("/v1/clients/CLI-A", body);
      expectError(res, 400, "VALIDATION_ERROR");
      expect(res.body.details).toEqual([
        { field: "body", message: `Request body must contain at least one updatable field: ${UPDATABLE}.`, code: "required" },
      ]);
      contract.check(res);
    }
  });

  test("AMS-R30: present fields are validated together", async () => {
    const res = await ctx.api.patch("/v1/clients/CLI-A", {
      first_name: "f".repeat(101),
      last_name: "l".repeat(101),
      email: "e".repeat(256),
      status: "gone",
      marital_status: "complicated",
      preferred_contact_method: "sms",
    });
    expect(fieldCodes(res)).toEqual([
      "first_name:too_long",
      "last_name:too_long",
      "email:too_long",
      "status:invalid_enum",
      "marital_status:invalid_enum",
      "preferred_contact_method:invalid_enum",
    ]);
  });

  test("AMS-R31: validation comes before the existence check; a valid body for an unknown id is 404", async () => {
    expectError(await ctx.api.patch("/v1/clients/CLI-ZZ", { status: "gone" }), 400, "VALIDATION_ERROR");
    const res = await ctx.api.patch("/v1/clients/CLI-ZZ", { status: "active" });
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("client not found.");
    contract.check(res);
  });

  test("AMS-R32: another client's email is a conflict; the client's own email is not", async () => {
    const { result, diff } = await ctx.svc.changes(() => ctx.api.patch("/v1/clients/CLI-A", { email: "bob@example.test" }));
    expectError(result, 409, "CONFLICT");
    expect(result.body.message).toBe("A client with email 'bob@example.test' already exists.");
    expect(diff).toEqual({});

    const own = await ctx.api.patch("/v1/clients/CLI-A", { email: "ann@example.test" });
    expect(own.status).toBe(200);
  });

  test("AMS-R33: only the fields sent change, and updated_at moves", async () => {
    const { result, diff } = await ctx.svc.changes(() =>
      ctx.api.patch("/v1/clients/CLI-A", { occupation: "Pilot", status: "inactive", email: "ann2@example.test" }),
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      id: "CLI-A",
      first_name: "Ann",
      occupation: "Pilot",
      status: "inactive",
      email: "ann2@example.test",
      phone: "555-0100",
      address: { street: "1 Main St", city: "Fresno", state: "CA", zip: "93650" },
      created_at: "2025-01-01T00:00:00.000Z",
    });
    expect(result.body.updated_at).toMatch(ISO_UTC);
    expect(result.body.updated_at).not.toBe("2025-01-01T00:00:00.000Z");
    contract.check(result, { allow: CLIENT_GAPS });

    expect(Object.keys(diff)).toEqual(["clients"]);
    expect(diff.clients.changed).toHaveLength(1);
    expect(diff.clients.changed[0].fields.sort()).toEqual(["email", "occupation", "status", "updated_at"]);
  });

  test("AMS-R33: null clears a nullable field", async () => {
    const res = await ctx.api.patch("/v1/clients/CLI-A", {
      phone: null,
      marital_status: null,
      household_id: null,
      preferred_contact_method: null,
      dob: null,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ phone: null, marital_status: null, household_id: null, preferred_contact_method: null, dob: null });
  });

  test("AMS-R33: address replaces all four parts", async () => {
    const res = await ctx.api.patch("/v1/clients/CLI-A", { address: { city: "Reno", state: "NV" } });
    expect(res.body.address).toEqual({ street: null, city: "Reno", state: "NV", zip: null });
    const row = (await ctx.svc.table("clients")).find((r) => r.id === "CLI-A")!;
    expect(row).toMatchObject({ address_street: null, address_city: "Reno", address_state: "NV", address_zip: null });
  });
});

describe("mergeClient", () => {
  test("AMS-R34: checks run in order: body, self-merge, target, source", async () => {
    const missing = await ctx.api.post("/v1/clients/CLI-A/merge", {});
    expectError(missing, 400, "VALIDATION_ERROR", { field: "source_client_id", code: "required" });
    contract.check(missing);

    const self = await ctx.api.post("/v1/clients/CLI-A/merge", { source_client_id: "CLI-A" });
    expectError(self, 409, "CONFLICT");
    expect(self.body.message).toBe("Cannot merge a client with itself.");
    contract.check(self);

    // The self-merge check does not need the client to exist.
    expectError(await ctx.api.post("/v1/clients/NO-SUCH/merge", { source_client_id: "NO-SUCH" }), 409, "CONFLICT");

    const noTarget = await ctx.api.post("/v1/clients/NO-SUCH/merge", { source_client_id: "CLI-B" });
    expectError(noTarget, 404, "NOT_FOUND");
    expect(noTarget.body.message).toBe("client not found.");
    const noSource = await ctx.svc.changes(() => ctx.api.post("/v1/clients/CLI-A/merge", { source_client_id: "NO-SUCH" }));
    expectError(noSource.result, 404, "NOT_FOUND");
    expect(noSource.diff).toEqual({});
    contract.check(noSource.result);
  });

  test("AMS-R35: policies and tasks move to the target and the source becomes inactive; the target row is untouched", async () => {
    const { result, diff } = await ctx.svc.changes(() => ctx.api.post("/v1/clients/CLI-A/merge", { source_client_id: "CLI-B" }));
    expect(result.status).toBe(200);
    expect(Object.keys(diff).sort()).toEqual(["clients", "policies", "tasks"]);

    expect(diff.clients.changed.map((c) => c.key)).toEqual(["CLI-B"]);
    expect(diff.clients.changed[0].fields.sort()).toEqual(["status", "updated_at"]);
    expect(diff.clients.changed[0].after.status).toBe("inactive");

    expect(diff.policies.changed.map((c) => c.key)).toEqual(["POL-B-AUTO"]);
    expect(diff.policies.changed[0].fields.sort()).toEqual(["client_id", "updated_at"]);
    expect(diff.policies.changed[0].after.client_id).toBe("CLI-A");

    expect(diff.tasks.changed.map((c) => c.key).sort()).toEqual(["T-B1", "T-B2"]);
    for (const change of diff.tasks.changed) {
      expect(change.fields.sort()).toEqual(["related_client_id", "updated_at"]);
      expect(change.after.related_client_id).toBe("CLI-A");
      expect(change.after.updated_at).toMatch(ISO_UTC);
    }
    for (const table of ["clients", "policies", "tasks"]) {
      expect(diff[table].added).toEqual([]);
      expect(diff[table].removed).toEqual([]);
    }
  });

  test("AMS-R36: the response reports the target and the counts; a repeat merge moves nothing", async () => {
    const first = await ctx.api.post("/v1/clients/CLI-A/merge", { source_client_id: "CLI-B" });
    expect(first.body).toMatchObject({ source_client_id: "CLI-B", policies_moved: 1, tasks_moved: 2 });
    expect(first.body.target_client).toMatchObject({ id: "CLI-A", status: "active", updated_at: "2025-01-01T00:00:00.000Z" });
    expect(first.body.target_client.address).toEqual({ street: "1 Main St", city: "Fresno", state: "CA", zip: "93650" });
    contract.check(first, { allow: CLIENT_GAPS });

    const again = await ctx.api.post("/v1/clients/CLI-A/merge", { source_client_id: "CLI-B" });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ policies_moved: 0, tasks_moved: 0 });

    expect((await ctx.api.get("/v1/clients/CLI-A/policies")).body.data).toHaveLength(3);
    expect((await ctx.api.get("/v1/clients/CLI-B/policies")).body.data).toHaveLength(0);
  });
});

describe("getHouseholdSummary", () => {
  test("AMS-R37: members are the clients of the household, by last then first name; an unknown household is 404", async () => {
    const res = await ctx.api.get("/v1/clients/household/HH-1");
    expect(res.status).toBe(200);
    expect(res.body.members.map((m: any) => m.id)).toEqual(["CLI-A", "CLI-B"]);
    expect(res.body).toMatchObject({ household_id: "HH-1", member_count: 2 });
    contract.check(res, { allow: CLIENT_GAPS });

    const missing = await ctx.api.get("/v1/clients/household/HH-404");
    expectError(missing, 404, "NOT_FOUND");
    expect(missing.body.message).toBe("household not found.");
  });

  test("AMS-R38: premiums are summed, coverage types are the sorted union of policy and coverage types, gaps keep the fixed order", async () => {
    const res = await ctx.api.get("/v1/clients/household/HH-1");
    const [ann, bob] = res.body.members;
    expect(ann).toMatchObject({
      first_name: "Ann",
      address: { street: "1 Main St", city: "Fresno", state: "CA", zip: "93650" },
      policy_count: 2,
      total_premium: 3000,
      coverage_types: ["bodily_injury", "collision", "dwelling", "homeowners", "personal_auto", "property_damage"],
    });
    expect(bob).toMatchObject({ policy_count: 1, total_premium: 500, coverage_types: ["bodily_injury", "personal_auto"] });
    expect(res.body.total_premium).toBe(3500);
    expect(res.body.coverage_types).toEqual(["bodily_injury", "collision", "dwelling", "homeowners", "personal_auto", "property_damage"]);
    expect(res.body.coverage_gaps).toEqual(["umbrella", "life", "flood"]);
  });

  test("AMS-R38: policies of any status count, and a household without policies lacks every recommended type", async () => {
    const hh2 = await ctx.api.get("/v1/clients/household/HH-2");
    expect(hh2.body.members[0]).toMatchObject({ id: "CLI-C", policy_count: 4, total_premium: 3000 });
    expect(hh2.body.coverage_types).toEqual(["personal_auto", "renters"]);
    expect(hh2.body.coverage_gaps).toEqual(["homeowners", "umbrella", "life", "flood"]);

    await ctx.api.patch("/v1/clients/CLI-D", { household_id: "HH-EMPTY" });
    await ctx.api.post("/v1/clients/CLI-A/merge", { source_client_id: "CLI-D" });
    const empty = await ctx.api.get("/v1/clients/household/HH-EMPTY");
    expect(empty.body).toMatchObject({ member_count: 1, total_premium: 0, coverage_types: [] });
    expect(empty.body.coverage_gaps).toEqual(["personal_auto", "homeowners", "umbrella", "life", "flood"]);
    expect(empty.body.members[0]).toMatchObject({ policy_count: 0, total_premium: 0, coverage_types: [] });
  });
});

describe("listClientPolicies", () => {
  test("AMS-R39: the client must exist, and that is checked before the filters", async () => {
    const res = await ctx.api.get("/v1/clients/NO-SUCH/policies", { query: { status: "bogus" } });
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("client not found.");
    contract.check(res);
  });

  test("AMS-R40: policy_type and status are validated together", async () => {
    const res = await ctx.api.get("/v1/clients/CLI-A/policies", { query: { policy_type: "boat", status: "lapsed" } });
    expectError(res, 400, "VALIDATION_ERROR");
    expect(res.body.details).toEqual([
      {
        field: "policy_type",
        message:
          "policy_type must be one of: personal_auto, homeowners, renters, umbrella, bop, workers_comp, general_liability, professional_liability.",
        code: "invalid_enum",
      },
      { field: "status", message: "status must be one of: active, pending, expired, cancelled, non_renewed.", code: "invalid_enum" },
    ]);
    contract.check(res);
  });

  test("AMS-R40: an empty policy_type or status value fails its enum check", async () => {
    const res = await ctx.api.get("/v1/clients/CLI-A/policies", { query: { policy_type: "", status: "" } });
    expectError(res, 400, "VALIDATION_ERROR");
    expect(fieldCodes(res)).toEqual(["policy_type:invalid_enum", "status:invalid_enum"]);
  });

  test("AMS-R41: returns the client's policies, newest effective date first, each with its coverages", async () => {
    const res = await ctx.api.get("/v1/clients/CLI-A/policies");
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: any) => p.policy_id)).toEqual(["POL-A-HOME", "POL-A-AUTO"]);
    expect(res.body.data[1]).toEqual({
      policy_id: "POL-A-AUTO",
      client_id: "CLI-A",
      carrier_code: "SMIT",
      policy_type: "personal_auto",
      effective_date: "2025-06-01",
      expiration_date: "2026-06-01",
      premium_current: 1000,
      premium_prior: 900,
      status: "active",
      coverages: [
        { type: "bodily_injury", limit: "100000/300000", deductible: null },
        { type: "property_damage", limit: "50000", deductible: null },
        { type: "collision", limit: null, deductible: 500 },
      ],
      multi_policy_discount: true,
      created_at: "2025-01-01T00:00:00.000Z",
      updated_at: "2025-01-01T00:00:00.000Z",
    });
    contract.check(res, { allow: POLICY_GAPS });
  });

  test("AMS-R41: policy_type and status filter the list; a client without policies gets an empty page", async () => {
    const byType = await ctx.api.get("/v1/clients/CLI-C/policies", { query: { policy_type: "renters" } });
    expect(byType.body.data.map((p: any) => p.policy_id)).toEqual(["POL-C-EXP"]);
    const byStatus = await ctx.api.get("/v1/clients/CLI-C/policies", { query: { status: "cancelled" } });
    expect(byStatus.body.data.map((p: any) => p.policy_id)).toEqual(["POL-C-CAN"]);
    const both = await ctx.api.get("/v1/clients/CLI-C/policies", { query: { status: "active", policy_type: "renters" } });
    expect(both.body.data).toEqual([]);
    expect(byType.body.data[0].coverages).toEqual([]);
  });
});
