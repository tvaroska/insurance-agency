import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract, startService } from "../harness";
import { ISO_UTC, PAYMENT_METHODS, bindBody, checkError, quoteRow, requestRow, start, type Ctx } from "./support";

const contract = loadContract("rater");
let ctx: Ctx;
const bind = (quoteId: string, body: unknown) => ctx.api.post(`/v1/quotes/${quoteId}/bind`, body);

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(() => {
  ctx.ams.clear(true);
});

const seedQuote = (quote: Record<string, unknown> = {}, request: Record<string, unknown> = {}) =>
  ctx.svc.seed({
    tables: {
      quote_requests: [requestRow(request)],
      carrier_quotes: [quoteRow(quote), quoteRow({ quote_id: "QT-OTHER", carrier_code: "LIBT", carrier_name: "Liberty" })],
    },
  });

const PREMIUM_MESSAGE = "Premium of $12000.00 exceeds the $10,000 threshold requiring manager approval.";
const PREMIUM_RULE = { rule: "premium_threshold", error_code: "E_EO_PREMIUM_THRESHOLD_EXCEEDED", message: PREMIUM_MESSAGE };

describe("POST /v1/quotes/{quote_id}/bind: validation and lookup", () => {
  test("RTR-R40: payment_method, producer_id, insured_signature_collected and insured_signature_date are required", async () => {
    await seedQuote();
    const { result, diff } = await ctx.svc.changes(() => bind("QT-nope", {}));
    expectError(
      result,
      400,
      "VALIDATION_ERROR",
      { field: "payment_method", code: "required" },
      { field: "producer_id", code: "required" },
      { field: "insured_signature_collected", code: "required" },
      { field: "insured_signature_date", code: "required" },
    );
    expect(result.body.details).toHaveLength(4);
    checkError(contract, result);
    expect(diff).toEqual({});
  });

  test("RTR-R40: payment_method must be a known method and the signature date must look like YYYY-MM-DD", async () => {
    await seedQuote();
    const res = await bind("QT-1", bindBody({ payment_method: "cash", insured_signature_date: "May 20" }));
    expectError(
      res,
      400,
      "VALIDATION_ERROR",
      { field: "payment_method", code: "invalid_enum" },
      { field: "insured_signature_date", code: "invalid_format" },
    );
    for (const payment_method of PAYMENT_METHODS) {
      await seedQuote();
      expect((await bind("QT-1", bindBody({ payment_method }))).status).toBe(201);
    }
  });

  test("RTR-R40: insured_signature_collected must be true, checked after the other fields and before the lookup", async () => {
    await seedQuote();
    for (const value of [false, "true", 1]) {
      const { result, diff } = await ctx.svc.changes(() => bind("QT-nope", bindBody({ insured_signature_collected: value })));
      expectError(result, 400, "VALIDATION_ERROR", { field: "insured_signature_collected", code: "invalid_format" });
      expect(result.body.details).toHaveLength(1);
      expect(diff).toEqual({});
    }
    const both = await bind("QT-1", bindBody({ insured_signature_collected: false, payment_method: "cash" }));
    expect(both.body.details.map((d: any) => d.field)).toEqual(["payment_method"]);
  });

  test("RTR-R41: an unknown quote is 404 NOT_FOUND", async () => {
    await seedQuote();
    const res = await bind("QT-nope", bindBody());
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("quote not found.");
    checkError(contract, res);
  });

  test("RTR-R41: a bound quote and a declined quote are 409 CONFLICT", async () => {
    await seedQuote({ status: "bound", bound_at: "2024-05-02T00:00:00.000Z" });
    const bound = await ctx.svc.changes(() => bind("QT-1", bindBody()));
    expectError(bound.result, 409, "CONFLICT");
    expect(bound.result.body.message).toBe("Quote QT-1 is already bound.");
    contract.check(bound.result);
    expect(bound.diff).toEqual({});

    await seedQuote({ status: "declined" });
    const declined = await ctx.svc.changes(() => bind("QT-1", bindBody()));
    expectError(declined.result, 409, "CONFLICT");
    expect(declined.result.body.message).toBe("Cannot bind declined quote QT-1.");
    expect(declined.diff).toEqual({});
  });

  test("RTR-R41: the conflict check comes before the E&O checks", async () => {
    await seedQuote({ status: "bound", premium_annual: 12000 });
    expectError(await bind("QT-1", bindBody()), 409, "CONFLICT");
  });

  for (const status of ["pending", "expired", "error", "underwriting_hold"]) {
    test(`RTR-R41: a quote in status ${status} is refused with 409 CONFLICT`, async () => {
      await seedQuote({ status });
      const { result, diff } = await ctx.svc.changes(() => bind("QT-1", bindBody()));
      expectError(result, 409, "CONFLICT");
      expect(result.body.message).toBe(`Cannot bind quote QT-1 with status '${status}'.`);
      expect(diff).toEqual({});
    });
  }

  test("RTR-R41: a quoted row whose valid_until precedes the simulated date is refused with 409 CONFLICT", async () => {
    await seedQuote({ status: "quoted", valid_until: "2026-10-13T23:59:59.000Z" });
    const { result, diff } = await ctx.svc.changes(() => bind("QT-1", bindBody()));
    expectError(result, 409, "CONFLICT");
    expect(result.body.message).toBe("Cannot bind expired quote QT-1 (valid_until 2026-10-13T23:59:59.000Z).");
    expect(diff).toEqual({});

    await seedQuote({ status: "quoted", valid_until: "2026-10-14" });
    expect((await bind("QT-1", bindBody())).status).toBe(201);
  });
});

