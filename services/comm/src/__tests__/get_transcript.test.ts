import { describe, expect, test, beforeAll } from "bun:test";
import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";
import { createTestDb, makePhoneMessage } from "./setup";

const { sqlite: testSqlite, db: testDb } = createTestDb();
mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

import { handleGetTranscript } from "../tools/get_transcript";

beforeAll(() => {
  const calls = [
    makePhoneMessage({
      message_id: "MSG-T01",
      client_id: "CLI-004",
      call_id: "CALL-001",
      duration_seconds: 540,
      transcript:
        "Agent: Thank you for calling Evergreen Insurance Partners. This is Amy speaking. How can I help you today?\nCaller: Hi Amy, this is David Thompson.",
      sentiment: "positive",
      topics: JSON.stringify(["business_expansion", "coverage_review"]),
      timestamp: "2026-01-10T14:00:00Z",
    }),
    makePhoneMessage({
      message_id: "MSG-T02",
      client_id: "CLI-008",
      call_id: "CALL-002",
      duration_seconds: 380,
      transcript:
        "Agent: Evergreen Insurance, this is Tom. How can I help?\nCaller: Tom, it's Robert Kim.",
      sentiment: "neutral",
      topics: JSON.stringify(["coi_request"]),
      timestamp: "2025-10-05T11:30:00Z",
    }),
  ];

  for (const c of calls) {
    testDb.insert(schema.messages).values(c).run();
  }
});

describe("get_transcript - success", () => {
  test("returns transcript for valid call_id", async () => {
    const result = await handleGetTranscript({ call_id: "CALL-001" }, testDb);
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.call_id).toBe("CALL-001");
    expect(parsed.client_id).toBe("CLI-004");
    expect(parsed.duration_seconds).toBe(540);
    expect(parsed.transcript_text).toContain("Amy speaking");
    expect(parsed.sentiment).toBe("positive");
    expect(parsed.topics).toEqual(["business_expansion", "coverage_review"]);
    expect(parsed.timestamp).toBe("2026-01-10T14:00:00Z");
  });

  test("extracts agent name from transcript", async () => {
    const result = await handleGetTranscript({ call_id: "CALL-001" }, testDb);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.agent_name).toBe("Amy");
  });

  test("extracts different agent names", async () => {
    const result = await handleGetTranscript({ call_id: "CALL-002" }, testDb);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.agent_name).toBe("Tom");
  });
});

describe("get_transcript - errors", () => {
  test("returns error for missing call_id", async () => {
    const result = await handleGetTranscript({}, testDb);
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.error).toBe("call_id is required");
  });

  test("returns error for non-existent call_id", async () => {
    const result = await handleGetTranscript(
      { call_id: "CALL-999" },
      testDb,
    );
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.error).toBe("not_found");
  });
});
