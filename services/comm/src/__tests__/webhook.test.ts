import { describe, expect, test, beforeEach } from "bun:test";
import * as schema from "../schema";
import { createTestDb, makeWebhook } from "./setup";
import { signPayload, buildWebhookEnvelope, calculateRetryDelay } from "../webhook/signing";
import { simulateDelivery } from "../webhook/delivery";

describe("webhook signing", () => {
  test("signPayload produces consistent HMAC-SHA256", () => {
    const sig1 = signPayload('{"test":true}', "secret123");
    const sig2 = signPayload('{"test":true}', "secret123");
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[a-f0-9]{64}$/);
  });

  test("signPayload produces different signatures for different secrets", () => {
    const sig1 = signPayload('{"test":true}', "secret1");
    const sig2 = signPayload('{"test":true}', "secret2");
    expect(sig1).not.toBe(sig2);
  });

  test("buildWebhookEnvelope creates proper structure", () => {
    const envelope = buildWebhookEnvelope("message.delivered", {
      message_id: "msg_123",
    });
    expect(envelope.event_id).toStartWith("evt_");
    expect(envelope.event_type).toBe("message.delivered");
    expect(envelope.timestamp).toBeTruthy();
    expect(envelope.data).toEqual({ message_id: "msg_123" });
  });
});

describe("webhook retry delay", () => {
  test("returns exponential back-off schedule", () => {
    expect(calculateRetryDelay(1)).toBe(1000);
    expect(calculateRetryDelay(2)).toBe(2000);
    expect(calculateRetryDelay(3)).toBe(4000);
    expect(calculateRetryDelay(4)).toBe(8000);
    expect(calculateRetryDelay(5)).toBe(16000);
  });

  test("caps at 16 seconds", () => {
    expect(calculateRetryDelay(6)).toBe(16000);
    expect(calculateRetryDelay(10)).toBe(16000);
  });
});

describe("webhook delivery simulation", () => {
  let testDb: ReturnType<typeof createTestDb>["db"];

  beforeEach(() => {
    const created = createTestDb();
    testDb = created.db;
  });

  test("creates delivery records for matching webhooks", () => {
    testDb
      .insert(schema.webhooks)
      .values(
        makeWebhook({
          events: JSON.stringify(["message.delivered"]),
        }),
      )
      .run();

    const deliveries = simulateDelivery(testDb, "message.delivered", {
      message_id: "msg_test",
    });
    expect(deliveries.length).toBe(1);
    expect(deliveries[0].event_type).toBe("message.delivered");
    expect(deliveries[0].status).toBe("delivered");
    expect(deliveries[0].signature).toMatch(/^[a-f0-9]{64}$/);
  });

  test("does not create deliveries for non-matching events", () => {
    testDb
      .insert(schema.webhooks)
      .values(
        makeWebhook({
          events: JSON.stringify(["call.completed"]),
        }),
      )
      .run();

    const deliveries = simulateDelivery(testDb, "message.delivered", {
      message_id: "msg_test",
    });
    expect(deliveries.length).toBe(0);
  });

  test("persists delivery records in database", () => {
    testDb
      .insert(schema.webhooks)
      .values(
        makeWebhook({
          events: JSON.stringify(["message.received"]),
        }),
      )
      .run();

    simulateDelivery(testDb, "message.received", { message_id: "msg_test" });

    const rows = testDb.select().from(schema.webhookDeliveries).all();
    expect(rows.length).toBe(1);
    expect(rows[0].delivery_id).toStartWith("del_");
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].response_status).toBe(200);
  });
});
