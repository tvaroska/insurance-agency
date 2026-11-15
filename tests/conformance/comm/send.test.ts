import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { loadContract } from "../harness";
import {
  callTool,
  ERROR_ENVELOPE_GAP,
  ISO_TIME,
  messageRow,
  replyScript,
  sign,
  start,
  tool,
  UUID,
  webhookRow,
  type Ctx,
  type ScriptEntry,
} from "./support";

const contract = loadContract("comm");
const SCRIPT = replyScript();
const entry = (scenario: string, turn: number): ScriptEntry =>
  SCRIPT.find((e) => e.scenario_id === scenario && e.turn === turn)!;

let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({});
});

const send = (args: Record<string, unknown>) => tool(ctx.api, "send_message", args);
const messages = () => ctx.svc.table("messages");
const deliveries = () => ctx.svc.table("webhook_deliveries");
const subscribe = (events: string[], url = "https://hooks.example.com/evergreen") =>
  tool(ctx.api, "manage_webhook", { action: "subscribe", url, events });

describe("send_message validation", () => {
  const M = {
    to: "to is required",
    channel: "channel is required",
    body: "body is required",
    enum: "channel must be one of: email, sms, whatsapp",
    subject: "subject is required for email channel",
    template: "template_id must match format: tmpl_[a-z0-9_]+",
  };

  const restCases: [string, Record<string, unknown>, string[]][] = [
    ["an empty body reports the three required fields in order", {}, [M.to, M.channel, M.body]],
    ["an unknown channel", { to: "a@example.com", channel: "fax", body: "x" }, [M.enum]],
    ["phone is not a send channel", { to: "555", channel: "phone", body: "x" }, [M.enum]],
    ["email without a subject", { to: "a@example.com", channel: "email", body: "x" }, [M.subject]],
    ["email with an empty subject", { to: "a@example.com", channel: "email", subject: "", body: "x" }, [M.subject]],
    ["a malformed template id", { to: "555", channel: "sms", body: "x", template_id: "Tmpl-1" }, [M.template]],
    ["a template id without the prefix", { to: "555", channel: "sms", body: "x", template_id: "welcome" }, [M.template]],
    ["every failure together, in the documented order", { channel: "fax", template_id: "BAD" }, [M.to, M.body, M.enum, M.template]],
    ["required, subject and template together", { channel: "email", template_id: "BAD" }, [M.to, M.body, M.subject, M.template]],
  ];
  for (const [label, body, errors] of restCases) {
    test(`COMM-R24: ${label} (REST)`, async () => {
      const { result: res, diff } = await ctx.svc.changes(() => ctx.api.post("/v1/messages/send", body));
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error_code: "VALIDATION_ERROR", details: errors });
      expect(diff).toEqual({});
    });
  }

  test("COMM-R24: over MCP, empty strings pass the schema and reach the same checks", async () => {
    const { result: res, diff } = await ctx.svc.changes(() =>
      callTool(ctx.api, "send_message", { to: "", channel: "sms", body: "", template_id: "BAD" }),
    );
    expect(res.isError).toBe(true);
    expect(res.json).toEqual({ errors: [M.to, M.body, M.template] });
    expect(diff).toEqual({});
    const email = await callTool(ctx.api, "send_message", { to: "a@example.com", channel: "email", body: "x" });
    expect(email.isError).toBe(true);
    expect(email.json).toEqual({ errors: [M.subject] });
  });

  test("COMM-R24: a failed send produces no webhook delivery", async () => {
    await subscribe(["message.delivered", "message.failed"]);
    await callTool(ctx.api, "send_message", { to: "a@example.com", channel: "email", body: "x" });
    expect(await deliveries()).toEqual([]);
  });

  test("COMM-R24: a well-formed template id is accepted", async () => {
    const res = await send({ to: "555", channel: "sms", body: "x", template_id: "tmpl_renewal_2026" });
    expect((await messages())[0]).toMatchObject({ message_id: res.message_id, template_id: "tmpl_renewal_2026" });
  });
});

