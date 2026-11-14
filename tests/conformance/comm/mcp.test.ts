import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mcpCall } from "../harness";
import { callRow, callTool, messageRow, start, tool, TOOL_NAMES, type Ctx } from "./support";

let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({
    tables: { messages: [messageRow({ message_id: "MSG-A" }), callRow("CALL-A", "Agent: Hello, this is Dana.")] },
  });
});

const rpc = (method: string, params?: unknown, id: number | string = 1) => ({ id, method, params });

describe("transport", () => {
  test("COMM-R12: a POST is answered as a server-sent event carrying the JSON-RPC response, with no session id", async () => {
    const reply = await mcpCall(ctx.api, rpc("tools/list", {}, 7));
    expect(reply.http.status).toBe(200);
    expect(reply.http.headers.get("content-type")).toContain("text/event-stream");
    expect(reply.http.headers.get("mcp-session-id")).toBeNull();
    expect(reply.http.text).toContain("event: message");
    expect(reply.messages).toHaveLength(1);
    expect(reply.message).toMatchObject({ jsonrpc: "2.0", id: 7 });
  });

  test("COMM-R12: tools can be called without initialize and without any state from an earlier request", async () => {
    const first = await tool(ctx.api, "get_inbox", { limit: 1 });
    const second = await tool(ctx.api, "get_inbox", { limit: 1 });
    expect(first.data).toHaveLength(1);
    expect(second).toEqual(first);
  });

  test("COMM-R12: a batch is answered with one event per request", async () => {
    const reply = await mcpCall(ctx.api, [
      rpc("tools/call", { name: "get_transcript", arguments: { call_id: "CALL-A" } }, "a"),
      rpc("ping", undefined, "b"),
    ]);
    expect(reply.http.status).toBe(200);
    expect(reply.messages.map((m) => m.id).sort()).toEqual(["a", "b"]);
    const call = reply.messages.find((m) => m.id === "a")!;
    expect(JSON.parse(call.result.content[0].text).call_id).toBe("CALL-A");
  });

  test("COMM-R12: a request that does not accept both JSON and event streams is 406", async () => {
    const res = await ctx.api.post("/mcp", { jsonrpc: "2.0", ...rpc("tools/list", {}) }, {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(406);
    expect(res.body).toMatchObject({ jsonrpc: "2.0", error: { code: -32000 } });
  });

  test("COMM-R12: a notification is accepted with 202 and no body", async () => {
    const reply = await mcpCall(ctx.api, { method: "notifications/initialized" });
    expect(reply.http.status).toBe(202);
    expect(reply.http.text).toBe("");
  });

  test("COMM-R12: a body that is not JSON-RPC is 400 with a parse error", async () => {
    const res = await ctx.api.post("/mcp", "this is not json", {
      headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ jsonrpc: "2.0", error: { code: -32700 } });
  });

  test("COMM-R13: initialize names the server evergreen-comm 1.4.0 and offers tools", async () => {
    const reply = await mcpCall(
      ctx.api,
      rpc("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "conformance", version: "1" },
      }),
    );
    expect(reply.http.status).toBe(200);
    expect(reply.message?.result.serverInfo).toEqual({ name: "evergreen-comm", version: "1.4.0" });
    expect(reply.message?.result.capabilities).toHaveProperty("tools");
  });
});

describe("tool catalogue", () => {
  let tools: any[];
  beforeAll(async () => {
    tools = (await mcpCall(ctx.api, rpc("tools/list", {}))).message?.result.tools;
  });
  const byName = (name: string) => tools.find((t) => t.name === name);

  test("COMM-R15: tools/list returns the four tools and their aliases, in order", () => {
    expect(tools.map((t) => t.name)).toEqual(TOOL_NAMES);
  });

  test("COMM-R15: an alias has the description and input schema of its canonical tool", () => {
    for (let i = 0; i < TOOL_NAMES.length; i += 2) {
      const canonical = byName(TOOL_NAMES[i]);
      const alias = byName(TOOL_NAMES[i + 1]);
      expect(alias.description).toBe(canonical.description);
      expect(alias.inputSchema).toEqual(canonical.inputSchema);
    }
  });

  test("COMM-R15: an alias behaves like its canonical tool", async () => {
    expect(await tool(ctx.api, "comm_list_inbox", {})).toEqual(await tool(ctx.api, "get_inbox", {}));
    expect(await tool(ctx.api, "comm_get_transcript", { call_id: "CALL-A" })).toEqual(
      await tool(ctx.api, "get_transcript", { call_id: "CALL-A" }),
    );
    const sent = await tool(ctx.api, "comm_send_message", { to: "+15550000001", channel: "sms", body: "hi" });
    expect(sent.status).toBe("queued");
    const hook = await tool(ctx.api, "comm_register_webhook", {
      action: "subscribe",
      url: "https://hooks.example.com/a",
      events: ["call.missed"],
    });
    expect(hook.webhook_id).toStartWith("whk_");
  });

  test("COMM-R18: get_inbox publishes its input schema", () => {
    const t = byName("get_inbox");
    expect(t.description).toBe(
      "Retrieve recent messages (email, SMS, phone, WhatsApp) with filtering and cursor pagination. Returns messages ordered by timestamp descending.",
    );
    const p = t.inputSchema.properties;
    expect(Object.keys(p).sort()).toEqual(
      ["channel", "client_id", "cursor", "direction", "limit", "read", "since", "until"].sort(),
    );
    expect(p.channel).toMatchObject({ type: "string", enum: ["email", "sms", "phone", "whatsapp"] });
    expect(p.direction).toMatchObject({ type: "string", enum: ["inbound", "outbound"] });
    expect(p.read.type).toBe("boolean");
    expect(p.limit).toMatchObject({ type: "number", minimum: 1, maximum: 100 });
    for (const key of ["client_id", "since", "until", "cursor"]) expect(p[key].type).toBe("string");
    expect(t.inputSchema.required ?? []).toEqual([]);
  });

  test("COMM-R24: send_message publishes its input schema", () => {
    const t = byName("send_message");
    expect(t.description).toBe(
      "Send an outbound message via email, SMS, or WhatsApp. Returns a message_id and queued status.",
    );
    const p = t.inputSchema.properties;
    expect(Object.keys(p).sort()).toEqual(["body", "channel", "client_id", "subject", "template_id", "to"]);
    expect(p.channel).toMatchObject({ type: "string", enum: ["email", "sms", "whatsapp"] });
    for (const key of ["to", "subject", "body", "template_id", "client_id"]) expect(p[key].type).toBe("string");
    expect([...t.inputSchema.required].sort()).toEqual(["body", "channel", "to"]);
  });

  test("COMM-R27: get_transcript publishes its input schema", () => {
    const t = byName("get_transcript");
    expect(t.description).toBe(
      "Get the full transcript of a recorded client call with sentiment analysis and extracted topics.",
    );
    expect(Object.keys(t.inputSchema.properties)).toEqual(["call_id"]);
    expect(t.inputSchema.properties.call_id.type).toBe("string");
    expect(t.inputSchema.required).toEqual(["call_id"]);
  });

  test("COMM-R30: manage_webhook publishes its input schema", () => {
    const t = byName("manage_webhook");
    expect(t.description).toBe(
      "Subscribe or unsubscribe to real-time communication events. Use action 'subscribe' to create a webhook or 'unsubscribe' to remove one.",
    );
    const p = t.inputSchema.properties;
    expect(Object.keys(p).sort()).toEqual(["action", "events", "url", "webhook_id"]);
    expect(p.action).toMatchObject({ type: "string", enum: ["subscribe", "unsubscribe"] });
    expect(p.events).toMatchObject({ type: "array", items: { type: "string" } });
    expect(t.inputSchema.required).toEqual(["action"]);
  });
});

describe("results and errors", () => {
  test("COMM-R16: a success is one text item holding a JSON document, without isError", async () => {
    const res = await callTool(ctx.api, "get_inbox", {});
    expect(res.http.status).toBe(200);
    expect(res.result.content).toHaveLength(1);
    expect(res.result.content[0].type).toBe("text");
    expect(res.result.isError).toBeUndefined();
    expect(res.json).toHaveProperty("data");
  });

  test("COMM-R16: a business error is a result with isError, not a JSON-RPC error", async () => {
    const reply = await mcpCall(ctx.api, rpc("tools/call", { name: "get_transcript", arguments: { call_id: "NOPE" } }));
    expect(reply.http.status).toBe(200);
    expect(reply.message?.error).toBeUndefined();
    expect(reply.message?.result.isError).toBe(true);
    expect(JSON.parse(reply.message?.result.content[0].text).error).toBe("not_found");
  });

  const schemaViolations: [string, string, Record<string, unknown>, string][] = [
    ["a missing required argument", "get_transcript", {}, "call_id"],
    ["a value outside an enum", "get_inbox", { channel: "fax" }, "channel"],
    ["a number below its range", "get_inbox", { limit: 0 }, "limit"],
    ["a number above its range", "get_inbox", { limit: 101 }, "limit"],
    ["a wrong type", "get_inbox", { read: "yes" }, "read"],
    ["phone as a send channel", "send_message", { to: "a@example.com", channel: "phone", body: "x" }, "channel"],
    ["a send without a body", "send_message", { to: "a@example.com", channel: "sms" }, "body"],
    ["an unknown webhook action", "manage_webhook", { action: "delete" }, "action"],
    ["events that are not an array", "manage_webhook", { action: "subscribe", url: "https://x.example", events: "all" }, "events"],
  ];
  for (const [label, name, args, argument] of schemaViolations) {
    test(`COMM-R17: ${label} is rejected before the tool runs (${name})`, async () => {
      const { result: res, diff } = await ctx.svc.changes(() => callTool(ctx.api, name, args));
      expect(res.http.status).toBe(200);
      expect(res.isError).toBe(true);
      expect(res.json).toBeUndefined();
      expect(res.text).toStartWith("MCP error -32602");
      expect(res.text).toContain(argument);
      expect(diff).toEqual({});
    });
  }

  test("COMM-R17: an unknown tool name is an error result", async () => {
    const res = await callTool(ctx.api, "delete_everything", {});
    expect(res.http.status).toBe(200);
    expect(res.isError).toBe(true);
    expect(res.text).toBe("MCP error -32602: Tool delete_everything not found");
  });
});

describe("authentication on /mcp", () => {
  const list = { jsonrpc: "2.0", ...rpc("tools/list", {}) };
  const accept = { headers: { Accept: "application/json, text/event-stream" } };

  test("COMM-R6: no Authorization header is 401 AUTH_ERROR", async () => {
    const res = await ctx.svc.http.post("/mcp", list, accept);
    expect(res.status).toBe(401);
    expect(res.body.error_code).toBe("AUTH_ERROR");
    expect(typeof res.body.correlation_id).toBe("string");
  });

  test("COMM-R6: a scheme other than Bearer is 401", async () => {
    const res = await ctx.svc.http.with({ Authorization: "Basic abc" }).post("/mcp", list, accept);
    expect(res.status).toBe(401);
    expect(res.body.error_code).toBe("AUTH_ERROR");
  });

  test("COMM-R6: a token with a bad signature is 401 and no tool runs", async () => {
    const good = await ctx.svc.token();
    const forged = `${good.slice(0, good.lastIndexOf(".") + 1)}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    const { result: res, diff } = await ctx.svc.changes(() =>
      ctx.svc
        .withToken(forged)
        .post("/mcp", { jsonrpc: "2.0", ...rpc("tools/call", { name: "send_message", arguments: { to: "+15550000002", channel: "sms", body: "x" } }) }, accept),
    );
    expect(res.status).toBe(401);
    expect(res.body.error_code).toBe("AUTH_ERROR");
    expect(diff).toEqual({});
  });

  test("COMM-R8: any valid token may call any tool, whatever its scopes", async () => {
    const callsOnly = await ctx.svc.client({ scopes: ["comm:calls:read"] });
    expect((await tool(callsOnly, "get_inbox", {})).data.length).toBeGreaterThan(0);
    const sent = await tool(callsOnly, "send_message", { to: "+15550000003", channel: "sms", body: "over MCP" });
    expect(sent.status).toBe("queued");
    const hook = await tool(callsOnly, "manage_webhook", {
      action: "subscribe",
      url: "https://hooks.example.com/b",
      events: ["message.failed"],
    });
    expect(hook.secret).toStartWith("whsec_");
    const readonly = await ctx.svc.client({ clientId: "agent-readonly" });
    expect((await tool(readonly, "send_message", { to: "+15550000004", channel: "sms", body: "x" })).status).toBe("queued");
  });
});

describe("stdio transport", () => {
  // The stdio server is a separate entry point, so it is driven here as a child
  // process through the package's own `dev:stdio` script rather than over HTTP.
  async function stdioSession(requests: object[]): Promise<{ replies: any[]; stdout: string; stderr: string }> {
    const child = Bun.spawn([process.execPath, "run", "dev:stdio"], {
      cwd: join(import.meta.dir, "..", "..", "..", "services", "comm"),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        EVERGREEN_DATA_DIR: join(process.env.TMPDIR ?? "/tmp", `conformance-comm-stdio-${process.pid}`),
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const wanted = requests.filter((r: any) => r.id !== undefined).length;
    let stdout = "";
    const replies: any[] = [];
    const reading = (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of child.stdout) {
        stdout += decoder.decode(chunk);
        replies.length = 0;
        for (const line of stdout.split("\n")) {
          if (line.trim() === "") continue;
          try {
            replies.push(JSON.parse(line));
          } catch {
            // an incomplete line; the next chunk completes it
          }
        }
        if (replies.length >= wanted) break;
      }
    })();
    for (const request of requests) child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...request })}\n`);
    child.stdin.flush();
    await Promise.race([reading, Bun.sleep(15_000)]);
    child.stdin.end();
    child.kill();
    const stderr = await new Response(child.stderr).text();
    return { replies, stdout, stderr };
  }

  test("COMM-R14: the stdio entry point serves the same server and tools, unauthenticated, with a clean stdout", async () => {
    const { replies, stdout, stderr } = await stdioSession([
      rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "conformance", version: "1" } }, 1),
      { method: "notifications/initialized" },
      rpc("tools/list", {}, 2),
      rpc("tools/call", { name: "send_message", arguments: { to: "a@example.com", channel: "email", body: "no subject" } }, 3),
    ]);
    const byId = (id: number) => replies.find((r) => r.id === id);
    expect(byId(1)?.result.serverInfo).toEqual({ name: "evergreen-comm", version: "1.4.0" });
    expect(byId(2)?.result.tools.map((t: any) => t.name)).toEqual(TOOL_NAMES);
    const httpTools = (await mcpCall(ctx.api, rpc("tools/list", {}))).message?.result.tools;
    expect(byId(2)?.result.tools).toEqual(httpTools);
    expect(byId(3)?.result.isError).toBe(true);
    expect(JSON.parse(byId(3)?.result.content[0].text)).toEqual({ errors: ["subject is required for email channel"] });
    for (const line of stdout.split("\n").filter((l) => l.trim() !== "")) {
      expect(JSON.parse(line).jsonrpc).toBe("2.0");
    }
    expect(stderr).not.toBe("");
  }, 30_000);
});
