import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expectError, expectedServiceMode, loadContract, mcpCall } from "../harness";
import { callTool, ERROR_ENVELOPE_GAP, messageRow, SCOPES, start, tool, webhookRow, type Ctx } from "./support";

const contract = loadContract("comm");
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({ tables: { messages: [messageRow({ message_id: "P1" })] } });
});

const seedFile = (mode: "seed" | "seed-clean"): any[] =>
  JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "data", mode, "communications.json"), "utf-8"));

const concrete = (path: string) => path.replace("{call_id}", "CALL-001");
const bodyFor = (operationId: string) =>
  operationId === "sendMessage"
    ? { to: "+15550006666", channel: "sms", body: "x" }
    : operationId === "createWebhookSubscription"
      ? { url: "https://hooks.example.com/x", events: ["call.missed"] }
      : undefined;

describe("public endpoints", () => {
  test("COMM-R4: GET /health answers without a token", async () => {
    const res = await ctx.svc.http.get("/health");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["status", "service", "timestamp"]);
    expect(res.body).toMatchObject({ status: "ok", service: "comm" });
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  test("COMM-R5: the three clients hold the documented comm scopes", async () => {
    const scopesOf = async (clientId: string) => {
      const res = await ctx.svc.http.post("/oauth/token", {
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: "dev-secret",
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
      return (res.body.scope as string).split(" ").filter((s) => s.startsWith("comm:")).sort();
    };
    expect(await scopesOf("agent-full")).toEqual(Object.values(SCOPES).sort());
    expect(await scopesOf("agent-csr")).toEqual([SCOPES.calls, SCOPES.read, SCOPES.send].sort());
    expect(await scopesOf("agent-readonly")).toEqual([SCOPES.calls, SCOPES.read].sort());
  });

  test("COMM-R5: a scope the client does not hold is refused with invalid_scope", async () => {
    const res = await ctx.svc.http.post("/oauth/token", {
      grant_type: "client_credentials",
      client_id: "agent-readonly",
      client_secret: "dev-secret",
      scope: SCOPES.send,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_scope");
  });

  test("COMM-R9: a correlation id sent by the caller is echoed, otherwise one is generated", async () => {
    const echoed = await ctx.api.get("/v1/messages", { headers: { "X-Correlation-ID": "conformance-123" } });
    expect(echoed.headers.get("x-correlation-id")).toBe("conformance-123");
    const generated = await ctx.svc.http.get("/health");
    expect(generated.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
    const onError = await ctx.svc.http.get("/v1/messages", { headers: { "X-Correlation-ID": "conformance-456" } });
    expect(onError.status).toBe(401);
    expect(onError.headers.get("x-correlation-id")).toBe("conformance-456");
    expect(onError.body.correlation_id).toBe("conformance-456");
    const viaMcp = await mcpCall(ctx.api, { id: 1, method: "tools/list", params: {} }, { headers: { "X-Correlation-ID": "conformance-789" } });
    expect(viaMcp.http.headers.get("x-correlation-id")).toBe("conformance-789");
  });
});

describe("REST authentication and scopes", () => {
  const operations = contract.operations();

  test("COMM-R7: the OpenAPI file lists the five REST operations with one scope each", () => {
    expect(operations.map((o) => [o.operationId, o.method, o.path, o.scopes])).toEqual([
      ["listInboxMessages", "GET", "/v1/messages/inbox", [SCOPES.read]],
      ["listMessages", "GET", "/v1/messages", [SCOPES.read]],
      ["sendMessage", "POST", "/v1/messages/send", [SCOPES.send]],
      ["getCallTranscript", "GET", "/v1/calls/transcripts/{call_id}", [SCOPES.calls]],
      ["createWebhookSubscription", "POST", "/v1/webhooks/incoming", [SCOPES.webhooks]],
    ]);
  });

  for (const op of operations) {
    test(`COMM-R6: ${op.operationId} without a token is 401 AUTH_ERROR and writes nothing`, async () => {
      const { result: res, diff } = await ctx.svc.changes(() =>
        ctx.svc.http.request(op.method, concrete(op.path), { body: bodyFor(op.operationId) }),
      );
      expectError(res, 401, "AUTH_ERROR");
      expect(res.body.message).toBe("Missing or malformed Authorization header.");
      contract.check(res, { allow: ERROR_ENVELOPE_GAP });
      expect(diff).toEqual({});
    });

    test(`COMM-R6: ${op.operationId} with a forged token is 401`, async () => {
      const good = await ctx.svc.token();
      const forged = `${good.slice(0, good.lastIndexOf(".") + 1)}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
      const res = await ctx.svc.withToken(forged).request(op.method, concrete(op.path), { body: bodyFor(op.operationId) });
      expectError(res, 401, "AUTH_ERROR");
      const malformed = await ctx.svc.withToken("not-a-jwt").request(op.method, concrete(op.path), { body: bodyFor(op.operationId) });
      expectError(malformed, 401, "AUTH_ERROR");
    });

    test(`COMM-R7: ${op.operationId} needs ${op.scopes[0]}`, async () => {
      await ctx.svc.reset("realistic");
      const others = Object.values(SCOPES).filter((s) => s !== op.scopes[0]);
      const without = await ctx.svc.client({ scopes: others });
      const { result: refused, diff } = await ctx.svc.changes(() =>
        without.request(op.method, concrete(op.path), { body: bodyFor(op.operationId) }),
      );
      expectError(refused, 403, "FORBIDDEN");
      expect(refused.body.message).toBe(`Missing required scope(s): ${op.scopes[0]}`);
      contract.check(refused, { allow: ERROR_ENVELOPE_GAP });
      expect(diff).toEqual({});

      const only = await ctx.svc.client({ scopes: [op.scopes[0]] });
      const allowed = await only.request(op.method, concrete(op.path), { body: bodyFor(op.operationId) });
      expect([200, 201]).toContain(allowed.status);
    });
  }

  test("COMM-R7: agent-csr may not manage webhooks over REST and agent-readonly may not send", async () => {
    const csr = await ctx.svc.client({ clientId: "agent-csr" });
    expectError(await csr.post("/v1/webhooks/incoming", bodyFor("createWebhookSubscription")), 403, "FORBIDDEN");
    expect((await csr.post("/v1/messages/send", bodyFor("sendMessage"))).status).toBe(201);
    const readonly = await ctx.svc.client({ clientId: "agent-readonly" });
    expectError(await readonly.post("/v1/messages/send", bodyFor("sendMessage")), 403, "FORBIDDEN");
    expect((await readonly.get("/v1/messages")).status).toBe(200);
  });

  test("COMM-R7: every operation of the OpenAPI file answers its success schema", async () => {
    // A fresh contract object, so this does not depend on which tests ran before.
    await ctx.svc.reset("realistic");
    const fresh = loadContract("comm");
    for (const op of fresh.operations()) {
      const res = await ctx.api.request(op.method, concrete(op.path), { body: bodyFor(op.operationId) });
      expect([200, 201]).toContain(res.status);
      expect(fresh.check(res).schemaChecked).toBe(true);
    }
    expect(fresh.unchecked()).toEqual([]);
  });
});

describe("strict mode", () => {
  let strict: Ctx;
  let guarded: Ctx;
  beforeAll(async () => {
    strict = await start({ MODALITY_MODE: "strict" });
    guarded = await start({ MODALITY_MODE: "strict", EVERGREEN_SCORER_SECRET: "conformance-scorer-secret" });
  }, 60_000);
  beforeEach(async () => {
    await strict.svc.reset("realistic");
    await guarded.svc.reset("realistic");
  });

  const routes: [string, string, unknown][] = [
    ["GET", "/v1/messages", undefined],
    ["GET", "/v1/messages/inbox", undefined],
    ["POST", "/v1/messages/send", { to: "+15550006666", channel: "sms", body: "x" }],
    ["GET", "/v1/calls/transcripts/CALL-001", undefined],
    ["POST", "/v1/webhooks/incoming", { url: "https://hooks.example.com/x", events: ["call.missed"] }],
  ];
  for (const [method, path, body] of routes) {
    test(`COMM-R10: ${method} ${path} is refused with MODALITY_VIOLATION, with or without a token`, async () => {
      const { result: withToken, diff } = await strict.svc.changes(() => strict.api.request(method, path, { body }));
      expectError(withToken, 403, "MODALITY_VIOLATION");
      expect(diff).toEqual({});
      expectError(await strict.svc.http.request(method, path, { body }), 403, "MODALITY_VIOLATION");
    });
  }

  test("COMM-R10: MCP, health, tokens and the control plane keep working", async () => {
    expect((await strict.svc.http.get("/health")).status).toBe(200);
    expect((await strict.svc.status()).modality_mode).toBe("strict");
    expect(Object.keys(await strict.svc.snapshot())).toEqual(["messages", "webhooks", "webhook_deliveries"]);
    expect((await tool(strict.api, "get_inbox", { limit: 1 })).data).toHaveLength(1);
    expect((await tool(strict.api, "get_transcript", { call_id: "CALL-001" })).call_id).toBe("CALL-001");
    expect((await tool(strict.api, "send_message", { to: "+15550006666", channel: "sms", body: "x" })).status).toBe("queued");
    const hook = await tool(strict.api, "manage_webhook", { action: "subscribe", url: "https://hooks.example.com/x", events: ["call.missed"] });
    expect(hook.webhook_id).toStartWith("whk_");
    const unauthenticated = await mcpCall(strict.svc.http, { id: 1, method: "tools/list", params: {} });
    expect(unauthenticated.http.status).toBe(401);
  });

  test("COMM-R10: the default mode is permissive", async () => {
    expect((await ctx.svc.status()).modality_mode).toBe("permissive");
    expect((await ctx.api.get("/v1/messages")).status).toBe(200);
  });

  test("COMM-R11: X-Eval-Scorer: true with X-Evergreen-Scorer-Secret passes the strict check; token and scope still apply", async () => {
    const scorer = {
      "X-Eval-Scorer": "true",
      "X-Evergreen-Scorer-Secret": strict.svc.scorerSecret!,
    };
    const ok = await strict.api.get("/v1/messages", { headers: scorer });
    expect(ok.status).toBe(200);
    expect(ok.body.data.length).toBeGreaterThan(0);
    expect(
      (
        await strict.api.get("/v1/messages", {
          headers: { "X-Eval-Scorer": "TRUE", "X-Evergreen-Scorer-Secret": strict.svc.scorerSecret! },
        })
      ).status,
    ).toBe(200);
    expectError(await strict.api.get("/v1/messages", { headers: { "X-Eval-Scorer": "true" } }), 403, "MODALITY_VIOLATION");
    expectError(await strict.svc.http.get("/v1/messages", { headers: scorer }), 401, "AUTH_ERROR");
    const callsOnly = await strict.svc.client({ scopes: [SCOPES.calls] });
    expectError(await callsOnly.get("/v1/messages", { headers: scorer }), 403, "FORBIDDEN");
    expectError(await strict.api.get("/v1/messages", { headers: { "X-Eval-Scorer": "yes", "X-Evergreen-Scorer-Secret": strict.svc.scorerSecret! } }), 403, "MODALITY_VIOLATION");
    expectError(await strict.api.get("/v1/messages", { headers: { "X-Evergreen-Internal": "1", "X-Evergreen-Scorer-Secret": strict.svc.scorerSecret! } }), 403, "MODALITY_VIOLATION");
  });

  test("COMM-R11: with EVERGREEN_SCORER_SECRET set the scorer must also present the secret", async () => {
    const scorer = { "X-Eval-Scorer": "true" };
    expectError(await guarded.api.get("/v1/messages", { headers: scorer }), 403, "MODALITY_VIOLATION");
    expectError(
      await guarded.api.get("/v1/messages", { headers: { ...scorer, "X-Evergreen-Scorer-Secret": "wrong" } }),
      403,
      "MODALITY_VIOLATION",
    );
    const ok = await guarded.api.get("/v1/messages", {
      headers: { ...scorer, "X-Evergreen-Scorer-Secret": "conformance-scorer-secret" },
    });
    expect(ok.status).toBe(200);
    expectError(
      await guarded.api.get("/v1/messages", { headers: { "X-Evergreen-Scorer-Secret": "conformance-scorer-secret" } }),
      403,
      "MODALITY_VIOLATION",
    );
  });
});

describe("tables and seed data", () => {
  test("COMM-R1: the snapshot has the three tables, sorted by primary key, with stored column names", async () => {
    await ctx.svc.seed({
      tables: {
        messages: [messageRow({ message_id: "B" }), messageRow({ message_id: "A" }), messageRow({ message_id: "C" })],
        webhooks: [webhookRow({ webhook_id: "whk_2" }), webhookRow({ webhook_id: "whk_1" })],
        webhook_deliveries: [
          { delivery_id: "del_2", webhook_id: "whk_1", event_id: "evt_2", event_type: "message.delivered", payload: "{}", status: "delivered", attempts: 1, created_at: "2026-01-01T00:00:00.000Z" },
          { delivery_id: "del_1", webhook_id: "whk_1", event_id: "evt_1", event_type: "message.delivered", payload: "{}", status: "delivered", attempts: 1, created_at: "2026-01-01T00:00:00.000Z" },
        ],
      },
    });
    const tables = await ctx.svc.snapshot();
    expect(Object.keys(tables)).toEqual(["messages", "webhooks", "webhook_deliveries"]);
    expect(tables.messages.map((m) => m.message_id)).toEqual(["A", "B", "C"]);
    expect(tables.webhooks.map((w) => w.webhook_id)).toEqual(["whk_1", "whk_2"]);
    expect(tables.webhook_deliveries.map((d) => d.delivery_id)).toEqual(["del_1", "del_2"]);
    expect(Object.keys(tables.messages[0])).toEqual([
      "message_id", "client_id", "direction", "channel", "subject", "body", "from_addr", "to_addr", "timestamp", "read",
      "call_id", "duration_seconds", "transcript", "sentiment", "topics", "status", "template_id", "attachments",
    ]);
    expect(Object.keys(tables.webhooks[0])).toEqual(["webhook_id", "url", "events", "secret", "active", "created_at"]);
    expect(Object.keys(tables.webhook_deliveries[0])).toEqual([
      "delivery_id", "webhook_id", "event_id", "event_type", "payload", "status", "attempts", "last_attempt_at",
      "next_retry_at", "response_status", "created_at",
    ]);
    expect(typeof tables.messages[0].topics).toBe("string");
    expect(typeof tables.webhooks[0].events).toBe("string");
  });

  test("COMM-R43: reset loads the realistic set by default and clean on request, with no webhooks", async () => {
    await tool(ctx.api, "manage_webhook", { action: "subscribe", url: "https://hooks.example.com/x", events: ["message.delivered"] });
    await tool(ctx.api, "send_message", { to: "+15550006666", channel: "sms", body: "x" });
    const res = await ctx.svc.http.post("/sim/reset");
    expect(res.body).toMatchObject({ status: "reset", service: "comm", seed_mode: "realistic" });
    let tables = await ctx.svc.snapshot();
    expect(tables.messages).toHaveLength(44);
    expect(tables.webhooks).toEqual([]);
    expect(tables.webhook_deliveries).toEqual([]);
    await ctx.svc.reset("clean");
    tables = await ctx.svc.snapshot();
    expect(tables.messages).toHaveLength(42);
  });

  test("COMM-R43: a seed_mode other than clean loads the realistic set", async () => {
    for (const mode of ["demo", "CLEAN", "empty-ish"]) {
      await ctx.svc.reset("clean");
      const res = await ctx.svc.http.post("/sim/reset", { seed_mode: mode });
      expect(res.status).toBe(200);
      const ids = (await ctx.svc.table("messages")).map((m) => m.message_id);
      expect(ids).toHaveLength(44);
      expect(ids).toContain("MSG-038");
    }
  });

  test("COMM-R43: seeding on the empty base loads only the given rows", async () => {
    await ctx.svc.seed({ tables: { messages: [messageRow({ message_id: "ONLY" })] } });
    expect((await ctx.svc.table("messages")).map((m) => m.message_id)).toEqual(["ONLY"]);
    await ctx.svc.seed({});
    expect(await ctx.svc.table("messages")).toEqual([]);
  });

  for (const [mode, folder] of [["realistic", "seed"], ["clean", "seed-clean"]] as const) {
    test(`COMM-R44: every ${mode} seed entry is mapped to a row as specified`, async () => {
      await ctx.svc.reset(mode);
      const rows = await ctx.svc.table("messages");
      const expected = seedFile(folder)
        .map((m) => ({
          message_id: m.message_id,
          client_id: m.client_id,
          direction: m.direction,
          channel: m.channel,
          subject: m.subject ?? null,
          body: m.body ?? null,
          from_addr: m.from ?? (m.channel === "phone" ? "caller" : ""),
          to_addr: m.to ?? (m.channel === "phone" ? "800-555-EVER" : ""),
          timestamp: m.timestamp,
          read: m.read ?? false,
          call_id: m.call_id ?? null,
          duration_seconds: m.duration_seconds ?? null,
          transcript: m.transcript ?? null,
          sentiment: m.sentiment ?? null,
          topics: JSON.stringify(m.topics ?? []),
          status: "delivered",
          template_id: null,
          attachments: "[]",
        }))
        .sort((a, b) => (a.message_id < b.message_id ? -1 : 1));
      expect(rows).toEqual(expected);
    });
  }

  test("COMM-R44: phone entries without addresses get 'caller' and the agency number", async () => {
    await ctx.svc.reset("realistic");
    const call = (await ctx.svc.table("messages")).find((m) => m.message_id === "MSG-003")!;
    expect(call).toMatchObject({ channel: "phone", from_addr: "caller", to_addr: "800-555-EVER", call_id: "CALL-001", status: "delivered" });
  });

  test("COMM-R45: realistic seed facts", async () => {
    await ctx.svc.reset("realistic");
    const rows = await ctx.svc.table("messages");
    expect(rows).toHaveLength(44);
    const calls = rows.filter((m) => m.channel === "phone");
    expect(calls.map((m) => m.call_id).sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `CALL-${String(i + 1).padStart(3, "0")}`),
    );
    expect(rows.filter((m) => m.read === false)).toHaveLength(23);
    const page = await tool(ctx.api, "get_inbox", { limit: 1 });
    expect(page.data[0].message_id).toBe("MSG-038");
    expect(page.pagination.has_more).toBe(true);
    expect(await tool(ctx.api, "get_transcript", { call_id: "CALL-001" })).toMatchObject({
      client_id: "CLI-004",
      duration_seconds: 540,
      sentiment: "positive",
      agent_name: "Amy",
    });
    expect((await tool(ctx.api, "get_transcript", { call_id: "CALL-006" })).agent_name).toBeNull();
    expect(await tool(ctx.api, "get_transcript", { call_id: "CALL-011" })).toMatchObject({ sentiment: "negative", duration_seconds: 720 });
  });

  test("COMM-R45: clean seed facts", async () => {
    await ctx.svc.reset("clean");
    const rows = await ctx.svc.table("messages");
    expect(rows).toHaveLength(42);
    const ids = rows.map((m) => m.message_id);
    expect(ids).not.toContain("MSG-038");
    expect(ids).not.toContain("MSG-039");
    expect(rows.filter((m) => m.channel === "phone")).toHaveLength(12);
    expect(rows.filter((m) => m.read === false)).toHaveLength(16);
    expect((await tool(ctx.api, "get_inbox", { limit: 1 })).data[0].message_id).toBe("MSG-041");
    expect(await tool(ctx.api, "get_transcript", { call_id: "CALL-011" })).toMatchObject({ sentiment: "positive", duration_seconds: 420 });
  });

  test("COMM-R45: walking the realistic inbox 10 at a time returns all 44 messages once", async () => {
    await ctx.svc.reset("realistic");
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await tool(ctx.api, "get_inbox", { limit: 10, ...(cursor ? { cursor } : {}) });
      seen.push(...page.data.map((m: any) => m.message_id));
      if (!page.pagination.has_more) break;
      cursor = page.pagination.next_cursor;
    }
    expect(seen).toHaveLength(44);
    expect(new Set(seen).size).toBe(44);
  });
});

describe("simulated clock", () => {
  const delivery = (id: string, overrides: Record<string, unknown>) => ({
    delivery_id: id,
    webhook_id: "whk_seed",
    event_id: `evt_${id}`,
    event_type: "message.delivered",
    payload: "{}",
    status: "pending",
    attempts: 1,
    last_attempt_at: null,
    next_retry_at: null,
    response_status: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
  const baseMs = Date.parse("2026-10-14T12:00:00.000Z");
  const inHours = (h: number) => new Date(baseMs + h * 3_600_000).toISOString();

  test("COMM-R46: time travel fails pending deliveries whose retry time has passed, and only those", async () => {
    await ctx.svc.seed({
      tables: {
        webhook_deliveries: [
          delivery("del_due", { next_retry_at: inHours(12) }),
          delivery("del_later", { next_retry_at: inHours(240) }),
          delivery("del_no_retry", { next_retry_at: null }),
          delivery("del_done", { status: "delivered", next_retry_at: inHours(12) }),
          delivery("del_failed", { status: "failed", next_retry_at: inHours(12) }),
        ],
      },
    });
    const none = await ctx.svc.timeTravel({ days: 0.1 });
    expect(none.transitions).toEqual({ webhook_deliveries_expired: 0 });
    const res = await ctx.svc.timeTravel({ days: 1 });
    expect(res).toMatchObject({ status: "ok", service: "comm" });
    expect(res.transitions).toEqual({ webhook_deliveries_expired: 1 });
    const status = Object.fromEntries((await ctx.svc.table("webhook_deliveries")).map((d) => [d.delivery_id, d.status]));
    expect(status).toEqual({
      del_due: "failed",
      del_later: "pending",
      del_no_retry: "pending",
      del_done: "delivered",
      del_failed: "failed",
    });
    const more = await ctx.svc.timeTravel({ days: 30 });
    expect(more.transitions).toEqual({ webhook_deliveries_expired: 1 });
  });

  test("COMM-R46: deliveries written by the service are not touched by time travel", async () => {
    await tool(ctx.api, "manage_webhook", { action: "subscribe", url: "https://hooks.example.com/x", events: ["message.delivered"] });
    await tool(ctx.api, "send_message", { to: "+15550006666", channel: "sms", body: "x" });
    const res = await ctx.svc.timeTravel({ days: 400 });
    expect(res.transitions).toEqual({ webhook_deliveries_expired: 0 });
    expect((await ctx.svc.table("webhook_deliveries"))[0].status).toBe("delivered");
  });

  test("COMM-R47: after time travel new rows are stamped with the simulated clock", async () => {
    await tool(ctx.api, "manage_webhook", { action: "subscribe", url: "https://hooks.example.com/x", events: ["message.delivered"] });
    await ctx.svc.timeTravel({ days: 365 });
    const simMs = (await ctx.svc.now()).getTime();
    expect(simMs - baseMs).toBeGreaterThan(360 * 86_400_000);
    const sent = await tool(ctx.api, "send_message", { to: "+15550006666", channel: "sms", body: "x" });
    const hook = await tool(ctx.api, "manage_webhook", { action: "subscribe", url: "https://hooks.example.com/y", events: ["call.missed"] });
    const row = (await ctx.svc.table("webhook_deliveries"))[0];
    for (const stamp of [sent.timestamp, hook.created_at, row.created_at, JSON.parse(row.payload).timestamp]) {
      expect(Math.abs(Date.parse(stamp) - simMs)).toBeLessThan(60_000);
    }
    expect((await ctx.svc.table("messages")).find((m) => m.message_id === "P1")).toBeDefined();
  });
});

describe("control plane, chaos and request log", () => {
  test("COMM-R48: the control plane answers without a token", async () => {
    expect((await ctx.svc.http.get("/sim/snapshot")).status).toBe(200);
    expect((await ctx.svc.http.get("/sim/status")).body).toMatchObject({ status: "ok", service: "comm" });
    expect((await ctx.svc.http.get("/sim/trace")).status).toBe(200);
    expect((await ctx.svc.http.post("/sim/time-travel", { days: 0 })).status).toBe(200);
    expect((await ctx.svc.http.post("/sim/chaos", { enabled: false })).status).toBe(200);
    expect((await ctx.svc.http.post("/sim/seed", { base: "empty" })).body).toMatchObject({ status: "seeded", service: "comm" });
    expect((await ctx.svc.http.post("/sim/reset", { seed_mode: "clean" })).body).toMatchObject({ status: "reset", seed_mode: "clean" });
  });

  test("COMM-R48: seeding an unknown table is refused and names the three tables", async () => {
    const res = await ctx.svc.http.post("/sim/seed", { base: "empty", tables: { policies: [] } });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("messages, webhooks, webhook_deliveries");
  });

  test("COMM-R49: chaos fails /v1 and /mcp requests without running them; health and /sim are spared", async () => {
    await ctx.svc.chaos({ enabled: true, error_rate: 1 });
    const { result: viaRest, diff } = await ctx.svc.changes(() =>
      ctx.api.post("/v1/messages/send", { to: "+15550006666", channel: "sms", body: "x" }),
    );
    expectError(viaRest, 503, "SERVICE_UNAVAILABLE");
    const viaMcp = await callTool(ctx.api, "send_message", { to: "+15550006666", channel: "sms", body: "x" });
    expect(viaMcp.http.status).toBe(503);
    expect(viaMcp.http.body.error_code).toBe("SERVICE_UNAVAILABLE");
    expect(diff).toEqual({});
    expect((await ctx.svc.http.get("/health")).status).toBe(200);
    await ctx.svc.chaos({ enabled: true, error_rate: 1, status_code: 500 });
    expect((await ctx.api.get("/v1/messages")).status).toBe(500);
    await ctx.svc.seed({});
    expect((await ctx.svc.status()).chaos.enabled).toBe(false);
    expect((await ctx.api.get("/v1/messages")).status).toBe(200);
  });

  const spans = async () => {
    const res = await ctx.svc.http.get("/sim/trace");
    expect(res.status).toBe(200);
    const resource = res.body.resourceSpans[0];
    expect(resource.resource.attributes).toContainEqual({ key: "service.name", value: { stringValue: "comm" } });
    return resource.scopeSpans[0].spans as any[];
  };
  const attr = (span: any, key: string) => {
    const value = span.attributes.find((a: any) => a.key === key)?.value;
    return value?.stringValue ?? value?.intValue;
  };

  test("COMM-R50: REST calls and MCP tool calls are logged; other MCP requests are not", async () => {
    await ctx.svc.seed({});
    expect(await spans()).toEqual([]);
    await ctx.api.get("/v1/messages", { query: { limit: 1 } });
    await mcpCall(ctx.api, { id: 1, method: "tools/list", params: {} });
    await mcpCall(ctx.api, { id: 2, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "c", version: "1" } } });
    await callTool(ctx.api, "get_inbox", { limit: 1 });
    await ctx.svc.http.get("/health");
    await ctx.svc.snapshot();
    const logged = await spans();
    expect(logged.map((s) => s.name)).toEqual(["GET /v1/messages", "POST /mcp"]);
    expect(attr(logged[0], "url.full")).toBe("http://localhost:3004/v1/messages?limit=1");
    expect(attr(logged[0], "server.port")).toBe(3004);
    expect(attr(logged[0], "http.response.status_code")).toBe(200);
    expect(attr(logged[0], "mcp.tool.name")).toBeUndefined();
    expect(attr(logged[1], "url.full")).toBe("http://localhost:3004/mcp");
    expect(attr(logged[1], "mcp.tool.name")).toBe("get_inbox");
    expect(JSON.parse(attr(logged[1], "http.request.body")).params.name).toBe("get_inbox");
  });

  test("COMM-R50: a batch with several tool calls yields one span per call", async () => {
    await ctx.svc.seed({});
    await mcpCall(ctx.api, [
      { id: 1, method: "tools/call", params: { name: "get_inbox", arguments: {} } },
      { id: 2, method: "tools/call", params: { name: "comm_get_transcript", arguments: { call_id: "X" } } },
      { id: 3, method: "ping" },
    ]);
    expect((await spans()).map((s) => attr(s, "mcp.tool.name")).sort()).toEqual(["comm_get_transcript", "get_inbox"]);
  });

  test("COMM-R50: internal requests are not logged, and reset or seed clears the log", async () => {
    await ctx.svc.seed({});
    await ctx.api.get("/v1/messages", { headers: { "X-Evergreen-Internal": "1" } });
    expect(await spans()).toEqual([]);
    await ctx.api.get("/v1/messages");
    expect(await spans()).toHaveLength(1);
    await ctx.svc.reset("clean");
    expect(await spans()).toEqual([]);
  });
});

describe("access log", () => {
  test.skipIf(expectedServiceMode("comm") !== "process")(
    "COMM-R54: each request is written to standard output as one JSON line",
    async () => {
      expect(ctx.svc.mode).toBe("process");
    const id = `access-log-${crypto.randomUUID()}`;
    const res = await ctx.api.get("/v1/messages", { query: { limit: 1 }, headers: { "X-Correlation-ID": id, "User-Agent": "conformance-suite" } });
    expect(res.status).toBe(200);
    let line: string | undefined;
    for (let i = 0; i < 40 && !line; i++) {
      line = ctx.svc.logs().split("\n").find((l) => l.includes(id));
      if (!line) await Bun.sleep(25);
    }
    const entry = JSON.parse(line!);
    expect(entry).toMatchObject({
      method: "GET",
      path: "/v1/messages",
      status: 200,
      correlation_id: id,
      query: { limit: "1" },
      user_agent: "conformance-suite",
    });
    expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);
    expect(typeof entry.duration_ms).toBe("number");
    },
  );
});
