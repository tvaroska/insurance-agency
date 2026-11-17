import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { ALL_AMS_SCOPES, book, endorsement, escalation, start, task, type Ctx } from "./support";

const contract = loadContract("ams");
let ctx: Ctx;

// The scope table of specs/ams.spec.md, section 4.
const SCOPE_BY_OPERATION: Record<string, string> = {
  listClients: "ams:clients:read",
  createClient: "ams:clients:write",
  getClient: "ams:clients:read",
  updateClient: "ams:clients:write",
  mergeClient: "ams:clients:write",
  getHouseholdSummary: "ams:clients:read",
  listClientPolicies: "ams:policies:read",
  listPolicies: "ams:policies:read",
  createPolicy: "ams:policies:write",
  getPolicyById: "ams:policies:read",
  listPolicyEndorsements: "ams:policies:read",
  createEndorsement: "ams:policies:endorsements",
  listCommissions: "ams:accounting:read",
  listTasks: "ams:tasks:read",
  createTask: "ams:tasks:write",
  updateTask: "ams:tasks:write",
  listEscalations: "ams:escalations:read",
  createEscalation: "ams:escalations:write",
  getEscalation: "ams:escalations:read",
};

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({
    tables: book({
      tasks: [task("T-1")],
      endorsements: [endorsement("END-1", "POL-A-AUTO")],
      escalations: [escalation("esc_1")],
    }),
  });
});

function concretePath(template: string): string {
  return template
    .replace("{household_id}", "HH-1")
    .replace("{escalation_id}", "esc_1")
    .replace("/tasks/{id}", "/tasks/T-1")
    .replace("/policies/{id}", "/policies/POL-A-AUTO")
    .replace("/clients/{id}", "/clients/CLI-A");
}

function base64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Signs a token the way specs/ams.yaml documents: HS256 with a shared secret. */
async function signToken(claims: Record<string, unknown>, secret = "dev-secret"): Promise<string> {
  const input = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  return `${input}.${base64url(new Uint8Array(sig))}`;
}

