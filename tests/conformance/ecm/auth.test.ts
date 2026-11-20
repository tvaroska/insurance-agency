import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { SCOPES, checkError, documentRow, envelopeRow, start, type Ctx } from "./support";

const contract = loadContract("ecm");
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({ tables: { documents: [documentRow()], envelopes: [envelopeRow()] } });
  // The peer stubs are shared with the other test files of the run.
  ctx.ams.clear(true);
  ctx.claims.clear(true);
});

const concretePath = (template: string) => template.replace("{form_type}", "90").replace(/\{[^}]+\}/g, "x");
// ECM-R08: no client can hold ecm:envelopes:read; ecm:documents:read stands in for it.
const effectiveScope = (scope: string) => (scope === "ecm:envelopes:read" ? "ecm:documents:read" : scope);

describe("public endpoints", () => {
  test("ECM-R01: GET /health answers without credentials", async () => {
    const res = await ctx.svc.http.get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", service: "ecm" });
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  test("ECM-R02: POST /oauth/token issues a bearer token limited to the requested scopes", async () => {
    const res = await ctx.svc.http.post("/oauth/token", {
      grant_type: "client_credentials",
      client_id: "agent-full",
      client_secret: "dev-secret",
      scope: "ecm:documents:read",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "ecm:documents:read" });

    const wrong = await ctx.svc.http.post("/oauth/token", {
      grant_type: "client_credentials",
      client_id: "agent-full",
      client_secret: "nope",
    });
    expect([wrong.status, wrong.body.error]).toEqual([401, "invalid_client"]);
  });
});

describe("authentication and scopes, for every operation in the OpenAPI file", () => {
  for (const op of contract.operations()) {
    const path = concretePath(op.path);
    const label = `${op.method} ${op.path} (${op.operationId})`;
    const body = op.method === "GET" ? undefined : {};

    test(`ECM-R03: ${label} rejects a missing or unsigned token`, async () => {
      const { result, diff } = await ctx.svc.changes(() => ctx.svc.http.request(op.method, path, { body }));
      expectError(result, 401, "AUTH_ERROR");
      checkError(contract, result);
      expect(diff).toEqual({});
      expectError(await ctx.svc.withToken("not.a.token").request(op.method, path, { body }), 401, "AUTH_ERROR");
    });

    test(`ECM-R04: ${label} requires scope ${op.scopes.join(" ")}`, async () => {
      expect(op.scopes).toHaveLength(1);
      const needed = effectiveScope(op.scopes[0]);
      const lacking = await ctx.svc.client({ scopes: SCOPES.filter((scope) => scope !== needed) });
      const { result, diff } = await ctx.svc.changes(() => lacking.request(op.method, path, { body }));
      expectError(result, 403, "FORBIDDEN");
      checkError(contract, result);
      expect(result.body.message).toContain(op.scopes[0]);
      expect(diff).toEqual({});
      expect(ctx.ams.calls).toEqual([]);

      const exact = await ctx.svc.client({ scopes: [needed] });
      expect([401, 403]).not.toContain((await exact.request(op.method, path, { body })).status);
    });
  }

  test("ECM-R03: authentication comes first, even for a path that does not exist", async () => {
    expectError(await ctx.svc.http.get("/v1/no-such-resource"), 401, "AUTH_ERROR");
  });

  test("ECM-R08: ecm:envelopes:read cannot be requested; ecm:documents:read opens the envelope list", async () => {
    const asked = await ctx.svc.http.post("/oauth/token", {
      grant_type: "client_credentials",
      client_id: "agent-full",
      client_secret: "dev-secret",
      scope: "ecm:envelopes:read",
    });
    expect([asked.status, asked.body.error]).toEqual([400, "invalid_scope"]);

    for (const clientId of ["agent-full", "agent-csr", "agent-readonly"]) {
      const reader = await ctx.svc.client({ clientId, scopes: ["ecm:documents:read"] });
      expect((await reader.get("/v1/envelopes")).status).toBe(200);
    }
    const creator = await ctx.svc.client({ scopes: ["ecm:envelopes:create", "ecm:assets:read"] });
    const refused = await creator.get("/v1/envelopes");
    expectError(refused, 403, "FORBIDDEN");
    expect(refused.body.message).toContain("ecm:envelopes:read");
  });
});

describe("error envelope", () => {
  test("ECM-R05: errors carry error_code, message and correlation_id; validation errors list field, message and code", async () => {
    const res = await ctx.api.post("/v1/envelopes/create", { message: "m".repeat(1001) });
    expectError(
      res,
      400,
      "VALIDATION_ERROR",
      { field: "client_id", code: "required" },
      { field: "document_ids", code: "required" },
      { field: "signers", code: "required" },
      { field: "message", code: "too_long" },
    );
    expect(res.body.message).toBe("One or more fields failed validation.");
    for (const detail of res.body.details) expect(typeof detail.message).toBe("string");
  });

  test("ECM-R06: the response carries X-Correlation-ID and repeats it in an error body", async () => {
    const generated = await ctx.api.get("/v1/coi/nope/pdf");
    expect(generated.headers.get("x-correlation-id")).toBeTruthy();
    expect(generated.body.correlation_id).toBe(generated.headers.get("x-correlation-id"));
    const echoed = await ctx.api.get("/v1/coi/nope/pdf", { headers: { "X-Correlation-ID": "trace-2" } });
    expect(echoed.headers.get("x-correlation-id")).toBe("trace-2");
    expect(echoed.body.correlation_id).toBe("trace-2");
  });

  for (const path of ["/v1/envelopes/create", "/v1/coi", "/v1/coi/generate", "/v1/documents/coi", "/v1/documents/coi/generate"]) {
    test(`ECM-R07: POST ${path} answers 400 VALIDATION_ERROR to a body that is not JSON`, async () => {
      const { result, diff } = await ctx.svc.changes(() =>
        ctx.api.post(path, "{not json", { headers: { "Content-Type": "application/json" } }),
      );
      expectError(result, 400, "VALIDATION_ERROR");
      expect(diff).toEqual({});
    });
  }

  test("ECM-R07: POST /v1/documents/upload answers 500 INTERNAL_ERROR to a body that is not form data", async () => {
    const { result, diff } = await ctx.svc.changes(() => ctx.api.post("/v1/documents/upload", { client_id: "CLI-1" }));
    expectError(result, 500, "INTERNAL_ERROR");
    expect(diff).toEqual({});
  });

  test.todo(
    "ECM-G01: error bodies match the Error schema of specs/ecm.yaml (the file requires `code`; the service sends `error_code`, `correlation_id` and `details[].{field,message,code}`)",
  () => {},
  );
  test.todo("ECM-G06: a body that cannot be parsed gets a 400 (the service answers 500 INTERNAL_ERROR)", () => {});
});
