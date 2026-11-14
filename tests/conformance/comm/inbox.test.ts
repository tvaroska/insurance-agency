import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { callRow, callTool, messageRow, start, tool, type Ctx } from "./support";

const contract = loadContract("comm");
let ctx: Ctx;

// Five rows; M3 and M4 share a timestamp so the tie-break is visible.
const ROWS = [
  messageRow({ message_id: "M1", client_id: "CLI-1", channel: "email", direction: "inbound", read: true, timestamp: "2026-01-01T00:00:00Z" }),
  messageRow({ message_id: "M2", client_id: "CLI-1", channel: "sms", direction: "outbound", read: false, timestamp: "2026-01-02T00:00:00Z", subject: null }),
  callRow("CALL-M3", "Agent: Hi, this is Sam.", { message_id: "M3", client_id: "CLI-2", timestamp: "2026-01-03T00:00:00Z" }),
  messageRow({ message_id: "M4", client_id: "CLI-2", channel: "whatsapp", direction: "inbound", read: true, timestamp: "2026-01-03T00:00:00Z", subject: null }),
  messageRow({ message_id: "M5", client_id: "CLI-3", channel: "email", direction: "outbound", read: false, timestamp: "2026-01-04T00:00:00.500Z", template_id: "tmpl_x", status: "queued" }),
];

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({ tables: { messages: ROWS } });
});

const ids = (page: any): string[] => page.data.map((m: any) => m.message_id);
const inbox = (args: Record<string, unknown> = {}) => tool(ctx.api, "get_inbox", args);
const rest = async (query: Record<string, string | number | boolean> = {}, path = "/v1/messages") => {
  const res = await ctx.api.get(path, { query });
  expect(res.status).toBe(200);
  return res.body;
};

describe("message shape", () => {
  test("COMM-R20: a non-phone message has exactly the ten base fields and status, in order", async () => {
    const page = await inbox({ channel: "email", direction: "outbound" });
    expect(page.data).toHaveLength(1);
    expect(Object.keys(page.data[0])).toEqual([
      "message_id", "client_id", "direction", "channel", "subject", "body", "from", "to", "timestamp", "read", "status",
    ]);
    expect(page.data[0]).toEqual({
      message_id: "M5",
      client_id: "CLI-3",
      direction: "outbound",
      channel: "email",
      subject: "Subject",
      body: "Body",
      from: "client@example.com",
      to: "service@evergreen-ins.com",
      timestamp: "2026-01-04T00:00:00.500Z",
      read: false,
      status: "queued",
    });
  });

  test("COMM-R20: a phone message adds the call fields before status and never the transcript", async () => {
    const page = await inbox({ channel: "phone" });
    expect(Object.keys(page.data[0])).toEqual([
      "message_id", "client_id", "direction", "channel", "subject", "body", "from", "to", "timestamp", "read",
      "call_id", "duration_seconds", "sentiment", "topics", "status",
    ]);
    expect(page.data[0]).toMatchObject({ call_id: "CALL-M3", duration_seconds: 120, sentiment: "neutral", subject: null, body: null });
  });

  test("COMM-R2: topics is stored as JSON text and returned as an array", async () => {
    const stored = (await ctx.svc.table("messages")).find((m) => m.message_id === "M3")!;
    expect(stored.topics).toBe('["billing","renewal"]');
    expect((await inbox({ channel: "phone" })).data[0].topics).toEqual(["billing", "renewal"]);
  });
});

