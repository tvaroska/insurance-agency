import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";
import { createTestDb, makeWebhook } from "./setup";

let testDb: ReturnType<typeof createTestDb>["db"];
let testSqlite: Database;

beforeEach(() => {
  const created = createTestDb();
  testDb = created.db;
  testSqlite = created.sqlite;
});

import { handleManageWebhook } from "../tools/manage_webhook";

describe("manage_webhook - subscribe", () => {
  test("creates a webhook subscription", async () => {
    const result = await handleManageWebhook(
      {
        action: "subscribe",
        url: "https://example.com/hooks",
        events: ["message.received", "message.delivered"],
      },
      testDb,
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.webhook_id).toStartWith("whk_");
    expect(parsed.secret).toStartWith("whsec_");
    expect(parsed.url).toBe("https://example.com/hooks");
    expect(parsed.events).toEqual(["message.received", "message.delivered"]);
    expect(parsed.created_at).toBeTruthy();
  });

  test("persists webhook in database", async () => {
    await handleManageWebhook(
      {
        action: "subscribe",
        url: "https://example.com/hooks",
        events: ["message.received"],
      },
      testDb,
    );
    const rows = testDb.select().from(schema.webhooks).all();
    expect(rows.length).toBe(1);
    expect(rows[0].active).toBe(true);
  });

  test("returns error when url is missing", async () => {
    const result = await handleManageWebhook(
      { action: "subscribe", events: ["message.received"] },
      testDb,
    );
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.errors).toContain("url is required for subscribe");
  });

  test("returns error when events is missing", async () => {
    const result = await handleManageWebhook(
      { action: "subscribe", url: "https://example.com/hooks" },
      testDb,
    );
    expect(result.isError).toBe(true);
  });

  test("returns error for invalid event type", async () => {
    const result = await handleManageWebhook(
      {
        action: "subscribe",
        url: "https://example.com/hooks",
        events: ["invalid.event"],
      },
      testDb,
    );
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.errors[0]).toContain("Invalid event type");
  });
});

describe("manage_webhook - unsubscribe", () => {
  test("removes an existing webhook", async () => {
    const webhook = makeWebhook({ webhook_id: "whk_to_delete" });
    testDb.insert(schema.webhooks).values(webhook).run();

    const result = await handleManageWebhook(
      { action: "unsubscribe", webhook_id: "whk_to_delete" },
      testDb,
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.deleted).toBe(true);
    expect(parsed.webhook_id).toBe("whk_to_delete");

    const rows = testDb.select().from(schema.webhooks).all();
    expect(rows.length).toBe(0);
  });

  test("returns error when webhook_id is missing", async () => {
    const result = await handleManageWebhook(
      { action: "unsubscribe" },
      testDb,
    );
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.error).toContain("webhook_id is required");
  });

  test("returns error for non-existent webhook_id", async () => {
    const result = await handleManageWebhook(
      { action: "unsubscribe", webhook_id: "whk_nonexistent" },
      testDb,
    );
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.error).toBe("not_found");
  });
});

describe("manage_webhook - invalid action", () => {
  test("returns error for missing action", async () => {
    const result = await handleManageWebhook({}, testDb);
    expect(result.isError).toBe(true);
  });

  test("returns error for invalid action", async () => {
    const result = await handleManageWebhook({ action: "invalid" }, testDb);
    expect(result.isError).toBe(true);
  });
});
