import { mock } from "bun:test";
import { createTestDb, makeMessage } from "./setup";

// Create test db and mock module before importing routes
const { sqlite: testSqlite, db: testDb } = createTestDb();
mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

import { describe, expect, test, beforeAll } from "bun:test";
import { Hono } from "hono";
import {
  correlationId,
  jwtAuth,
  errorHandler,
  authHeader as _authHeader,
  type CorrelationVariables,
  type AuthVariables,
} from "@evergreen/shared";
import * as schema from "../schema";
import { messagesRouter } from "../routes/messages";

type AppVariables = CorrelationVariables & AuthVariables;

const TEST_SECRET = "test-secret-for-comm-rest";
process.env.JWT_SECRET = TEST_SECRET;

async function authHeader(scopes: string[]) {
  return _authHeader(TEST_SECRET, scopes);
}

function createTestApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", correlationId);
  app.onError(errorHandler);

  const api = new Hono<{ Variables: AppVariables }>();
  api.use("*", jwtAuth);
  api.route("/messages", messagesRouter);
  app.route("/v1", api);
  return app;
}

const app = createTestApp();

const MESSAGES_URL = "http://localhost/v1/messages";

async function postSend(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return app.request(`${MESSAGES_URL}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function getMessages(
  params: Record<string, string> = {},
  headers: Record<string, string> = {},
) {
  const url = new URL(MESSAGES_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return app.request(url.toString(), { headers });
}

beforeAll(() => {
  const messages = [
    makeMessage({
      message_id: "msg_001",
      client_id: "CLI-001",
      channel: "email",
      direction: "inbound",
      subject: "Question",
      body: "I have a question",
    }),
    makeMessage({
      message_id: "msg_002",
      client_id: "CLI-001",
      channel: "sms",
      direction: "outbound",
      body: "Your policy renews soon",
      from_addr: "800-555-EVER",
      to_addr: "+15551234567",
    }),
    makeMessage({
      message_id: "msg_003",
      client_id: "CLI-002",
      channel: "email",
      direction: "inbound",
      subject: "Claim",
      body: "I need to file a claim",
    }),
  ];
  for (const m of messages) {
    testDb.insert(schema.messages).values(m).run();
  }
});

// ── POST /send ───────────────────────────────────────────────────────

describe("POST /v1/messages/send", () => {
  test("401 without auth token", async () => {
    const res = await postSend({ to: "a@b.com", channel: "email", body: "hi", subject: "Hi" });
    expect(res.status).toBe(401);
  });

  test("403 with wrong scope", async () => {
    const hdr = await authHeader(["comm:messages:read"]);
    const res = await postSend(
      { to: "a@b.com", channel: "email", body: "hi", subject: "Hi" },
      hdr,
    );
    expect(res.status).toBe(403);
  });

  test("400 when required fields are missing", async () => {
    const hdr = await authHeader(["comm:messages:send"]);
    const res = await postSend({}, hdr);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error_code).toBe("VALIDATION_ERROR");
    expect(json.details).toBeArray();
    expect(json.details.length).toBeGreaterThanOrEqual(3);
  });

  test("400 for invalid channel", async () => {
    const hdr = await authHeader(["comm:messages:send"]);
    const res = await postSend(
      { to: "a@b.com", channel: "fax", body: "hi" },
      hdr,
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.details).toEqual(
      expect.arrayContaining([expect.stringContaining("channel must be one of")]),
    );
  });

  test("201 success for SMS", async () => {
    const hdr = await authHeader(["comm:messages:send"]);
    const res = await postSend(
      { to: "+15559876543", channel: "sms", body: "Your claim is approved" },
      hdr,
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.message_id).toBeString();
    expect(json.status).toBe("queued");
    expect(json.channel).toBe("sms");
  });

  test("201 success for email (with subject)", async () => {
    const hdr = await authHeader(["comm:messages:send"]);
    const res = await postSend(
      {
        to: "customer@example.com",
        channel: "email",
        subject: "Policy Update",
        body: "Your policy has been updated.",
        client_id: "CLI-100",
      },
      hdr,
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.message_id).toBeString();
    expect(json.message_id).toStartWith("msg_");
    expect(json.status).toBe("queued");
    expect(json.channel).toBe("email");
    expect(json.timestamp).toBeString();
  });
});

// ── GET / ────────────────────────────────────────────────────────────

describe("GET /v1/messages", () => {
  test("401 without auth token", async () => {
    const res = await getMessages();
    expect(res.status).toBe(401);
  });

  test("403 with wrong scope", async () => {
    const hdr = await authHeader(["comm:messages:send"]);
    const res = await getMessages({}, hdr);
    expect(res.status).toBe(403);
  });

  test("200 returns all seeded messages", async () => {
    const hdr = await authHeader(["comm:messages:read"]);
    const res = await getMessages({}, hdr);
    expect(res.status).toBe(200);
    const json = await res.json();
    // Should include at least the 3 seeded messages (plus any created by POST tests)
    expect(json.data.length).toBeGreaterThanOrEqual(3);
  });

  test("filters by channel", async () => {
    const hdr = await authHeader(["comm:messages:read"]);
    const res = await getMessages({ channel: "sms" }, hdr);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBeGreaterThanOrEqual(1);
    for (const msg of json.data) {
      expect(msg.channel).toBe("sms");
    }
  });

  test("filters by client_id", async () => {
    const hdr = await authHeader(["comm:messages:read"]);
    const res = await getMessages({ client_id: "CLI-002" }, hdr);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBeGreaterThanOrEqual(1);
    for (const msg of json.data) {
      expect(msg.client_id).toBe("CLI-002");
    }
  });

  test("returns pagination structure", async () => {
    const hdr = await authHeader(["comm:messages:read"]);
    const res = await getMessages({ limit: "2" }, hdr);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toBeArray();
    expect(json.data.length).toBeLessThanOrEqual(2);
    expect(json).toHaveProperty("pagination");
    expect(json.pagination).toHaveProperty("next_cursor");
  });
});
