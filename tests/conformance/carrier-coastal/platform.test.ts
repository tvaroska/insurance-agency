import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expectError, loadContract } from "../harness";
import { API, ENUM_GAPS, policyRow, quoteRow, rawQuoteRow, recommendation, riskFactors, riskScore, riskTier, SCOPES, spaced, start, type Ctx } from "./support";

const contract = loadContract("carrier-coastal");
let ctx: Ctx;

const SEED = {
  tables: {
    quotes: [
      quoteRow({ quote_id: "QT-ASSESSED" }),
      quoteRow({ quote_id: "QT-BOUND", status: "bound", bind_status: "bound", bound_at: "2026-01-06T00:00:00Z", policy_id: "POL-OLD" }),
    ],
    policies: [policyRow({ policy_id: "POL-OLD" })],
  },
};

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed(SEED);
});

const seedJson = (mode: "seed" | "seed-clean", file: string): any[] =>
  JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "data", mode, file), "utf-8"));

const apiOperations = contract.operations().filter((o) => o.path.startsWith(API));
const concrete = (path: string) => path.replace("{quote_id}", "QT-ASSESSED").replace("{policy_id}", "POL-OLD");
const BODIES: Record<string, unknown> = {
  submitQuote: { client_id: "CLI-001", policy_type: "personal_auto", effective_date: "2026-04-01" },
  bindQuote: { effective_date: "2026-04-01" },
  quickQuote: { vin: "1HGCM82633A004352", client_id: "CLI-003", driver_name: "Driver" },
  recalculateQuote: {},
};
const call = (client: typeof ctx.api, op: (typeof apiOperations)[number]) =>
  spaced(() => client.request(op.method, concrete(op.path), { body: BODIES[op.operationId] }));
const SUCCESS_GAPS = [...ENUM_GAPS, /missing required property 'deductibles'/, /missing required property 'submitted_at'/];

describe("public endpoints", () => {
  test("CST-R6: GET /health answers without a token", async () => {
    const res = await ctx.svc.http.get("/health");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["status", "service", "timestamp"]);
    expect(res.body).toMatchObject({ status: "ok", service: "carrier-coastal" });
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
    contract.check(res, { operationId: "getHealth" });
  });

  test("CST-R7: GET /auth/dev-token answers without a token, and its token opens every API route", async () => {
    const res = await ctx.svc.http.get("/auth/dev-token");
    expect(res.status).toBe(200);
    contract.check(res, { operationId: "getDevToken" });
    const dev = ctx.svc.withToken(res.body.token);
    for (const op of apiOperations) {
      await ctx.svc.seed(SEED);
      expect([200, 201]).toContain((await call(dev, op)).status);
    }
  });

  test("CST-R8: the three clients hold the documented carrier scopes", async () => {
    const scopesOf = async (clientId: string) => {
      const res = await ctx.svc.http.post("/oauth/token", { grant_type: "client_credentials", client_id: clientId, client_secret: "dev-secret" });
      expect(res.status).toBe(200);
      return (res.body.scope as string).split(" ").filter((s) => s.startsWith("carrier:")).sort();
    };
    expect(await scopesOf("agent-full")).toEqual(Object.values(SCOPES).sort());
    expect(await scopesOf("agent-csr")).toEqual([SCOPES.policiesRead, SCOPES.quotesRead, SCOPES.quotesWrite].sort());
    expect(await scopesOf("agent-readonly")).toEqual([SCOPES.policiesRead, SCOPES.quotesRead].sort());
  });

  test("CST-R12: a correlation id sent by the caller is echoed in the header and in error bodies", async () => {
    const path = `${API}/quotes/QT-ASSESSED/risk-assessment`;
    const ok = await ctx.api.get(path, { headers: { "X-Correlation-ID": "conformance-1" } });
    expect(ok.headers.get("x-correlation-id")).toBe("conformance-1");
    const missing = await ctx.api.get(`${API}/quotes/QT-NOPE/risk-assessment`, { headers: { "X-Correlation-ID": "conformance-2" } });
    expect(missing.headers.get("x-correlation-id")).toBe("conformance-2");
    expect(missing.body.correlation_id).toBe("conformance-2");
    const generated = await ctx.api.get(`${API}/quotes/QT-NOPE/risk-assessment`);
    expect(generated.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(generated.body.correlation_id).toBe(generated.headers.get("x-correlation-id"));
  });
});