describe("POST /v1/quotes/{quote_id}/bind: success", () => {
  test("RTR-R45: marks the quote bound and returns the policy summary; no other row changes", async () => {
    await seedQuote();
    const { result: res, diff } = await ctx.svc.changes(() => bind("QT-1", bindBody({ notes: "ignored" })));
    expect(res.status).toBe(201);
    contract.check(res);
    const year = (await ctx.svc.now()).getUTCFullYear();
    expect(res.body).toEqual({
      policy_id: expect.stringMatching(new RegExp(`^POL-ERIE-${year}-\\d{6}$`)),
      quote_id: "QT-1",
      carrier_code: "ERIE",
      carrier_name: "Erie Mutual",
      effective_date: "2030-06-01",
      expiration_date: "2031-06-01",
      premium_annual: 1200,
      premium_monthly: 100,
      bind_status: "bound",
      bound_at: expect.stringMatching(ISO_UTC),
      policy_documents_url: expect.stringMatching(/^https?:\/\/[^/]+\/v1\/documents\?client_id=CLI-1$/),
    });
    expect(Object.keys(diff)).toEqual(["carrier_quotes"]);
    expect(diff.carrier_quotes.changed).toHaveLength(1);
    expect(diff.carrier_quotes.changed[0]).toMatchObject({ key: "QT-1" });
    expect(diff.carrier_quotes.changed[0].fields.sort()).toEqual(["bound_at", "status"]);
    expect(diff.carrier_quotes.changed[0].after).toMatchObject({ status: "bound", bound_at: res.body.bound_at });
    expect(ctx.ams.calls).toEqual([]);

    const again = await bind("QT-1", bindBody());
    expectError(again, 409, "CONFLICT");
    const other = await bind("QT-OTHER", bindBody());
    expect(other.status).toBe(201);
  });

  test("RTR-R45: a request without an effective date gives null dates", async () => {
    await seedQuote({}, { effective_date: null });
    const res = await bind("QT-1", bindBody());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ effective_date: null, expiration_date: null });
  });

  test("RTR-R45: the expiration date is one calendar year later, clamping Feb 29 to Feb 28 in non-leap years", async () => {
    await seedQuote({}, { effective_date: "2028-02-29" });
    const res = await bind("QT-1", bindBody());
    expect(res.body).toMatchObject({ effective_date: "2028-02-29", expiration_date: "2029-02-28" });
  });

  test("RTR-R42: a premium of exactly 10000 binds without escalation", async () => {
    await seedQuote({ premium_annual: 10000 });
    expect((await bind("QT-1", bindBody())).status).toBe(201);
    expect(ctx.ams.calls).toEqual([]);
  });
});

