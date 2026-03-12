import { Hono } from "hono";
import {
  requireScopes,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { handleManageWebhook } from "../tools/manage_webhook";

type AppVariables = CorrelationVariables & AuthVariables;

const webhooksRouter = new Hono<{ Variables: AppVariables }>();

// ── POST /incoming — Subscribe to webhook events via REST ────────────

webhooksRouter.post(
  "/incoming",
  requireScopes("comm:webhooks:manage"),
  async (c) => {
    const body = await c.req.json();

    const result = await handleManageWebhook(
      { action: "subscribe", url: body.url, events: body.events },
      db,
    );

    if (result.isError) {
      const parsed = JSON.parse(result.content[0].text as string);
      return c.json({ error_code: "VALIDATION_ERROR", details: parsed.errors || [parsed.error] }, 400);
    }

    const parsed = JSON.parse(result.content[0].text as string);
    return c.json(parsed, 201);
  },
);

export { webhooksRouter };
