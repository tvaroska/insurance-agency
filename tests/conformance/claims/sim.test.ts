import { beforeAll, describe, expect, test } from "bun:test";
import { loadContract } from "../harness";
import { CLAIM_STATUSES, claim, fnolBody, seedTables, start, todayUtc, type Ctx } from "./support";

const contract = loadContract("claims");
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);

function countBy(rows: Record<string, any>[], column: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row[column]] = (counts[row[column]] ?? 0) + 1;
  return counts;
}

describe("seed data", () => {
  test("CLM-R100: GET /sim/snapshot exposes the four tables, each ordered by primary key", async () => {
    await ctx.svc.reset("realistic");
    const tables = await ctx.svc.snapshot();
    expect(Object.keys(tables).sort()).toEqual(["adjusters", "claim_documents", "claim_timeline", "claims"]);
    const ids = tables.claims.map((c) => c.claim_id as string);
    expect(ids).toEqual([...ids].sort());
  });

  test("CLM-R101: base empty leaves all four tables present and empty", async () => {
    await ctx.svc.seed({ base: "empty" });
    expect(await ctx.svc.snapshot()).toEqual({ adjusters: [], claims: [], claim_documents: [], claim_timeline: [] });
    const res = await ctx.api.get("/v1/adjusters");
    expect(res.body).toEqual({ data: [] });
  });

  for (const [mode, statuses, openCounts] of [
    ["realistic", { reported: 3, assigned: 2, investigating: 5, reserved: 1, settled: 2, denied: 1 }, [1, 5, 2]],
    ["clean", { reported: 3, assigned: 2, investigating: 5, reserved: 1, settled: 3 }, [2, 5, 2]],
  ] as const) {
    test(`CLM-R102: the ${mode} data set has 3 active adjusters, 14 claims, and no documents or timeline rows`, async () => {
      await ctx.svc.reset(mode);
      const tables = await ctx.svc.snapshot();
      expect(tables.adjusters.map((a) => [a.adjuster_id, a.specialty, a.active, a.max_open_claims])).toEqual([
        ["ADJ-001", "auto", 1, 25],
        ["ADJ-002", "property", 1, 20],
        ["ADJ-003", "general", 1, 30],
      ]);
      expect(tables.claims).toHaveLength(14);
      expect(countBy(tables.claims, "status")).toEqual(statuses);
      expect(tables.claims[0].claim_id).toBe("CLM-2025-000001");
      expect(tables.claims[13].claim_id).toBe("CLM-2026-000014");
      expect(tables.claim_documents).toEqual([]);
      expect(tables.claim_timeline).toEqual([]);

      const adjusters = await ctx.api.get("/v1/adjusters");
      contract.check(adjusters);
      expect(adjusters.body.data.map((a: any) => [a.adjuster_id, a.open_claims_count]).sort()).toEqual([
        ["ADJ-001", openCounts[0]],
        ["ADJ-002", openCounts[1]],
        ["ADJ-003", openCounts[2]],
      ]);

      const list = await ctx.api.get("/v1/claims", { query: { limit: 100 } });
      contract.check(list);
      expect(list.body.data).toHaveLength(14);
      expect(list.body.data[0].claim_id).toBe("CLM-2026-000010");
      for (const row of list.body.data) {
        contract.check(await ctx.api.get(`/v1/claims/${row.claim_id}`));
      }
    });
  }

  test("CLM-R102, CLM-R20: the first claim filed on the realistic data set continues the current year's sequence", async () => {
    await ctx.svc.reset("realistic");
    const year = (await ctx.svc.now()).getUTCFullYear();
    const existing = (await ctx.svc.table("claims"))
      .map((c) => c.claim_id as string)
      .filter((id) => id.startsWith(`CLM-${year}-`))
      .map((id) => Number(id.slice(-6)));
    const next = Math.max(0, ...existing) + 1;
    const res = await ctx.api.post("/v1/claims/fnol", fnolBody());
    expect(res.body.claim_id).toBe(`CLM-${year}-${String(next).padStart(6, "0")}`);
  });

  test("CLM-R103: POST /sim/reset and POST /sim/seed discard earlier writes", async () => {
    await ctx.svc.reset("clean");
    await ctx.api.post("/v1/claims/fnol", fnolBody());
    expect(await ctx.svc.table("claims")).toHaveLength(15);
    await ctx.svc.reset("clean");
    expect(await ctx.svc.table("claims")).toHaveLength(14);
    expect(await ctx.svc.table("claim_timeline")).toHaveLength(0);

    await ctx.svc.seed({ base: "clean", tables: { claims: [claim()] } });
    expect(await ctx.svc.table("claims")).toHaveLength(15);
  });
});