describe("POST /v1/quotes/{quote_id}/bind: premium threshold and escalation", () => {
  const big = () => seedQuote({ premium_annual: 12000, premium_monthly: 1000 }, { client_id: "CLI-7" });
  const approved = { status: "approved", client_id: "CLI-7", reason: "premium_threshold" };

  test("RTR-R42: a premium above 10000 without escalation_id is refused with 422 and nothing is written", async () => {
    await big();
    const { result: res, diff } = await ctx.svc.changes(() => bind("QT-1", bindBody()));
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: "E&O_RULES_TRIGGERED",
      error_code: "E_EO_PREMIUM_THRESHOLD_EXCEEDED",
      message: "This bind request triggers E&O rules that require manager escalation.",
      details: [{ field: "premium_annual", message: PREMIUM_MESSAGE, code: "E_EO_PREMIUM_THRESHOLD_EXCEEDED" }],
      eo_rules: [PREMIUM_RULE],
    });
    expect(diff).toEqual({});
    expect(ctx.ams.calls).toEqual([]);
    expect((await bind("QT-1", bindBody({ escalation_id: "" }))).body.error).toBe("E&O_RULES_TRIGGERED");
  });

  test("RTR-R44: with escalation_id the service asks AMS for the escalation, passing the caller's token", async () => {
    await big();
    ctx.ams.on("GET", "/v1/escalations/{id}", { body: approved });
    const token = await ctx.svc.token({ scopes: ["rater:quotes:bind"] });
    const res = await ctx.svc.withToken(token).post("/v1/quotes/QT-1/bind", bindBody({ escalation_id: "ESC 1/2" }));
    expect(res.status).toBe(201);
    contract.check(res);
    expect(res.body).toMatchObject({ quote_id: "QT-1", bind_status: "bound", premium_annual: 12000 });
    expect((await ctx.svc.table("carrier_quotes")).find((q) => q.quote_id === "QT-1")!.status).toBe("bound");

    expect(ctx.ams.calls).toHaveLength(1);
    const call = ctx.ams.calls[0];
    expect([call.method, call.path]).toEqual(["GET", "/v1/escalations/ESC%201%2F2"]);
    expect(call.headers.authorization).toBe(`Bearer ${token}`);
    expect(call.headers["x-evergreen-internal"]).toBe("1");
  });

  test("RTR-R44: an escalation AMS does not return is refused as ESCALATION_VERIFICATION_FAILED", async () => {
    await big();
    for (const status of [404, 500, 403]) {
      ctx.ams.clear(true);
      ctx.ams.on("GET", "/v1/escalations/{id}", { status, body: {} });
      const { result: res, diff } = await ctx.svc.changes(() => bind("QT-1", bindBody({ escalation_id: "ESC-1" })));
      const message = `Could not verify escalation ESC-1: ${status}`;
      expect(res.status).toBe(422);
      expect(res.body).toEqual({
        error: "ESCALATION_VERIFICATION_FAILED",
        error_code: "E_EO_PREMIUM_THRESHOLD_EXCEEDED",
        message,
        details: [{ field: "escalation_id", message, code: "E_EO_PREMIUM_THRESHOLD_EXCEEDED" }],
        eo_rules: [PREMIUM_RULE],
      });
      expect(diff).toEqual({});
    }
  });

  for (const [label, escalation, message] of [
    ["is not approved", { ...approved, status: "pending" }, "Escalation ESC-1 has status 'pending', but 'approved' is required."],
    ["belongs to another client", { ...approved, client_id: "CLI-8" }, "Escalation ESC-1 belongs to client 'CLI-8', not 'CLI-7'."],
    [
      "has another reason",
      { ...approved, reason: "backdating" },
      "Escalation ESC-1 has reason 'backdating', but 'premium_threshold' is required.",
    ],
    [
      "fails several checks (status is reported first)",
      { status: "denied", client_id: "CLI-8", reason: "backdating" },
      "Escalation ESC-1 has status 'denied', but 'approved' is required.",
    ],
  ] as const) {
    test(`RTR-R44: an escalation that ${label} is refused as ESCALATION_NOT_APPROVED`, async () => {
      await big();
      ctx.ams.on("GET", "/v1/escalations/{id}", { body: escalation });
      const { result: res, diff } = await ctx.svc.changes(() => bind("QT-1", bindBody({ escalation_id: "ESC-1" })));
      expect(res.status).toBe(422);
      expect(res.body).toEqual({
        error: "ESCALATION_NOT_APPROVED",
        error_code: "E_EO_PREMIUM_THRESHOLD_EXCEEDED",
        message,
        details: [{ field: "escalation_id", message, code: "E_EO_PREMIUM_THRESHOLD_EXCEEDED" }],
        eo_rules: [PREMIUM_RULE],
      });
      expect(diff).toEqual({});
    });
  }

  test("RTR-R44: the AMS address comes from AMS_BASE_URL, and from AMS_URL when that is empty", async () => {
    const viaFallback = await startService("rater", { env: { AMS_BASE_URL: "", AMS_URL: ctx.ams.url } });
    const api = await viaFallback.client();
    await viaFallback.seed({
      tables: { quote_requests: [requestRow({ client_id: "CLI-7" })], carrier_quotes: [quoteRow({ premium_annual: 12000 })] },
    });
    ctx.ams.on("GET", "/v1/escalations/{id}", { body: approved });
    const res = await api.post("/v1/quotes/QT-1/bind", bindBody({ escalation_id: "ESC-1" }));
    expect(res.status).toBe(201);
    expect(ctx.ams.calls.map((c) => c.path)).toEqual(["/v1/escalations/ESC-1"]);
  }, 30_000);

  test("RTR-R46: when AMS cannot be reached the answer is 500 INTERNAL_ERROR and the quote stays unbound", async () => {
    const isolated = await startService("rater");
    const api = await isolated.client();
    await isolated.seed({
      tables: { quote_requests: [requestRow()], carrier_quotes: [quoteRow({ premium_annual: 12000 })] },
    });
    const { result, diff } = await isolated.changes(() => api.post("/v1/quotes/QT-1/bind", bindBody({ escalation_id: "ESC-1" })));
    expectError(result, 500, "INTERNAL_ERROR");
    expect(diff).toEqual({});
  }, 30_000);

  test("RTR-G02: E&O 422 refusals conform to specs/rater.yaml", async () => {
    await big();
    const res = await bind("QT-1", bindBody());
    expect(res.status).toBe(422);
    contract.check(res);
  });
});