describe("filters", () => {
  test("COMM-R18: each filter is an exact match", async () => {
    expect(ids(await inbox({ channel: "email" }))).toEqual(["M5", "M1"]);
    expect(ids(await inbox({ channel: "whatsapp" }))).toEqual(["M4"]);
    expect(ids(await inbox({ direction: "outbound" }))).toEqual(["M5", "M2"]);
    expect(ids(await inbox({ client_id: "CLI-2" }))).toEqual(["M4", "M3"]);
    expect(ids(await inbox({ client_id: "CLI-" }))).toEqual([]);
    expect(ids(await inbox({ read: true }))).toEqual(["M4", "M1"]);
    expect(ids(await inbox({ read: false }))).toEqual(["M5", "M3", "M2"]);
  });

  test("COMM-R18: filters combine with AND", async () => {
    expect(ids(await inbox({ channel: "email", direction: "inbound" }))).toEqual(["M1"]);
    expect(ids(await inbox({ client_id: "CLI-1", read: false }))).toEqual(["M2"]);
    expect(ids(await inbox({ client_id: "CLI-1", channel: "phone" }))).toEqual([]);
  });

  test("COMM-R18: an empty-string filter is not applied", async () => {
    expect(ids(await inbox({ client_id: "", since: "", until: "" }))).toEqual(["M5", "M4", "M3", "M2", "M1"]);
    expect(ids(await rest({ channel: "", direction: "", client_id: "" }))).toEqual(["M5", "M4", "M3", "M2", "M1"]);
  });

  test("COMM-R19: since and until are inclusive", async () => {
    expect(ids(await inbox({ since: "2026-01-03T00:00:00Z" }))).toEqual(["M5", "M4", "M3"]);
    expect(ids(await inbox({ until: "2026-01-02T00:00:00Z" }))).toEqual(["M2", "M1"]);
    expect(ids(await inbox({ since: "2026-01-02T00:00:00Z", until: "2026-01-03T00:00:00Z" }))).toEqual(["M4", "M3", "M2"]);
  });

  test("COMM-R19: bounds are compared as text, not as dates", async () => {
    // M5 is half a second after this bound in time, but "." sorts before "Z" as text.
    expect(ids(await inbox({ until: "2026-01-04T00:00:00Z" }))).toContain("M5");
    expect(ids(await inbox({ since: "2026-01-04T00:00:00Z" }))).toEqual([]);
    expect(ids(await inbox({ since: "2026-01-03" }))).toEqual(["M5", "M4", "M3"]);
  });
});

describe("order and pages", () => {
  test("COMM-R20: newest first, ties broken by message_id descending", async () => {
    expect(ids(await inbox())).toEqual(["M5", "M4", "M3", "M2", "M1"]);
  });

  test("COMM-R21: the default page size is 25 and pagination reports the size used", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      messageRow({ message_id: `N${String(i).padStart(2, "0")}`, timestamp: `2026-02-01T00:00:${String(i).padStart(2, "0")}Z` }),
    );
    await ctx.svc.seed({ tables: { messages: many } });
    const page = await inbox();
    expect(page.data).toHaveLength(25);
    expect(page.pagination).toMatchObject({ limit: 25, cursor: null, has_more: true });
    const all = await inbox({ limit: 100 });
    expect(all.data).toHaveLength(30);
    expect(all.pagination).toEqual({ limit: 100, cursor: null, next_cursor: null, has_more: false });
  });

  test("COMM-R22: next_cursor encodes the last row and has_more tells whether rows remain", async () => {
    const page = await inbox({ limit: 2 });
    expect(ids(page)).toEqual(["M5", "M4"]);
    expect(page.pagination.has_more).toBe(true);
    expect(JSON.parse(atob(page.pagination.next_cursor))).toEqual({ timestamp: "2026-01-03T00:00:00Z", message_id: "M4" });
    const exact = await inbox({ limit: 5 });
    expect(exact.pagination).toEqual({ limit: 5, cursor: null, next_cursor: null, has_more: false });
  });

  test("COMM-R22: following next_cursor visits every row once, also across a timestamp tie", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await inbox({ limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...ids(page));
      expect(page.pagination.cursor).toBe(cursor ?? null);
      if (!page.pagination.has_more) break;
      cursor = page.pagination.next_cursor;
    }
    expect(seen).toEqual(["M5", "M4", "M3", "M2", "M1"]);
  });

  test("COMM-R22: a cursor is combined with the filters of the request", async () => {
    const first = await inbox({ limit: 1, read: false });
    expect(ids(first)).toEqual(["M5"]);
    const second = await inbox({ limit: 1, read: false, cursor: first.pagination.next_cursor });
    expect(ids(second)).toEqual(["M3"]);
    const third = await inbox({ limit: 1, read: false, cursor: second.pagination.next_cursor });
    expect(ids(third)).toEqual(["M2"]);
    expect(third.pagination.has_more).toBe(false);
  });

  test("COMM-R23: over MCP an invalid cursor is an error result", async () => {
    for (const cursor of ["not-base64-json", btoa(JSON.stringify({ timestamp: "2026-01-01T00:00:00Z" })), btoa("[1,2]")]) {
      const res = await callTool(ctx.api, "get_inbox", { cursor });
      expect(res.isError).toBe(true);
      expect(res.text).toBe("One or more fields failed validation.");
    }
  });
});

