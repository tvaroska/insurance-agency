import { afterAll, describe, expect, test } from "bun:test";
import { diffTables, loadContract, parseSse, startStub, validateSchema } from "./index";
import { Contract } from "./openapi";

const issues = (schema: any, value: unknown, root: any = schema) =>
  validateSchema(schema, value, root).map((i) => `${i.path}: ${i.message}`);

describe("schema validator", () => {
  test("types, nullable and enum", () => {
    expect(issues({ type: "string" }, "a")).toEqual([]);
    expect(issues({ type: "string" }, 1)).toHaveLength(1);
    expect(issues({ type: "integer" }, 1.5)).toHaveLength(1);
    expect(issues({ type: "number" }, 1.5)).toEqual([]);
    expect(issues({ type: "string" }, null)).toHaveLength(1);
    expect(issues({ type: "string", nullable: true }, null)).toEqual([]);
    expect(issues({ type: "string", enum: ["a", "b"] }, "c")).toHaveLength(1);
    expect(issues({ type: "integer", enum: [0, 1] }, 1)).toEqual([]);
  });

  test("objects, arrays and nested paths", () => {
    const schema = {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" }, tags: { type: "array", items: { type: "string" }, minItems: 1 } },
    };
    expect(issues(schema, { id: "x", tags: ["a"], extra: 1 })).toEqual([]);
    expect(issues(schema, { tags: ["a", 2] })).toEqual([
      ": is missing required property 'id'",
      "/tags/1: is number, expected string",
    ]);
    expect(issues({ ...schema, additionalProperties: false }, { id: "x", extra: 1 })).toHaveLength(1);
    expect(issues(schema, { id: "x", tags: [] })).toHaveLength(1);
  });

  test("formats, lengths, patterns and numeric bounds", () => {
    expect(issues({ type: "string", format: "date" }, "2024-02-29")).toEqual([]);
    expect(issues({ type: "string", format: "date" }, "2024-02-31")).toHaveLength(1);
    expect(issues({ type: "string", format: "date-time" }, "2024-01-15T00:00:00Z")).toEqual([]);
    expect(issues({ type: "string", format: "date-time" }, "2024-01-15")).toHaveLength(1);
    expect(issues({ type: "string", format: "uuid" }, "not-a-uuid")).toHaveLength(1);
    expect(issues({ type: "string", maxLength: 2 }, "abc")).toHaveLength(1);
    expect(issues({ type: "string", pattern: "^A-\\d+$" }, "A-12")).toEqual([]);
    expect(issues({ type: "number", minimum: 0 }, -1)).toHaveLength(1);
    expect(issues({ type: "number", minimum: 0, exclusiveMinimum: true }, 0)).toHaveLength(1);
    expect(issues({ type: "number", maximum: 5 }, 5)).toEqual([]);
  });

  test("$ref with sibling keywords, allOf, oneOf and anyOf", () => {
    const root = {
      components: {
        schemas: {
          Pet: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
          Owner: {
            allOf: [
              { $ref: "#/components/schemas/Pet" },
              { type: "object", properties: { pet: { $ref: "#/components/schemas/Pet", nullable: true } } },
            ],
          },
        },
      },
    };
    const owner = root.components.schemas.Owner;
    expect(issues(owner, { name: "o", pet: null }, root)).toEqual([]);
    expect(issues(owner, { name: "o", pet: {} }, root)).toEqual(["/pet: is missing required property 'name'"]);
    expect(issues(owner, { pet: null }, root)).toHaveLength(1);
    expect(issues({ oneOf: [{ type: "string" }, { type: "number" }] }, true)).toHaveLength(1);
    expect(issues({ oneOf: [{ type: "number" }, { type: "integer" }] }, 1)).toHaveLength(1);
    expect(issues({ anyOf: [{ type: "number" }, { type: "integer" }] }, 1)).toEqual([]);
  });
});

