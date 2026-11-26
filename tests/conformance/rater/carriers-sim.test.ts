import { beforeAll, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import {
  CARRIER_LIST_GAP,
  bindBody,
  carrier,
  carrierRow,
  checkError,
  quoteRequestBody,
  quoteRow,
  requestRow,
  start,
  type Ctx,
} from "./support";

const contract = loadContract("rater");
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);

const CARRIERS = [
  carrierRow({ carrier_code: "NTNW", carrier_name: "National", states: ["TX"], policy_types: ["personal_auto"], risk_categories: ["non_standard"] }),
  carrierRow({ carrier_code: "ERIE", carrier_name: "Erie Mutual", states: ["TX", "IL"], policy_types: ["personal_auto", "homeowners"], risk_categories: ["preferred", "standard"] }),
  carrierRow({ carrier_code: "LIBT", carrier_name: "Liberty", states: ["IL"], policy_types: ["homeowners"], risk_categories: ["preferred"] }),
  carrierRow({ carrier_code: "HRTF", carrier_name: "Hartfield", states: ["NY"], policy_types: ["bop"], risk_categories: ["standard"] }),
];

for (const [path, rule] of [
  ["/v1/carriers", "RTR-R50"],
  ["/v1/carriers/appetite", "RTR-R53"],
] as const) {
  describe(`GET ${path}`, () => {
    const codes = async (query: Record<string, string | number> = {}, allow: string[] = []) => {
      const res = await ctx.api.get(path, { query });
      expect(res.status).toBe(200);
      contract.check(res, allow.length > 0 ? { ...CARRIER_LIST_GAP, allow } : CARRIER_LIST_GAP);
      return res.body.data.map((c: any) => c.carrier_code);
    };

    test(`${rule}: lists carriers by carrier_code with the list columns as arrays`, async () => {
      await ctx.svc.seed({ tables: { carriers: CARRIERS } });
      const res = await ctx.api.get(path);
      expect(res.status).toBe(200);
      contract.check(res, CARRIER_LIST_GAP);
      expect(res.body.data.map((c: any) => c.carrier_code)).toEqual(["ERIE", "HRTF", "LIBT", "NTNW"]);
      expect(res.body.data[0]).toEqual(carrier());
      expect(res.body.pagination).toEqual({ limit: 25, cursor: null, next_cursor: null, has_more: false });
    });

    test(`${rule}, RTR-R51: state, policy_type and risk_category filter the list`, async () => {
      await ctx.svc.seed({ tables: { carriers: CARRIERS } });
      expect(await codes({ state: "TX" })).toEqual(["ERIE", "NTNW"]);
      expect(await codes({ state: "IL" })).toEqual(["ERIE", "LIBT"]);
      expect(await codes({ policy_type: "homeowners" })).toEqual(["ERIE", "LIBT"]);
      expect(await codes({ risk_category: "preferred" })).toEqual(["ERIE", "LIBT"]);
      expect(await codes({ state: "TX", policy_type: "homeowners" })).toEqual(["ERIE"]);
      expect(await codes({ state: "IL", policy_type: "homeowners", risk_category: "preferred" })).toEqual(["ERIE", "LIBT"]);
      expect(await codes({ state: "ZZ" })).toEqual([]);
      expect(await codes({ policy_type: "boat" }, ["query/policy_type:"])).toEqual([]);
    });

    test(`${rule}, RTR-R51: risk_category=standard does not select carriers that only take non_standard risks`, async () => {
      await ctx.svc.seed({ tables: { carriers: CARRIERS } });
      expect(await codes({ risk_category: "standard" })).toEqual(["ERIE", "HRTF"]);
      expect(await codes({ risk_category: "non_standard" })).toEqual(["NTNW"]);
      expect(await codes({ state: "T" }, ["query/state:"])).toEqual(["ERIE", "NTNW"]);
      expect(await codes({ policy_type: "auto" }, ["query/policy_type:"])).toEqual(["ERIE", "NTNW"]);
    });

    test(`${rule}, RTR-R51: a risk_category outside the three categories is a validation error`, async () => {
      const res = await ctx.api.get(path, { query: { risk_category: "risky" } });
      expectError(res, 400, "VALIDATION_ERROR", { field: "risk_category", code: "invalid_enum" });
      checkError(contract, res);
    });

    test(`${rule}, RTR-R52: pages with a cursor built from carrier_code`, async () => {
      await ctx.svc.seed({ tables: { carriers: CARRIERS } });
      const first = await ctx.api.get(path, { query: { limit: 3 } });
      expect(first.body.data.map((c: any) => c.carrier_code)).toEqual(["ERIE", "HRTF", "LIBT"]);
      expect(first.body.pagination).toMatchObject({ limit: 3, cursor: null, has_more: true });
      expect(JSON.parse(atob(first.body.pagination.next_cursor))).toEqual({ carrier_code: "LIBT" });
      const second = await ctx.api.get(path, { query: { limit: 3, cursor: first.body.pagination.next_cursor } });
      expect(second.body.data.map((c: any) => c.carrier_code)).toEqual(["NTNW"]);
      expect(second.body.pagination).toEqual({
        limit: 3,
        cursor: first.body.pagination.next_cursor,
        next_cursor: null,
        has_more: false,
      });
      const limit = async (value: string) => (await ctx.api.get(path, { query: { limit: value } })).body.pagination.limit;
      expect([await limit("0"), await limit("500"), await limit("abc")]).toEqual([1, 100, 25]);
      expectError(await ctx.api.get(path, { query: { cursor: "%%%" } }), 400, "VALIDATION_ERROR", {
        field: "cursor",
        code: "invalid_format",
      });
    });
  });
}

