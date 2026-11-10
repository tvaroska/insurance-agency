import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createRequestLog } from "@evergreen/shared";
import { createServer } from "../server";
import { createTestPrisma } from "./setup";

const { prisma: testPrisma, sqlite: testSqlite } = createTestPrisma();

// Mirrors the /mcp wiring in src/index.ts. Importing index.ts itself would make Bun
// serve its default export on the shared port 3004.
const requestLog = createRequestLog({ serviceName: "comm", port: 3004, mcpPath: "/mcp" });
const app = new Hono();
app.use("*", requestLog.middleware);
app.route("/sim", requestLog.router);
app.all("/mcp", async (c) => {
  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = createServer(testPrisma);
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

function mcp(message: unknown) {
  return app.request("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(message),
  });
}

async function recordedSpans() {
  const trace = await (await app.request("/sim/trace")).json();
  return trace.resourceSpans[0].scopeSpans[0].spans as {
    name: string;
    attributes: { key: string; value: { stringValue?: string; intValue?: number } }[];
  }[];
}

describe("comm request log over the real MCP transport", () => {
  test("the handshake and tools/list are not recorded", async () => {
    const init = await mcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "request-log-test", version: "1.0.0" },
      },
    });
    expect(init.status).toBe(200);
    await init.text();

    const list = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(await list.text()).toContain("comm_send_message");

    expect(await recordedSpans()).toEqual([]);
  });

  test("a tools/call still reaches the transport intact and is recorded with its tool name", async () => {
    const call = {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "comm_send_message",
        arguments: {
          client_id: "CLI-023",
          to: "marcus.johnson@example.com",
          channel: "email",
          subject: "Welcome",
          body: "Hi Marcus, we received your intake.",
        },
      },
    };
    const res = await mcp(call);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("queued");

    const rows = testSqlite.query("SELECT client_id, to_addr FROM messages").all();
    expect(rows).toContainEqual({ client_id: "CLI-023", to_addr: "marcus.johnson@example.com" });

    const spans = await recordedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("POST /mcp");
    expect(spans[0].attributes).toEqual([
      { key: "http.request.method", value: { stringValue: "POST" } },
      { key: "url.full", value: { stringValue: "http://localhost:3004/mcp" } },
      { key: "http.response.status_code", value: { intValue: 200 } },
      { key: "server.port", value: { intValue: 3004 } },
      { key: "http.request.body", value: { stringValue: JSON.stringify(call) } },
      { key: "mcp.tool.name", value: { stringValue: "comm_send_message" } },
    ]);
  });
});