describe("POST /v1/quotes/{quote_id}/bind: state minimum limits", () => {
  const auto = (state: string | undefined, requested: unknown[], quoteCoverages: unknown[] = [], quote: Record<string, unknown> = {}) =>
    seedQuote(
      { coverages: quoteCoverages, ...quote },
      { policy_type: "personal_auto", risk_data: { ...(state ? { state } : {}), requested_coverages: requested } },
    );
  const violation = (message: string) => ({
    error: "E&O_RULES_TRIGGERED",
    error_code: "E_EO_STATE_MINIMUM_VIOLATION",
    message,
    details: [{ field: "coverages", message, code: "E_EO_STATE_MINIMUM_VIOLATION" }],
    eo_rules: [{ rule: "state_minimum_violation", error_code: "E_EO_STATE_MINIMUM_VIOLATION", message }],
  });

  test("RTR-R43: an auto quote below the state's bodily injury minimum is refused with 422", async () => {
    await auto("TX", [{ type: "bodily_injury", limit: "25/50" }]);
    const { result: res, diff } = await ctx.svc.changes(() => bind("QT-1", bindBody()));
    expect(res.status).toBe(422);
    expect(res.body).toEqual(
      violation("Bodily injury per-person limit ($25,000) is below TX statutory minimum of $30,000 (30/60/25)."),
    );
    expect(diff).toEqual({});
  });

  for (const [state, coverage, message] of [
    ["TX", { type: "bodily_injury", limit: "30/50" }, "Bodily injury per-accident limit ($50,000) is below TX statutory minimum of $60,000 (30/60/25)."],
    ["TX", { type: "property_damage", limit: "10000" }, "Property damage limit ($10,000) is below TX statutory minimum of $25,000 (30/60/25)."],
    ["TX", { type: "bodily_injury", limit: "30/60/20" }, "Property damage limit ($20,000) is below TX statutory minimum of $25,000 (30/60/25)."],
    ["NC", { coverage_type: "liability", per_person_limit: 30000, per_accident_limit: 100000 }, "Bodily injury per-person limit ($30,000) is below NC statutory minimum of $50,000 (50/100/50)."],
    ["CA", { coverage: "BI", limit: "15000/30000" }, "Bodily injury per-person limit ($15,000) is below CA statutory minimum of $30,000 (30/60/15)."],
    ["WA", { type: "bodily_injury", limit: "20/40" }, "Bodily injury per-person limit ($20,000) is below DEFAULT statutory minimum of $25,000 (25/50/10)."],
    [undefined, { type: "pd", limit: 5 }, "Property damage limit ($5,000) is below DEFAULT statutory minimum of $10,000 (25/50/10)."],
  ] as const) {
    test(`RTR-R43: ${state ?? "no state"} with ${JSON.stringify(coverage)} is refused`, async () => {
      await auto(state, [coverage]);
      const res = await bind("QT-1", bindBody());
      expect(res.status).toBe(422);
      expect(res.body).toEqual(violation(message));
    });
  }

  for (const [state, coverages] of [
    ["TX", [{ type: "bodily_injury", limit: "30/60" }, { type: "property_damage", limit: "25000" }]],
    ["TX", [{ type: "bodily_injury", limit: "100000/300000/50000" }]],
    ["FL", [{ type: "bodily_injury", limit: "10/20" }, { type: "property_damage", limit: 10 }]],
    ["WA", [{ type: "bodily_injury", limit: "25/50/10" }]],
    ["TX", [{ type: "collision", deductible: 500 }, { type: "comprehensive", limit: "1/1" }]],
  ] as const) {
    test(`RTR-R43: ${state} with ${JSON.stringify(coverages)} binds`, async () => {
      await auto(state, [...coverages]);
      expect((await bind("QT-1", bindBody())).status).toBe(201);
    });
  }

  test("RTR-R43: the coverages stored on the quote are checked as well as the requested ones", async () => {
    await auto("TX", [{ type: "bodily_injury", limit: "100/300" }], [{ type: "bodily_injury", limit: "25/50" }]);
    expect((await bind("QT-1", bindBody())).status).toBe(422);
  });

  test("RTR-R43: the state falls back to the request address, then to `state` in the bind body", async () => {
    const low = [{ type: "bodily_injury", limit: "25/50" }];
    await seedQuote({}, { policy_type: "personal_auto", risk_data: { address: { state: "TX" }, requested_coverages: low } });
    expect((await bind("QT-1", bindBody())).body.message).toContain("TX statutory minimum");
    await seedQuote({}, { policy_type: "personal_auto", risk_data: { requested_coverages: low } });
    expect((await bind("QT-1", bindBody({ state: "NC" }))).body.message).toContain("NC statutory minimum");
  });

  test("RTR-R43: the check applies to personal_auto requests only", async () => {
    await seedQuote({}, { policy_type: "homeowners", risk_data: { state: "TX", requested_coverages: [{ type: "bodily_injury", limit: "1/1" }] } });
    expect((await bind("QT-1", bindBody())).status).toBe(201);
  });

  test("RTR-R43: an escalation cannot waive a state minimum, and AMS is not asked", async () => {
    await auto("TX", [{ type: "bodily_injury", limit: "25/50" }], [], { premium_annual: 12000 });
    ctx.ams.on("GET", "/v1/escalations/{id}", { body: { status: "approved", client_id: "CLI-1", reason: "premium_threshold" } });
    const { result: res, diff } = await ctx.svc.changes(() => bind("QT-1", bindBody({ escalation_id: "ESC-1" })));
    expect(res.status).toBe(422);
    const message = "Bodily injury per-person limit ($25,000) is below TX statutory minimum of $30,000 (30/60/25).";
    expect(res.body).toEqual({
      ...violation(message),
      eo_rules: [PREMIUM_RULE, { rule: "state_minimum_violation", error_code: "E_EO_STATE_MINIMUM_VIOLATION", message }],
    });
    expect(diff).toEqual({});
    expect(ctx.ams.calls).toEqual([]);
  });
});
