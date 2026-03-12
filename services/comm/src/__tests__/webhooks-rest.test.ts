import { mock } from "bun:test";
import { createTestDb } from "./setup";

const { sqlite: testSqlite, db: testDb } = createTestDb();
mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  correlationId,
  jwtAuth,
  errorHandler,
  authHeader as _authHeader,
  type CorrelationVariables,
  type AuthVariables,
} from "@evergreen/shared";
import { webhooksRouter } from "../routes/webhooks";

type AppVariables = CorrelationVariables & AuthVariables;

const TEST_SECRET = "test-secret-for-webhooks-rest";
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
  api.route("/webhooks", webhooksRouter);
  app.route("/v1", api);
  return app;
}

const app = createTestApp();

const WEBHOOKS_URL = "http://localhost/v1/webhooks";

async function postIncoming(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return app.request(`${WEBHOOKS_URL}/incoming`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/webhooks/incoming", () => {
  test("401 without auth token", async () => {
    const res = await postIncoming({ url: "https://example.com/hook", events: ["message.received"] });
    expect(res.status).toBe(401);
  });

  test("403 with wrong scope", async () => {
    const hdr = await authHeader(["comm:messages:read"]);
    const res = await postIncoming(
      { url: "https://example.com/hook", events: ["message.received"] },
      hdr,
    );
    expect(res.status).toBe(403);
  });

  test("400 when url is missing", async () => {
    const hdr = await authHeader(["comm:webhooks:manage"]);
    const res = await postIncoming({ events: ["message.received"] }, hdr);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error_code).toBe("VALIDATION_ERROR");
  });

  test("400 when events is missing", async () => {
    const hdr = await authHeader(["comm:webhooks:manage"]);
    const res = await postIncoming({ url: "https://example.com/hook" }, hdr);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error_code).toBe("VALIDATION_ERROR");
  });

  test("201 success with webhook_id and secret", async () => {
    const hdr = await authHeader(["comm:webhooks:manage"]);
    const res = await postIncoming(
      { url: "https://example.com/hook", events: ["message.received", "call.completed"] },
      hdr,
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.webhook_id).toBeString();
    expect(json.webhook_id).toStartWith("whk_");
    expect(json.secret).toBeString();
    expect(json.secret).toStartWith("whsec_");
    expect(json.url).toBe("https://example.com/hook");
    expect(json.events).toEqual(["message.received", "call.completed"]);
    expect(json.created_at).toBeString();
  });
});
