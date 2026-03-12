import { mock } from "bun:test";
import { createTestDb, makePhoneMessage } from "./setup";

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
import { callsRouter } from "../routes/calls";

type AppVariables = CorrelationVariables & AuthVariables;

const TEST_SECRET = "test-secret-for-calls-rest";
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
  api.route("/calls", callsRouter);
  app.route("/v1", api);
  return app;
}

const app = createTestApp();

const CALLS_URL = "http://localhost/v1/calls";

async function getTranscript(
  callId: string,
  headers: Record<string, string> = {},
) {
  return app.request(`${CALLS_URL}/transcripts/${callId}`, { headers });
}

beforeAll(() => {
  const msg = makePhoneMessage({
    message_id: "msg_call_001",
    call_id: "CALL-001",
    client_id: "CLI-001",
    duration_seconds: 300,
    transcript:
      "Agent: Thank you for calling. This is Amy speaking.\nCaller: Hi Amy, I have a question about my policy.",
    sentiment: "positive",
    topics: JSON.stringify(["policy_inquiry"]),
  });
  testDb.insert(schema.messages).values(msg).run();
});

describe("GET /v1/calls/transcripts/:call_id", () => {
  test("401 without auth token", async () => {
    const res = await getTranscript("CALL-001");
    expect(res.status).toBe(401);
  });

  test("403 with wrong scope", async () => {
    const hdr = await authHeader(["comm:messages:read"]);
    const res = await getTranscript("CALL-001", hdr);
    expect(res.status).toBe(403);
  });

  test("404 for unknown call_id", async () => {
    const hdr = await authHeader(["comm:calls:read"]);
    const res = await getTranscript("CALL-NONEXISTENT", hdr);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error_code).toBe("NOT_FOUND");
  });

  test("200 success with all fields", async () => {
    const hdr = await authHeader(["comm:calls:read"]);
    const res = await getTranscript("CALL-001", hdr);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.call_id).toBe("CALL-001");
    expect(json.client_id).toBe("CLI-001");
    expect(json.agent_name).toBe("Amy");
    expect(json.duration_seconds).toBe(300);
    expect(json.transcript_text).toBeString();
    expect(json.sentiment).toBe("positive");
    expect(json.topics).toEqual(["policy_inquiry"]);
    expect(json.timestamp).toBeString();
  });
});
