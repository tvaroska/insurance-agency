import { describe, expect, test, beforeEach } from "bun:test";
import { mock } from "bun:test";
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

// Import dynamically isn't needed since we test the handler directly
import { handleSendMessage } from "../tools/send_message";

describe("send_message - validation", () => {
  test("returns error when 'to' is missing", async () => {
    const result = await handleSendMessage(
      { channel: "email", body: "Hello" },
      testDb,
    );
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.errors).toContain("to is required");
  });

  test("returns error when 'channel' is missing", async () => {
    const result = await handleSendMessage(
      { to: "test@example.com", body: "Hello" },
      testDb,
    );
    expect(result.isError).toBe(true);
  });

  test("returns error when 'body' is missing", async () => {
    const result = await handleSendMessage(
      { to: "test@example.com", channel: "email" },
      testDb,
    );
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.errors).toContain("body is required");
  });

  test("returns error for invalid channel", async () => {
    const result = await handleSendMessage(
      { to: "test@example.com", channel: "telegram", body: "Hi" },
      testDb,
    );
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.errors[0]).toContain("channel must be one of");
  });

  test("returns error when email channel lacks subject", async () => {
    const result = await handleSendMessage(
      { to: "test@example.com", channel: "email", body: "Hello" },
      testDb,
    );
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.errors).toContain("subject is required for email channel");
  });

  test("returns error for invalid template_id format", async () => {
    const result = await handleSendMessage(
      {
        to: "test@example.com",
        channel: "sms",
        body: "Hi",
        template_id: "bad_format",
      },
      testDb,
    );
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.errors[0]).toContain("template_id must match format");
  });
});

describe("send_message - success", () => {
  test("sends an email message", async () => {
    const result = await handleSendMessage(
      {
        to: "customer@example.com",
        channel: "email",
        subject: "Policy Update",
        body: "Your policy has been renewed.",
        client_id: "CLI-001",
      },
      testDb,
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.message_id).toStartWith("msg_");
    expect(parsed.status).toBe("queued");
    expect(parsed.channel).toBe("email");
  });

  test("sends an SMS message", async () => {
    const result = await handleSendMessage(
      {
        to: "+15551234567",
        channel: "sms",
        body: "Your policy renews on 3/1.",
        client_id: "CLI-002",
      },
      testDb,
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.message_id).toStartWith("msg_");
    expect(parsed.status).toBe("queued");
    expect(parsed.channel).toBe("sms");
  });

  test("accepts valid template_id", async () => {
    const result = await handleSendMessage(
      {
        to: "+15551234567",
        channel: "sms",
        body: "Hello",
        template_id: "tmpl_renewal_reminder",
      },
      testDb,
    );
    expect(result.isError).toBeUndefined();
  });

  test("inserts message into database with outbound direction", async () => {
    await handleSendMessage(
      {
        to: "test@example.com",
        channel: "email",
        subject: "Test",
        body: "Test body",
        client_id: "CLI-005",
      },
      testDb,
    );

    const rows = testDb.select().from(schema.messages).all();
    expect(rows.length).toBe(1);
    expect(rows[0].direction).toBe("outbound");
    expect(rows[0].status).toBe("queued");
    expect(rows[0].client_id).toBe("CLI-005");
  });
});

describe("send_message - webhook trigger", () => {
  test("creates webhook delivery when webhook is subscribed", async () => {
    // Set up a webhook subscription
    testDb
      .insert(schema.webhooks)
      .values(
        makeWebhook({
          events: JSON.stringify(["message.delivered"]),
        }),
      )
      .run();

    await handleSendMessage(
      {
        to: "+15551234567",
        channel: "sms",
        body: "Hello",
        client_id: "CLI-001",
      },
      testDb,
    );

    const deliveries = testDb
      .select()
      .from(schema.webhookDeliveries)
      .all();
    expect(deliveries.length).toBe(1);
    expect(deliveries[0].event_type).toBe("message.delivered");
    expect(deliveries[0].status).toBe("delivered");
  });
});
