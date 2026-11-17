import { beforeAll, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { campaign, checkError, leadRow, risk, start, todayUtc, type Ctx } from "./support";

const contract = loadContract("crm");
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);

describe("GET /v1/analytics/retention-risk", () => {
  const RISKS = [
    risk({ client_id: "CLI-1", risk_score: 90, assigned_producer: "prod_1" }),
    risk({ client_id: "CLI-2", risk_score: 70, assigned_producer: "prod_2" }),
    risk({ client_id: "CLI-3", risk_score: 70, assigned_producer: "prod_1" }),
    risk({ client_id: "CLI-4", risk_score: 50, assigned_producer: "prod_2" }),
    risk({ client_id: "CLI-5", risk_score: 49, assigned_producer: "prod_1" }),
    risk({ client_id: "CLI-6", risk_score: 10, assigned_producer: "prod_1" }),
  ];
  const ids = async (query: Record<string, string | number> = {}) => {
    const res = await ctx.api.get("/v1/analytics/retention-risk", { query });
    expect(res.status).toBe(200);
    contract.check(res);
    return res.body.data.map((r: any) => r.client_id);
  };

  test("CRM-R80: returns risk rows with nested factors, by risk_score descending then client_id descending", async () => {
    await ctx.svc.seed({ tables: { retention_risks: RISKS } });
    const res = await ctx.api.get("/v1/analytics/retention-risk");
    expect(res.status).toBe(200);
    contract.check(res);
    expect(res.body.data.map((r: any) => r.client_id)).toEqual(["CLI-1", "CLI-3", "CLI-2", "CLI-4"]);
    expect(res.body.data[0]).toEqual({
      client_id: "CLI-1",
      client_name: "Client One",
      risk_score: 90,
      factors: { rate_increase_pct: 12.5, months_since_contact: 6, email_open_rate: 0.2, policies_count: 2 },
      recommended_action: "Call the client.",
    });
    expect(res.body.pagination).toEqual({ limit: 25, cursor: null, next_cursor: null, has_more: false });
  });

  test("CRM-R81: min_risk_score defaults to 50 and can be lowered or raised; assigned_producer filters", async () => {
    await ctx.svc.seed({ tables: { retention_risks: RISKS } });
    expect(await ids()).toEqual(["CLI-1", "CLI-3", "CLI-2", "CLI-4"]);
    expect(await ids({ min_risk_score: 0 })).toHaveLength(6);
    expect(await ids({ min_risk_score: 71 })).toEqual(["CLI-1"]);
    expect(await ids({ min_risk_score: 100 })).toEqual([]);
    expect(await ids({ assigned_producer: "prod_2" })).toEqual(["CLI-2", "CLI-4"]);
    expect(await ids({ assigned_producer: "prod_1", min_risk_score: 0 })).toEqual(["CLI-1", "CLI-3", "CLI-5", "CLI-6"]);
  });

  test("CRM-R81: min_risk_score outside 0..100 is out of range", async () => {
    for (const value of [-1, 101]) {
      const res = await ctx.api.get("/v1/analytics/retention-risk", { query: { min_risk_score: value } });
      expectError(res, 400, "VALIDATION_ERROR", { field: "min_risk_score", code: "out_of_range" });
      checkError(contract, res);
    }
  });

  test("CRM-R82: pages with a cursor built from risk_score and client_id", async () => {
    await ctx.svc.seed({ tables: { retention_risks: RISKS } });
    const first = await ctx.api.get("/v1/analytics/retention-risk", { query: { limit: 2 } });
    expect(first.body.data.map((r: any) => r.client_id)).toEqual(["CLI-1", "CLI-3"]);
    expect(first.body.pagination).toMatchObject({ limit: 2, has_more: true });
    expect(JSON.parse(atob(first.body.pagination.next_cursor))).toEqual({ risk_score: 70, client_id: "CLI-3" });
    const second = await ctx.api.get("/v1/analytics/retention-risk", {
      query: { limit: 2, cursor: first.body.pagination.next_cursor },
    });
    contract.check(second);
    expect(second.body.data.map((r: any) => r.client_id)).toEqual(["CLI-2", "CLI-4"]);
    expect(second.body.pagination.has_more).toBe(false);
    expectError(
      await ctx.api.get("/v1/analytics/retention-risk", { query: { cursor: btoa(JSON.stringify({ risk_score: 1 })) } }),
      400,
      "VALIDATION_ERROR",
      { field: "cursor", code: "invalid_format" },
    );
  });

  test("CRM-R83: numeric filters that are not numbers answer 500 INTERNAL_ERROR", async () => {
    expectError(await ctx.api.get("/v1/analytics/retention-risk", { query: { min_risk_score: "high" } }), 500, "INTERNAL_ERROR");
    expectError(await ctx.api.get("/v1/leads", { query: { min_score: "high" } }), 500, "INTERNAL_ERROR");
    expectError(await ctx.api.get("/v1/leads/scoring", { query: { min_score: "high" } }), 500, "INTERNAL_ERROR");
  });

  test.todo("CRM-G05: a numeric filter that is not a number gets a 400 validation error (the service answers 500)", () => {});
});

