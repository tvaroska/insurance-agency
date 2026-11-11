import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  createRequestLog,
  createSimRouter,
  getInternalRequestHeaders,
  type RequestLogOptions,
} from "../index";

type Span = {
  traceId: string;
  spanId: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: { key: string; value: { stringValue?: string; intValue?: number } }[];
};

function attr(span: Span, key: string) {
  return span.attributes.find((a) => a.key === key)?.value;
}

function createApp(options: RequestLogOptions = { serviceName: "ams", port: 3000 }) {
  const log = createRequestLog(options);
  let failReset = false;
  const app = new Hono();
  app.use("*", log.middleware);
  app.onError((_err, c) => c.json({ error: "INTERNAL" }, 500));
  app.route(
    "/sim",
    createSimRouter({
      serviceName: options.serviceName,
      prisma: {},
      tables: [],
      onReset: async () => {
        if (failReset) throw new Error("seed failed");
      },
    }),
  );
  app.route("/sim", log.router);
  app.post("/oauth/token", (c) => c.json({ access_token: "token" }));
  app.get("/auth/portal-session", (c) => c.json({ session_token: "session" }));
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/workbench/api/overview", (c) => c.json({}));
  app.get("/assets/index.js", (c) => c.text("console.log(1)"));
  app.get("/v1/clients", (c) => c.json({ data: [] }));
  app.post("/v1/clients", async (c) => c.json(await c.req.json(), 201));
  app.get("/v1/private", (c) => c.json({ error: "UNAUTHORIZED" }, 401));
  app.get("/v1/boom", () => {
    throw new Error("boom");
  });
  // Echoes the raw body, as the MCP transport reads c.req.raw directly.
  app.all("/mcp", async (c) => c.text(await c.req.raw.text()));
  return {
    app,
    setFailReset: (value: boolean) => {
      failReset = value;
    },
  };
}

async function exportTrace(app: Hono) {
  const res = await app.request("/sim/trace");
  expect(res.status).toBe(200);
  return res.json();
}

async function spans(app: Hono): Promise<Span[]> {
  return (await exportTrace(app)).resourceSpans[0].scopeSpans[0].spans;
}

function mcpPost(app: Hono, message: unknown) {
  return app.request("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(message),
  });
}

