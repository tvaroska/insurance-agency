import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { loadContract } from "../harness";
import { callRow, callTool, ERROR_ENVELOPE_GAP, EVENT_TYPES, ISO_TIME, messageRow, start, tool, UUID, webhookRow, type Ctx } from "./support";

const contract = loadContract("comm");
let ctx: Ctx;

const TRANSCRIPT = "Agent: Thank you for calling Evergreen. This is Priya speaking.\nCaller: Hi Priya, I have a question.";

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({
    tables: {
      messages: [
        callRow("CALL-T1", TRANSCRIPT, { message_id: "T1", client_id: "CLI-42", duration_seconds: 305, sentiment: "positive", timestamp: "2026-02-02T10:00:00Z" }),
        messageRow({ message_id: "T2" }),
      ],
    },
  });
});

const seedCall = (callId: string, transcript: string | null) =>
  ctx.svc.seed({ tables: { messages: [callRow(callId, transcript)] } });

describe("get_transcript", () => {
  test("COMM-R27: the result is built from the message row with that call_id", async () => {
    const res = await tool(ctx.api, "get_transcript", { call_id: "CALL-T1" });
    expect(Object.keys(res)).toEqual([
      "call_id", "client_id", "agent_name", "duration_seconds", "transcript_text", "sentiment", "topics", "timestamp",
    ]);
    expect(res).toEqual({
      call_id: "CALL-T1",
      client_id: "CLI-42",
      agent_name: "Priya",
      duration_seconds: 305,
      transcript_text: TRANSCRIPT,
      sentiment: "positive",
      topics: ["billing", "renewal"],
      timestamp: "2026-02-02T10:00:00Z",
    });
  });

  test("COMM-R27: reading a transcript writes nothing", async () => {
    const { diff } = await ctx.svc.changes(() => tool(ctx.api, "get_transcript", { call_id: "CALL-T1" }));
    expect(diff).toEqual({});
  });

  const names: [string, string | null, string | null][] = [
    ["this is <name>", "Agent: Evergreen Insurance, this is Lisa speaking.", "Lisa"],
    ["I'm <name>", "Agent: Hello, I'm Marcus, how can I help?", "Marcus"],
    ["I am <name>", "Agent: Good morning, I am Dana.", "Dana"],
    ["upper-case phrase", "Agent: THIS IS Omar.", "Omar"],
    ["the first match on the line wins", "Agent: I'm sorry to hear that, this is Tom.", "sorry"],
    ["the phrase must follow Agent: on the same line", "Agent: Hello.\nCaller: this is Bob.", null],
    ["a caller's introduction alone is not used", "Caller: Hi, this is Carol.", null],
    ["no introduction phrase", "Agent: Thank you for calling Evergreen.", null],
    ["an empty transcript", "", null],
    ["a missing transcript", null, null],
  ];
  for (const [label, transcript, expected] of names) {
    test(`COMM-R28: agent_name, ${label}`, async () => {
      await seedCall("CALL-N", transcript);
      const res = await tool(ctx.api, "get_transcript", { call_id: "CALL-N" });
      expect(res.agent_name).toBe(expected);
      expect(res.transcript_text).toBe(transcript);
    });
  }

  test("COMM-R29: an unknown call is a not_found error result", async () => {
    const res = await callTool(ctx.api, "get_transcript", { call_id: "CALL-NOPE" });
    expect(res.isError).toBe(true);
    expect(res.json).toEqual({ error: "not_found", message: "No transcript found for call_id: CALL-NOPE" });
  });

  test("COMM-R29: an empty call_id is rejected by the tool", async () => {
    const res = await callTool(ctx.api, "get_transcript", { call_id: "" });
    expect(res.isError).toBe(true);
    expect(res.json).toEqual({ error: "call_id is required" });
  });

  test("COMM-R29: a message id is not a call id", async () => {
    const res = await callTool(ctx.api, "get_transcript", { call_id: "T1" });
    expect(res.json?.error).toBe("not_found");
  });
});

