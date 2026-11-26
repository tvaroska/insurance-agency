import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError } from "../harness";
import { book, endorsement, escalation, ISO_UTC, policy, policyBody, start, type Ctx } from "./support";

let ctx: Ctx;

const TABLES = ["clients", "policies", "coverages", "endorsements", "commissions", "tasks", "escalations", "escalation_events"];

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({ tables: book() });
});

function counts(tables: Record<string, unknown[]>): Record<string, number> {
  return Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]));
}

describe("snapshot, reset and seed", () => {
  test("AMS-R99: the snapshot lists exactly the eight tables, as raw rows ordered by primary key", async () => {
    const res = await ctx.svc.http.get("/sim/snapshot");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("ams");
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
    expect(Number.isNaN(Date.parse(res.body.simulated_time))).toBe(false);
    expect(Object.keys(res.body.tables)).toEqual(TABLES);

    const { clients, policies, coverages } = res.body.tables;
    expect(clients.map((c: any) => c.id)).toEqual(["CLI-A", "CLI-B", "CLI-C", "CLI-D"]);
    expect(Object.keys(clients[0])).toEqual([
      "id",
      "first_name",
      "last_name",
      "dob",
      "email",
      "phone",
      "address_street",
      "address_city",
      "address_state",
      "address_zip",
      "driver_license_number",
      "occupation",
      "marital_status",
      "household_id",
      "preferred_contact_method",
      "preferred_contact_time",
      "status",
      "created_at",
      "updated_at",
    ]);
    const policyIds = policies.map((p: any) => p.policy_id);
    expect(policyIds).toEqual([...policyIds].sort());
    expect(coverages.map((c: any) => c.id)).toEqual([1, 2, 3, 4, 5]);
  });

  test("AMS-R100, AMS-R114: reset loads the realistic seed by default", async () => {
    const res = await ctx.svc.http.post("/sim/reset");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "reset", service: "ams", seed_mode: "realistic" });
    expect(counts(await ctx.svc.snapshot())).toEqual({
      clients: 33,
      policies: 80,
      coverages: 244,
      endorsements: 5,
      commissions: 15,
      tasks: 8,
      escalations: 0,
      escalation_events: 0,
    });
  });

  test("AMS-R100, AMS-R114: reset with seed_mode clean loads the clean seed", async () => {
    const res = await ctx.svc.http.post("/sim/reset", { seed_mode: "clean" });
    expect(res.body).toMatchObject({ status: "reset", seed_mode: "clean" });
    const tables = await ctx.svc.snapshot();
    expect(counts(tables)).toEqual({
      clients: 31,
      policies: 80,
      coverages: 249,
      endorsements: 5,
      commissions: 15,
      tasks: 8,
      escalations: 0,
      escalation_events: 0,
    });
    const ids = tables.clients.map((c) => c.id);
    expect(ids).not.toContain("CLI-030");
    expect(ids).not.toContain("CLI-031");
    expect(new Set(tables.policies.map((p) => p.status))).toEqual(new Set(["active", "pending", "expired", "cancelled"]));
  });

  test("AMS-R100: reset with seed_mode empty leaves eight empty tables", async () => {
    await ctx.svc.http.post("/sim/reset", { seed_mode: "empty" });
    const tables = await ctx.svc.snapshot();
    expect(Object.keys(tables)).toEqual(TABLES);
    for (const name of TABLES) expect(tables[name]).toEqual([]);
    expect((await ctx.api.get("/v1/clients")).body).toEqual({
      data: [],
      pagination: { limit: 25, cursor: null, next_cursor: null, has_more: false },
    });
  });

  test("AMS-R100: reset discards rows written through the API and puts the clock and fault injection back", async () => {
    await ctx.svc.reset("realistic");
    await ctx.api.post("/v1/tasks", { title: "Gone after reset" });
    await ctx.api.post("/v1/escalations", { client_id: "CLI-001", reason: "backdating", summary: "Gone too." });
    await ctx.svc.timeTravel({ days: 400 });
    await ctx.svc.chaos({ enabled: true, error_rate: 1 });

    await ctx.svc.reset("realistic");
    const tables = await ctx.svc.snapshot();
    expect(tables.tasks).toHaveLength(8);
    expect(tables.escalations).toEqual([]);
    expect(tables.escalation_events).toEqual([]);
    expect(new Set(tables.policies.map((p) => p.status)).has("active")).toBe(true);
    const status = await ctx.svc.status();
    expect(Math.abs(status.clock_offset_ms)).toBeLessThan(1000);
    expect(status.chaos.enabled).toBe(false);
    expect((await ctx.api.get("/v1/clients/CLI-001")).status).toBe(200);
  });

  test("AMS-R114: the realistic seed holds the rows the spec names", async () => {
    await ctx.svc.reset("realistic");
    const sarah = await ctx.api.get("/v1/clients/CLI-001");
    expect(sarah.body).toMatchObject({ first_name: "Sarah", last_name: "Chen", household_id: "HH-001" });
    expect(sarah.body.address.state).toBe("CA");
    expect((await ctx.api.get("/v1/clients/CLI-002")).body).toMatchObject({ last_name: "Chen", household_id: "HH-001" });
    expect((await ctx.api.get("/v1/clients/CLI-003")).body.address.state).toBe("TX");

    const policyRes = await ctx.api.get("/v1/policies/POL-PA-2025-001847");
    expect(policyRes.body).toMatchObject({
      client_id: "CLI-001",
      policy_type: "personal_auto",
      status: "active",
      effective_date: "2026-02-01",
      expiration_date: "2027-02-01",
    });
    // Seed coverage limits are text.
    expect(policyRes.body.coverages[0]).toMatchObject({ type: "bodily_injury", limit: "100000/300000", deductible: null });
    const endorsements = await ctx.api.get("/v1/policies/POL-PA-2025-001847/endorsements");
    expect(endorsements.body.data.map((e: any) => e.endorsement_id)).toEqual(["END-2025-009432"]);
    expect(endorsements.body.data[0].changes.vehicle.make).toBe("Toyota");

    const household = await ctx.api.get("/v1/clients/household/HH-004");
    expect(household.body.members.map((m: any) => m.id)).toEqual(["CLI-004", "CLI-005"]);

    const tables = await ctx.svc.snapshot();
    expect(tables.policies.filter((p) => p.status === "lapsed").map((p) => p.policy_id)).toEqual(["POL-PA-2025-005100"]);
    expect(tables.tasks.every((t) => t.task_type === null && typeof t.due_date === "string")).toBe(true);
    expect(tables.clients.some((c) => c.preferred_contact_method === "sms")).toBe(true);
    for (const trap of ["CLI-008", "CLI-021", "CLI-022", "CLI-026", "CLI-027"]) {
      expect(tables.clients.map((c) => c.id)).toContain(trap);
    }
    const marsh = tables.coverages.filter((c) => c.policy_id === "POL-PA-2026-000030");
    expect(marsh.find((c) => c.type === "bodily_injury")?.limit).toBe("15000/30000");
  });

  test("AMS-R114: a policy with the seed status 'lapsed' is listed, but no status filter accepts that value", async () => {
    await ctx.svc.reset("realistic");
    const all = await ctx.api.get("/v1/policies", { query: { client_id: "CLI-033" } });
    expect(all.body.data.map((p: any) => p.status)).toContain("lapsed");
    expectError(await ctx.api.get("/v1/policies", { query: { status: "lapsed" } }), 400, "VALIDATION_ERROR");
  });

  test("AMS-R101: seed inserts rows on an empty base and reports how many per table", async () => {
    const res = await ctx.svc.http.post("/sim/seed", {
      base: "empty",
      tables: { clients: book().clients, escalations: [escalation("esc_1", { context: { k: 1 } })] },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "seeded", service: "ams", base: "empty", inserted: { clients: 4, escalations: 1 } });
    const tables = await ctx.svc.snapshot();
    expect(counts(tables)).toMatchObject({ clients: 4, policies: 0, escalations: 1 });
    // Object values are stored as JSON text.
    expect(tables.escalations[0].context).toBe('{"k":1}');
  });

  test("AMS-R101: on a non-empty base a row with an existing primary key replaces the seed row", async () => {
    await ctx.svc.seed({
      base: "clean",
      tables: {
        policies: [policy("POL-PA-2025-001847", "CLI-001", { status: "cancelled" }), policy("POL-EXTRA", "CLI-001")],
      },
    });
    const tables = await ctx.svc.snapshot();
    expect(tables.policies).toHaveLength(81);
    expect(tables.policies.find((p) => p.policy_id === "POL-PA-2025-001847")!.status).toBe("cancelled");
    expect(tables.clients).toHaveLength(31);
  });

  test("AMS-R101: an unknown base or table name is rejected", async () => {
    const base = await ctx.svc.http.post("/sim/seed", { base: "production" });
    expect([base.status, base.body.error_code]).toEqual([400, "VALIDATION_ERROR"]);
    const table = await ctx.svc.http.post("/sim/seed", { base: "empty", tables: { accounting_ledger: [] } });
    expect([table.status, table.body.error_code]).toEqual([400, "VALIDATION_ERROR"]);
  });
});