describe("Service-side request log (packages/shared/src/request-log.ts)", () => {
  test("records a /v1 call as an OTLP client span with the contract attributes", async () => {
    const { app } = createApp();
    const res = await app.request("http://127.0.0.1:4100/v1/clients?last_name=Johnson");
    expect(res.status).toBe(200);

    const trace = await exportTrace(app);
    expect(trace.resourceSpans).toHaveLength(1);
    expect(trace.resourceSpans[0].resource.attributes).toEqual([
      { key: "service.name", value: { stringValue: "ams" } },
    ]);
    expect(trace.resourceSpans[0].scopeSpans[0].scope).toEqual({ name: "evergreen-request-log" });

    const [span] = trace.resourceSpans[0].scopeSpans[0].spans as Span[];
    expect(span.kind).toBe(3);
    expect(span.name).toBe("GET /v1/clients");
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(span.startTimeUnixNano).toMatch(/^\d{19}$/);
    expect(BigInt(span.endTimeUnixNano)).toBeGreaterThanOrEqual(BigInt(span.startTimeUnixNano));
    expect(span.attributes).toEqual([
      { key: "http.request.method", value: { stringValue: "GET" } },
      // Canonical port, not the port the request arrived on.
      { key: "url.full", value: { stringValue: "http://localhost:3000/v1/clients?last_name=Johnson" } },
      { key: "http.response.status_code", value: { intValue: 200 } },
      { key: "server.port", value: { intValue: 3000 } },
      { key: "http.request.body", value: { stringValue: "" } },
    ]);
  });

  test("records the request body and still hands it to the handler", async () => {
    const { app } = createApp();
    const payload = { first_name: "Marcus", last_name: "Johnson" };
    const res = await app.request("/v1/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(payload);

    const [span] = await spans(app);
    expect(attr(span, "http.request.method")).toEqual({ stringValue: "POST" });
    expect(attr(span, "http.response.status_code")).toEqual({ intValue: 201 });
    expect(attr(span, "http.request.body")).toEqual({ stringValue: JSON.stringify(payload) });
  });

  test("truncates the recorded body at 16 KB", async () => {
    const { app } = createApp();
    const payload = { notes: "x".repeat(20_000) };
    const res = await app.request("/v1/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect((await res.json()).notes).toHaveLength(20_000);

    const [span] = await spans(app);
    const body = attr(span, "http.request.body")?.stringValue ?? "";
    expect(body).toHaveLength(16 * 1024);
    expect(JSON.stringify(payload).startsWith(body)).toBe(true);
  });

  test("records error responses with their final status", async () => {
    const { app } = createApp();
    await app.request("/v1/private");
    await app.request("/v1/boom");

    const recorded = await spans(app);
    expect(recorded.map((s) => attr(s, "http.response.status_code")?.intValue)).toEqual([401, 500]);
  });

  test("skips internal, OAuth, /sim, /auth, health, workbench, and static requests", async () => {
    const { app } = createApp();
    await app.request("/v1/clients", { headers: { "X-Evergreen-Internal": "1" } });
    await app.request("/oauth/token", { method: "POST" });
    await app.request("/sim/status");
    await app.request("/auth/portal-session");
    await app.request("/health");
    await app.request("/workbench/api/overview");
    await app.request("/assets/index.js");

    expect(await spans(app)).toEqual([]);
  });

  test("records MCP tools/call with mcp.tool.name and skips the handshake", async () => {
    const { app } = createApp({ serviceName: "comm", port: 3004, mcpPath: "/mcp" });
    await mcpPost(app, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    });
    await mcpPost(app, { jsonrpc: "2.0", method: "notifications/initialized" });
    await mcpPost(app, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    await app.request("/mcp", { method: "GET", headers: { Accept: "text/event-stream" } });
    await app.request("/mcp", { method: "DELETE" });
    expect(await spans(app)).toEqual([]);

    const call = {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "comm_send_message", arguments: { to: "a@example.com", channel: "email", body: "Hi" } },
    };
    const res = await mcpPost(app, call);
    expect(await res.text()).toBe(JSON.stringify(call));

    const [span] = await spans(app);
    expect(span.name).toBe("POST /mcp");
    expect(attr(span, "url.full")).toEqual({ stringValue: "http://localhost:3004/mcp" });
    expect(attr(span, "server.port")).toEqual({ intValue: 3004 });
    expect(attr(span, "mcp.tool.name")).toEqual({ stringValue: "comm_send_message" });
    expect(attr(span, "http.request.body")).toEqual({ stringValue: JSON.stringify(call) });
  });

  test("records one span per tools/call in a JSON-RPC batch", async () => {
    const { app } = createApp({ serviceName: "comm", port: 3004, mcpPath: "/mcp" });
    await mcpPost(app, [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "comm_send_message", arguments: {} } },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "comm_list_inbox", arguments: {} } },
    ]);

    const recorded = await spans(app);
    expect(recorded.map((s) => attr(s, "mcp.tool.name")?.stringValue)).toEqual([
      "comm_send_message",
      "comm_list_inbox",
    ]);
  });

  test("ignores POST /mcp on a service without an MCP endpoint", async () => {
    const { app } = createApp();
    await mcpPost(app, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "comm_send_message" } });
    expect(await spans(app)).toEqual([]);
  });

  test("a successful POST /sim/reset clears the log and a failed one does not", async () => {
    const { app, setFailReset } = createApp();
    await app.request("/v1/clients");
    expect(await spans(app)).toHaveLength(1);

    const reset = await app.request("/sim/reset", { method: "POST" });
    expect(reset.status).toBe(200);
    expect(await spans(app)).toEqual([]);

    await app.request("/v1/clients");
    setFailReset(true);
    const failed = await app.request("/sim/reset", { method: "POST" });
    expect(failed.status).toBe(500);
    expect(await spans(app)).toHaveLength(1);
  });

  test("exports spans in start-time order even when they finish out of order", async () => {
    const { app } = createApp();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    app.get("/v1/slow", async (c) => {
      await gate;
      return c.json({});
    });

    const slow = app.request("/v1/slow");
    await Bun.sleep(2);
    await app.request("/v1/clients");
    release();
    await slow;

    expect((await spans(app)).map((s) => s.name)).toEqual(["GET /v1/slow", "GET /v1/clients"]);
  });

  test("keeps separate logs per instance", async () => {
    const ams = createApp();
    const crm = createApp({ serviceName: "crm", port: 3002 });
    await ams.app.request("/v1/clients");

    expect(await spans(ams.app)).toHaveLength(1);
    expect(await spans(crm.app)).toEqual([]);
  });

  test("honors EVERGREEN_SCORER_SECRET on X-Evergreen-Internal requests", async () => {
    const prevSecret = process.env.EVERGREEN_SCORER_SECRET;
    process.env.EVERGREEN_SCORER_SECRET = "secret-internal-123";
    try {
      const { app } = createApp();
      // Forged X-Evergreen-Internal without secret IS recorded in the trace
      await app.request("/v1/clients", { headers: { "X-Evergreen-Internal": "1" } });
      expect(await spans(app)).toHaveLength(1);

      // Authorized internal call with matching secret is skipped
      await app.request("/v1/clients", { headers: getInternalRequestHeaders() });
      expect(await spans(app)).toHaveLength(1);
    } finally {
      if (prevSecret === undefined) {
        delete process.env.EVERGREEN_SCORER_SECRET;
      } else {
        process.env.EVERGREEN_SCORER_SECRET = prevSecret;
      }
    }
  });
});