describe("REST transcript", () => {
  test("COMM-R40: GET /calls/transcripts/{call_id} returns the tool's result document", async () => {
    const res = await ctx.api.get("/v1/calls/transcripts/CALL-T1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(await tool(ctx.api, "get_transcript", { call_id: "CALL-T1" }));
    // Tolerated issues are Known gap 3 of specs/comm.spec.md.
    contract.check(res, { allow: [/call_id: does not match pattern/, /client_id: .* is not a UUID/] });
  });

  test("COMM-R40: a call without an agent introduction returns agent_name null", async () => {
    await seedCall("CALL-Q", "Agent: Thank you for calling.");
    const res = await ctx.api.get("/v1/calls/transcripts/CALL-Q");
    expect(res.status).toBe(200);
    expect(res.body.agent_name).toBeNull();
  });

  test("COMM-R40: an unknown call is 404 with error_code and message only", async () => {
    const res = await ctx.api.get("/v1/calls/transcripts/CALL-NOPE");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error_code: "NOT_FOUND", message: "No transcript found for call_id: CALL-NOPE" });
    contract.check(res, { allow: ERROR_ENVELOPE_GAP });
  });

  test("COMM-R42: the 404 body carries no correlation_id, though the header is set", async () => {
    const res = await ctx.api.get("/v1/calls/transcripts/CALL-NOPE");
    expect(Object.keys(res.body)).toEqual(["error_code", "message"]);
    expect(res.headers.get("x-correlation-id")).toBeTruthy();
  });

  test.todo("Known gap 3: transcripts match CallTranscript (CALL-NNN and CLI-NNN ids, agent_name may be null)");
});

describe("manage_webhook subscribe", () => {
  const E = {
    url: "url is required for subscribe",
    events: "events is required for subscribe (at least one event)",
    invalid: (name: string) => `Invalid event type: ${name}. Must be one of: ${EVENT_TYPES.join(", ")}`,
  };

  const cases: [string, Record<string, unknown>, string[]][] = [
    ["no url and no events", {}, [E.url, E.events]],
    ["an empty url", { url: "", events: ["call.missed"] }, [E.url]],
    ["an empty event list", { url: "https://h.example.com", events: [] }, [E.events]],
    ["an unknown event", { url: "https://h.example.com", events: ["message.read"] }, [E.invalid("message.read")]],
    ["one error per unknown event, known ones accepted", { url: "https://h.example.com", events: ["a.b", "call.missed", "c.d"] }, [E.invalid("a.b"), E.invalid("c.d")]],
    ["url and event errors together, in order", { events: ["bogus"] }, [E.url, E.invalid("bogus")]],
  ];
  for (const [label, args, errors] of cases) {
    test(`COMM-R30: ${label}`, async () => {
      const { result: res, diff } = await ctx.svc.changes(() =>
        callTool(ctx.api, "manage_webhook", { action: "subscribe", ...args }),
      );
      expect(res.isError).toBe(true);
      expect(res.json).toEqual({ errors });
      expect(diff).toEqual({});
    });
  }

  test("COMM-R30: every documented event name is accepted", async () => {
    const res = await tool(ctx.api, "manage_webhook", { action: "subscribe", url: "https://h.example.com", events: EVENT_TYPES });
    expect(res.events).toEqual(EVENT_TYPES);
  });

  test("COMM-R31: subscribe stores an active webhook with a fresh secret and returns it once", async () => {
    const simMs = (await ctx.svc.now()).getTime();
    const { result, diff } = await ctx.svc.changes(() =>
      tool(ctx.api, "manage_webhook", {
        action: "subscribe",
        url: "https://hooks.example.com/in",
        events: ["message.received", "call.completed"],
      }),
    );
    expect(Object.keys(result)).toEqual(["webhook_id", "url", "events", "secret", "created_at"]);
    expect(result.webhook_id).toMatch(new RegExp(`^whk_${UUID}$`));
    expect(result.secret).toMatch(/^whsec_[A-Za-z0-9]{32}$/);
    expect(result.url).toBe("https://hooks.example.com/in");
    expect(result.events).toEqual(["message.received", "call.completed"]);
    expect(result.created_at).toMatch(ISO_TIME);
    expect(Math.abs(Date.parse(result.created_at) - simMs)).toBeLessThan(60_000);
    expect(diff).toEqual({
      webhooks: {
        added: [
          {
            webhook_id: result.webhook_id,
            url: "https://hooks.example.com/in",
            events: '["message.received","call.completed"]',
            secret: result.secret,
            active: true,
            created_at: result.created_at,
          },
        ],
        removed: [],
        changed: [],
      },
    });
  });

  test("COMM-R31: the url is stored as given, whatever its form", async () => {
    const res = await tool(ctx.api, "manage_webhook", { action: "subscribe", url: "not a url", events: ["call.missed"] });
    expect(res.url).toBe("not a url");
  });

  test("COMM-R31: duplicate subscriptions are separate rows with separate secrets", async () => {
    const args = { action: "subscribe", url: "https://hooks.example.com/dup", events: ["call.missed"] };
    const a = await tool(ctx.api, "manage_webhook", args);
    const b = await tool(ctx.api, "manage_webhook", args);
    expect(a.webhook_id).not.toBe(b.webhook_id);
    expect(a.secret).not.toBe(b.secret);
    expect(await ctx.svc.table("webhooks")).toHaveLength(2);
  });

  test("COMM-R2: events is stored as JSON text and returned as an array", async () => {
    const res = await tool(ctx.api, "manage_webhook", { action: "subscribe", url: "https://h.example.com", events: ["call.missed"] });
    expect(res.events).toEqual(["call.missed"]);
    expect((await ctx.svc.table("webhooks"))[0].events).toBe('["call.missed"]');
  });
});

