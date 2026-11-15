import { beforeAll, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import {
  ISO_UTC,
  KNOWN_CLIENTS,
  POLICY_TYPES,
  QUOTE_ID,
  REQUEST_ID,
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

describe("GET /v1/quotes", () => {
  const seed = () =>
    ctx.svc.seed({
      tables: {
        quote_requests: [
          requestRow({ request_id: "QR-3", client_id: "CLI-2", policy_type: "renters", status: "pending", completed_at: null }),
          requestRow({ request_id: "QR-1", client_id: "CLI-1", policy_type: "homeowners", status: "completed" }),
          requestRow({ request_id: "QR-2", client_id: "CLI-1", policy_type: "renters", status: "completed" }),
        ],
        carrier_quotes: [
          quoteRow({ quote_id: "QT-1", request_id: "QR-1" }),
          quoteRow({
            quote_id: "QT-2",
            request_id: "QR-1",
            carrier_code: "LIBT",
            carrier_name: "Liberty",
            status: "declined",
            premium_annual: null,
            premium_monthly: null,
            decline_reason: "Roof age",
            valid_until: null,
          }),
        ],
      },
    });

  test("RTR-R10: lists quote requests by request_id with a summary of each carrier quote", async () => {
    await seed();
    const res = await ctx.api.get("/v1/quotes");
    expect(res.status).toBe(200);
    contract.check(res);
    expect(Object.keys(res.body)).toEqual(["data"]);
    expect(res.body.data.map((r: any) => r.request_id)).toEqual(["QR-1", "QR-2", "QR-3"]);
    const first = res.body.data[0];
    expect({ ...first, carriers: undefined }).toEqual({
      request_id: "QR-1",
      client_id: "CLI-1",
      policy_type: "homeowners",
      effective_date: "2030-06-01",
      status: "completed",
      submitted_at: "2024-05-01T10:00:00.000Z",
      completed_at: "2024-05-01T10:00:00.000Z",
      created_at: "2024-05-01T10:00:00.000Z",
      carriers: undefined,
    });
    expect([...first.carriers].sort((a: any, b: any) => a.carrier_code.localeCompare(b.carrier_code))).toEqual([
      {
        quote_id: "QT-1",
        carrier_code: "ERIE",
        carrier_name: "Erie Mutual",
        status: "quoted",
        premium_annual: 1200,
        premium_monthly: 100,
        decline_reason: null,
        valid_until: "2999-01-01T00:00:00.000Z",
      },
      {
        quote_id: null,
        carrier_code: "LIBT",
        carrier_name: "Liberty",
        status: "declined",
        premium_annual: null,
        premium_monthly: null,
        decline_reason: "Roof age",
        valid_until: null,
      },
    ]);
    expect(res.body.data[1].carriers).toEqual([]);
  });

  test("RTR-R11: client_id, policy_type and status filter by exact match, without validation", async () => {
    await seed();
    const ids = async (query: Record<string, string>) => {
      const res = await ctx.api.get("/v1/quotes", { query });
      expect(res.status).toBe(200);
      return res.body.data.map((r: any) => r.request_id);
    };
    expect(await ids({ client_id: "CLI-1" })).toEqual(["QR-1", "QR-2"]);
    expect(await ids({ policy_type: "renters" })).toEqual(["QR-2", "QR-3"]);
    expect(await ids({ status: "pending" })).toEqual(["QR-3"]);
    expect(await ids({ client_id: "CLI-1", policy_type: "renters", status: "completed" })).toEqual(["QR-2"]);
    expect(await ids({ status: "no-such-status" })).toEqual([]);
    expect(await ids({ policy_type: "boat" })).toEqual([]);
  });

  test("RTR-R11: carrier_code and cursor are ignored", async () => {
    await seed();
    const res = await ctx.api.get("/v1/quotes", { query: { carrier_code: "LIBT", cursor: "anything" } });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
  });

  test("RTR-R12: limit defaults to 50 and is clamped to 1..100", async () => {
    const rows = Array.from({ length: 105 }, (_, i) => requestRow({ request_id: `QR-${String(i).padStart(3, "0")}` }));
    await ctx.svc.seed({ tables: { quote_requests: rows } });
    const count = async (limit?: string) => (await ctx.api.get("/v1/quotes", { query: { limit } })).body.data.length;
    expect(await count()).toBe(50);
    expect(await count("abc")).toBe(50);
    expect(await count("0")).toBe(50);
    expect(await count("-3")).toBe(1);
    expect(await count("7")).toBe(7);
    expect(await count("100")).toBe(100);
    expect(await count("1000")).toBe(100);
  });

  test.todo(
    "RTR-G09: GET /v1/quotes honours the carrier_code and cursor parameters that specs/rater.yaml documents (the service ignores both and returns no pagination data)",
  );
});

describe("POST /v1/quotes/request: validation", () => {
  const submit = (body: unknown) => ctx.api.post("/v1/quotes/request", body);

  test("RTR-R20: the top-level required fields are reported together", async () => {
    await ctx.svc.seed({ tables: { carriers: [carrierRow()] } });
    const { result, diff } = await ctx.svc.changes(() => submit({}));
    expectError(
      result,
      400,
      "VALIDATION_ERROR",
      { field: "policy_type", code: "required" },
      { field: "effective_date", code: "required" },
      { field: "client", code: "required" },
      { field: "requested_coverages", code: "required" },
    );
    expect(result.body.details).toHaveLength(4);
    checkError(contract, result);
    expect(diff).toEqual({});
  });

  test("RTR-R20: policy_type, effective_date, client fields and the state code are validated", async () => {
    await ctx.svc.seed({ tables: { carriers: [carrierRow()] } });
    const res = await submit(
      quoteRequestBody({ policy_type: "boat", effective_date: "06/01/2030", client: { address: { state: "tx" } } }),
    );
    expectError(
      res,
      400,
      "VALIDATION_ERROR",
      { field: "policy_type", code: "invalid_enum" },
      { field: "effective_date", code: "invalid_format" },
      { field: "client.first_name", code: "required" },
      { field: "client.last_name", code: "required" },
      { field: "client.address.state", code: "invalid_format" },
    );
    expect(res.body.details).toHaveLength(5);

    const noAddress = await submit(quoteRequestBody({ client: { first_name: "A", last_name: "B" } }));
    expectError(noAddress, 400, "VALIDATION_ERROR", { field: "client.address", code: "required" });
    const noState = await submit(quoteRequestBody({ client: { first_name: "A", last_name: "B", address: {} } }));
    expectError(noState, 400, "VALIDATION_ERROR", { field: "client.address.state", code: "required" });
    for (const state of ["Texas", "T", "T1"]) {
      const bad = await submit(quoteRequestBody({ client: { first_name: "A", last_name: "B", address: { state } } }));
      expectError(bad, 400, "VALIDATION_ERROR", { field: "client.address.state", code: "invalid_format" });
    }
  });

  test("RTR-R20: personal_auto needs drivers and vehicles, homeowners needs property", async () => {
    await ctx.svc.seed({ tables: { carriers: [carrierRow()] } });
    const auto = await submit(quoteRequestBody({ policy_type: "personal_auto", property: undefined }));
    expectError(
      auto,
      400,
      "VALIDATION_ERROR",
      { field: "drivers", code: "required" },
      { field: "vehicles", code: "required" },
    );
    const home = await submit(quoteRequestBody({ property: undefined }));
    expectError(home, 400, "VALIDATION_ERROR", { field: "property", code: "required" });
    const renters = await submit(quoteRequestBody({ policy_type: "renters", property: undefined }));
    expect(renters.status).toBe(202);
  });

  test("RTR-R20: requested_coverages must be a non-empty array", async () => {
    await ctx.svc.seed({ tables: { carriers: [carrierRow()] } });
    for (const requested_coverages of [[], "all", { type: "x" }]) {
      const res = await submit(quoteRequestBody({ requested_coverages }));
      expectError(res, 400, "VALIDATION_ERROR", { field: "requested_coverages", code: "invalid_format" });
    }
    const missing = await submit(quoteRequestBody({ requested_coverages: null }));
    expectError(missing, 400, "VALIDATION_ERROR", { field: "requested_coverages", code: "required" });
  });

  test("RTR-R20: every policy type is accepted", async () => {
    await ctx.svc.seed({ tables: { carriers: [carrierRow()] } });
    for (const policy_type of POLICY_TYPES) {
      const res = await submit(quoteRequestBody({ policy_type, drivers: [{}], vehicles: [{}] }));
      expect(res.status).toBe(202);
    }
  });
});

describe("POST /v1/quotes/request: effects", () => {
  const submit = (body: unknown) => ctx.api.post("/v1/quotes/request", body);
  const CARRIERS = [
    carrierRow({ carrier_code: "ERIE", carrier_name: "Erie Mutual", states: ["TX", "IL"], policy_types: ["homeowners"] }),
    carrierRow({ carrier_code: "HRTF", carrier_name: "Hartfield", states: ["TX"], policy_types: ["homeowners", "renters"] }),
    carrierRow({ carrier_code: "LIBT", carrier_name: "Liberty", states: ["IL"], policy_types: ["homeowners"] }),
    carrierRow({ carrier_code: "NTNW", carrier_name: "National", states: ["TX"], policy_types: ["personal_auto"] }),
  ];

  test("RTR-R21, RTR-R22, RTR-R24: stores the request, one quote per eligible carrier, and answers 202", async () => {
    await ctx.svc.seed({ tables: { carriers: CARRIERS } });
    const body = quoteRequestBody({ business: { employees: 3 }, client_id: "CLI-55" });
    const simMs = (await ctx.svc.now()).getTime();
    const { result: res, diff } = await ctx.svc.changes(() => submit(body));
    expect(res.status).toBe(202);
    contract.check(res);
    expect(res.body).toEqual({
      request_id: expect.stringMatching(REQUEST_ID),
      status: "completed",
      created_at: expect.stringMatching(ISO_UTC),
      estimated_completion: expect.stringMatching(ISO_UTC),
      carriers_queried: 2,
    });
    const eta = Date.parse(res.body.estimated_completion) - Date.parse(res.body.created_at);
    expect(eta).toBeGreaterThanOrEqual(120_000);
    expect(eta).toBeLessThan(125_000);
    expect(Math.abs(Date.parse(res.body.created_at) - simMs)).toBeLessThan(60_000);

    expect(Object.keys(diff).sort()).toEqual(["carrier_quotes", "quote_requests"]);
    expect(diff.quote_requests.added).toEqual([
      {
        request_id: res.body.request_id,
        client_id: "CLI-55",
        policy_type: "homeowners",
        effective_date: "2030-06-01",
        status: "completed",
        submitted_at: res.body.created_at,
        completed_at: res.body.created_at,
        expires_at: null,
        risk_data: expect.any(String),
        created_at: res.body.created_at,
      },
    ]);
    expect(JSON.parse(diff.quote_requests.added[0].risk_data as string)).toEqual({
      state: "TX",
      address: { state: "TX" },
      requested_coverages: body.requested_coverages,
      property: { year_built: 1999 },
      business: { employees: 3 },
    });

    const quotes = diff.carrier_quotes.added as any[];
    expect(quotes.map((q) => q.carrier_code).sort()).toEqual(["ERIE", "HRTF"]);
    for (const quote of quotes) {
      expect(quote).toEqual({
        quote_id: expect.stringMatching(QUOTE_ID),
        request_id: res.body.request_id,
        carrier_code: quote.carrier_code,
        carrier_name: quote.carrier_code === "ERIE" ? "Erie Mutual" : "Hartfield",
        status: "quoted",
        premium_annual: expect.any(Number),
        premium_monthly: expect.any(Number),
        coverages: JSON.stringify(body.requested_coverages),
        deductibles: "{}",
        decline_reason: null,
        valid_until: expect.stringMatching(ISO_UTC),
        bound_at: null,
        created_at: res.body.created_at,
      });
      const days = (Date.parse(quote.valid_until) - Date.parse(res.body.created_at)) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(30);
      expect(days).toBeLessThan(30.01);
    }
    expect(new Set(quotes.map((q) => q.quote_id)).size).toBe(2);
  });

  test("RTR-R22: premiums are between 800 and 5000 with two decimals, and the monthly premium is a twelfth", async () => {
    await ctx.svc.seed({ tables: { carriers: CARRIERS } });
    for (let i = 0; i < 10; i++) await submit(quoteRequestBody());
    const quotes = await ctx.svc.table("carrier_quotes");
    expect(quotes).toHaveLength(20);
    for (const quote of quotes) {
      expect(quote.premium_annual).toBeGreaterThanOrEqual(800);
      expect(quote.premium_annual).toBeLessThanOrEqual(5000);
      expect(Math.round(quote.premium_annual * 100) / 100).toBe(quote.premium_annual);
      expect(quote.premium_monthly).toBe(Math.round((quote.premium_annual / 12) * 100) / 100);
    }
    expect(new Set(quotes.map((q) => q.premium_annual)).size).toBeGreaterThan(1);
  });

  test("RTR-R21: carriers are matched on the client's state and the policy type", async () => {
    await ctx.svc.seed({ tables: { carriers: CARRIERS } });
    const codes = async (overrides: Record<string, unknown>) => {
      const res = await submit(quoteRequestBody(overrides));
      expect(res.status).toBe(202);
      const quotes = (await ctx.svc.table("carrier_quotes")).filter((q) => q.request_id === res.body.request_id);
      expect(res.body.carriers_queried).toBe(quotes.length);
      return quotes.map((q) => q.carrier_code).sort();
    };
    const inState = (state: string) => ({ first_name: "Q", last_name: "Q", address: { state } });
    expect(await codes({ client: inState("IL") })).toEqual(["ERIE", "LIBT"]);
    expect(await codes({ client: inState("TX"), policy_type: "renters" })).toEqual(["HRTF"]);
    expect(await codes({ client: inState("TX"), policy_type: "personal_auto", drivers: [{}], vehicles: [{}] })).toEqual(["NTNW"]);
  });

  test("RTR-R21, RTR-R24: with no eligible carrier the request is stored as pending and no quote is written", async () => {
    await ctx.svc.seed({ tables: { carriers: CARRIERS } });
    const { result: res, diff } = await ctx.svc.changes(() =>
      submit(quoteRequestBody({ client: { first_name: "Q", last_name: "Q", address: { state: "WY" } } })),
    );
    expect(res.status).toBe(202);
    contract.check(res);
    expect(res.body).toMatchObject({ status: "pending", carriers_queried: 0 });
    expect(Object.keys(diff)).toEqual(["quote_requests"]);
    expect(diff.quote_requests.added[0]).toMatchObject({ status: "pending", completed_at: null });

    const results = await ctx.api.get(`/v1/quotes/${res.body.request_id}/results`);
    expect(results.body).toMatchObject({ status: "pending", carriers: [] });
  });

  test("RTR-R22: risk_data keeps drivers and vehicles for an auto request", async () => {
    await ctx.svc.seed({ tables: { carriers: CARRIERS } });
    const body = quoteRequestBody({
      policy_type: "personal_auto",
      property: undefined,
      drivers: [{ name: "D" }],
      vehicles: [{ vin: "V" }],
      client: { first_name: "Q", last_name: "Q", address: { state: "TX", city: "Austin", zip: "78701" } },
    });
    await submit(body);
    const row = (await ctx.svc.table("quote_requests"))[0];
    expect(JSON.parse(row.risk_data)).toEqual({
      state: "TX",
      address: { state: "TX", city: "Austin", zip: "78701" },
      requested_coverages: body.requested_coverages,
      drivers: [{ name: "D" }],
      vehicles: [{ vin: "V" }],
    });
  });

  test("RTR-R23: the client id comes from client_id, then client.client_id, then client.id", async () => {
    await ctx.svc.seed({ tables: { carriers: CARRIERS } });
    const clientOf = async (overrides: Record<string, unknown>) => {
      const res = await submit(quoteRequestBody(overrides));
      return (await ctx.svc.table("quote_requests")).find((r) => r.request_id === res.body.request_id)!.client_id;
    };
    const person = { first_name: "Sarah", last_name: "Chen", address: { state: "TX" } };
    expect(await clientOf({ client_id: "TOP", client: { ...person, client_id: "INNER", id: "ID" } })).toBe("TOP");
    expect(await clientOf({ client: { ...person, client_id: "INNER", id: "ID" } })).toBe("INNER");
    expect(await clientOf({ client: { ...person, id: "ID" } })).toBe("ID");
    expect(await clientOf({ client: person })).toBe("CLI-001");
  });

  test("RTR-R23: a known client name maps to its client id, ignoring case", async () => {
    await ctx.svc.seed({ tables: { carriers: [] } });
    for (const [name, clientId] of Object.entries(KNOWN_CLIENTS)) {
      const [first_name, last_name] = name.split(" ");
      const res = await submit(
        quoteRequestBody({ client: { first_name: first_name.toUpperCase(), last_name: last_name.toLowerCase(), address: { state: "TX" } } }),
      );
      const row = (await ctx.svc.table("quote_requests")).find((r) => r.request_id === res.body.request_id)!;
      expect([name, row.client_id]).toEqual([name, clientId]);
    }
  });

  test("RTR-R23: an unknown name becomes <first>-<last> in lower case", async () => {
    await ctx.svc.seed({ tables: { carriers: [] } });
    await submit(quoteRequestBody({ client: { first_name: "Zed", last_name: "O'Neil", address: { state: "TX" } } }));
    expect((await ctx.svc.table("quote_requests"))[0].client_id).toBe("zed-o'neil");
  });
});

describe("GET /v1/quotes/{request_id}/results", () => {
  test("RTR-R30: an unknown request is 404 NOT_FOUND", async () => {
    await ctx.svc.seed();
    const res = await ctx.api.get("/v1/quotes/QR-nope/results");
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("quote request not found.");
    checkError(contract, res);
  });

  test("RTR-R31: returns the request with each carrier quote, coverages and deductibles as JSON values", async () => {
    await ctx.svc.seed({
      tables: {
        quote_requests: [requestRow()],
        carrier_quotes: [
          quoteRow({
            coverages: [{ coverage_type: "dwelling", limit: 300000 }],
            deductibles: { all_peril: 1000 },
          }),
          quoteRow({
            quote_id: "QT-2",
            carrier_code: "LIBT",
            carrier_name: "Liberty",
            status: "declined",
            premium_annual: null,
            premium_monthly: null,
            decline_reason: "Roof age",
            valid_until: null,
          }),
        ],
      },
    });
    const res = await ctx.api.get("/v1/quotes/QR-1/results");
    expect(res.status).toBe(200);
    contract.check(res);
    expect({ ...res.body, carriers: undefined }).toEqual({
      request_id: "QR-1",
      status: "completed",
      policy_type: "homeowners",
      effective_date: "2030-06-01",
      created_at: "2024-05-01T10:00:00.000Z",
      completed_at: "2024-05-01T10:00:00.000Z",
      carriers: undefined,
    });
    expect([...res.body.carriers].sort((a: any, b: any) => a.carrier_code.localeCompare(b.carrier_code))).toEqual([
      {
        carrier_code: "ERIE",
        carrier_name: "Erie Mutual",
        quote_id: "QT-1",
        status: "quoted",
        premium_annual: 1200,
        premium_monthly: 100,
        coverages: [{ coverage_type: "dwelling", limit: 300000 }],
        deductibles: { all_peril: 1000 },
        decline_reason: null,
        valid_until: "2999-01-01T00:00:00.000Z",
      },
      {
        carrier_code: "LIBT",
        carrier_name: "Liberty",
        quote_id: null,
        status: "declined",
        premium_annual: null,
        premium_monthly: null,
        coverages: [],
        deductibles: {},
        decline_reason: "Roof age",
        valid_until: null,
      },
    ]);
  });

  for (const [stored, quoteStatuses, expected] of [
    ["pending", ["quoted", "declined"], "completed"],
    ["pending", ["quoted", "pending"], "partial"],
    ["pending", ["pending", "pending"], "pending"],
    ["pending", [], "pending"],
    ["partial", ["quoted", "error"], "completed"],
    ["expired", ["quoted", "bound"], "completed"],
    ["requires_info", ["quoted", "pending"], "requires_info"],
    ["completed", ["pending", "pending"], "completed"],
  ] as const) {
    test(`RTR-R32: stored status ${stored} with carrier quotes [${quoteStatuses.join(", ")}] reads as ${expected}`, async () => {
      await ctx.svc.seed({
        tables: {
          quote_requests: [requestRow({ status: stored })],
          carrier_quotes: quoteStatuses.map((status, i) => quoteRow({ quote_id: `QT-${i}`, status })),
        },
      });
      const res = await ctx.api.get("/v1/quotes/QR-1/results");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(expected);
      expect((await ctx.svc.table("quote_requests"))[0].status).toBe(stored);
    });
  }
});