describe("send_message success", () => {
  test("COMM-R25: an SMS without client_id is stored as an outbound queued row from the agency number", async () => {
    const simMs = (await ctx.svc.now()).getTime();
    const { result, diff } = await ctx.svc.changes(() => send({ to: "+15550001111", channel: "sms", body: "Hello" }));
    expect(Object.keys(result)).toEqual(["message_id", "status", "channel", "timestamp"]);
    expect(result.message_id).toMatch(new RegExp(`^msg_${UUID}$`));
    expect(result).toMatchObject({ status: "queued", channel: "sms" });
    expect(result.timestamp).toMatch(ISO_TIME);
    expect(Math.abs(Date.parse(result.timestamp) - simMs)).toBeLessThan(60_000);
    expect(Object.keys(diff)).toEqual(["messages"]);
    expect(diff.messages.added).toEqual([
      {
        message_id: result.message_id,
        client_id: "unknown",
        direction: "outbound",
        channel: "sms",
        subject: null,
        body: "Hello",
        from_addr: "800-555-EVER",
        to_addr: "+15550001111",
        timestamp: result.timestamp,
        read: false,
        call_id: null,
        duration_seconds: null,
        transcript: null,
        sentiment: null,
        topics: "[]",
        status: "queued",
        template_id: null,
        attachments: "[]",
      },
    ]);
    expect(diff.messages.removed).toEqual([]);
    expect(diff.messages.changed).toEqual([]);
  });

  test("COMM-R25: an email keeps subject, client and template and is sent from the service mailbox", async () => {
    const result = await send({
      to: "nobody@example.com",
      channel: "email",
      subject: "Your renewal",
      body: "Details inside",
      client_id: "CLI-777",
      template_id: "tmpl_renewal",
    });
    expect((await messages())[0]).toMatchObject({
      message_id: result.message_id,
      client_id: "CLI-777",
      channel: "email",
      subject: "Your renewal",
      body: "Details inside",
      from_addr: "service@evergreen-ins.com",
      to_addr: "nobody@example.com",
      template_id: "tmpl_renewal",
      status: "queued",
    });
  });

  test("COMM-R25: WhatsApp is sent from the agency number and a subject is kept when given", async () => {
    const result = await send({ to: "+15550002222", channel: "whatsapp", subject: "FYI", body: "Hi" });
    expect((await messages())[0]).toMatchObject({
      message_id: result.message_id,
      channel: "whatsapp",
      from_addr: "800-555-EVER",
      subject: "FYI",
    });
  });

  test("COMM-R26: a sent message stays queued", async () => {
    const first = await send({ to: "+15550001111", channel: "sms", body: "one" });
    await send({ to: "+15550001111", channel: "sms", body: "two" });
    await ctx.svc.timeTravel({ days: 30 });
    const row = (await messages()).find((m) => m.message_id === first.message_id)!;
    expect(row.status).toBe("queued");
    const listed = await tool(ctx.api, "get_inbox", { direction: "outbound" });
    expect(listed.data.map((m: any) => m.status)).toEqual(["queued", "queued"]);
  });

  test("COMM-R3: sending never changes or removes an existing message", async () => {
    await ctx.svc.seed({ tables: { messages: [messageRow({ message_id: "KEEP-1" }), messageRow({ message_id: "KEEP-2", read: true })] } });
    const { diff } = await ctx.svc.changes(() => send({ to: "+15550001111", channel: "sms", body: "x" }));
    expect(diff.messages.changed).toEqual([]);
    expect(diff.messages.removed).toEqual([]);
    expect(diff.messages.added).toHaveLength(1);
  });
});