describe("manage_webhook unsubscribe", () => {
  test("COMM-R32: unsubscribe deletes the row and confirms", async () => {
    const hook = await tool(ctx.api, "manage_webhook", { action: "subscribe", url: "https://h.example.com", events: ["call.missed"] });
    const other = await tool(ctx.api, "manage_webhook", { action: "subscribe", url: "https://h.example.com/2", events: ["call.missed"] });
    const res = await tool(ctx.api, "manage_webhook", { action: "unsubscribe", webhook_id: hook.webhook_id });
    expect(res).toEqual({ deleted: true, webhook_id: hook.webhook_id });
    expect((await ctx.svc.table("webhooks")).map((w) => w.webhook_id)).toEqual([other.webhook_id]);
  });

  test("COMM-R32: a second unsubscribe of the same id is not_found", async () => {
    const hook = await tool(ctx.api, "manage_webhook", { action: "subscribe", url: "https://h.example.com", events: ["call.missed"] });
    await tool(ctx.api, "manage_webhook", { action: "unsubscribe", webhook_id: hook.webhook_id });
    const again = await callTool(ctx.api, "manage_webhook", { action: "unsubscribe", webhook_id: hook.webhook_id });
    expect(again.isError).toBe(true);
    expect(again.json).toEqual({ error: "not_found", message: `No webhook found with id: ${hook.webhook_id}` });
  });

  test("COMM-R32: unsubscribe without or with an empty webhook_id is an error", async () => {
    for (const args of [{}, { webhook_id: "" }]) {
      const res = await callTool(ctx.api, "manage_webhook", { action: "unsubscribe", ...args });
      expect(res.isError).toBe(true);
      expect(res.json).toEqual({ error: "webhook_id is required for unsubscribe" });
    }
  });

  test("COMM-R32: unsubscribe ignores url and events", async () => {
    await ctx.svc.seed({ tables: { webhooks: [webhookRow({ webhook_id: "whk_keep" })] } });
    const res = await callTool(ctx.api, "manage_webhook", { action: "unsubscribe", url: "https://hooks.example.com/evergreen", events: ["message.delivered"] });
    expect(res.json).toEqual({ error: "webhook_id is required for unsubscribe" });
    expect(await ctx.svc.table("webhooks")).toHaveLength(1);
  });

  test("COMM-R3: an unsubscribed webhook stops receiving events and keeps its past deliveries", async () => {
    const hook = await tool(ctx.api, "manage_webhook", { action: "subscribe", url: "https://h.example.com", events: ["message.delivered"] });
    await tool(ctx.api, "send_message", { to: "+15550005555", channel: "sms", body: "one" });
    await tool(ctx.api, "manage_webhook", { action: "unsubscribe", webhook_id: hook.webhook_id });
    await tool(ctx.api, "send_message", { to: "+15550005555", channel: "sms", body: "two" });
    const rows = await ctx.svc.table("webhook_deliveries");
    expect(rows).toHaveLength(1);
    expect(rows[0].webhook_id).toBe(hook.webhook_id);
  });
});