describe("authentication and scopes", () => {
  test("CST-R10: the OpenAPI file lists the six API operations with one scope each", () => {
    expect(apiOperations.map((o) => [o.operationId, o.method, o.path, o.scopes])).toEqual([
      ["submitQuote", "POST", `${API}/quotes/submit`, [SCOPES.quotesWrite]],
      ["getRiskAssessment", "GET", `${API}/quotes/{quote_id}/risk-assessment`, [SCOPES.quotesRead]],
      ["bindQuote", "POST", `${API}/quotes/{quote_id}/bind`, [SCOPES.underwriting]],
      ["quickQuote", "POST", `${API}/quotes/quick`, [SCOPES.quotesWrite]],
      ["recalculateQuote", "POST", `${API}/quotes/{quote_id}/recalculate`, [SCOPES.quotesRead]],
      ["getPolicyIdCard", "GET", `${API}/policies/{policy_id}/id-card`, [SCOPES.policiesRead]],
    ]);
  });

  for (const op of apiOperations) {
    test(`CST-R9: ${op.operationId} without a valid token is 401 AUTH_ERROR and writes nothing`, async () => {
      const { result: res, diff } = await ctx.svc.changes(() => call(ctx.svc.http, op));
      expectError(res, 401, "AUTH_ERROR");
      expect(res.body.message).toBe("Missing or malformed Authorization header.");
      contract.check(res);
      expect(diff).toEqual({});
      expectError(await call(ctx.svc.http.with({ Authorization: "Token abc" }), op), 401, "AUTH_ERROR");
      expectError(await call(ctx.svc.withToken("not-a-jwt"), op), 401, "AUTH_ERROR");
      const good = await ctx.svc.token();
      const forged = `${good.slice(0, good.lastIndexOf(".") + 1)}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
      expectError(await call(ctx.svc.withToken(forged), op), 401, "AUTH_ERROR");
    });

    test(`CST-R10: ${op.operationId} needs ${op.scopes[0]}`, async () => {
      const others = Object.values(SCOPES).filter((s) => s !== op.scopes[0]);
      const without = await ctx.svc.client({ scopes: others });
      const { result: refused, diff } = await ctx.svc.changes(() => call(without, op));
      expectError(refused, 403, "FORBIDDEN");
      expect(refused.body.message).toBe(`Missing required scope(s): ${op.scopes[0]}`);
      contract.check(refused);
      expect(diff).toEqual({});
      const only = await ctx.svc.client({ scopes: [op.scopes[0]] });
      const allowed = await call(only, op);
      expect([200, 201]).toContain(allowed.status);
      contract.check(allowed, { allow: SUCCESS_GAPS });
    });
  }

  test("CST-R10: agent-csr may quote but not bind; agent-readonly may only read and recalculate", async () => {
    const csr = await ctx.svc.client({ clientId: "agent-csr" });
    expect((await spaced(() => csr.post(`${API}/quotes/quick`, BODIES.quickQuote))).status).toBe(201);
    expectError(await csr.post(`${API}/quotes/QT-ASSESSED/bind`, BODIES.bindQuote), 403, "FORBIDDEN");
    const readonly = await ctx.svc.client({ clientId: "agent-readonly" });
    expect((await readonly.get(`${API}/quotes/QT-ASSESSED/risk-assessment`)).status).toBe(200);
    expect((await readonly.post(`${API}/quotes/QT-ASSESSED/recalculate`, {})).status).toBe(200);
    expect((await readonly.get(`${API}/policies/POL-OLD/id-card`)).status).toBe(200);
    expectError(await readonly.post(`${API}/quotes/submit`, BODIES.submitQuote), 403, "FORBIDDEN");
    expectError(await readonly.post(`${API}/quotes/quick`, BODIES.quickQuote), 403, "FORBIDDEN");
  });

  test("CST-R11: checks run in the order token, scope, body, existence, state", async () => {
    const path = (id: string) => `${API}/quotes/${id}/bind`;
    await ctx.svc.seed({ tables: { quotes: [quoteRow({ quote_id: "QT-BOUND", status: "bound", bind_status: "bound" }), rawQuoteRow({ quote_id: "QT-RAW" })] } });
    expectError(await ctx.svc.http.post(path("QT-NOPE"), {}), 401, "AUTH_ERROR");
    const noScope = await ctx.svc.client({ scopes: [SCOPES.quotesRead] });
    expectError(await noScope.post(path("QT-NOPE"), {}), 403, "FORBIDDEN");
    expectError(await ctx.api.post(path("QT-NOPE"), {}), 400, "VALIDATION_ERROR");
    expectError(await ctx.api.post(path("QT-BOUND"), { payment_plan: "weekly", effective_date: "2026-04-01" }), 400, "VALIDATION_ERROR");
    expectError(await ctx.api.post(path("QT-NOPE"), { effective_date: "2026-04-01" }), 404, "NOT_FOUND");
    expectError(await ctx.api.post(path("QT-BOUND"), { effective_date: "2026-04-01" }), 409, "CONFLICT");
    expectError(await ctx.api.post(path("QT-RAW"), { effective_date: "2026-04-01" }), 400, "VALIDATION_ERROR");
  });

  test("CST-R13: validation, not-found and conflict errors use the shared envelope", async () => {
    const invalid = await ctx.api.post(`${API}/quotes/quick`, { vin: "X" });
    expect(invalid.status).toBe(400);
    expect(Object.keys(invalid.body).sort()).toEqual(["correlation_id", "details", "error_code", "message"]);
    expect(invalid.body.error_code).toBe("VALIDATION_ERROR");
    expect(invalid.body.message).toBe("One or more fields failed validation.");
    for (const d of invalid.body.details) expect(Object.keys(d).sort()).toEqual(["code", "field", "message"]);
    // Known gap 1 of specs/carrier-coastal.spec.md: the OpenAPI file documents 422.
    contract.check(invalid, { allowUndocumentedStatus: true });
    contract.checkSchema("ErrorResponse", invalid.body);

    const missing = await ctx.api.get(`${API}/policies/POL-NOPE/id-card`);
    expect(Object.keys(missing.body).sort()).toEqual(["correlation_id", "error_code", "message"]);
    expect(missing.body).toMatchObject({ error_code: "NOT_FOUND", message: "policy not found." });

    const conflict = await ctx.api.post(`${API}/quotes/QT-BOUND/bind`, { effective_date: "2026-04-01" });
    expect(Object.keys(conflict.body).sort()).toEqual(["correlation_id", "error_code", "message"]);
    expect(conflict.body.error_code).toBe("CONFLICT");
  });

  test("CST-R10: every operation of the OpenAPI file was exercised", async () => {
    // A fresh contract object, so this does not depend on which tests ran before.
    const fresh = loadContract("carrier-coastal");
    fresh.check(await ctx.svc.http.get("/health"), { operationId: "getHealth" });
    fresh.check(await ctx.svc.http.get("/auth/dev-token"), { operationId: "getDevToken" });
    for (const op of fresh.operations().filter((o) => o.path.startsWith(API))) {
      const res = await ctx.svc.http.request(op.method, concrete(op.path), { body: BODIES[op.operationId] });
      expect(res.status).toBe(401);
      fresh.check(res);
    }
    expect(fresh.unchecked()).toEqual([]);
  });

  test.todo("Known gap 2: GET /auth/portal-session and the strict-mode 403 responses are described by the OpenAPI file (they are not)", () => {});
  test.todo("Known gap 4: /health and /auth/dev-token are served under the OpenAPI server path /v1 (they are served at the root)", () => {});
});

describe("tables", () => {
  test("CST-R1: the snapshot has the three tables, sorted by primary key, with stored columns", async () => {
    await ctx.svc.seed({
      tables: {
        quotes: [quoteRow({ quote_id: "QT-B" }), quoteRow({ quote_id: "QT-A" })],
        policies: [policyRow({ policy_id: "POL-B" }), policyRow({ policy_id: "POL-A" })],
        id_cards: [
          { card_id: "IDC-2", policy_id: "POL-A", card_data: { carrier: "x" }, issued_at: "2026-01-01T00:00:00.000Z" },
          { card_id: "IDC-1", policy_id: "POL-B", card_data: { carrier: "x" }, issued_at: "2026-01-01T00:00:00.000Z" },
        ],
      },
    });
    const tables = await ctx.svc.snapshot();
    expect(Object.keys(tables)).toEqual(["quotes", "policies", "id_cards"]);
    expect(tables.quotes.map((r) => r.quote_id)).toEqual(["QT-A", "QT-B"]);
    expect(tables.policies.map((r) => r.policy_id)).toEqual(["POL-A", "POL-B"]);
    expect(tables.id_cards.map((r) => r.card_id)).toEqual(["IDC-1", "IDC-2"]);
    expect(Object.keys(tables.quotes[0])).toEqual([
      "quote_id", "request_id", "client_id", "policy_type", "premium_annual", "premium_monthly", "premium_semi_annual",
      "coverages", "deductibles", "status", "decline_reason", "valid_until", "submitted_at", "risk_score", "risk_tier",
      "risk_factors", "assessed_at", "bind_status", "bound_at", "policy_id", "vin", "vehicle_year", "vehicle_make",
      "vehicle_model", "driver_name", "driver_dob", "driver_license", "coverage_config",
    ]);
    expect(Object.keys(tables.id_cards[0])).toEqual(["card_id", "policy_id", "card_data", "issued_at"]);
  });

  test("CST-R3: JSON columns are stored as text and returned decoded", async () => {
    const tables = await ctx.svc.snapshot();
    expect(tables.quotes[0].coverages).toBe('[{"type":"bodily_injury","limit":"100/300"},{"type":"collision","deductible":500}]');
    expect(typeof tables.quotes[0].risk_factors).toBe("string");
    expect(typeof tables.policies[0].coverages).toBe("string");
    const assessment = await ctx.api.get(`${API}/quotes/QT-ASSESSED/risk-assessment`);
    expect(Array.isArray(assessment.body.factors)).toBe(true);
    const card = await ctx.api.get(`${API}/policies/POL-OLD/id-card`);
    expect(typeof card.body.card_data).toBe("object");
    expect(typeof (await ctx.svc.table("id_cards"))[0].card_data).toBe("string");
  });

  test("CST-R4: no operation removes a row, and risk assessment and recalculation write nothing", async () => {
    const reads = await ctx.svc.changes(async () => {
      await ctx.api.get(`${API}/quotes/QT-ASSESSED/risk-assessment`);
      await ctx.api.post(`${API}/quotes/QT-ASSESSED/recalculate`, {});
      await ctx.svc.http.get("/auth/dev-token");
      await ctx.svc.http.get("/auth/portal-session");
      await ctx.svc.http.get("/");
    });
    expect(reads.diff).toEqual({});
    const writes = await ctx.svc.changes(async () => {
      for (const op of apiOperations) await call(ctx.api, op);
    });
    expect(Object.keys(writes.diff).sort()).toEqual(["id_cards", "policies", "quotes"]);
    for (const table of Object.values(writes.diff)) expect(table.removed).toEqual([]);
  });

  test("CST-R5: every operation works with no other service reachable", async () => {
    // The harness points every peer URL at a closed port.
    for (const op of apiOperations) {
      await ctx.svc.seed(SEED);
      expect([200, 201]).toContain((await call(ctx.api, op)).status);
    }
  });

  test("CST-R2: a policy has at most one ID card, which names an existing policy", async () => {
    for (let i = 0; i < 3; i++) await ctx.api.get(`${API}/policies/POL-OLD/id-card`);
    const tables = await ctx.svc.snapshot();
    expect(tables.id_cards).toHaveLength(1);
    expect(tables.policies.map((p) => p.policy_id)).toContain(tables.id_cards[0].policy_id);
  });
});

describe("seed data", () => {
  const expectedRows = (mode: "seed" | "seed-clean") => {
    const policies = seedJson(mode, "policies.json").filter((p) => p.carrier_code === "CSTL");
    const quotes = seedJson(mode, "quotes.json").flatMap((request) =>
      request.results
        .filter((r: any) => r.carrier_code === "CSTL")
        .map((r: any) => {
          const score = riskScore(r.quote_id);
          const bound = r.status === "bound";
          return {
            quote_id: r.quote_id,
            request_id: request.request_id,
            client_id: request.client_id,
            policy_type: request.policy_type,
            premium_annual: r.premium_annual,
            premium_monthly: r.premium_monthly,
            premium_semi_annual: null,
            coverages: JSON.stringify(r.coverages),
            deductibles: JSON.stringify(r.deductibles),
            status: bound ? "bound" : "assessed",
            decline_reason: r.decline_reason ?? null,
            valid_until: r.valid_until ?? null,
            submitted_at: request.submitted_at,
            risk_score: score,
            risk_tier: riskTier(score),
            risk_factors: JSON.stringify(riskFactors(score)),
            assessed_at: request.submitted_at,
            bind_status: bound ? "bound" : "unbound",
            bound_at: bound ? request.submitted_at : null,
            policy_id: bound
              ? (policies.find((p) => p.client_id === request.client_id && p.status === "active")?.policy_id ?? null)
              : null,
            vin: null,
            vehicle_year: null,
            vehicle_make: null,
            vehicle_model: null,
            driver_name: null,
            driver_dob: null,
            driver_license: null,
            coverage_config: null,
          };
        }),
    );
    return {
      quotes: quotes.sort((a, b) => (a.quote_id < b.quote_id ? -1 : 1)),
      policies: policies
        .map((p) => ({
          policy_id: p.policy_id,
          client_id: p.client_id,
          policy_type: p.policy_type,
          effective_date: p.effective_date,
          expiration_date: p.expiration_date,
          premium_current: p.premium_current,
          status: p.status,
          coverages: JSON.stringify(p.coverages),
          created_at: p.created_at,
          updated_at: p.updated_at,
        }))
        .sort((a, b) => (a.policy_id < b.policy_id ? -1 : 1)),
      id_cards: [],
    };
  };

  test("CST-R50: reset loads the realistic set by default and clean on request, with no ID cards", async () => {
    await ctx.api.get(`${API}/policies/POL-OLD/id-card`);
    const res = await ctx.svc.http.post("/sim/reset");
    expect(res.body).toMatchObject({ status: "reset", service: "carrier-coastal", seed_mode: "realistic" });
    const tables = await ctx.svc.snapshot();
    expect(tables.quotes).toHaveLength(8);
    expect(tables.id_cards).toEqual([]);
    expect((await ctx.svc.http.post("/sim/reset", { seed_mode: "clean" })).body.seed_mode).toBe("clean");
  });

  const differingPolicy = async () => {
    const row = (await ctx.svc.table("policies")).find((p) => p.policy_id === "POL-PA-2026-000030")!;
    return [row.premium_current, JSON.parse(row.coverages).length];
  };

  test("CST-R50: a seed_mode other than clean loads the realistic set", async () => {
    await ctx.svc.reset("clean");
    expect(await differingPolicy()).toEqual([1250, 5]);
    for (const mode of ["demo", "CLEAN"]) {
      await ctx.svc.reset("clean");
      expect((await ctx.svc.http.post("/sim/reset", { seed_mode: mode })).status).toBe(200);
      expect(await differingPolicy()).toEqual([680, 3]);
    }
  });

  test("CST-R52: the two sets differ in policy POL-PA-2026-000030 only", async () => {
    await ctx.svc.reset("realistic");
    const realistic = await ctx.svc.snapshot();
    const policy = realistic.policies.find((p) => p.policy_id === "POL-PA-2026-000030")!;
    expect(policy.premium_current).toBe(680);
    expect(JSON.parse(policy.coverages as string)).toEqual([
      expect.objectContaining({ type: "bodily_injury", limit: "15000/30000" }),
      expect.objectContaining({ type: "property_damage", limit: "5000" }),
      expect.objectContaining({ type: "collision", deductible: 2000 }),
    ]);
    await ctx.svc.reset("clean");
    const clean = await ctx.svc.snapshot();
    expect(clean.quotes).toEqual(realistic.quotes);
    const differing = clean.policies.filter((p, i) => JSON.stringify(p) !== JSON.stringify(realistic.policies[i]));
    expect(differing.map((p) => p.policy_id)).toEqual(["POL-PA-2026-000030"]);
    expect(await differingPolicy()).toEqual([1250, 5]);
  });

  test("CST-R50: seeding on the empty base loads only the given rows", async () => {
    await ctx.svc.seed({ tables: { quotes: [quoteRow({ quote_id: "QT-ONLY" })] } });
    const tables = await ctx.svc.snapshot();
    expect(tables.quotes.map((q) => q.quote_id)).toEqual(["QT-ONLY"]);
    expect(tables.policies).toEqual([]);
  });

  for (const [mode, folder] of [["realistic", "seed"], ["clean", "seed-clean"]] as const) {
    test(`CST-R51: the ${mode} seed files are mapped to rows as specified`, async () => {
      await ctx.svc.reset(mode);
      expect(await ctx.svc.snapshot()).toEqual(expectedRows(folder));
    });
  }

  test("CST-R52: seed facts", async () => {
    await ctx.svc.reset("realistic");
    const tables = await ctx.svc.snapshot();
    const count = (rows: any[], key: (r: any) => string) =>
      rows.reduce((acc: Record<string, number>, r) => ({ ...acc, [key(r)]: (acc[key(r)] ?? 0) + 1 }), {});
    expect(count(tables.quotes, (q) => `${q.status}/${q.bind_status}`)).toEqual({ "assessed/unbound": 7, "bound/bound": 1 });
    expect(count(tables.policies, (p) => p.status)).toEqual({ active: 8, cancelled: 1, pending: 1 });

    const q1 = tables.quotes.find((q) => q.quote_id === "QT-001-CSTL")!;
    expect(q1).toMatchObject({ client_id: "CLI-003", policy_type: "personal_auto", premium_annual: 1020, premium_monthly: 89, risk_score: 80, risk_tier: "preferred" });
    const a1 = await ctx.api.get(`${API}/quotes/QT-001-CSTL/risk-assessment`);
    expect(a1.body).toMatchObject({ risk_score: 80, risk_tier: "preferred", recommendation: "approve", assessed_at: q1.submitted_at });
    contract.check(a1);
    const a2 = await ctx.api.get(`${API}/quotes/QT-002-CSTL/risk-assessment`);
    expect(a2.body).toMatchObject({ risk_score: 51, risk_tier: "standard", recommendation: "review" });
    expect(tables.quotes.find((q) => q.quote_id === "QT-002-CSTL")!.premium_annual).toBe(2780);
    for (const q of tables.quotes) {
      const score = riskScore(q.quote_id as string);
      const res = await ctx.api.get(`${API}/quotes/${q.quote_id}/risk-assessment`);
      expect(res.body).toMatchObject({ risk_score: score, risk_tier: riskTier(score), recommendation: recommendation(score), factors: riskFactors(score) });
    }
    expect(tables.quotes.find((q) => q.quote_id === "QT-005-CSTL")).toMatchObject({ status: "bound", bind_status: "bound", policy_id: "POL-PA-2025-002301" });
    expectError(await ctx.api.post(`${API}/quotes/QT-005-CSTL/bind`, { effective_date: "2026-04-01" }), 409, "CONFLICT");
    expect(tables.quotes.find((q) => q.quote_id === "QT-014-CSTL")).toMatchObject({ status: "assessed", premium_annual: null, premium_monthly: null });
    expect(tables.policies.find((p) => p.policy_id === "POL-PA-2025-002103")).toMatchObject({
      client_id: "CLI-003",
      effective_date: "2026-05-15",
      expiration_date: "2026-11-15",
      status: "active",
    });
    expectError(await ctx.api.post(`${API}/quotes/submit`, { quote_id: "QT-001-CSTL" }), 409, "CONFLICT");
  });
});

describe("simulated clock", () => {
  test("CST-R53: time travel expires quoted quotes and active policies whose date is before the simulated date", async () => {
    await ctx.svc.seed({
      tables: {
        quotes: [
          rawQuoteRow({ quote_id: "QT-PAST", valid_until: "2031-06-14" }),
          rawQuoteRow({ quote_id: "QT-SAME-DAY", valid_until: "2031-06-15" }),
          rawQuoteRow({ quote_id: "QT-FUTURE", valid_until: "2031-06-16" }),
          rawQuoteRow({ quote_id: "QT-NO-DATE", valid_until: null }),
          quoteRow({ quote_id: "QT-ASSESSED", valid_until: "2031-06-14" }),
          quoteRow({ quote_id: "QT-BOUND", status: "bound", bind_status: "bound", valid_until: "2031-06-14" }),
        ],
        policies: [
          policyRow({ policy_id: "POL-PAST", expiration_date: "2031-06-14" }),
          policyRow({ policy_id: "POL-SAME-DAY", expiration_date: "2031-06-15" }),
          policyRow({ policy_id: "POL-FUTURE", expiration_date: "2031-06-16" }),
          policyRow({ policy_id: "POL-PENDING", status: "pending", expiration_date: "2031-06-14" }),
          policyRow({ policy_id: "POL-CANCELLED", status: "cancelled", expiration_date: "2031-06-14" }),
        ],
      },
    });
    const res = await ctx.svc.timeTravel({ target_date: "2031-06-15T12:00:00.000Z" });
    expect(res).toMatchObject({ status: "ok", service: "carrier-coastal" });
    // The clock keeps running while the request is handled, so the reported time can be a few milliseconds on.
    expect(Math.abs(Date.parse(res.simulated_time) - Date.parse("2031-06-15T12:00:00.000Z"))).toBeLessThan(1000);
    expect(res.transitions).toEqual({ quotes_expired: 1, policies_expired: 1 });
    const tables = await ctx.svc.snapshot();
    expect(Object.fromEntries(tables.quotes.map((q) => [q.quote_id, q.status]))).toEqual({
      "QT-PAST": "expired",
      "QT-SAME-DAY": "quoted",
      "QT-FUTURE": "quoted",
      "QT-NO-DATE": "quoted",
      "QT-ASSESSED": "assessed",
      "QT-BOUND": "bound",
    });
    expect(Object.fromEntries(tables.policies.map((p) => [p.policy_id, [p.status, p.updated_at]]))).toEqual({
      "POL-PAST": ["expired", res.simulated_time],
      "POL-SAME-DAY": ["active", "2026-01-01T00:00:00Z"],
      "POL-FUTURE": ["active", "2026-01-01T00:00:00Z"],
      "POL-PENDING": ["pending", "2026-01-01T00:00:00Z"],
      "POL-CANCELLED": ["cancelled", "2026-01-01T00:00:00Z"],
    });
    expect((await ctx.svc.timeTravel({ days: 1 })).transitions).toEqual({ quotes_expired: 1, policies_expired: 1 });
    expectError(await ctx.api.post(`${API}/quotes/submit`, { quote_id: "QT-PAST" }), 409, "CONFLICT");
    expect((await ctx.api.post(`${API}/quotes/QT-ASSESSED/bind`, { effective_date: "2031-07-01" })).status).toBe(200);
  });

  test("CST-R53: on realistic seed data no quote expires (all are assessed or bound) and the eight active policies do", async () => {
    await ctx.svc.reset("realistic");
    const res = await ctx.svc.timeTravel({ days: 400 });
    expect(res.transitions).toEqual({ quotes_expired: 0, policies_expired: 8 });
  });

  test("CST-R54: after time travel ids, timestamps and the driver's age advance with the simulated clock; reseeding resets the clock", async () => {
    const baseMs = Date.parse("2026-10-14T12:00:00.000Z");
    await ctx.svc.timeTravel({ days: 3650 });
    const simNow = (await ctx.svc.now()).getTime();
    expect(simNow - baseMs).toBeGreaterThan(3600 * 86_400_000);
    const twentyFour = new Date(simNow - 24.5 * 365.25 * 86_400_000).toISOString().slice(0, 10);
    const quick = await spaced(() =>
      ctx.api.post(`${API}/quotes/quick`, { vin: "1HGCM82633A004352", client_id: "CLI-003", driver_name: "Driver", driver_dob: twentyFour }),
    );
    expect(Math.abs(Number(quick.body.quote_id.slice("QT-CSTL-".length)) - simNow)).toBeLessThan(60_000);
    expect(Math.abs(Date.parse(quick.body.assessed_at) - simNow)).toBeLessThan(60_000);
    expect(quick.body.premium.annual).toBe(1680);
    const bound = await spaced(() => ctx.api.post(`${API}/quotes/QT-ASSESSED/bind`, { effective_date: "2036-11-01" }));
    expect(Math.abs(Date.parse(bound.body.bound_at) - simNow)).toBeLessThan(60_000);
    const card = await ctx.api.get(`${API}/policies/${bound.body.policy_id}/id-card`);
    expect(Math.abs(Date.parse(card.body.issued_at) - simNow)).toBeLessThan(60_000);
    await ctx.svc.seed(SEED);
    expect((await ctx.svc.status()).clock_offset_ms).toBe(0);
  });
});

describe("control plane, chaos and request log", () => {
  test("CST-R55: the control plane answers without a token", async () => {
    expect((await ctx.svc.http.get("/sim/snapshot")).body.service).toBe("carrier-coastal");
    expect((await ctx.svc.http.get("/sim/status")).body).toMatchObject({ status: "ok", service: "carrier-coastal" });
    expect((await ctx.svc.http.get("/sim/trace")).status).toBe(200);
    expect((await ctx.svc.http.post("/sim/time-travel", { days: 0 })).status).toBe(200);
    expect((await ctx.svc.http.post("/sim/chaos", { enabled: false })).status).toBe(200);
    expect((await ctx.svc.http.post("/sim/seed", { base: "empty" })).body).toMatchObject({ status: "seeded", service: "carrier-coastal" });
    const unknown = await ctx.svc.http.post("/sim/seed", { base: "empty", tables: { policy_documents: [] } });
    expect(unknown.status).toBe(400);
    expect(unknown.body.message).toContain("quotes, policies, id_cards");
  });

  test("CST-R56: chaos fails API requests without running them and spares everything else", async () => {
    await ctx.svc.chaos({ enabled: true, error_rate: 1 });
    const { result: res, diff } = await ctx.svc.changes(() => ctx.api.post(`${API}/quotes/QT-ASSESSED/bind`, { effective_date: "2026-04-01" }));
    expectError(res, 503, "SERVICE_UNAVAILABLE");
    expect(diff).toEqual({});
    expect((await ctx.svc.http.get("/health")).status).toBe(200);
    expect((await ctx.svc.http.get("/auth/dev-token")).status).toBe(200);
    expect((await ctx.svc.http.get("/auth/portal-session")).status).toBe(200);
    expect((await ctx.svc.http.get("/")).status).toBe(200);
    await ctx.svc.chaos({ enabled: true, error_rate: 1, status_code: 502 });
    expect((await ctx.api.get(`${API}/quotes/QT-ASSESSED/risk-assessment`)).status).toBe(502);
    await ctx.svc.seed(SEED);
    expect((await ctx.svc.status()).chaos.enabled).toBe(false);
    expect((await ctx.api.get(`${API}/quotes/QT-ASSESSED/risk-assessment`)).status).toBe(200);
  });

  test("CST-R57: API requests are logged under the canonical port; other requests are not; reseeding clears the log", async () => {
    const spans = async () => {
      const res = await ctx.svc.http.get("/sim/trace");
      const resource = res.body.resourceSpans[0];
      expect(resource.resource.attributes).toContainEqual({ key: "service.name", value: { stringValue: "carrier-coastal" } });
      return resource.scopeSpans[0].spans as any[];
    };
    const attr = (span: any, key: string) => {
      const value = span.attributes.find((a: any) => a.key === key)?.value;
      return value?.stringValue ?? value?.intValue;
    };
    expect(await spans()).toEqual([]);
    await ctx.api.get(`${API}/quotes/QT-ASSESSED/risk-assessment`);
    await ctx.api.post(`${API}/quotes/QT-ASSESSED/recalculate`, { coverages: [] });
    await ctx.svc.http.get("/health");
    await ctx.svc.http.get("/auth/dev-token");
    await ctx.svc.http.get("/");
    await ctx.api.get(`${API}/quotes/QT-ASSESSED/risk-assessment`, { headers: { "X-Evergreen-Internal": "1" } });
    const logged = await spans();
    expect(logged.map((s) => s.name)).toEqual([`GET ${API}/quotes/QT-ASSESSED/risk-assessment`, `POST ${API}/quotes/QT-ASSESSED/recalculate`]);
    expect(attr(logged[0], "url.full")).toBe(`http://localhost:3006${API}/quotes/QT-ASSESSED/risk-assessment`);
    expect(attr(logged[0], "server.port")).toBe(3006);
    expect(attr(logged[1], "http.response.status_code")).toBe(200);
    expect(JSON.parse(attr(logged[1], "http.request.body"))).toEqual({ coverages: [] });
    await ctx.svc.seed(SEED);
    expect(await spans()).toEqual([]);
  });
});

describe("access log", () => {
  test("CST-R61: each request is written to standard output as one JSON line", async () => {
    // Standard output is only visible when the harness started the service itself.
    if (ctx.svc.mode !== "process") return;
    const id = `access-log-${crypto.randomUUID()}`;
    const res = await ctx.api.get(`${API}/policies/POL-NOPE/id-card`, { query: { limit: 1 }, headers: { "X-Correlation-ID": id, "User-Agent": "conformance-suite" } });
    expect(res.status).toBe(404);
    let line: string | undefined;
    for (let i = 0; i < 40 && !line; i++) {
      line = ctx.svc.logs().split("\n").find((l) => l.includes(id));
      if (!line) await Bun.sleep(25);
    }
    const entry = JSON.parse(line!);
    expect(entry).toMatchObject({
      method: "GET",
      path: `${API}/policies/POL-NOPE/id-card`,
      status: 404,
      correlation_id: id,
      query: { limit: "1" },
      user_agent: "conformance-suite",
    });
    expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);
    expect(typeof entry.duration_ms).toBe("number");
  });
});
