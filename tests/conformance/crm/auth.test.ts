import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { SCOPES, campaign, checkError, leadRow, start, type Ctx } from "./support";

const contract = loadContract("crm");
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({ tables: { leads: [leadRow()], campaigns: [campaign()] } });
});

const concretePath = (template: string) => template.replace(/\{[^}]+\}/g, "x");

describe("public endpoints", () => {
  test("CRM-R01: GET /health answers without credentials", async () => {
    const res = await ctx.svc.http.get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", service: "crm" });
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  test("CRM-R02: POST /oauth/token issues a bearer token limited to the requested scopes", async () => {
    const res = await ctx.svc.http.post("/oauth/token", {
      grant_type: "client_credentials",
      client_id: "agent-full",
      client_secret: "dev-secret",
      scope: "crm:leads:read",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "crm:leads:read" });

    const readonly = await ctx.svc.http.post("/oauth/token", {
      grant_type: "client_credentials",
      client_id: "agent-readonly",
      client_secret: "dev-secret",
    });
    expect(readonly.body.scope.split(" ")).toContain("crm:leads:read");
    expect(readonly.body.scope.split(" ")).not.toContain("crm:leads:write");

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

    test(`CRM-R03: ${label} rejects a missing or unsigned token`, async () => {
      const { result, diff } = await ctx.svc.changes(() => ctx.svc.http.request(op.method, path, { body }));
      expectError(result, 401, "AUTH_ERROR");
      checkError(contract, result);
      expect(diff).toEqual({});
      expectError(await ctx.svc.withToken("not.a.token").request(op.method, path, { body }), 401, "AUTH_ERROR");
    });

    test(`CRM-R04: ${label} requires scope ${op.scopes.join(" ")}`, async () => {
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

  test("CRM-R03: authentication comes first, even for a path that does not exist", async () => {
    expectError(await ctx.svc.http.get("/v1/no-such-resource"), 401, "AUTH_ERROR");
  });
});

describe("error envelope", () => {
  test("CRM-R05: errors carry error_code, message and correlation_id; validation errors list field, message and code", async () => {
    const res = await ctx.api.post("/v1/leads", { source: "tv" });
    expectError(
      res,
      400,
      "VALIDATION_ERROR",
      { field: "first_name", code: "required" },
      { field: "last_name", code: "required" },
      { field: "email", code: "required" },
      { field: "source", code: "invalid_enum" },
    );
    expect(res.body.message).toBe("One or more fields failed validation.");
    for (const detail of res.body.details) expect(typeof detail.message).toBe("string");
  });

  test("CRM-R06: the response carries X-Correlation-ID and repeats it in an error body", async () => {
    const generated = await ctx.api.get("/v1/leads/nope");
    expect(generated.headers.get("x-correlation-id")).toBeTruthy();
    expect(generated.body.correlation_id).toBe(generated.headers.get("x-correlation-id"));
    const echoed = await ctx.api.get("/v1/leads/nope", { headers: { "X-Correlation-ID": "trace-9" } });
    expect(echoed.headers.get("x-correlation-id")).toBe("trace-9");
    expect(echoed.body.correlation_id).toBe("trace-9");
  });

  for (const [method, path] of [
    ["POST", "/v1/leads"],
    ["PATCH", "/v1/leads/lead_a"],
    ["POST", "/v1/leads/lead_a/enroll"],
    ["POST", "/v1/campaigns/camp_a/enroll"],
  ]) {
    test(`CRM-R07: ${method} ${path} answers 500 INTERNAL_ERROR to a body that is not JSON`, async () => {
      const { result, diff } = await ctx.svc.changes(() =>
        ctx.api.request(method, path, { body: "{not json", headers: { "Content-Type": "application/json" } }),
      );
      expectError(result, 500, "INTERNAL_ERROR");
      expect(diff).toEqual({});
    });
  }

  test.todo(
    "CRM-G01: error bodies match the Error schema of specs/crm.yaml (the file requires `code`, `details[].reason`, `request_id`; the service sends `error_code`, `details[].{field,message,code}`, `correlation_id`)",
  );
  test.todo("CRM-G06: a body that is not JSON gets a 400 (the service answers 500 INTERNAL_ERROR)");
});