describe("REST list routes", () => {
  test("COMM-R38: GET /messages and GET /messages/inbox return the tool's result document", async () => {
    const viaTool = await inbox({ limit: 3 });
    expect(await rest({ limit: 3 })).toEqual(viaTool);
    expect(await rest({ limit: 3 }, "/v1/messages/inbox")).toEqual(viaTool);
  });

  test("COMM-R38: query filters are passed to the tool", async () => {
    expect(ids(await rest({ channel: "email", direction: "inbound" }))).toEqual(["M1"]);
    expect(ids(await rest({ client_id: "CLI-2" }, "/v1/messages/inbox"))).toEqual(["M4", "M3"]);
    expect(ids(await rest({ since: "2026-01-02T00:00:00Z", until: "2026-01-03T00:00:00Z" }))).toEqual(["M4", "M3", "M2"]);
    const first = await rest({ limit: 2 });
    expect(ids(await rest({ limit: 2, cursor: first.pagination.next_cursor }))).toEqual(["M3", "M2"]);
  });

  test("COMM-R38: read is true only for the text 'true'", async () => {
    expect(ids(await rest({ read: "true" }))).toEqual(["M4", "M1"]);
    expect(ids(await rest({ read: "false" }))).toEqual(["M5", "M3", "M2"]);
    expect(ids(await rest({ read: "yes" }))).toEqual(["M5", "M3", "M2"]);
    expect(ids(await rest({ read: "" }))).toEqual(["M5", "M3", "M2"]);
  });

  test("COMM-R38: limit is clamped to 1..100; zero and non-numbers mean 25", async () => {
    expect((await rest({ limit: 500 })).pagination.limit).toBe(100);
    expect((await rest({ limit: "abc" })).pagination.limit).toBe(25);
    expect((await rest({ limit: 0 })).pagination.limit).toBe(25);
    const negative = await rest({ limit: -3 });
    expect(negative.pagination.limit).toBe(1);
    expect(ids(negative)).toEqual(["M5"]);
  });

  test("COMM-R38: filter values are not checked against the enums", async () => {
    const page = await rest({ channel: "fax" });
    expect(page).toEqual({ data: [], pagination: { limit: 25, cursor: null, next_cursor: null, has_more: false } });
    expect(ids(await rest({ direction: "sideways" }))).toEqual([]);
  });

  test("COMM-R38: an invalid cursor is 400 with a cursor field error", async () => {
    const garbage = await ctx.api.get("/v1/messages", { query: { cursor: "not-base64-json" } });
    expectError(garbage, 400, "VALIDATION_ERROR", { field: "cursor", code: "invalid_format" });
    expect(garbage.body.message).toBe("One or more fields failed validation.");
    const partial = await ctx.api.get("/v1/messages/inbox", {
      query: { cursor: btoa(JSON.stringify({ timestamp: "2026-01-01T00:00:00Z" })) },
    });
    expectError(partial, 400, "VALIDATION_ERROR", { field: "cursor", code: "invalid_format" });
  });

  test("COMM-R38: the list response has data and a pagination object, nothing else", async () => {
    const res = await ctx.api.get("/v1/messages", { query: { limit: 2 } });
    expect(Object.keys(res.body)).toEqual(["data", "pagination"]);
    expect(Object.keys(res.body.pagination)).toEqual(["limit", "cursor", "next_cursor", "has_more"]);
    // Tolerated issues are Known gaps 1 and 2 of specs/comm.spec.md.
    contract.check(res, {
      allow: [/missing required property 'has_more'/, /missing required property 'attachments'/, /does not match pattern/, /is not a UUID/],
    });
    const aliased = await ctx.api.get("/v1/messages/inbox", { query: { channel: "phone" } });
    contract.check(aliased, {
      allow: [/missing required property 'has_more'/, /missing required property 'attachments'/, /does not match pattern/, /is not a UUID/, /body: is null/],
    });
  });

  test.todo("Known gap 1: list responses match InboxResponse (the service returns a pagination object instead of top-level cursor and has_more)");
  test.todo("Known gap 2: listed messages match Message (no attachments, null body on calls, MSG-NNN and CLI-NNN ids)");
});