test("RTR-G08: the carrier list conforms strictly to specs/rater.yaml ({ data, pagination })", async () => {
  await ctx.svc.seed({ tables: { carriers: CARRIERS } });
  for (const path of ["/v1/carriers", "/v1/carriers/appetite"]) {
    const res = await ctx.api.get(path);
    expect(res.status).toBe(200);
    contract.check(res);
  }
});

describe("seed data", () => {
  test("RTR-R100: GET /sim/snapshot exposes the three tables; base empty leaves them empty", async () => {
    await ctx.svc.seed({ base: "empty" });
    expect(await ctx.svc.snapshot()).toEqual({ quote_requests: [], carrier_quotes: [], carriers: [] });
    expect((await ctx.api.get("/v1/quotes")).body).toEqual({
      data: [],
      pagination: { limit: 50, cursor: null, next_cursor: null, has_more: false },
    });
  });

  for (const mode of ["realistic", "clean"] as const) {
    test(`RTR-R101: the ${mode} data set has 7 carriers, 17 quote requests and 54 carrier quotes`, async () => {
      await ctx.svc.reset(mode);
      const tables = await ctx.svc.snapshot();
      const countBy = (rows: Record<string, any>[], column: string) => {
        const counts: Record<string, number> = {};
        for (const row of rows) counts[row[column]] = (counts[row[column]] ?? 0) + 1;
        return counts;
      };
      expect(tables.carriers.map((c) => c.carrier_code)).toEqual(["CSTL", "ERIE", "HRTF", "LIBT", "NTNW", "SAFECO", "SMIT"]);
      expect(tables.quote_requests).toHaveLength(17);
      expect(tables.quote_requests[0].request_id).toBe("QR-001");
      expect(countBy(tables.quote_requests, "status")).toEqual({ completed: 15, requires_info: 1, partial: 1 });
      expect(countBy(tables.quote_requests, "policy_type")).toEqual({
        personal_auto: 9,
        homeowners: 3,
        bop: 2,
        workers_comp: 1,
        renters: 1,
        general_liability: 1,
      });
      expect(tables.carrier_quotes).toHaveLength(54);
      expect(countBy(tables.carrier_quotes, "status")).toEqual({
        quoted: 31,
        declined: 12,
        bound: 7,
        underwriting_hold: 1,
        error: 1,
        pending: 2,
      });
      expect(tables.carrier_quotes.filter((q) => typeof q.premium_annual === "number" && q.premium_annual > 10000)).toEqual([]);
      expect(tables.quote_requests.filter((r) => r.effective_date !== null)).toEqual([]);
      for (const quote of tables.carrier_quotes.filter((q) => q.valid_until !== null)) {
        expect(quote.valid_until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }

      const list = await ctx.api.get("/v1/quotes", { query: { limit: 100 } });
      contract.check(list);
      expect(list.body.data).toHaveLength(17);
      for (const row of list.body.data) {
        contract.check(await ctx.api.get(`/v1/quotes/${row.request_id}/results`));
      }
      contract.check(await ctx.api.get("/v1/carriers"));
    });
  }

  test("RTR-R102: POST /sim/reset and POST /sim/seed discard earlier writes", async () => {
    await ctx.svc.reset("clean");
    await ctx.api.post("/v1/quotes/request", quoteRequestBody());
    expect(await ctx.svc.table("quote_requests")).toHaveLength(18);
    await ctx.svc.reset("clean");
    expect(await ctx.svc.table("quote_requests")).toHaveLength(17);
    expect(await ctx.svc.table("carrier_quotes")).toHaveLength(54);
  });

  test("RTR-G03..G07: seeded carriers, nullable dates, valid_until, statuses, and coverages conform strictly to specs/rater.yaml", async () => {
    await ctx.svc.reset("realistic");
    const list = await ctx.api.get("/v1/quotes", { query: { limit: 100 } });
    expect(list.status).toBe(200);
    contract.check(list);
    for (const row of list.body.data) {
      contract.check(await ctx.api.get(`/v1/quotes/${row.request_id}/results`));
    }
  });
});

describe("simulated clock", () => {
  const baseMs = Date.parse("2026-10-14T12:00:00.000Z");
  const at = (days: number) => new Date(baseMs + days * 86_400_000).toISOString();
  const seed = () =>
    ctx.svc.seed({
      tables: {
        quote_requests: [
          requestRow({ request_id: "QR-A", status: "completed", expires_at: at(10) }),
          requestRow({ request_id: "QR-B", status: "pending", expires_at: at(10) }),
          requestRow({ request_id: "QR-C", status: "partial", expires_at: at(10) }),
          requestRow({ request_id: "QR-D", status: "completed", expires_at: null }),
          requestRow({ request_id: "QR-E", status: "completed", expires_at: at(100) }),
        ],
        carrier_quotes: [
          quoteRow({ quote_id: "QT-A", request_id: "QR-A", status: "quoted", valid_until: at(10) }),
          quoteRow({ quote_id: "QT-B", request_id: "QR-A", status: "bound", valid_until: at(10) }),
          quoteRow({ quote_id: "QT-C", request_id: "QR-A", status: "pending", valid_until: at(10) }),
          quoteRow({ quote_id: "QT-D", request_id: "QR-A", status: "quoted", valid_until: null }),
          quoteRow({ quote_id: "QT-E", request_id: "QR-A", status: "quoted", valid_until: at(100) }),
        ],
      },
    });

  test("RTR-R110: moving the clock past expires_at and valid_until expires open requests and quoted quotes", async () => {
    await seed();
    const early = await ctx.svc.changes(() => ctx.svc.timeTravel({ days: 5 }));
    expect(early.result.transitions).toEqual({ quote_requests_expired: 0, carrier_quotes_expired: 0 });
    expect(early.diff).toEqual({});

    const { result, diff } = await ctx.svc.changes(() => ctx.svc.timeTravel({ days: 6 }));
    expect(result).toMatchObject({ status: "ok", service: "rater", days_advanced: 6 });
    expect(result.transitions).toEqual({ quote_requests_expired: 2, carrier_quotes_expired: 1 });
    expect(Object.keys(diff).sort()).toEqual(["carrier_quotes", "quote_requests"]);
    expect(diff.quote_requests.changed.map((c) => [c.key, c.fields, c.after.status])).toEqual([
      ["QR-A", ["status"], "expired"],
      ["QR-B", ["status"], "expired"],
    ]);
    expect(diff.carrier_quotes.changed.map((c) => [c.key, c.fields, c.after.status])).toEqual([["QT-A", ["status"], "expired"]]);
  });

  test("RTR-R111: the check runs on every time-travel call, also with zero or negative days", async () => {
    await ctx.svc.seed({
      tables: {
        quote_requests: [requestRow({ expires_at: "2000-01-01T00:00:00Z" })],
        carrier_quotes: [quoteRow({ valid_until: "2000-01-01" })],
      },
    });
    const zero = await ctx.svc.timeTravel({ days: 0 });
    expect(zero.transitions).toEqual({ quote_requests_expired: 1, carrier_quotes_expired: 1 });
    const back = await ctx.svc.timeTravel({ days: -30 });
    expect(back.transitions).toEqual({ quote_requests_expired: 0, carrier_quotes_expired: 0 });
  });

  test("RTR-R112: request handling advances with the simulated clock after time travel", async () => {
    await ctx.svc.seed({
      tables: { carriers: [carrierRow()], quote_requests: [requestRow()], carrier_quotes: [quoteRow()] },
    });
    await ctx.svc.timeTravel({ days: 400 });
    const simNow = await ctx.svc.now();
    const simMs = simNow.getTime();
    const simYear = simNow.getUTCFullYear();
    const submitted = await ctx.api.post("/v1/quotes/request", quoteRequestBody());
    expect(Math.abs(Date.parse(submitted.body.created_at) - simMs)).toBeLessThan(60_000);
    const quote = (await ctx.svc.table("carrier_quotes")).find((q) => q.request_id === submitted.body.request_id)!;
    expect(Math.abs(Date.parse(quote.valid_until) - simMs - 30 * 86_400_000)).toBeLessThan(60_000);
    const bound = await ctx.api.post("/v1/quotes/QT-1/bind", bindBody());
    expect(Math.abs(Date.parse(bound.body.bound_at) - simMs)).toBeLessThan(60_000);
    expect(bound.body.policy_id).toContain(`-${simYear}-`);
  });

  test("RTR-R113: seeding or resetting returns the clock to real time", async () => {
    await ctx.svc.seed();
    await ctx.svc.timeTravel({ days: 9 });
    await ctx.svc.seed();
    expect((await ctx.svc.status()).clock_offset_ms).toBe(0);
  });
});

test("every operation in specs/rater.yaml answers its success status with a body that matches the file", async () => {
  await ctx.svc.seed({ tables: { carriers: [carrierRow()], quote_requests: [requestRow()], carrier_quotes: [quoteRow()] } });
  const ok = (res: any, status: number, opts = {}) => {
    expect(res.status).toBe(status);
    expect(contract.check(res, opts).schemaChecked).toBe(true);
    return res.body;
  };
  ok(await ctx.api.get("/v1/quotes"), 200);
  const submitted = ok(await ctx.api.post("/v1/quotes/request", quoteRequestBody()), 202);
  ok(await ctx.api.get(`/v1/quotes/${submitted.request_id}/results`), 200);
  ok(await ctx.api.post("/v1/quotes/QT-1/bind", bindBody()), 201);
  ok(await ctx.api.get("/v1/carriers"), 200, CARRIER_LIST_GAP);
  ok(await ctx.api.get("/v1/carriers/appetite"), 200, CARRIER_LIST_GAP);
  expect(contract.unchecked()).toEqual([]);
});