describe("REST webhook subscription", () => {
  test("COMM-R41: POST /webhooks/incoming subscribes and answers 201 with the tool's result document", async () => {
    const { result: res, diff } = await ctx.svc.changes(() =>
      ctx.api.post("/v1/webhooks/incoming", { url: "https://hooks.example.com/rest", events: ["message.delivered", "call.missed"] }),
    );
    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(["webhook_id", "url", "events", "secret", "created_at"]);
    expect(res.body.webhook_id).toMatch(new RegExp(`^whk_${UUID}$`));
    expect(res.body.secret).toMatch(/^whsec_[A-Za-z0-9]{32}$/);
    expect(diff.webhooks.added).toHaveLength(1);
    expect(diff.webhooks.added[0]).toMatchObject({ webhook_id: res.body.webhook_id, secret: res.body.secret, active: true });
    // Tolerated issue is Known gap 4 of specs/comm.spec.md.
    contract.check(res, { allow: [/missing required property 'active'/] });
  });

  test("COMM-R41: other body fields are ignored: no caller-chosen secret, state or action", async () => {
    const res = await ctx.api.post("/v1/webhooks/incoming", {
      url: "https://hooks.example.com/rest",
      events: ["call.missed"],
      secret: "whsec_mine",
      active: false,
      action: "unsubscribe",
      webhook_id: "whk_x",
    });
    expect(res.status).toBe(201);
    const row = (await ctx.svc.table("webhooks"))[0];
    expect(row.secret).not.toBe("whsec_mine");
    expect(row.active).toBe(true);
  });

  test("COMM-R41: validation failures are 400 with the error strings as details", async () => {
    const { result: res, diff } = await ctx.svc.changes(() => ctx.api.post("/v1/webhooks/incoming", { events: ["nope"] }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error_code: "VALIDATION_ERROR",
      details: [
        "url is required for subscribe",
        `Invalid event type: nope. Must be one of: ${EVENT_TYPES.join(", ")}`,
      ],
    });
    expect(diff).toEqual({});
    contract.check(res, { allow: ERROR_ENVELOPE_GAP });
  });

  test("COMM-R41: a duplicate subscription is accepted, not 409", async () => {
    const body = { url: "https://hooks.example.com/rest", events: ["call.missed"] };
    expect((await ctx.api.post("/v1/webhooks/incoming", body)).status).toBe(201);
    expect((await ctx.api.post("/v1/webhooks/incoming", body)).status).toBe(201);
  });

  test("COMM-R41: there is no REST route to list or delete subscriptions", async () => {
    expect((await ctx.api.get("/v1/webhooks/incoming")).status).toBe(404);
    expect((await ctx.api.delete("/v1/webhooks/incoming/whk_x")).status).toBe(404);
    expect((await ctx.api.get("/v1/webhooks")).status).toBe(404);
  });

  test("COMM-R42: a body that is not JSON is 500 INTERNAL_ERROR", async () => {
    const res = await ctx.api.post("/v1/webhooks/incoming", "{oops", { headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(500);
    expect(res.body.error_code).toBe("INTERNAL_ERROR");
  });

  test.todo("Known gap 4: the subscription response matches WebhookSubscription (active is not returned)");
  test.todo("Known gap 7: a duplicate subscription is 409 (the service accepts it)");
  test.todo("Known gap 5: error bodies match the OpenAPI Error schema (the service uses the flat shared envelope, and three routes a smaller body)");
});
