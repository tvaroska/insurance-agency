import { describe, expect, test, beforeAll } from "bun:test";
import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";
import { createTestDb, makeMessage, makePhoneMessage } from "./setup";

const { sqlite: testSqlite, db: testDb } = createTestDb();
mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

import { handleGetInbox } from "../tools/get_inbox";

beforeAll(() => {
  const msgs = [
    makeMessage({
      message_id: "MSG-001",
      client_id: "CLI-001",
      channel: "email",
      direction: "inbound",
      subject: "Billing question",
      body: "Why did my premium go up?",
      timestamp: "2025-08-15T09:30:00Z",
      read: true,
    }),
    makeMessage({
      message_id: "MSG-002",
      client_id: "CLI-001",
      channel: "email",
      direction: "outbound",
      subject: "RE: Billing question",
      body: "Due to rate adjustments.",
      timestamp: "2025-08-15T14:00:00Z",
      read: true,
    }),
    makeMessage({
      message_id: "MSG-003",
      client_id: "CLI-004",
      channel: "sms",
      direction: "inbound",
      subject: null,
      body: "My renewal went up. Can we shop?",
      from_addr: "305-555-0401",
      to_addr: "800-555-EVER",
      timestamp: "2025-09-20T18:45:00Z",
      read: true,
    }),
    makePhoneMessage({
      message_id: "MSG-004",
      client_id: "CLI-008",
      call_id: "CALL-002",
      timestamp: "2025-10-05T11:30:00Z",
      sentiment: "neutral",
      topics: JSON.stringify(["coi_request", "add_driver"]),
      read: true,
    }),
    makeMessage({
      message_id: "MSG-005",
      client_id: "CLI-010",
      channel: "email",
      direction: "inbound",
      subject: "Renters question",
      body: "Buying a condo, what about renters?",
      timestamp: "2025-11-20T16:00:00Z",
      read: false,
    }),
    makeMessage({
      message_id: "MSG-006",
      client_id: "CLI-001",
      channel: "sms",
      direction: "outbound",
      subject: null,
      body: "Your ID cards have been sent.",
      from_addr: "800-555-EVER",
      to_addr: "323-555-0901",
      timestamp: "2026-01-20T13:00:00Z",
      read: false,
    }),
  ];

  for (const m of msgs) {
    testDb.insert(schema.messages).values(m).run();
  }
});

describe("get_inbox - no filters", () => {
  test("returns all messages with default pagination", async () => {
    const result = await handleGetInbox({}, testDb);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.data).toBeArray();
    expect(parsed.data.length).toBe(6);
    expect(parsed.pagination).toHaveProperty("has_more");
  });

  test("returns messages ordered by timestamp desc", async () => {
    const result = await handleGetInbox({}, testDb);
    const parsed = JSON.parse(result.content[0].text as string);
    const timestamps = parsed.data.map((m: any) => m.timestamp);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i - 1] >= timestamps[i]).toBe(true);
    }
  });
});

describe("get_inbox - channel filter", () => {
  test("filters by email channel", async () => {
    const result = await handleGetInbox({ channel: "email" }, testDb);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.data.length).toBe(3);
    for (const m of parsed.data) {
      expect(m.channel).toBe("email");
    }
  });

  test("filters by sms channel", async () => {
    const result = await handleGetInbox({ channel: "sms" }, testDb);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.data.length).toBe(2);
    for (const m of parsed.data) {
      expect(m.channel).toBe("sms");
    }
  });

  test("filters by phone channel and includes phone-specific fields", async () => {
    const result = await handleGetInbox({ channel: "phone" }, testDb);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.data.length).toBe(1);
    const msg = parsed.data[0];
    expect(msg.call_id).toBe("CALL-002");
    expect(msg.duration_seconds).toBe(300);
    expect(msg.sentiment).toBe("neutral");
    expect(msg.topics).toBeArray();
  });
});

describe("get_inbox - direction filter", () => {
  test("filters by inbound direction", async () => {
    const result = await handleGetInbox({ direction: "inbound" }, testDb);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.data.length).toBe(4);
    for (const m of parsed.data) {
      expect(m.direction).toBe("inbound");
    }
  });

  test("filters by outbound direction", async () => {
    const result = await handleGetInbox({ direction: "outbound" }, testDb);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.data.length).toBe(2);
  });
});

describe("get_inbox - other filters", () => {
  test("filters by read status", async () => {
    const result = await handleGetInbox({ read: false }, testDb);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.data.length).toBe(2);
    for (const m of parsed.data) {
      expect(m.read).toBe(false);
    }
  });

  test("filters by client_id", async () => {
    const result = await handleGetInbox({ client_id: "CLI-001" }, testDb);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.data.length).toBe(3);
    for (const m of parsed.data) {
      expect(m.client_id).toBe("CLI-001");
    }
  });

  test("filters by date range (since/until)", async () => {
    const result = await handleGetInbox(
      { since: "2025-09-01T00:00:00Z", until: "2025-11-01T00:00:00Z" },
      testDb,
    );
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.data.length).toBe(2); // MSG-003, MSG-004
  });

  test("returns empty data for no matches", async () => {
    const result = await handleGetInbox({ client_id: "CLI-999" }, testDb);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.data).toEqual([]);
    expect(parsed.pagination.has_more).toBe(false);
  });
});

describe("get_inbox - pagination", () => {
  test("limits results", async () => {
    const result = await handleGetInbox({ limit: 2 }, testDb);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.data.length).toBe(2);
    expect(parsed.pagination.has_more).toBe(true);
    expect(parsed.pagination.next_cursor).toBeTruthy();
  });

  test("paginates with cursor", async () => {
    const firstPage = await handleGetInbox({ limit: 3 }, testDb);
    const firstParsed = JSON.parse(firstPage.content[0].text as string);
    expect(firstParsed.data.length).toBe(3);

    const secondPage = await handleGetInbox(
      { limit: 3, cursor: firstParsed.pagination.next_cursor },
      testDb,
    );
    const secondParsed = JSON.parse(secondPage.content[0].text as string);
    expect(secondParsed.data.length).toBe(3);
    expect(secondParsed.pagination.has_more).toBe(false);

    // No overlap between pages
    const firstIds = firstParsed.data.map((m: any) => m.message_id);
    const secondIds = secondParsed.data.map((m: any) => m.message_id);
    for (const id of secondIds) {
      expect(firstIds).not.toContain(id);
    }
  });
});

describe("get_inbox - response format", () => {
  test("maps from_addr/to_addr back to from/to", async () => {
    const result = await handleGetInbox({ client_id: "CLI-001", direction: "inbound" }, testDb);
    const parsed = JSON.parse(result.content[0].text as string);
    const msg = parsed.data[0];
    expect(msg).toHaveProperty("from");
    expect(msg).toHaveProperty("to");
    expect(msg).not.toHaveProperty("from_addr");
    expect(msg).not.toHaveProperty("to_addr");
  });
});