describe("public endpoints", () => {
  test("AMS-R12: GET /health reports the service", async () => {
    const res = await ctx.svc.http.get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", service: "ams" });
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  test("AMS-R7: health, the control plane and the workbench answer without credentials", async () => {
    for (const path of ["/health", "/sim/status", "/sim/snapshot", "/", "/workbench/api/overview"]) {
      expect([path, (await ctx.svc.http.get(path)).status]).toEqual([path, 200]);
    }
  });

  test("AMS-R8: POST /oauth/token issues a bearer token with exactly the requested scopes", async () => {
    const res = await ctx.svc.http.post("/oauth/token", {
      grant_type: "client_credentials",
      client_id: "agent-full",
      client_secret: "dev-secret",
      scope: "ams:clients:read ams:tasks:write",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "ams:clients:read ams:tasks:write" });
    const [, payload] = res.body.access_token.split(".");
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    expect(claims).toMatchObject({ sub: "agent-full", scope: "ams:clients:read ams:tasks:write" });
    expect(claims.exp - claims.iat).toBe(3600);
  });

  test("AMS-R8: the token endpoint accepts a form-encoded body and defaults to all of the client's scopes", async () => {
    const res = await ctx.svc.http.post(
      "/oauth/token",
      "grant_type=client_credentials&client_id=agent-full&client_secret=dev-secret",
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );
    expect(res.status).toBe(200);
    const granted = res.body.scope.split(" ");
    for (const scope of ALL_AMS_SCOPES) expect(granted).toContain(scope);
  });

  test("AMS-R8: agent-csr has every AMS scope except endorsements; agent-readonly has only read scopes", async () => {
    const grant = (client_id: string) =>
      ctx.svc.http.post("/oauth/token", { grant_type: "client_credentials", client_id, client_secret: "dev-secret" });
    const csr = (await grant("agent-csr")).body.scope.split(" ");
    expect(csr).not.toContain("ams:policies:endorsements");
    for (const scope of ALL_AMS_SCOPES.filter((s) => s !== "ams:policies:endorsements")) expect(csr).toContain(scope);

    const readonly = (await grant("agent-readonly")).body.scope.split(" ");
    expect(readonly.filter((s: string) => !s.endsWith(":read"))).toEqual([]);
    for (const scope of ALL_AMS_SCOPES.filter((s) => s.endsWith(":read"))) expect(readonly).toContain(scope);
  });

  test("AMS-R9: the token endpoint rejects bad grants, clients and scopes in the OAuth error shape", async () => {
    const post = (body: Record<string, string>) => ctx.svc.http.post("/oauth/token", body);
    const base = { grant_type: "client_credentials", client_id: "agent-full", client_secret: "dev-secret" };

    const grant = await post({ ...base, grant_type: "password" });
    expect([grant.status, grant.body.error]).toEqual([400, "unsupported_grant_type"]);
    const missing = await post({ grant_type: "client_credentials", client_id: "agent-full" });
    expect([missing.status, missing.body.error]).toEqual([400, "invalid_request"]);
    const secret = await post({ ...base, client_secret: "wrong" });
    expect([secret.status, secret.body.error]).toEqual([401, "invalid_client"]);
    const unknown = await post({ ...base, client_id: "nobody" });
    expect([unknown.status, unknown.body.error]).toEqual([401, "invalid_client"]);
    const scope = await post({ ...base, client_id: "agent-csr", scope: "ams:policies:endorsements" });
    expect([scope.status, scope.body.error]).toEqual([400, "invalid_scope"]);
    expect(typeof scope.body.error_description).toBe("string");
    expect(scope.body.error_code).toBeUndefined();
  });
});

describe("authentication and scopes, for every operation in the OpenAPI file", () => {
  test("AMS-R11: the scope table of the spec covers every operation in specs/ams.yaml", () => {
    expect(contract.operations().map((op) => op.operationId).sort()).toEqual(Object.keys(SCOPE_BY_OPERATION).sort());
  });

  for (const op of contract.operations()) {
    const path = concretePath(op.path);
    const label = `${op.method} ${op.path} (${op.operationId})`;
    const body = op.method === "GET" ? undefined : {};
    const scope = SCOPE_BY_OPERATION[op.operationId];

    test(`AMS-R10: ${label} rejects a request without a token and writes nothing`, async () => {
      const { result, diff } = await ctx.svc.changes(() => ctx.svc.http.request(op.method, path, { body }));
      expectError(result, 401, "AUTH_ERROR");
      expect(result.body.message).toBe("Missing or malformed Authorization header.");
      expect(diff).toEqual({});
      contract.check(result);
    });

    test(`AMS-R10: ${label} rejects a token the service did not sign`, async () => {
      const res = await ctx.svc.withToken("not.a.token").request(op.method, path, { body });
      expectError(res, 401, "AUTH_ERROR");
    });

    test(`AMS-R11: ${label} requires scope ${scope}`, async () => {
      expect(op.scopes).toEqual([scope]);
      const lacking = await ctx.svc.client({ scopes: ALL_AMS_SCOPES.filter((s) => s !== scope) });
      const { result, diff } = await ctx.svc.changes(() => lacking.request(op.method, path, { body }));
      expectError(result, 403, "FORBIDDEN");
      expect(result.body.message).toBe(`Missing required scope(s): ${scope}`);
      expect(diff).toEqual({});
      contract.check(result);

      const exact = await ctx.svc.client({ scopes: [scope] });
      const allowed = await exact.request(op.method, path, { body });
      expect([401, 403]).not.toContain(allowed.status);
    });
  }

  test("AMS-R10: a header that is not a bearer token is rejected", async () => {
    const res = await ctx.svc.http.get("/v1/clients", { headers: { Authorization: "Basic abc" } });
    expectError(res, 401, "AUTH_ERROR");
    expect(res.body.message).toBe("Missing or malformed Authorization header.");
  });

  test("AMS-R10: a self-signed HS256 token is accepted; a wrong secret or an expired token is not", async () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = { sub: "tester", scope: "ams:clients:read", iat: now, exp: now + 60 };
    expect((await ctx.svc.withToken(await signToken(claims)).get("/v1/clients/CLI-A")).status).toBe(200);
    expectError(await ctx.svc.withToken(await signToken(claims, "other-secret")).get("/v1/clients/CLI-A"), 401, "AUTH_ERROR");
    const expired = await signToken({ ...claims, iat: now - 120, exp: now - 60 });
    expectError(await ctx.svc.withToken(expired).get("/v1/clients/CLI-A"), 401, "AUTH_ERROR");
  });

  test("AMS-R10: authentication comes before routing: an unknown /v1 path is 401 without a token and 404 with one", async () => {
    expectError(await ctx.svc.http.get("/v1/no-such-resource"), 401, "AUTH_ERROR");
    expect((await ctx.api.get("/v1/no-such-resource")).status).toBe(404);
  });

  test("AMS-R11: the scope check comes before validation and before the existence check", async () => {
    const reader = await ctx.svc.client({ clientId: "agent-readonly" });
    expectError(await reader.patch("/v1/clients/NO-SUCH", {}), 403, "FORBIDDEN");
    expectError(await reader.post("/v1/policies/NO-SUCH/endorsements", {}), 403, "FORBIDDEN");
    expectError(await reader.post("/v1/escalations", {}), 403, "FORBIDDEN");
  });

  test("AMS-R8, AMS-R11: an agent-csr token cannot create endorsements", async () => {
    const csr = await ctx.svc.client({ clientId: "agent-csr" });
    const res = await csr.post("/v1/policies/POL-A-AUTO/endorsements", { effective_date: "2026-03-01", change_type: "other", changes: { a: 1 } });
    expectError(res, 403, "FORBIDDEN");
    expect(res.body.message).toBe("Missing required scope(s): ams:policies:endorsements");
  });
});

describe("error envelope", () => {
  test("AMS-R13: every response carries X-Correlation-ID, echoing the request header when present", async () => {
    const ok = await ctx.api.get("/v1/clients/CLI-A");
    expect(ok.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);

    const generated = await ctx.api.get("/v1/clients/NO-SUCH");
    expect(generated.body.correlation_id).toBe(generated.headers.get("x-correlation-id"));

    const echoed = await ctx.api.get("/v1/clients/NO-SUCH", { headers: { "X-Correlation-ID": "trace-123" } });
    expect(echoed.headers.get("x-correlation-id")).toBe("trace-123");
    expect(echoed.body.correlation_id).toBe("trace-123");

    const health = await ctx.svc.http.get("/health", { headers: { "X-Correlation-ID": "trace-456" } });
    expect(health.headers.get("x-correlation-id")).toBe("trace-456");
  });

  test("AMS-R14: each error status has its error_code", async () => {
    expectError(await ctx.api.get("/v1/clients", { query: { status: "nope" } }), 400, "VALIDATION_ERROR");
    expectError(await ctx.svc.http.get("/v1/clients"), 401, "AUTH_ERROR");
    expectError(await (await ctx.svc.client({ scopes: ["ams:tasks:read"] })).get("/v1/clients"), 403, "FORBIDDEN");
    expectError(await ctx.api.get("/v1/clients/NO-SUCH"), 404, "NOT_FOUND");
    expectError(await ctx.api.post("/v1/clients/CLI-A/merge", { source_client_id: "CLI-A" }), 409, "CONFLICT");
    expectError(await ctx.api.post("/v1/clients", "{not json", { headers: { "Content-Type": "application/json" } }), 500, "INTERNAL_ERROR");
  });

  test("AMS-R15: a validation failure lists every failed check of the step, in order, with the standard messages", async () => {
    const res = await ctx.api.post("/v1/tasks", { title: "", description: "d".repeat(5001), priority: "soon", due_date: "tomorrow" });
    expectError(res, 400, "VALIDATION_ERROR");
    expect(res.body.message).toBe("One or more fields failed validation.");
    expect(res.body.details).toEqual([
      { field: "title", message: "title is required.", code: "required" },
      { field: "description", message: "description must be at most 5000 characters.", code: "too_long" },
      { field: "priority", message: "priority must be one of: low, medium, high, urgent.", code: "invalid_enum" },
      { field: "due_date", message: "due_date must be YYYY-MM-DD.", code: "invalid_format" },
    ]);
    contract.check(res);
  });

  test("AMS-R15: required fails for a missing value, null and the empty string", async () => {
    for (const body of [{}, { title: null }, { title: "" }]) {
      const res = await ctx.api.post("/v1/tasks", body);
      expect(res.body.details).toEqual([{ field: "title", message: "title is required.", code: "required" }]);
    }
  });

  test("AMS-R15: the date check is a pattern only; a date that does not exist passes", async () => {
    const res = await ctx.api.post("/v1/tasks", { title: "Odd date", due_date: "2026-13-45" });
    expect(res.status).toBe(201);
    expect(res.body.due_date).toBe("2026-13-45");
  });

  test("AMS-R16: a missing resource is 404 NOT_FOUND naming the resource", async () => {
    const cases: [string, Promise<any>][] = [
      ["client", ctx.api.get("/v1/clients/NO-SUCH")],
      ["policy", ctx.api.get("/v1/policies/NO-SUCH")],
      ["task", ctx.api.patch("/v1/tasks/NO-SUCH", { status: "open" })],
      ["escalation", ctx.api.get("/v1/escalations/NO-SUCH")],
      ["household", ctx.api.get("/v1/clients/household/NO-SUCH")],
    ];
    for (const [resource, pending] of cases) {
      const res = await pending;
      expectError(res, 404, "NOT_FOUND");
      expect(res.body.message).toBe(`${resource} not found.`);
      contract.check(res);
    }
  });

  test("AMS-R17: a body that is not JSON is answered with 500 INTERNAL_ERROR and writes nothing", async () => {
    const json = { headers: { "Content-Type": "application/json" } };
    const calls = [
      () => ctx.api.post("/v1/clients", "{not json", json),
      () => ctx.api.patch("/v1/clients/CLI-A", "{not json", json),
      () => ctx.api.post("/v1/policies", "{not json", json),
      () => ctx.api.post("/v1/policies/POL-A-AUTO/endorsements", "{not json", json),
      () => ctx.api.post("/v1/tasks", "{not json", json),
      () => ctx.api.patch("/v1/tasks/T-1", "{not json", json),
      () => ctx.api.post("/v1/escalations", "{not json", json),
    ];
    for (const call of calls) {
      const { result, diff } = await ctx.svc.changes(call);
      expectError(result, 500, "INTERNAL_ERROR");
      expect(result.body.message).toBe("An unexpected error occurred.");
      expect(diff).toEqual({});
    }
  });

  test("AMS-R6: a request that fails with 400, 404, 409 or 422 writes nothing", async () => {
    const policy = {
      client_id: "CLI-A",
      policy_type: "homeowners",
      carrier_code: "SMIT",
      effective_date: "2026-11-01",
      expiration_date: "2027-11-01",
      annual_premium: 1200,
      coverages: [{ type: "dwelling" }],
    };
    const calls: [number, () => Promise<any>][] = [
      [400, () => ctx.api.post("/v1/clients", { first_name: "Only" })],
      [400, () => ctx.api.post("/v1/policies", { ...policy, coverages: [] })],
      [400, () => ctx.api.patch("/v1/tasks/T-1", { status: "nope" })],
      [400, () => ctx.api.post("/v1/escalations", { client_id: "CLI-A" })],
      [404, () => ctx.api.patch("/v1/clients/NO-SUCH", { status: "active" })],
      [404, () => ctx.api.post("/v1/policies", { ...policy, client_id: "NO-SUCH" })],
      [404, () => ctx.api.post("/v1/policies/NO-SUCH/endorsements", { effective_date: "2026-03-01", change_type: "other", changes: { a: 1 } })],
      [409, () => ctx.api.post("/v1/clients", { first_name: "Ann", last_name: "Again", email: "ann@example.test" })],
      [409, () => ctx.api.post("/v1/clients/CLI-A/merge", { source_client_id: "CLI-A" })],
      [422, () => ctx.api.post("/v1/policies", { ...policy, annual_premium: 99_999 })],
      [422, () => ctx.api.post("/v1/policies/POL-A-AUTO/endorsements", { effective_date: "2001-01-01", change_type: "other", changes: { a: 1 } })],
    ];
    for (const [status, call] of calls) {
      const { result, diff } = await ctx.svc.changes(call);
      expect(result.status).toBe(status);
      expect(diff).toEqual({});
    }
  });

  test("AMS-R113: unknown body fields are ignored and never stored", async () => {
    const res = await ctx.api.post("/v1/tasks", { title: "Extra", surprise: true, id: "MINE", created_at: "2000-01-01" });
    expect(res.status).toBe(201);
    expect(res.body.id).not.toBe("MINE");
    expect(res.body.surprise).toBeUndefined();
    expect(res.body.created_at).not.toBe("2000-01-01");
  });
});

test.todo("AMS-G18: a body that is not JSON is answered with 400 VALIDATION_ERROR (today it is 500, and specs/ams.yaml documents no such case)", () => {});
test.todo("AMS-G19: a wrong JSON type in a body (first_name: 5, first_name: null on update, a numeric coverage limit) is a 400, not a 500", () => {});