describe("seed data", () => {
  test("CRM-R100: GET /sim/snapshot exposes the four tables; base empty leaves them empty", async () => {
    await ctx.svc.seed({ base: "empty" });
    expect(await ctx.svc.snapshot()).toEqual({ leads: [], campaigns: [], campaign_enrollments: [], retention_risks: [] });
    expect((await ctx.api.get("/v1/leads")).body.data).toEqual([]);
  });

  for (const [mode, facts] of [
    ["realistic", { leads: 16, withoutClient: 0, risks: 12, risksAtDefault: 10, topLead: "lead_e5f6a7b8", topRisk: "CLI-032" }],
    ["clean", { leads: 14, withoutClient: 9, risks: 10, risksAtDefault: 8, topLead: "lead_e5f6a7b8", topRisk: "CLI-002" }],
  ] as const) {
    test(`CRM-R101: the ${mode} data set`, async () => {
      await ctx.svc.reset(mode);
      const tables = await ctx.svc.snapshot();
      expect(tables.leads).toHaveLength(facts.leads);
      expect(tables.leads.filter((l) => l.client_id === null)).toHaveLength(facts.withoutClient);
      expect(tables.campaign_enrollments).toEqual([]);
      expect(tables.retention_risks).toHaveLength(facts.risks);
      expect(tables.campaigns.map((c) => [c.campaign_id, c.type, c.status, c.enrolled_count])).toEqual([
        ["camp_auto_nurture", "nurture", "active", 205],
        ["camp_holiday_2025", "cross_sell", "completed", 430],
        ["camp_life_pivot_2026", "cross_sell", "active", 148],
        ["camp_new_client_welcome", "welcome", "active", 89],
        ["camp_renewal_q1", "retention", "active", 312],
      ]);

      const campaigns = await ctx.api.get("/v1/campaigns");
      contract.check(campaigns);
      const risks = await ctx.api.get("/v1/analytics/retention-risk", { query: { limit: 100 } });
      contract.check(risks);
      expect(risks.body.data).toHaveLength(facts.risksAtDefault);
      expect(risks.body.data[0].client_id).toBe(facts.topRisk);

      const leads = await ctx.api.get("/v1/leads", { query: { limit: 100 } });
      expect(leads.body.data).toHaveLength(facts.leads);
      expect(leads.body.data[0].lead_id).toBe(facts.topLead);
      // CRM-G02: seeded leads come back with null client_id or assigned_producer.
      contract.check(leads, { allow: [/\/(client_id|assigned_producer): is null but the schema is not nullable/] });
    });
  }

  test("CRM-R102: POST /sim/reset and POST /sim/seed discard earlier writes", async () => {
    await ctx.svc.reset("clean");
    await ctx.api.post("/v1/campaigns/camp_auto_nurture/enroll", { client_id: "CLI-001" });
    expect(await ctx.svc.table("campaign_enrollments")).toHaveLength(1);
    await ctx.svc.reset("clean");
    expect(await ctx.svc.table("campaign_enrollments")).toHaveLength(0);
    expect((await ctx.svc.table("campaigns"))[0].enrolled_count).toBe(205);
  });
});

