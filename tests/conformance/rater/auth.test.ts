import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { SCOPES, carrierRow, checkError, quoteRow, requestRow, start, type Ctx } from "./support";

const contract = loadContract("rater");
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({ tables: { carriers: [carrierRow()], quote_requests: [requestRow()], carrier_quotes: [quoteRow()] } });
});

const concretePath = (template: string) => template.replace(/\{[^}]+\}/g, "x");

describe("public endpoints", () => {
  test("RTR-R01: GET /health answers without credentials", async () => {
    const res = await ctx.svc.http.get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", service: "rater" });
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  test("RTR-R02: POST /oauth/token issues a bearer token limited to the requested scopes", async () => {
    const res = await ctx.svc.http.post("/oauth/token", {
      grant_type: "client_credentials",
      client_id: "agent-full",
      client_secret: "dev-secret",
      scope: "rater:quotes:read",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "rater:quotes:read" });

    const readonly = await ctx.svc.http.post("/oauth/token", {
      grant_type: "client_credentials",
      client_id: "agent-readonly",
      client_secret: "dev-secret",
    });
    expect(readonly.body.scope.split(" ")).toContain("rater:quotes:read");
    expect(readonly.body.scope.split(" ")).not.toContain("rater:quotes:bind");

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

    test(`RTR-R03: ${label} rejects a missing or unsigned token`, async () => {
      const { result, diff } = await ctx.svc.changes(() => ctx.svc.http.request(op.method, path, { body }));
      expectError(result, 401, "AUTH_ERROR");
      checkError(contract, result);
      expect(diff).toEqual({});
      expectError(await ctx.svc.withToken("not.a.token").request(op.method, path, { body }), 401, "AUTH_ERROR");
    });

    test(`RTR-R04: ${label} requires scope ${op.scopes.join(" ")}`, async () => {
      expect(op.scopes).toHaveLength(1);
      const lacking = await ctx.svc.client({ scopes: SCOPES.filter((scope) => !op.scopes.includes(scope)) });
      const { result, diff } = await ctx.svc.changes(() => lacking.request(op.method, path, { body }));
      expectError(result, 403, "FORBIDDEN");
      checkError(contract, result);
      expect(result.body.message).toContain(op.scopes[0]);
      expect(diff).toEqual({});

      const exact = await ctx.svc.client({ scopes: op.scopes });
      expect([401, 403]).not.toContain((await exact.request(op.method, path, { body })).status);
    });
  }

  test("RTR-R03: authentication comes first, even for a path that does not exist", async () => {
    expectError(await ctx.svc.http.get("/v1/no-such-resource"), 401, "AUTH_ERROR");
  });
});

describe("error envelope", () => {
  test("RTR-R05: errors carry error_code, message and correlation_id; validation errors list field, message and code", async () => {
    const res = await ctx.api.post("/v1/quotes/QT-1/bind", { payment_method: "cash" });
    expectError(
      res,
      400,
      "VALIDATION_ERROR",
      { field: "payment_method", code: "invalid_enum" },
      { field: "producer_id", code: "required" },
    );
    expect(res.body.message).toBe("One or more fields failed validation.");
    for (const detail of res.body.details) expect(typeof detail.message).toBe("string");
  });

  test("RTR-R06: the response carries X-Correlation-ID and repeats it in an error body", async () => {
    const generated = await ctx.api.get("/v1/quotes/nope/results");
    expect(generated.headers.get("x-correlation-id")).toBeTruthy();
    expect(generated.body.correlation_id).toBe(generated.headers.get("x-correlation-id"));
    const echoed = await ctx.api.get("/v1/quotes/nope/results", { headers: { "X-Correlation-ID": "trace-4" } });
    expect(echoed.headers.get("x-correlation-id")).toBe("trace-4");
    expect(echoed.body.correlation_id).toBe("trace-4");
  });

  for (const path of ["/v1/quotes/request", "/v1/quotes/QT-1/bind"]) {
    test(`RTR-R07: POST ${path} answers 400 VALIDATION_ERROR to a body that is not JSON`, async () => {
      const { result, diff } = await ctx.svc.changes(() =>
        ctx.api.post(path, "{not json", { headers: { "Content-Type": "application/json" } }),
      );
      expectError(result, 400, "VALIDATION_ERROR");
      expect(diff).toEqual({});
    });
  }

  test("RTR-G01: error bodies conform to ErrorResponse in specs/rater.yaml", async () => {
    const bad = await ctx.api.post("/v1/quotes/QT-1/bind", { payment_method: "cash" });
    expectError(bad, 400, "VALIDATION_ERROR");
    contract.check(bad);
    const missing = await ctx.api.get("/v1/quotes/nope/results");
    expectError(missing, 404, "NOT_FOUND");
    contract.check(missing);
  });
});