describe("REST send", () => {
  test("COMM-R39: POST /messages/send answers 201 with the tool's result document and writes the same row", async () => {
    const { result: res, diff } = await ctx.svc.changes(() =>
      ctx.api.post("/v1/messages/send", { to: "+15550003333", channel: "sms", body: "via REST", client_id: "CLI-5" }),
    );
    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(["message_id", "status", "channel", "timestamp"]);
    expect(res.body.message_id).toMatch(new RegExp(`^msg_${UUID}$`));
    expect(diff.messages.added).toHaveLength(1);
    expect(diff.messages.added[0]).toMatchObject({ message_id: res.body.message_id, client_id: "CLI-5", status: "queued", body: "via REST" });
    // Known gap 9 of specs/comm.spec.md: the OpenAPI file documents 202, the service answers 201.
    contract.check(res, { allowUndocumentedStatus: true });
    contract.checkSchema("SendMessageResponse", res.body);
  });

  test("COMM-R39: unknown body fields, including attachments, are ignored", async () => {
    const res = await ctx.api.post("/v1/messages/send", {
      to: "+15550003333",
      channel: "sms",
      body: "x",
      attachments: [{ file_name: "a.pdf", content_type: "application/pdf", content_base64: "AAAA" }],
      priority: "high",
    });
    expect(res.status).toBe(201);
    expect((await messages())[0].attachments).toBe("[]");
  });

  test("COMM-R39: a REST send triggers the reply simulator and returns simulated_reply", async () => {
    const e = entry("20", 1);
    const res = await ctx.api.post("/v1/messages/send", {
      to: e.recipients[0],
      channel: "email",
      subject: "Your quote",
      body: "Which carrier should we bind?",
    });
    expect(res.status).toBe(201);
    expect(res.body.simulated_reply).toMatchObject({ scenario_id: "20", turn: 1, body: e.reply.body });
  });

  test("COMM-R42: a validation failure body has only error_code and details", async () => {
    const res = await ctx.api.post("/v1/messages/send", { channel: "sms" });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(["error_code", "details"]);
    contract.check(res, { allow: ERROR_ENVELOPE_GAP });
  });

  test("COMM-R42: a body that is not JSON is 500 INTERNAL_ERROR", async () => {
    const { result: res, diff } = await ctx.svc.changes(() =>
      ctx.api.post("/v1/messages/send", "{not json", { headers: { "Content-Type": "application/json" } }),
    );
    expect(res.status).toBe(500);
    expect(res.body.error_code).toBe("INTERNAL_ERROR");
    expect(typeof res.body.correlation_id).toBe("string");
    expect(diff).toEqual({});
  });

  test.todo("Known gap 9: POST /messages/send answers the documented 202 (the service answers 201)");
  test.todo("Known gap 8: malformed JSON on a POST route is 400 (the service answers 500)");
});

