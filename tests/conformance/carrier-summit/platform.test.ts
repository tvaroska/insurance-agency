import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expectError, loadContract } from "../harness";
import { API, documentRow, policyRow, quoteRow, SCOPES, start, submit, SUBMISSION, type Ctx } from "./support";

const contract = loadContract("carrier-summit");
let ctx: Ctx;

const SEED = {
  tables: {
    quotes: [quoteRow({ quote_id: "QT-PENDING" }), quoteRow({ quote_id: "QT-APPROVED", underwriting_status: "approved" })],
    policies: [policyRow({ policy_id: "POL-DOCS" })],
    policy_documents: [documentRow("SDOC-901", "POL-DOCS")],
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
const concrete = (path: string) => path.replace("{quote_id}", "QT-PENDING").replace("{policy_id}", "POL-DOCS");
const bodyFor = (operationId: string) =>
  operationId === "submitUnderwritingDecision" ? { decision: "refer" } : operationId === "submitProperty" ? SUBMISSION : undefined;

describe("public endpoints", () => {
  test("SMT-R6: GET /health answers without a token", async () => {
    const res = await ctx.svc.http.get("/health");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["status", "service", "timestamp"]);
    expect(res.body).toMatchObject({ status: "ok", service: "carrier-summit" });
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
    contract.check(res);
  });

  test("SMT-R7: GET /auth/dev-token answers without a token, and its token opens every API route", async () => {
    const res = await ctx.svc.http.get("/auth/dev-token");
    expect(res.status).toBe(200);
    contract.check(res);
    const dev = ctx.svc.withToken(res.body.token);
    for (const op of apiOperations) {
      await Bun.sleep(3);
      const answer = await dev.request(op.method, concrete(op.path), { body: bodyFor(op.operationId) });
      expect([200, 201]).toContain(answer.status);
    }
  });

  test("SMT-R8: the three clients hold the documented carrier scopes", async () => {
    const scopesOf = async (clientId: string) => {
      const res = await ctx.svc.http.post("/oauth/token", { grant_type: "client_credentials", client_id: clientId, client_secret: "dev-secret" });
      expect(res.status).toBe(200);
      return (res.body.scope as string).split(" ").filter((s) => s.startsWith("carrier:")).sort();
    };
    expect(await scopesOf("agent-full")).toEqual(Object.values(SCOPES).sort());
    expect(await scopesOf("agent-csr")).toEqual([SCOPES.policiesRead, SCOPES.quotesRead, SCOPES.quotesWrite].sort());
    expect(await scopesOf("agent-readonly")).toEqual([SCOPES.policiesRead, SCOPES.quotesRead].sort());
  });

  test("SMT-R12: a correlation id sent by the caller is echoed in the header and in error bodies", async () => {
    const ok = await ctx.api.get(`${API}/quotes/QT-PENDING`, { headers: { "X-Correlation-ID": "conformance-1" } });
    expect(ok.headers.get("x-correlation-id")).toBe("conformance-1");
    const missing = await ctx.api.get(`${API}/quotes/QT-NOPE`, { headers: { "X-Correlation-ID": "conformance-2" } });
    expect(missing.headers.get("x-correlation-id")).toBe("conformance-2");
    expect(missing.body.correlation_id).toBe("conformance-2");
    const generated = await ctx.api.get(`${API}/quotes/QT-NOPE`);
    expect(generated.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(generated.body.correlation_id).toBe(generated.headers.get("x-correlation-id"));
  });
});

describe("authentication and scopes", () => {
  test("SMT-R10: the OpenAPI file lists the six API operations with one scope each", () => {
    expect(apiOperations.map((o) => [o.operationId, o.method, o.path, o.scopes])).toEqual([
      ["getQuote", "GET", `${API}/quotes/{quote_id}`, [SCOPES.quotesRead]],
      ["submitUnderwritingDecision", "POST", `${API}/underwriting/{quote_id}/decision`, [SCOPES.underwriting]],
      ["getPolicyDocuments", "GET", `${API}/policies/{policy_id}/documents`, [SCOPES.policiesRead]],
      ["submitProperty", "POST", `${API}/submissions`, [SCOPES.quotesWrite]],
      ["getInspectionStatus", "GET", `${API}/inspections/{quote_id}`, [SCOPES.quotesRead]],
      ["getInspectionConditions", "GET", `${API}/inspections/{quote_id}/conditions`, [SCOPES.quotesRead]],
    ]);
  });

  for (const op of apiOperations) {
    test(`SMT-R9: ${op.operationId} without a valid token is 401 AUTH_ERROR and writes nothing`, async () => {
      const send = (client: typeof ctx.api) => client.request(op.method, concrete(op.path), { body: bodyFor(op.operationId) });
      const { result: res, diff } = await ctx.svc.changes(() => send(ctx.svc.http));
      expectError(res, 401, "AUTH_ERROR");
      expect(res.body.message).toBe("Missing or malformed Authorization header.");
      contract.check(res);
      expect(diff).toEqual({});
      expectError(await send(ctx.svc.http.with({ Authorization: "Token abc" })), 401, "AUTH_ERROR");
      expectError(await send(ctx.svc.withToken("not-a-jwt")), 401, "AUTH_ERROR");
      const good = await ctx.svc.token();
      const forged = `${good.slice(0, good.lastIndexOf(".") + 1)}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
      expectError(await send(ctx.svc.withToken(forged)), 401, "AUTH_ERROR");
    });

    test(`SMT-R10: ${op.operationId} needs ${op.scopes[0]}`, async () => {
      const others = Object.values(SCOPES).filter((s) => s !== op.scopes[0]);
      const without = await ctx.svc.client({ scopes: others });
      const { result: refused, diff } = await ctx.svc.changes(() =>
        without.request(op.method, concrete(op.path), { body: bodyFor(op.operationId) }),
      );
      expectError(refused, 403, "FORBIDDEN");
      expect(refused.body.message).toBe(`Missing required scope(s): ${op.scopes[0]}`);
      contract.check(refused);
      expect(diff).toEqual({});
      const only = await ctx.svc.client({ scopes: [op.scopes[0]] });
      await Bun.sleep(3);
      const allowed = await only.request(op.method, concrete(op.path), { body: bodyFor(op.operationId) });
      expect([200, 201]).toContain(allowed.status);
      contract.check(allowed);
    });
  }

  test("SMT-R10: agent-csr may submit but not decide; agent-readonly may only read", async () => {
    const csr = await ctx.svc.client({ clientId: "agent-csr" });
    expect((await submit(csr)).status).toBe(201);
    expectError(await csr.post(`${API}/underwriting/QT-PENDING/decision`, { decision: "approve" }), 403, "FORBIDDEN");
    const readonly = await ctx.svc.client({ clientId: "agent-readonly" });
    expect((await readonly.get(`${API}/quotes/QT-PENDING`)).status).toBe(200);
    expect((await readonly.get(`${API}/policies/POL-DOCS/documents`)).status).toBe(200);
    expectError(await submit(readonly), 403, "FORBIDDEN");
  });

  test("SMT-R11: checks run in the order token, scope, body, existence, state", async () => {
    const path = (id: string) => `${API}/underwriting/${id}/decision`;
    expectError(await ctx.svc.http.post(path("QT-NOPE"), {}), 401, "AUTH_ERROR");
    const noScope = await ctx.svc.client({ scopes: [SCOPES.quotesRead] });
    expectError(await noScope.post(path("QT-NOPE"), {}), 403, "FORBIDDEN");
    expectError(await ctx.api.post(path("QT-NOPE"), {}), 400, "VALIDATION_ERROR");
    expectError(await ctx.api.post(path("QT-APPROVED"), { decision: "nope" }), 400, "VALIDATION_ERROR");
    expectError(await ctx.api.post(path("QT-NOPE"), { decision: "approve" }), 404, "NOT_FOUND");
    expectError(await ctx.api.post(path("QT-APPROVED"), { decision: "approve" }), 409, "CONFLICT");
  });

  test("SMT-R13: validation, not-found and conflict errors use the shared envelope", async () => {
    const invalid = await ctx.api.post(`${API}/submissions`, { policy_type: "homeowners" });
    expect(invalid.status).toBe(400);
    expect(Object.keys(invalid.body).sort()).toEqual(["correlation_id", "details", "error_code", "message"]);
    expect(invalid.body.error_code).toBe("VALIDATION_ERROR");
    expect(invalid.body.message).toBe("One or more fields failed validation.");
    for (const d of invalid.body.details) expect(Object.keys(d).sort()).toEqual(["code", "field", "message"]);
    contract.check(invalid);
    contract.checkSchema("ErrorResponse", invalid.body);

    const missing = await ctx.api.get(`${API}/quotes/QT-NOPE`);
    expect(Object.keys(missing.body).sort()).toEqual(["correlation_id", "error_code", "message"]);
    expect(missing.body).toMatchObject({ error_code: "NOT_FOUND", message: "quote not found." });

    const conflict = await ctx.api.post(`${API}/underwriting/QT-APPROVED/decision`, { decision: "decline" });
    expect(Object.keys(conflict.body).sort()).toEqual(["correlation_id", "error_code", "message"]);
    expect(conflict.body.error_code).toBe("CONFLICT");
  });

  test("SMT-R10: every operation of the OpenAPI file was exercised", async () => {
    // A fresh contract object, so this does not depend on which tests ran before.
    const fresh = loadContract("carrier-summit");
    fresh.check(await ctx.svc.http.get("/health"));
    fresh.check(await ctx.svc.http.get("/auth/dev-token"));
    fresh.check(await ctx.svc.http.get("/auth/portal-session"));
    for (const op of fresh.operations().filter((o) => o.path.startsWith(API))) {
      const res = await ctx.svc.http.request(op.method, concrete(op.path), { body: bodyFor(op.operationId) });
      expect(res.status).toBe(401);
      fresh.check(res);
    }
    expect(fresh.unchecked()).toEqual([]);
  });

  test("Known gaps 2 & 4: /health, /auth/dev-token and /auth/portal-session match root OpenAPI paths and document strict 403", async () => {
    expect(contract.match("GET", "/health")?.operationId).toBe("getHealth");
    expect(contract.match("GET", "/auth/dev-token")?.operationId).toBe("getDevToken");
    const portalOp = contract.match("GET", "/auth/portal-session");
    expect(portalOp?.operationId).toBe("getPortalSession");
    expect(portalOp?.statuses).toContain("200");
    expect(portalOp?.statuses).toContain("403");
    contract.check(await ctx.svc.http.get("/auth/portal-session"));
    const forbiddenDesc: string = contract.document.components?.responses?.Forbidden?.description ?? "";
    expect(forbiddenDesc).toContain("MODALITY_VIOLATION");
    expect(forbiddenDesc).toContain("PORTAL_BOOTSTRAP_REQUIRED");
  });
});

describe("tables", () => {
  test("SMT-R1: the snapshot has the four tables, sorted by primary key, with stored columns", async () => {
    await ctx.svc.seed({
      tables: {
        quotes: [quoteRow({ quote_id: "QT-B" }), quoteRow({ quote_id: "QT-A" })],
        policies: [policyRow({ policy_id: "POL-B" }), policyRow({ policy_id: "POL-A" })],
        policy_documents: [documentRow("SDOC-2", "POL-A"), documentRow("SDOC-1", "POL-B")],
        underwriting_conditions: [
          { condition_id: "COND-2", quote_id: "QT-A", condition_type: "document_required", description: "d", status: "pending", created_at: "2026-01-01T00:00:00Z" },
          { condition_id: "COND-1", quote_id: "QT-A", condition_type: "document_required", description: "d", status: "pending", created_at: "2026-01-01T00:00:00Z" },
        ],
      },
    });
    const tables = await ctx.svc.snapshot();
    expect(Object.keys(tables)).toEqual(["quotes", "policies", "policy_documents", "underwriting_conditions"]);
    expect(tables.quotes.map((r) => r.quote_id)).toEqual(["QT-A", "QT-B"]);
    expect(tables.policies.map((r) => r.policy_id)).toEqual(["POL-A", "POL-B"]);
    expect(tables.policy_documents.map((r) => r.document_id)).toEqual(["SDOC-1", "SDOC-2"]);
    expect(tables.underwriting_conditions.map((r) => r.condition_id)).toEqual(["COND-1", "COND-2"]);
    expect(Object.keys(tables.quotes[0])).toEqual([
      "quote_id", "request_id", "client_id", "policy_type", "premium_annual", "premium_monthly", "coverages", "deductibles",
      "status", "decline_reason", "valid_until", "submitted_at", "underwriting_status", "underwriting_notes",
      "property_address", "property_details", "photo_checklist", "inspection_status", "inspection_scheduled_at",
      "inspection_completed_at", "inspection_notes",
    ]);
    expect(Object.keys(tables.policy_documents[0])).toEqual([
      "document_id", "policy_id", "document_type", "filename", "file_size_bytes", "version", "supersedes", "created_at",
    ]);
    expect(typeof tables.quotes[0].coverages).toBe("string");
    expect(typeof tables.policies[0].coverages).toBe("string");
  });

  test("SMT-R4: reads write nothing; a submission and a decision are the only writes, and nothing is deleted", async () => {
    const reads = await ctx.svc.changes(async () => {
      await ctx.api.get(`${API}/quotes/QT-PENDING`);
      await ctx.api.get(`${API}/policies/POL-DOCS/documents`);
      await ctx.api.get(`${API}/inspections/QT-PENDING`);
      await ctx.api.get(`${API}/inspections/QT-PENDING/conditions`);
      await ctx.svc.http.get("/auth/dev-token");
      await ctx.svc.http.get("/auth/portal-session");
      await ctx.svc.http.get("/");
    });
    expect(reads.diff).toEqual({});
    const writes = await ctx.svc.changes(async () => {
      await submit(ctx.api);
      await ctx.api.post(`${API}/underwriting/QT-PENDING/decision`, { decision: "approve" });
    });
    expect(Object.keys(writes.diff).sort()).toEqual(["quotes", "underwriting_conditions"]);
    expect(writes.diff.quotes.removed).toEqual([]);
    expect(writes.diff.underwriting_conditions.removed).toEqual([]);
    expect(writes.diff.underwriting_conditions.changed).toEqual([]);
  });

  test("SMT-R5: every operation works with no other service reachable", async () => {
    // The harness points every peer URL at a closed port.
    for (const op of apiOperations) {
      await Bun.sleep(3);
      const res = await ctx.api.request(op.method, concrete(op.path), { body: bodyFor(op.operationId) });
      expect([200, 201]).toContain(res.status);
    }
  });
});

describe("seed data", () => {
  const expectedRows = (mode: "seed" | "seed-clean") => {
    const policies = seedJson(mode, "policies.json").filter((p) => p.carrier_code === "SMIT");
    const quotes = seedJson(mode, "quotes.json").flatMap((request) =>
      request.results
        .filter((r: any) => r.carrier_code === "SMIT")
        .map((r: any) => ({
          quote_id: r.quote_id,
          request_id: request.request_id,
          client_id: request.client_id,
          policy_type: request.policy_type,
          premium_annual: r.premium_annual,
          premium_monthly: r.premium_monthly,
          coverages: JSON.stringify(r.coverages),
          deductibles: JSON.stringify(r.deductibles),
          status: r.status,
          decline_reason: r.decline_reason ?? null,
          valid_until: r.valid_until ?? null,
          submitted_at: request.submitted_at,
          underwriting_status: r.status === "declined" ? "declined" : r.status === "bound" ? "approved" : "pending_review",
          underwriting_notes: null,
          property_address: null,
          property_details: null,
          photo_checklist: null,
          inspection_status: "not_scheduled",
          inspection_scheduled_at: null,
          inspection_completed_at: null,
          inspection_notes: null,
        })),
    );
    const kinds = [
      { type: "dec_page", suffix: "declarations", base: 180000 },
      { type: "id_cards", suffix: "id_cards", base: 95000 },
      { type: "policy_jacket", suffix: "policy_jacket", base: 450000 },
    ];
    const documents: any[] = [];
    for (const p of policies) {
      const slug = p.policy_id.toLowerCase().replace(/[^a-z0-9]/g, "_");
      for (const kind of kinds) {
        const n = documents.length + 1;
        documents.push({
          document_id: `SDOC-${String(n).padStart(3, "0")}`,
          policy_id: p.policy_id,
          document_type: kind.type,
          filename: `${slug}_${kind.suffix}.pdf`,
          file_size_bytes: kind.base + (((n + 1) * 1337) % 50000),
          version: 1,
          supersedes: null,
          created_at: p.created_at,
        });
      }
    }
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
      policy_documents: documents,
      underwriting_conditions: [],
    };
  };

  test("SMT-R43: reset loads the realistic set by default and clean on request", async () => {
    await submit(ctx.api);
    const res = await ctx.svc.http.post("/sim/reset");
    expect(res.body).toMatchObject({ status: "reset", service: "carrier-summit", seed_mode: "realistic" });
    const tables = await ctx.svc.snapshot();
    expect(tables.quotes).toHaveLength(14);
    expect(tables.underwriting_conditions).toEqual([]);
    expect((await ctx.svc.http.post("/sim/reset", { seed_mode: "clean" })).body.seed_mode).toBe("clean");
  });

  test("SMT-R43: seeding on the empty base loads only the given rows", async () => {
    await ctx.svc.seed({ tables: { quotes: [quoteRow({ quote_id: "QT-ONLY" })] } });
    const tables = await ctx.svc.snapshot();
    expect(tables.quotes.map((q) => q.quote_id)).toEqual(["QT-ONLY"]);
    expect(tables.policies).toEqual([]);
    expect(tables.policy_documents).toEqual([]);
  });

  for (const [mode, folder] of [["realistic", "seed"], ["clean", "seed-clean"]] as const) {
    test(`SMT-R44: the ${mode} seed files are mapped to rows as specified`, async () => {
      await ctx.svc.reset(mode);
      expect(await ctx.svc.snapshot()).toEqual(expectedRows(folder));
    });
  }

  test("SMT-R2: every seeded document belongs to a seeded policy", async () => {
    await ctx.svc.reset("realistic");
    const tables = await ctx.svc.snapshot();
    const policyIds = new Set(tables.policies.map((p) => p.policy_id));
    expect(tables.policy_documents.every((d) => policyIds.has(d.policy_id as string))).toBe(true);
    const sub = await submit(ctx.api);
    const conditions = await ctx.svc.table("underwriting_conditions");
    expect(conditions.every((c) => c.quote_id === sub.body.quote_id)).toBe(true);
  });

  test("SMT-R45: seed facts", async () => {
    await ctx.svc.reset("realistic");
    const tables = await ctx.svc.snapshot();
    const count = (rows: any[], key: string) =>
      rows.reduce((acc: Record<string, number>, r) => ({ ...acc, [r[key]]: (acc[r[key]] ?? 0) + 1 }), {});
    expect(count(tables.quotes, "status")).toEqual({ quoted: 7, declined: 4, bound: 1, underwriting_hold: 1, pending: 1 });
    expect(count(tables.quotes, "underwriting_status")).toEqual({ pending_review: 9, declined: 4, approved: 1 });
    expect(count(tables.policies, "status")).toEqual({ active: 15, expired: 2 });
    expect(tables.policy_documents).toHaveLength(51);

    const q1 = await ctx.api.get(`${API}/quotes/QT-001-SMIT`);
    expect(q1.body).toMatchObject({
      client_id: "CLI-003",
      policy_type: "personal_auto",
      premium_annual: 1085,
      premium_monthly: 94.5,
      status: "quoted",
      underwriting_status: "pending_review",
      valid_until: "2026-11-08",
    });
    const q2 = await ctx.api.get(`${API}/quotes/QT-002-SMIT`);
    expect(q2.body).toMatchObject({ status: "declined", underwriting_status: "declined", premium_annual: null, premium_monthly: null });
    expect(typeof q2.body.decline_reason).toBe("string");
    expect((await ctx.api.get(`${API}/quotes/QT-007-SMIT`)).body).toMatchObject({ status: "bound", underwriting_status: "approved" });
    expectError(await ctx.api.post(`${API}/underwriting/QT-007-SMIT/decision`, { decision: "refer" }), 409, "CONFLICT");

    const docs = await ctx.api.get(`${API}/policies/POL-PA-2025-001847/documents`);
    expect(docs.body.document_count).toBe(3);
    expect(docs.body.documents.map((d: any) => d.document_id).sort()).toEqual(["SDOC-001", "SDOC-002", "SDOC-003"]);
    expect(docs.body.documents.find((d: any) => d.document_id === "SDOC-001")).toMatchObject({
      document_type: "dec_page",
      filename: "pol_pa_2025_001847_declarations.pdf",
      file_size_bytes: 182674,
    });
    expect((await ctx.api.get(`${API}/inspections/QT-001-SMIT/conditions`)).body.conditions).toEqual([]);
  });
});

describe("simulated clock", () => {
  test("SMT-R46: time travel expires quoted quotes and active policies whose date is before the simulated date", async () => {
    await ctx.svc.seed({
      tables: {
        quotes: [
          quoteRow({ quote_id: "QT-PAST", valid_until: "2031-06-14" }),
          quoteRow({ quote_id: "QT-SAME-DAY", valid_until: "2031-06-15" }),
          quoteRow({ quote_id: "QT-FUTURE", valid_until: "2031-06-16" }),
          quoteRow({ quote_id: "QT-NO-DATE", valid_until: null }),
          quoteRow({ quote_id: "QT-SUBMITTED", status: "submitted", valid_until: "2031-06-14" }),
          quoteRow({ quote_id: "QT-BOUND", status: "bound", valid_until: "2031-06-14" }),
          quoteRow({ quote_id: "QT-APPROVED-QUOTED", underwriting_status: "approved", valid_until: "2031-06-14" }),
        ],
        policies: [
          policyRow({ policy_id: "POL-PAST", expiration_date: "2031-06-14" }),
          policyRow({ policy_id: "POL-SAME-DAY", expiration_date: "2031-06-15" }),
          policyRow({ policy_id: "POL-FUTURE", expiration_date: "2031-06-16" }),
          policyRow({ policy_id: "POL-CANCELLED", status: "cancelled", expiration_date: "2031-06-14" }),
        ],
      },
    });
    const res = await ctx.svc.timeTravel({ target_date: "2031-06-15T12:00:00.000Z" });
    expect(res).toMatchObject({ status: "ok", service: "carrier-summit" });
    // The clock keeps running while the request is handled, so the reported time can be a few milliseconds on.
    expect(Math.abs(Date.parse(res.simulated_time) - Date.parse("2031-06-15T12:00:00.000Z"))).toBeLessThan(1000);
    expect(res.transitions).toEqual({ quotes_expired: 2, policies_expired: 1 });
    const tables = await ctx.svc.snapshot();
    expect(Object.fromEntries(tables.quotes.map((q) => [q.quote_id, q.status]))).toEqual({
      "QT-PAST": "expired",
      "QT-SAME-DAY": "quoted",
      "QT-FUTURE": "quoted",
      "QT-NO-DATE": "quoted",
      "QT-SUBMITTED": "submitted",
      "QT-BOUND": "bound",
      "QT-APPROVED-QUOTED": "expired",
    });
    expect(tables.quotes.find((q) => q.quote_id === "QT-APPROVED-QUOTED")!.underwriting_status).toBe("approved");
    expect(Object.fromEntries(tables.policies.map((p) => [p.policy_id, [p.status, p.updated_at]]))).toEqual({
      "POL-PAST": ["expired", res.simulated_time],
      "POL-SAME-DAY": ["active", "2026-01-01T00:00:00Z"],
      "POL-FUTURE": ["active", "2026-01-01T00:00:00Z"],
      "POL-CANCELLED": ["cancelled", "2026-01-01T00:00:00Z"],
    });
    const next = await ctx.svc.timeTravel({ days: 1 });
    expect(next.transitions).toEqual({ quotes_expired: 1, policies_expired: 1 });
    expect((await ctx.api.get(`${API}/quotes/QT-PAST`)).body.status).toBe("expired");
  });

  test("SMT-R46: on realistic seed data a jump of 400 days expires the seven quoted quotes and fifteen active policies", async () => {
    await ctx.svc.reset("realistic");
    const res = await ctx.svc.timeTravel({ days: 400 });
    expect(res.transitions).toEqual({ quotes_expired: 7, policies_expired: 15 });
    expect((await ctx.svc.timeTravel({ days: 1 })).transitions).toEqual({ quotes_expired: 0, policies_expired: 0 });
  });

  test("SMT-R47: after time travel ids and timestamps advance with the simulated clock, and reseeding resets the clock", async () => {
    const baseMs = Date.parse("2026-10-14T12:00:00.000Z");
    await ctx.svc.timeTravel({ days: 365 });
    const simNow = (await ctx.svc.now()).getTime();
    expect(simNow - baseMs).toBeGreaterThan(360 * 86_400_000);
    const sub = await submit(ctx.api);
    expect(Math.abs(Number(sub.body.quote_id.slice("QT-SMIT-".length)) - simNow)).toBeLessThan(60_000);
    expect(Math.abs(Date.parse(sub.body.submitted_at) - simNow)).toBeLessThan(60_000);
    expect(Math.abs(Date.parse(sub.body.inspection_scheduled_at) - simNow - 7 * 86_400_000)).toBeLessThan(60_000);
    const decided = await ctx.api.post(`${API}/underwriting/${sub.body.quote_id}/decision`, { decision: "refer" });
    expect(Math.abs(Date.parse(decided.body.decided_at) - simNow)).toBeLessThan(60_000);
    await ctx.svc.seed(SEED);
    expect(Math.abs((await ctx.svc.now()).getTime() - baseMs)).toBeLessThan(60_000);
    expect((await ctx.svc.status()).clock_offset_ms).toBe(0);
  });
});

describe("control plane, chaos and request log", () => {
  test("SMT-R48: the control plane answers without a token", async () => {
    expect((await ctx.svc.http.get("/sim/snapshot")).body.service).toBe("carrier-summit");
    expect((await ctx.svc.http.get("/sim/status")).body).toMatchObject({ status: "ok", service: "carrier-summit" });
    expect((await ctx.svc.http.get("/sim/trace")).status).toBe(200);
    expect((await ctx.svc.http.post("/sim/time-travel", { days: 0 })).status).toBe(200);
    expect((await ctx.svc.http.post("/sim/chaos", { enabled: false })).status).toBe(200);
    expect((await ctx.svc.http.post("/sim/seed", { base: "empty" })).body).toMatchObject({ status: "seeded", service: "carrier-summit" });
    const unknown = await ctx.svc.http.post("/sim/seed", { base: "empty", tables: { id_cards: [] } });
    expect(unknown.status).toBe(400);
    expect(unknown.body.message).toContain("quotes, policies, policy_documents, underwriting_conditions");
  });

  test("SMT-R49: chaos fails API requests without running them and spares everything else", async () => {
    await ctx.svc.chaos({ enabled: true, error_rate: 1 });
    const { result: res, diff } = await ctx.svc.changes(() => submit(ctx.api));
    expectError(res, 503, "SERVICE_UNAVAILABLE");
    expect(diff).toEqual({});
    expect((await ctx.svc.http.get("/health")).status).toBe(200);
    expect((await ctx.svc.http.get("/auth/dev-token")).status).toBe(200);
    expect((await ctx.svc.http.get("/auth/portal-session")).status).toBe(200);
    expect((await ctx.svc.http.get("/")).status).toBe(200);
    await ctx.svc.chaos({ enabled: true, error_rate: 1, status_code: 502 });
    expect((await ctx.api.get(`${API}/quotes/QT-PENDING`)).status).toBe(502);
    await ctx.svc.seed(SEED);
    expect((await ctx.svc.status()).chaos.enabled).toBe(false);
    expect((await ctx.api.get(`${API}/quotes/QT-PENDING`)).status).toBe(200);
  });

  test("SMT-R50: API requests are logged under the canonical port; other requests are not; reseeding clears the log", async () => {
    const spans = async () => {
      const res = await ctx.svc.http.get("/sim/trace");
      const resource = res.body.resourceSpans[0];
      expect(resource.resource.attributes).toContainEqual({ key: "service.name", value: { stringValue: "carrier-summit" } });
      return resource.scopeSpans[0].spans as any[];
    };
    const attr = (span: any, key: string) => {
      const value = span.attributes.find((a: any) => a.key === key)?.value;
      return value?.stringValue ?? value?.intValue;
    };
    expect(await spans()).toEqual([]);
    await ctx.api.get(`${API}/quotes/QT-PENDING`);
    await ctx.api.post(`${API}/underwriting/QT-PENDING/decision`, { decision: "refer", notes: "n" });
    await ctx.svc.http.get("/health");
    await ctx.svc.http.get("/auth/dev-token");
    await ctx.svc.http.get("/");
    await ctx.api.get(`${API}/quotes/QT-PENDING`, { headers: { "X-Evergreen-Internal": "1" } });
    const logged = await spans();
    expect(logged.map((s) => s.name)).toEqual([`GET ${API}/quotes/QT-PENDING`, `POST ${API}/underwriting/QT-PENDING/decision`]);
    expect(attr(logged[0], "url.full")).toBe(`http://localhost:3005${API}/quotes/QT-PENDING`);
    expect(attr(logged[0], "server.port")).toBe(3005);
    expect(attr(logged[1], "http.response.status_code")).toBe(200);
    expect(JSON.parse(attr(logged[1], "http.request.body"))).toEqual({ decision: "refer", notes: "n" });
    await ctx.svc.seed(SEED);
    expect(await spans()).toEqual([]);
  });
});

describe("access log", () => {
  test("SMT-R54: each request is written to standard output as one JSON line", async () => {
    // Standard output is only visible when the harness started the service itself.
    if (ctx.svc.mode !== "process") return;
    const id = `access-log-${crypto.randomUUID()}`;
    const res = await ctx.api.get(`${API}/quotes/QT-NOPE`, { query: { limit: 1 }, headers: { "X-Correlation-ID": id, "User-Agent": "conformance-suite" } });
    expect(res.status).toBe(404);
    let line: string | undefined;
    for (let i = 0; i < 40 && !line; i++) {
      line = ctx.svc.logs().split("\n").find((l) => l.includes(id));
      if (!line) await Bun.sleep(25);
    }
    const entry = JSON.parse(line!);
    expect(entry).toMatchObject({
      method: "GET",
      path: `${API}/quotes/QT-NOPE`,
      status: 404,
      correlation_id: id,
      query: { limit: "1" },
      user_agent: "conformance-suite",
    });
    expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);
    expect(typeof entry.duration_ms).toBe("number");
  });
});