describe("simulated clock", () => {
  const seedEnrollments = () =>
    ctx.svc.seed({
      tables: {
        leads: [leadRow()],
        campaigns: [campaign()],
        campaign_enrollments: [1, 4].map((step, i) => ({
          enrollment_id: `enr_${i}`,
          campaign_id: "camp_a",
          client_id: `CLI-${i}`,
          trigger_reason: null,
          metadata: null,
          enrolled_at: "2024-05-01T00:00:00.000Z",
          sequence_step: step,
        })),
      },
    });
  const steps = async () => (await ctx.svc.table("campaign_enrollments")).map((e) => e.sequence_step);

  for (const [days, increment] of [
    [1, 1],
    [6, 1],
    [7, 1],
    [14, 2],
    [30, 4],
  ]) {
    test(`CRM-R110: moving the clock ${days} day(s) forward advances every enrollment by ${increment} step(s)`, async () => {
      await seedEnrollments();
      const { result, diff } = await ctx.svc.changes(() => ctx.svc.timeTravel({ days }));
      expect(result).toMatchObject({ status: "ok", service: "crm", days_advanced: days });
      expect(result.transitions).toEqual({ campaign_enrollments_advanced: 2 });
      expect(await steps()).toEqual([1 + increment, 4 + increment]);
      expect(Object.keys(diff)).toEqual(["campaign_enrollments"]);
      for (const change of diff.campaign_enrollments.changed) expect(change.fields).toEqual(["sequence_step"]);
    });
  }

  test("CRM-R111: zero or negative days change nothing", async () => {
    for (const days of [0, -7]) {
      await seedEnrollments();
      const { result, diff } = await ctx.svc.changes(() => ctx.svc.timeTravel({ days }));
      expect(result.transitions).toEqual({ campaign_enrollments_advanced: 0 });
      expect(diff).toEqual({});
    }
  });

  test("CRM-R112: request handling advances with the simulated clock after time travel", async () => {
    await seedEnrollments();
    await ctx.svc.timeTravel({ days: 400 });
    const simNow = await ctx.svc.now();
    const simMs = simNow.getTime();
    const simToday = simNow.toISOString().slice(0, 10);
    const created = await ctx.api.post("/v1/leads", { first_name: "T", last_name: "T", email: "t@example.test", source: "web" });
    expect(created.body.last_activity_date).toBe(simToday);
    expect(Math.abs(Date.parse(created.body.created_at) - simMs)).toBeLessThan(60_000);
    const enrolled = await ctx.api.post("/v1/campaigns/camp_a/enroll", { client_id: "CLI-T" });
    expect(Math.abs(Date.parse(enrolled.body.enrolled_at) - simMs)).toBeLessThan(60_000);
    const patched = await ctx.api.patch("/v1/leads/lead_a", { score: 1 });
    expect(patched.body.last_activity_date).toBe(simToday);
  });

  test("CRM-R113: seeding or resetting returns the clock to real time", async () => {
    await ctx.svc.seed();
    await ctx.svc.timeTravel({ days: 9 });
    await ctx.svc.seed();
    expect((await ctx.svc.status()).clock_offset_ms).toBe(0);
  });
});

test("every operation in specs/crm.yaml answers its success status with a body that matches the file", async () => {
  await ctx.svc.seed({ tables: { leads: [leadRow()], campaigns: [campaign()], retention_risks: [risk()] } });
  const ok = (res: any, status: number) => {
    expect(res.status).toBe(status);
    contract.check(res);
    return res.body;
  };
  ok(await ctx.api.get("/v1/leads"), 200);
  ok(await ctx.api.get("/v1/leads/scoring"), 200);
  ok(await ctx.api.get("/v1/leads/lead_a"), 200);
  ok(
    await ctx.api.post("/v1/leads", {
      first_name: "A",
      last_name: "B",
      email: "a@example.test",
      source: "web",
      client_id: "CLI-2",
      phone: "+1-555-010-0002",
      assigned_producer: "prod_1",
    }),
    201,
  );
  ok(await ctx.api.patch("/v1/leads/lead_a", { score: 60 }), 200);
  ok(await ctx.api.post("/v1/leads/lead_a/enroll", { campaign_id: "camp_a" }), 201);
  ok(await ctx.api.get("/v1/campaigns"), 200);
  ok(await ctx.api.post("/v1/campaigns/camp_a/enroll", { client_id: "CLI-3" }), 201);
  ok(await ctx.api.get("/v1/analytics/retention-risk"), 200);
  expect(contract.unchecked()).toEqual([]);
});

test.todo("CRM-G08: specs/crm.yaml documents 409 for createLead and updateLead (the service never answers 409 there)", () => {});
test.todo("CRM-G09: CursorPagination in specs/crm.yaml declares next_cursor (the service returns it; the schema omits it)", () => {});