describe("reply simulator", () => {
  const first = entry("16", 1);
  const second = entry("16", 2);

  test("COMM-R33: a recipient outside the script gets no reply", async () => {
    const { result, diff } = await ctx.svc.changes(() =>
      send({ to: "stranger@example.com", channel: "email", subject: "Which?", body: "Please confirm?" }),
    );
    expect(result).not.toHaveProperty("simulated_reply");
    expect(diff.messages.added).toHaveLength(1);
  });

  test("COMM-R33: a scripted recipient without a trigger keyword gets no reply", async () => {
    const result = await send({ to: first.recipients[0], channel: "email", subject: "Hello", body: "Good morning" });
    expect(result).not.toHaveProperty("simulated_reply");
    expect(await messages()).toHaveLength(1);
  });

  test("COMM-R33: a keyword match ignores case and also looks at the subject", async () => {
    const result = await send({ to: first.recipients[0], channel: "email", subject: "DEDUCTIBLE", body: "Good morning" });
    expect(result.simulated_reply).toMatchObject({ scenario_id: "16", turn: 1 });
  });

  test("COMM-R33: the recipient match ignores case and surrounding spaces", async () => {
    const result = await send({ to: "  James.Chen@Email.com ", channel: "email", subject: "s", body: "which one?" });
    expect(result.simulated_reply?.scenario_id).toBe("16");
  });

  const phoneForms = ["310-555-0101", "+13105550101", "+1 (310) 555-0101", "(310) 555 0101", "3105550101"];
  for (const form of phoneForms) {
    test(`COMM-R33: the phone number ${form} is normalised before matching`, async () => {
      const result = await send({ to: form, channel: "sms", body: "which policy?" });
      expect(result.simulated_reply).toMatchObject({ scenario_id: "16", turn: 1 });
    });
  }

  test("COMM-R33: a number that is not ten digits after normalisation does not match", async () => {
    const result = await send({ to: "+443105550101", channel: "sms", body: "which policy?" });
    expect(result).not.toHaveProperty("simulated_reply");
  });

  test("COMM-R33: client_id alone addresses a scenario, whatever the recipient", async () => {
    const result = await send({ to: "someone.else@example.com", channel: "email", subject: "COI", body: "certificate attached", client_id: "CLI-018" });
    expect(result.simulated_reply).toMatchObject({ scenario_id: "17", turn: 1, client_id: "CLI-018" });
  });

  test("COMM-R33: the turn follows the replies already stored, and a turn's keywords are its own", async () => {
    const one = await send({ to: first.recipients[0], channel: "email", subject: "s", body: "which policy?" });
    expect(one.simulated_reply.turn).toBe(1);
    // "?" fires turn 1 only; turn 2 has its own keyword list.
    const none = await send({ to: first.recipients[0], channel: "email", subject: "s", body: "really?" });
    expect(none).not.toHaveProperty("simulated_reply");
    const two = await send({ to: first.recipients[0], channel: "email", subject: "s", body: "Endorsement submitted" });
    expect(two.simulated_reply).toMatchObject({ scenario_id: "16", turn: 2, body: second.reply.body });
  });

  test("COMM-R33: the turn is counted from stored message ids with the scenario prefix", async () => {
    await ctx.svc.seed({ tables: { messages: [messageRow({ message_id: "msg_sim_16_seeded" })] } });
    const result = await send({ to: first.recipients[0], channel: "email", subject: "s", body: "updated as requested" });
    expect(result.simulated_reply).toMatchObject({ scenario_id: "16", turn: 2 });
    expect(result.simulated_reply.message_id).toMatch(/^msg_sim_16_t2_[0-9a-f]{8}$/);
  });

  test("COMM-R33: with two candidate scenarios the first in script order that fires wins", async () => {
    const carlos = entry("18", 1).recipients[0];
    // client_id addresses scenario 17, the recipient addresses scenario 18.
    const both = await send({ to: carlos, channel: "email", subject: "s", body: "certificate for the truck", client_id: "CLI-018" });
    expect(both.simulated_reply.scenario_id).toBe("17");
    await ctx.svc.seed({});
    const later = await send({ to: carlos, channel: "email", subject: "s", body: "the truck", client_id: "CLI-018" });
    expect(later.simulated_reply.scenario_id).toBe("18");
  });

  test("COMM-R33: the next turn plays for any recipient that addresses the scenario (Known gap 15)", async () => {
    await send({ to: first.recipients[0], channel: "email", subject: "s", body: "which policy?" });
    // 310-555-0103 is listed for turn 1 only, yet it receives turn 2.
    const turnOneOnly = first.recipients.find((r) => !second.recipients.includes(r))!;
    expect(turnOneOnly).toBe("310-555-0103");
    const result = await send({ to: turnOneOnly, channel: "sms", body: "please confirm" });
    expect(result.simulated_reply).toMatchObject({ scenario_id: "16", turn: 2 });
  });

  test("COMM-R34: the reply row and simulated_reply carry the scripted text on the outbound channel (email)", async () => {
    const { result, diff } = await ctx.svc.changes(() =>
      send({ to: first.recipients[0], channel: "email", subject: "Policy change", body: "Which policy did you mean?" }),
    );
    const reply = result.simulated_reply;
    expect(Object.keys(reply)).toEqual([
      "message_id", "scenario_id", "turn", "client_id", "direction", "channel", "from", "to", "subject", "body", "timestamp",
    ]);
    expect(reply.message_id).toMatch(/^msg_sim_16_t1_[0-9a-f]{8}$/);
    expect(reply).toMatchObject({
      scenario_id: "16",
      turn: 1,
      client_id: first.reply.client_id,
      direction: "inbound",
      channel: "email",
      from: first.reply.from_addr,
      to: "service@evergreen-ins.com",
      subject: first.reply.subject,
      body: first.reply.body,
    });
    expect(Date.parse(reply.timestamp) - Date.parse(result.timestamp)).toBe(10);
    expect(diff.messages.added).toHaveLength(2);
    const row = diff.messages.added.find((m: any) => m.message_id === reply.message_id);
    expect(row).toEqual({
      message_id: reply.message_id,
      client_id: first.reply.client_id,
      direction: "inbound",
      channel: "email",
      subject: first.reply.subject,
      body: first.reply.body,
      from_addr: first.reply.from_addr,
      to_addr: "service@evergreen-ins.com",
      timestamp: reply.timestamp,
      read: false,
      call_id: null,
      duration_seconds: null,
      transcript: null,
      sentiment: null,
      topics: JSON.stringify(first.reply.topics),
      status: "delivered",
      template_id: null,
      attachments: "[]",
    });
  });

  test("COMM-R34: on SMS the reply has no subject and is addressed to the agency number", async () => {
    const result = await send({ to: "310-555-0102", channel: "sms", body: "which policy?" });
    expect(result.simulated_reply).toMatchObject({
      channel: "sms",
      subject: null,
      to: "800-555-EVER",
      from: first.reply.from_addr,
    });
    const row = (await messages()).find((m) => m.message_id === result.simulated_reply.message_id)!;
    expect(row).toMatchObject({ channel: "sms", subject: null, to_addr: "800-555-EVER" });
  });

  test("COMM-R34: the reply is the newest message in the inbox", async () => {
    const result = await send({ to: first.recipients[0], channel: "email", subject: "s", body: "which policy?" });
    const page = await tool(ctx.api, "get_inbox", {});
    expect(page.data.map((m: any) => m.message_id)).toEqual([result.simulated_reply.message_id, result.message_id]);
    expect(page.data[0]).toMatchObject({ direction: "inbound", read: false, status: "delivered" });
  });

  test("COMM-R35: a scenario plays each turn once, and a reseed starts it over", async () => {
    const to = first.recipients[0];
    const turnOne = { to, channel: "email", subject: "s", body: "which policy? confirm" };
    expect((await send(turnOne)).simulated_reply.turn).toBe(1);
    expect((await send(turnOne)).simulated_reply.turn).toBe(2);
    expect(await send(turnOne)).not.toHaveProperty("simulated_reply");
    expect(await send({ ...turnOne, body: "pol-pa-2025-001848 endorsement updated confirm?" })).not.toHaveProperty("simulated_reply");
    await ctx.svc.seed({});
    expect((await send(turnOne)).simulated_reply.turn).toBe(1);
    await ctx.svc.reset("clean");
    expect((await send(turnOne)).simulated_reply.turn).toBe(1);
  });

  for (const scenario of ["16", "17", "18", "19", "20"]) {
    test(`COMM-R34: scenario ${scenario} replies with the text of Appendix A on both turns`, async () => {
      for (const turn of [1, 2]) {
        const e = entry(scenario, turn);
        const result = await send({ to: e.recipients[0], channel: "email", subject: "Follow-up", body: `About ${e.keywords[0]}` });
        expect(result.simulated_reply).toMatchObject({
          scenario_id: scenario,
          turn,
          client_id: e.reply.client_id,
          from: e.reply.from_addr,
          subject: e.reply.subject,
          body: e.reply.body,
        });
        const row = (await messages()).find((m) => m.message_id === result.simulated_reply.message_id)!;
        expect(JSON.parse(row.topics)).toEqual(e.reply.topics);
      }
    });

    test(`COMM-R33: scenario ${scenario} is addressed by each listed client id and recipient`, async () => {
      const e = entry(scenario, 1);
      for (const clientId of e.client_ids) {
        await ctx.svc.seed({});
        const r = await send({ to: "x@example.com", channel: "email", subject: "s", body: e.keywords[0], client_id: clientId });
        expect(r.simulated_reply?.scenario_id).toBe(scenario);
      }
      for (const recipient of e.recipients) {
        await ctx.svc.seed({});
        const r = await send({ to: recipient, channel: recipient.includes("@") ? "email" : "sms", subject: "s", body: e.keywords[0] });
        expect(r.simulated_reply?.scenario_id).toBe(scenario);
      }
    });

    test(`COMM-R33: every keyword of scenario ${scenario} fires its turn`, async () => {
      for (const turn of [1, 2]) {
        const e = entry(scenario, turn);
        for (const keyword of e.keywords) {
          const prior = turn === 2 ? [messageRow({ message_id: `msg_sim_${scenario}_t1_seeded00` })] : [];
          await ctx.svc.seed({ tables: { messages: prior } });
          const r = await send({ to: e.recipients[0], channel: "email", subject: "s", body: `xx ${keyword.toUpperCase()} xx` });
          expect(r.simulated_reply).toMatchObject({ scenario_id: scenario, turn });
        }
      }
    });
  }

  test("COMM-R33: the script has five scenarios with two turns each", () => {
    expect(SCRIPT.map((e) => `${e.scenario_id}/${e.turn}`)).toEqual([
      "16/1", "16/2", "17/1", "17/2", "18/1", "18/2", "19/1", "19/2", "20/1", "20/2",
    ]);
  });

  test("COMM-R33: SIMULATOR_DISABLED=true switches the simulator off", async () => {
    const quiet = await start({ SIMULATOR_DISABLED: "true" });
    await quiet.svc.seed({});
    const result = await tool(quiet.api, "send_message", { to: first.recipients[0], channel: "email", subject: "s", body: "which policy?" });
    expect(result.status).toBe("queued");
    expect(result).not.toHaveProperty("simulated_reply");
    expect(await quiet.svc.table("messages")).toHaveLength(1);
  }, 30_000);
});