describe("contract", () => {
  const doc = {
    servers: [{ url: "http://localhost:1/v1" }],
    security: [{ oauth2: [] }],
    components: { schemas: { Thing: { type: "object", required: ["id"], properties: { id: { type: "string" } } } } },
    paths: {
      "/things/special": {
        get: { operationId: "special", responses: { "200": { description: "no body schema" } } },
      },
      "/things/{id}": {
        get: {
          operationId: "getThing",
          security: [{ oauth2: ["things:read"] }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Thing" } } } },
            "404": { description: "missing" },
          },
        },
      },
    },
  };
  const response = (path: string, status: number, body: unknown, method = "GET") => ({
    status,
    headers: new Headers({ "content-type": "application/json" }),
    body,
    text: JSON.stringify(body),
    bytes: new Uint8Array(),
    request: { method, path, url: `http://x${path}` },
  });

  test("matches operations, prefers literal segments, reads scopes", () => {
    const contract = new Contract("demo", doc);
    expect(contract.match("GET", "/v1/things/special")?.operationId).toBe("special");
    expect(contract.match("GET", "/v1/things/42")?.operationId).toBe("getThing");
    expect(contract.match("POST", "/v1/things/42")).toBeUndefined();
    expect(contract.operation("getThing").scopes).toEqual(["things:read"]);
    expect(contract.operation("special").scopes).toEqual([]);
  });

  test("checks status and body, and tracks which operations were seen", () => {
    const contract = new Contract("demo", doc);
    expect(contract.unchecked()).toEqual(["special", "getThing"]);
    expect(contract.check(response("/v1/things/42", 200, { id: "42" })).schemaChecked).toBe(true);
    expect(contract.check(response("/v1/things/42", 404, { error_code: "NOT_FOUND" })).schemaChecked).toBe(false);
    expect(() => contract.check(response("/v1/things/42", 200, { id: 42 }))).toThrow("/id: is number, expected string");
    expect(() => contract.check(response("/v1/things/42", 500, {}))).toThrow("status 500 is not documented");
    expect(contract.check(response("/v1/things/42", 500, {}), { allowUndocumentedStatus: true }).issues).toEqual([]);
    expect(contract.check(response("/v1/things/42", 200, { id: 42 }), { allow: ["/id:"] }).issues).toEqual([]);
    expect(() => contract.check(response("/v1/unknown", 200, {}))).toThrow("no operation for GET /v1/unknown");
    expect(contract.unchecked()).toEqual(["special"]);
    expect(contract.inspectSchema("Thing", {})).toEqual(["/: is missing required property 'id'"]);
    expect(() => contract.checkSchema("Thing", { id: "1" })).not.toThrow();
  });

  test("every OpenAPI file in specs/ loads and lists operations with unique ids", () => {
    for (const name of ["ams", "rater", "crm", "ecm", "comm", "carrier-summit", "carrier-coastal", "claims"]) {
      const ops = loadContract(name).operations();
      expect(ops.length).toBeGreaterThan(0);
      expect(new Set(ops.map((o) => o.operationId)).size).toBe(ops.length);
      for (const op of ops) expect(op.path.startsWith("/")).toBe(true);
    }
  });
});

describe("table diff", () => {
  test("reports added, removed and changed rows per table, and nothing for equal tables", () => {
    const before = { a: [{ id: 1, v: "x", t: 1 }, { id: 2, v: "y", t: 1 }], b: [{ id: 1 }] };
    const after = { a: [{ id: 1, v: "z", t: 2 }, { id: 3, v: "n", t: 2 }], b: [{ id: 1 }] };
    expect(diffTables(before, before)).toEqual({});
    expect(diffTables(before, after)).toEqual({
      a: {
        added: [{ id: 3, v: "n", t: 2 }],
        removed: [{ id: 2, v: "y", t: 1 }],
        changed: [{ key: "1", before: before.a[0], after: after.a[0], fields: ["v", "t"] }],
      },
    });
    expect(diffTables(before, after, { ignore: { "*": ["t"] } }).a.changed[0].fields).toEqual(["v"]);
  });
});

describe("peer stub and SSE parsing", () => {
  const stub = startStub();
  afterAll(() => stub.stop());

  test("records calls and serves scripted replies", async () => {
    stub.on("GET", "/v1/clients/{id}", (call) => ({ body: { path: call.path } }));
    stub.on("POST", "/v1/tasks", { status: 201, body: { ok: true } });
    const got = await fetch(`${stub.url}/v1/clients/CLI-1?x=1`, { headers: { "X-Test": "1" } });
    expect(await got.json()).toEqual({ path: "/v1/clients/CLI-1" });
    const posted = await fetch(`${stub.url}/v1/tasks`, { method: "POST", body: JSON.stringify({ a: 1 }) });
    expect(posted.status).toBe(201);
    expect((await fetch(`${stub.url}/nope`)).status).toBe(404);
    expect(stub.calls.map((c) => [c.method, c.path])).toEqual([
      ["GET", "/v1/clients/CLI-1"],
      ["POST", "/v1/tasks"],
      ["GET", "/nope"],
    ]);
    expect(stub.calls[0].query).toEqual({ x: "1" });
    expect(stub.calls[0].headers["x-test"]).toBe("1");
    expect(stub.calls[1].body).toEqual({ a: 1 });
    stub.clear();
    expect(stub.calls).toEqual([]);
  });

  test("parses server-sent events", () => {
    const text = 'event: message\ndata: {"id":1}\n\nevent: message\ndata: {"id":2}\n\n';
    expect(parseSse(text)).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