describe("time travel", () => {
  beforeEach(async () => {
    await ctx.svc.seed({
      tables: book({
        endorsements: [
          endorsement("END-DUE", "POL-A-AUTO", { status: "pending_review", effective_date: "2026-06-15" }),
          endorsement("END-LATER", "POL-A-AUTO", { status: "pending_review", effective_date: "2026-09-01" }),
          endorsement("END-SUBMITTED", "POL-A-AUTO", { status: "submitted_to_carrier", effective_date: "2026-01-01" }),
        ],
      }),
    });
  });

  test("AMS-R98: active policies past their expiration date expire, and pending-review endorsements that are due are applied", async () => {
    const before = await ctx.svc.snapshot();
    const res = await ctx.svc.http.post("/sim/time-travel", { target_date: "2026-06-15T12:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      service: "ams",
      transitions: { policies_expired: 2, endorsements_applied: 1 },
    });
    // The clock keeps running while the request is handled, so allow a few milliseconds.
    expect(res.body.simulated_time).toMatch(/^2026-06-15T12:00:00\.0\d\dZ$/);
    expect(typeof res.body.days_advanced).toBe("number");

    const after = await ctx.svc.snapshot();
    const statusOf = (id: string) => after.policies.find((p) => p.policy_id === id)!.status;
    // Expired: active with an expiration date before 2026-06-15.
    expect(statusOf("POL-A-AUTO")).toBe("expired");
    expect(statusOf("POL-C-OLD")).toBe("expired");
    // Still in force, or not active to begin with.
    expect(statusOf("POL-A-HOME")).toBe("active");
    expect(statusOf("POL-D-AUTO")).toBe("active");
    expect(statusOf("POL-B-AUTO")).toBe("pending");
    expect(statusOf("POL-C-CAN")).toBe("cancelled");
    expect(statusOf("POL-C-NR")).toBe("non_renewed");

    const expired = after.policies.find((p) => p.policy_id === "POL-A-AUTO")!;
    expect(expired.updated_at).toBe(res.body.simulated_time);
    const untouched = after.policies.find((p) => p.policy_id === "POL-A-HOME")!;
    expect(untouched).toEqual(before.policies.find((p) => p.policy_id === "POL-A-HOME")!);

    const endorsementStatus = Object.fromEntries(after.endorsements.map((e) => [e.endorsement_id, e.status]));
    expect(endorsementStatus).toEqual({ "END-DUE": "applied", "END-LATER": "pending_review", "END-SUBMITTED": "submitted_to_carrier" });
    expect(after.endorsements.find((e) => e.endorsement_id === "END-DUE")!.updated_at).toBe(res.body.simulated_time);
  });

  test("AMS-R98: a policy expires only after its expiration date, and days are counted from the current simulated time", async () => {
    await ctx.svc.timeTravel({ target_date: "2026-06-01T08:00:00.000Z" });
    expect((await ctx.api.get("/v1/policies/POL-A-AUTO")).body.status).toBe("active");
    const res = await ctx.svc.timeTravel({ days: 1 });
    expect(res).toMatchObject({ days_advanced: 1, transitions: { policies_expired: 1 } });
    expect(res.simulated_time.slice(0, 16)).toBe("2026-06-02T08:00");
    expect((await ctx.api.get("/v1/policies/POL-A-AUTO")).body.status).toBe("expired");
  });

  test("AMS-R98: moving the clock back does not undo transitions", async () => {
    await ctx.svc.timeTravel({ target_date: "2026-06-15T00:00:00.000Z" });
    const back = await ctx.svc.timeTravel({ target_date: "2026-01-01T00:00:00.000Z" });
    expect(back.transitions).toEqual({ policies_expired: 0, endorsements_applied: 0 });
    expect((await ctx.api.get("/v1/policies/POL-A-AUTO")).body.status).toBe("expired");
  });

  test("AMS-R98: a body without days or target_date is rejected", async () => {
    const res = await ctx.svc.http.post("/sim/time-travel", {});
    expect([res.status, res.body.error_code]).toEqual([400, "VALIDATION_ERROR"]);
  });

  test("AMS-R98, AMS-R57: an expired policy can no longer be endorsed, and expiry shows in the status filter", async () => {
    await ctx.svc.timeTravel({ target_date: "2026-06-15T00:00:00.000Z" });
    const res = await ctx.api.post("/v1/policies/POL-A-AUTO/endorsements", {
      effective_date: "2026-07-01",
      change_type: "other",
      changes: { a: 1 },
    });
    expectError(res, 409, "CONFLICT");
    const expired = await ctx.api.get("/v1/policies", { query: { status: "expired" } });
    expect(expired.body.data.map((p: any) => p.policy_id).sort()).toEqual(["POL-A-AUTO", "POL-C-EXP", "POL-C-OLD"]);
  });

  test("AMS-R1: timestamps written by the API follow the simulated clock", async () => {
    const baseMs = Date.parse("2026-10-14T12:00:00.000Z");
    await ctx.svc.timeTravel({ days: 400 });
    const simNow = (await ctx.svc.now()).getTime();
    const created = await ctx.api.post("/v1/tasks", { title: "Written in the simulated future" });
    const policyRes = await ctx.api.post(
      "/v1/policies",
      policyBody({ effective_date: "2027-12-01", expiration_date: "2028-12-01" }),
    );
    for (const stamp of [created.body.created_at, policyRes.body.created_at]) {
      expect(stamp).toMatch(ISO_UTC);
      expect(Math.abs(Date.parse(stamp) - simNow)).toBeLessThan(60_000);
    }
    expect(simNow - baseMs).toBeGreaterThan(399 * 86_400_000);
  });
});

describe("fault injection", () => {
  test("AMS-R102: an injected fault hits /v1 only; health, the control plane and the workbench keep answering", async () => {
    await ctx.svc.chaos({ enabled: true, error_rate: 1, status_code: 503 });
    const res = await ctx.api.get("/v1/clients/CLI-A");
    expect(res.status).toBe(503);
    expect(res.body.error_code).toBe("SERVICE_UNAVAILABLE");
    expect(typeof res.body.correlation_id).toBe("string");

    expect((await ctx.svc.http.get("/health")).status).toBe(200);
    expect((await ctx.svc.http.get("/sim/snapshot")).status).toBe(200);
    expect((await ctx.svc.http.get("/")).status).toBe(200);
    expect((await ctx.svc.http.get("/workbench/api/overview")).status).toBe(200);

    await ctx.svc.chaos({ enabled: false });
    expect((await ctx.api.get("/v1/clients/CLI-A")).status).toBe(200);
  });
});