describe("simulated clock", () => {
  const seedAllStatuses = () =>
    ctx.svc.seed({
      tables: seedTables([
        ...CLAIM_STATUSES.map((status, i) => claim({ claim_id: `CLM-2024-00000${i + 1}`, status })),
        claim({ claim_id: "CLM-2024-000007", status: "open" }),
      ]),
    });

  test("CLM-R110: moving the clock forward turns reported, assigned and open claims into investigating", async () => {
    await seedAllStatuses();
    const before = await ctx.svc.table("claims");
    const { result, diff } = await ctx.svc.changes(() => ctx.svc.timeTravel({ days: 3 }));
    expect(result).toMatchObject({ status: "ok", service: "claims", days_advanced: 3, transitions: { claims_advanced: 3 } });

    expect(Object.keys(diff)).toEqual(["claims"]);
    expect(diff.claims.changed.map((c) => c.key).sort()).toEqual(["CLM-2024-000001", "CLM-2024-000002", "CLM-2024-000007"]);
    for (const change of diff.claims.changed) {
      expect(change.fields.sort()).toEqual(["status", "updated_at"]);
      expect(change.after.status).toBe("investigating");
      expect(change.after.updated_at).toBe(result.simulated_time);
    }
    const baseMs = Date.parse("2026-10-14T12:00:00.000Z");
    const drift = Date.parse(result.simulated_time) - baseMs - 3 * 86_400_000;
    expect(Math.abs(drift)).toBeLessThan(60_000);
    expect(before).toHaveLength(7);
  });

  test("CLM-R110: a target_date in the future has the same effect", async () => {
    await seedAllStatuses();
    const target = new Date(Date.parse("2026-10-14T12:00:00.000Z") + 10 * 86_400_000).toISOString();
    const result = await ctx.svc.timeTravel({ target_date: target });
    expect(result.transitions).toEqual({ claims_advanced: 3 });
    expect(result.simulated_time).toBe(target);
  });

  test("CLM-R111: zero or negative days change no rows", async () => {
    for (const days of [0, -2]) {
      await seedAllStatuses();
      const { result, diff } = await ctx.svc.changes(() => ctx.svc.timeTravel({ days }));
      expect(result.transitions).toEqual({ claims_advanced: 0 });
      expect(diff).toEqual({});
    }
  });

  test("CLM-R112: request handling advances with the simulated clock after time travel", async () => {
    const baseMs = Date.parse("2026-10-14T12:00:00.000Z");
    await ctx.svc.seed({ tables: seedTables() });
    await ctx.svc.timeTravel({ days: 400 });
    const simNow = await ctx.svc.now();
    const simMs = simNow.getTime();
    const simToday = simNow.toISOString().slice(0, 10);
    const simYear = simNow.getUTCFullYear();
    expect(simMs).toBeGreaterThan(baseMs + 399 * 86_400_000);

    const filed = await ctx.api.post("/v1/claims/fnol", fnolBody());
    expect(filed.status).toBe(201);
    expect(filed.body.reported_date).toBe(simToday);
    expect(filed.body.claim_id).toBe(`CLM-${simYear}-000001`);
    expect(Math.abs(Date.parse(filed.body.created_at) - simMs)).toBeLessThan(60_000);
    const event = (await ctx.svc.table("claim_timeline"))[0];
    expect(Math.abs(Date.parse(event.created_at) - simMs)).toBeLessThan(60_000);

    const beyondSimulatedToday = new Date(simMs + 30 * 86_400_000).toISOString().slice(0, 10);
    const future = await ctx.api.post("/v1/claims/fnol", fnolBody({ loss_date: beyondSimulatedToday }));
    expect(future.status).toBe(400);
    expect(future.body.details[0]).toMatchObject({ field: "loss_date", code: "out_of_range" });
  });

  test("CLM-R113: seeding or resetting returns the clock to real time", async () => {
    await ctx.svc.seed();
    await ctx.svc.timeTravel({ days: 50 });
    await ctx.svc.seed();
    expect((await ctx.svc.status()).clock_offset_ms).toBe(0);
    await ctx.svc.timeTravel({ days: 50 });
    await ctx.svc.reset("clean");
    expect((await ctx.svc.status()).clock_offset_ms).toBe(0);
  });
});