describe("webhook deliveries", () => {
  test("COMM-R36: a send records one delivered row per subscription to message.delivered", async () => {
    const hook = await subscribe(["message.delivered"]);
    const simMs = (await ctx.svc.now()).getTime();
    const { result, diff } = await ctx.svc.changes(() => send({ to: "+15550004444", channel: "sms", body: "ping" }));
    expect(diff.webhook_deliveries.added).toHaveLength(1);
    const row: any = diff.webhook_deliveries.added[0];
    expect(row.delivery_id).toMatch(new RegExp(`^del_${UUID}$`));
    expect(row).toMatchObject({
      webhook_id: hook.webhook_id,
      event_type: "message.delivered",
      status: "delivered",
      attempts: 1,
      response_status: 200,
      next_retry_at: null,
    });
    expect(row.created_at).toMatch(ISO_TIME);
    expect(row.last_attempt_at).toBe(row.created_at);
    expect(Math.abs(Date.parse(row.created_at) - simMs)).toBeLessThan(60_000);

    const envelope = JSON.parse(row.payload);
    expect(Object.keys(envelope)).toEqual(["event_id", "event_type", "timestamp", "data"]);
    expect(envelope.event_id).toMatch(new RegExp(`^evt_${UUID}$`));
    expect(envelope.event_id).toBe(row.event_id);
    expect(envelope.event_type).toBe("message.delivered");
    expect(envelope.timestamp).toMatch(ISO_TIME);
    expect(envelope.data).toEqual({ message_id: result.message_id, channel: "sms", to: "+15550004444", status: "queued" });
    expect(Object.keys(envelope.data)).toEqual(["message_id", "channel", "to", "status"]);
    // Known gap 10 of specs/comm.spec.md: the OpenAPI envelope wants a bare UUID as event_id.
    expect(() => contract.checkSchema("WebhookEnvelope", { ...envelope, event_id: envelope.event_id.slice(4) })).not.toThrow();
  });

  test("COMM-R36: the stored payload is compact JSON, the exact text that is signed", async () => {
    await subscribe(["message.delivered"]);
    await send({ to: "+15550004444", channel: "sms", body: 'quotes " and unicode é' });
    const row = (await deliveries())[0];
    expect(row.payload).toBe(JSON.stringify(JSON.parse(row.payload)));
  });

  test("COMM-R36: only active subscriptions to the event receive it; a reply adds message.received", async () => {
    const delivered = await subscribe(["message.delivered"], "https://hooks.example.com/a");
    const received = await subscribe(["message.received"], "https://hooks.example.com/b");
    const both = await subscribe(["message.received", "message.delivered"], "https://hooks.example.com/c");
    await subscribe(["message.failed", "call.completed", "call.missed"], "https://hooks.example.com/d");
    const e = entry("17", 1);

    const quiet = await send({ to: "nobody@example.com", channel: "email", subject: "s", body: "no script here" });
    let rows = await deliveries();
    expect(rows.map((r) => [r.webhook_id, r.event_type]).sort()).toEqual(
      [[delivered.webhook_id, "message.delivered"], [both.webhook_id, "message.delivered"]].sort(),
    );
    expect(rows.every((r) => JSON.parse(r.payload).data.message_id === quiet.message_id)).toBe(true);

    const sent = await send({ to: e.recipients[0], channel: "email", subject: "COI", body: "Which venue?" });
    rows = (await deliveries()).filter((r) => JSON.parse(r.payload).data.message_id !== quiet.message_id);
    expect(rows.map((r) => [r.webhook_id, r.event_type]).sort()).toEqual(
      [
        [delivered.webhook_id, "message.delivered"],
        [both.webhook_id, "message.delivered"],
        [received.webhook_id, "message.received"],
        [both.webhook_id, "message.received"],
      ].sort(),
    );
    const receivedRow = rows.find((r) => r.webhook_id === received.webhook_id)!;
    const data = JSON.parse(receivedRow.payload).data;
    expect(Object.keys(data)).toEqual(["message_id", "client_id", "channel", "from", "status"]);
    expect(data).toEqual({
      message_id: sent.simulated_reply.message_id,
      client_id: e.reply.client_id,
      channel: "email",
      from: e.reply.from_addr,
      status: "delivered",
    });
    expect(receivedRow).toMatchObject({ status: "delivered", attempts: 1, response_status: 200 });
  });

  test("COMM-R36: a subscription seeded as inactive receives nothing", async () => {
    await ctx.svc.seed({ tables: { webhooks: [webhookRow({ active: false }), webhookRow({ webhook_id: "whk_live" })] } });
    await send({ to: "+15550004444", channel: "sms", body: "ping" });
    expect((await deliveries()).map((r) => r.webhook_id)).toEqual(["whk_live"]);
  });

  test("COMM-R36: with no subscription a send writes no delivery", async () => {
    await send({ to: "+15550004444", channel: "sms", body: "ping" });
    expect(await deliveries()).toEqual([]);
  });

  test("COMM-R36: each delivery of one event has its own event id", async () => {
    await subscribe(["message.delivered"], "https://hooks.example.com/a");
    await subscribe(["message.delivered"], "https://hooks.example.com/b");
    await send({ to: "+15550004444", channel: "sms", body: "ping" });
    const rows = await deliveries();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.event_id)).size).toBe(2);
    expect(new Set(rows.map((r) => r.delivery_id)).size).toBe(2);
  });

  test("COMM-R37: a receiver can reproduce the signature from the stored payload and the secret from subscribe", async () => {
    const a = await subscribe(["message.delivered"], "https://hooks.example.com/a");
    const b = await subscribe(["message.delivered"], "https://hooks.example.com/b");
    expect(a.secret).toMatch(/^whsec_[A-Za-z0-9]{32}$/);
    expect(a.secret).not.toBe(b.secret);
    await send({ to: "+15550004444", channel: "sms", body: "ping" });
    const rows = await deliveries();
    const secrets: Record<string, string> = { [a.webhook_id]: a.secret, [b.webhook_id]: b.secret };
    const signatures = rows.map((r) => sign(r.payload, secrets[r.webhook_id]));
    for (const signature of signatures) expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signatures[0]).not.toBe(signatures[1]);
    // The signature itself is neither stored nor sent (Known gap 16).
    for (const r of rows) expect(Object.keys(r)).not.toContain("signature");
  });

  test.todo("Known gap 16: the service's own HMAC-SHA256 signature of a delivery equals the receiver's (it is never stored or sent)");
  test.todo("Known gap 10: delivery envelopes match WebhookEnvelope (event_id is evt_<uuid>, the schema wants a bare UUID)");
  test.todo("Known gap 7: a delivery is sent to the subscription URL with an X-Evergreen-Signature header (no request is made)");
});
