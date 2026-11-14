import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { claim, seedTables, start, type Ctx } from "./support";

const contract = loadContract("claims");
const SCOPES = ["claims:read", "claims:write", "claims:assign", "claims:documents"];
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({ tables: seedTables([claim()]) });
});

function concretePath(template: string): string {
  return template.replace(/\{[^}]+\}/g, "CLM-2024-000001");
}

describe("public endpoints", () => {
  test("CLM-R01: GET /health answers without credentials", async () => {
    const res = await ctx.svc.http.get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", service: "claims" });
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  test("CLM-R02: POST /oauth/token issues a bearer token for the client-credentials grant", async () => {
    const res = await ctx.svc.http.post("/oauth/token", {
      grant_type: "client_credentials",
      client_id: "agent-full",
      client_secret: "dev-secret",
      scope: "claims:read claims:write",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "claims:read claims:write" });
    expect(typeof res.body.access_token).toBe("string");
  });

  test("CLM-R02: the token endpoint also accepts a form-encoded body", async () => {
    const res = await ctx.svc.http.post(
      "/oauth/token",
      "grant_type=client_credentials&client_id=agent-readonly&client_secret=dev-secret",
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );
    expect(res.status).toBe(200);
    expect(res.body.scope.split(" ")).toContain("claims:read");
    expect(res.body.scope.split(" ")).not.toContain("claims:write");
  });

  test("CLM-R02: the token endpoint rejects bad grants, clients and scopes", async () => {
    const post = (body: Record<string, string>) => ctx.svc.http.post("/oauth/token", body);
    const base = { grant_type: "client_credentials", client_id: "agent-full", client_secret: "dev-secret" };

    const grant = await post({ ...base, grant_type: "password" });
    expect([grant.status, grant.body.error]).toEqual([400, "unsupported_grant_type"]);
    const missing = await post({ grant_type: "client_credentials", client_id: "agent-full" });
    expect([missing.status, missing.body.error]).toEqual([400, "invalid_request"]);
    const secret = await post({ ...base, client_secret: "wrong" });
    expect([secret.status, secret.body.error]).toEqual([401, "invalid_client"]);
    const scope = await post({ ...base, client_id: "agent-readonly", scope: "claims:write" });
    expect([scope.status, scope.body.error]).toEqual([400, "invalid_scope"]);
  });
});

describe("authentication and scopes, for every operation in the OpenAPI file", () => {
  for (const op of contract.operations()) {
    const path = concretePath(op.path);
    const label = `${op.method} ${op.path} (${op.operationId})`;
    const body = op.method === "GET" ? undefined : {};

    test(`CLM-R03: ${label} rejects a request without a token`, async () => {
      const { result, diff } = await ctx.svc.changes(() => ctx.svc.http.request(op.method, path, { body }));
      expectError(result, 401, "AUTH_ERROR");
      expect(diff).toEqual({});
    });

    test(`CLM-R03: ${label} rejects a token that the service did not sign`, async () => {
      const res = await ctx.svc.withToken("not.a.token").request(op.method, path, { body });
      expectError(res, 401, "AUTH_ERROR");
    });

    test(`CLM-R04: ${label} requires scope ${op.scopes.join(" ")}`, async () => {
      expect(op.scopes).toHaveLength(1);
      const others = SCOPES.filter((scope) => !op.scopes.includes(scope));
      const lacking = await ctx.svc.client({ scopes: others });
      const { result, diff } = await ctx.svc.changes(() => lacking.request(op.method, path, { body }));
      expectError(result, 403, "FORBIDDEN");
      expect(result.body.message).toContain(op.scopes[0]);
      expect(diff).toEqual({});

      const exact = await ctx.svc.client({ scopes: op.scopes });
      const allowed = await exact.request(op.method, path, { body });
      expect([401, 403]).not.toContain(allowed.status);
    });
  }

  test("CLM-R03: a header that is not a bearer token is rejected", async () => {
    const res = await ctx.svc.http.get("/v1/claims", { headers: { Authorization: "Basic abc" } });
    expectError(res, 401, "AUTH_ERROR");
  });

  test("CLM-R03: authentication comes first, even for a path that does not exist", async () => {
    const res = await ctx.svc.http.get("/v1/no-such-resource");
    expectError(res, 401, "AUTH_ERROR");
  });

  test("CLM-R04: the scope check comes before body validation and the existence check", async () => {
    const reader = await ctx.svc.client({ scopes: ["claims:read"] });
    expectError(await reader.patch("/v1/claims/CLM-0000-000000", {}), 403, "FORBIDDEN");
    expectError(await reader.post("/v1/claims/CLM-0000-000000/assign", {}), 403, "FORBIDDEN");
  });
});

describe("error envelope", () => {
  test("CLM-R05: a validation failure lists every failing field with field, message and code", async () => {
    const res = await ctx.api.post("/v1/claims", { claim_type: "nope", loss_date: "yesterday" });
    expectError(
      res,
      400,
      "VALIDATION_ERROR",
      { field: "policy_id", code: "required" },
      { field: "client_id", code: "required" },
      { field: "loss_description", code: "required" },
      { field: "claim_type", code: "invalid_enum" },
      { field: "loss_date", code: "invalid_format" },
    );
    expect(res.body.message).toBe("One or more fields failed validation.");
    for (const detail of res.body.details) expect(typeof detail.message).toBe("string");
    contract.check(res);
  });

  test("CLM-R06: the response carries X-Correlation-ID and repeats it in an error body", async () => {
    const generated = await ctx.api.get("/v1/claims/CLM-0000-000000");
    const id = generated.headers.get("x-correlation-id");
    expect(id).toBeTruthy();
    expect(generated.body.correlation_id).toBe(id);

    const echoed = await ctx.api.get("/v1/claims/CLM-0000-000000", { headers: { "X-Correlation-ID": "trace-123" } });
    expect(echoed.headers.get("x-correlation-id")).toBe("trace-123");
    expect(echoed.body.correlation_id).toBe("trace-123");
  });

  for (const [method, path] of [
    ["POST", "/v1/claims"],
    ["POST", "/v1/claims/fnol"],
    ["POST", "/v1/claims/CLM-2024-000001/assign"],
    ["PATCH", "/v1/claims/CLM-2024-000001"],
    ["POST", "/v1/claims/CLM-2024-000001/documents"],
  ]) {
    test(`CLM-R07: ${method} ${path} answers 500 INTERNAL_ERROR to a body that is not JSON`, async () => {
      const { result, diff } = await ctx.svc.changes(() =>
        ctx.api.request(method, path, { body: "{not json", headers: { "Content-Type": "application/json" } }),
      );
      expectError(result, 500, "INTERNAL_ERROR");
      expect(diff).toEqual({});
    });
  }

  test.todo(
    "CLM-G01: specs/claims.yaml documents the response to a body that is not JSON (the service answers 500, the file lists no 500)",
  );
});
