import { Hono } from "hono";
import {
  requireScopes,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { handleSendMessage } from "../tools/send_message";
import { handleGetInbox } from "../tools/get_inbox";

type AppVariables = CorrelationVariables & AuthVariables;

const messagesRouter = new Hono<{ Variables: AppVariables }>();

// ── POST /send — Send a message via REST ──────────────────────────────

messagesRouter.post(
  "/send",
  requireScopes("comm:messages:send"),
  async (c) => {
    const body = await c.req.json();

    const result = await handleSendMessage(body, db);

    if (result.isError) {
      const parsed = JSON.parse(result.content[0].text as string);
      return c.json({ error_code: "VALIDATION_ERROR", details: parsed.errors }, 400);
    }

    const parsed = JSON.parse(result.content[0].text as string);
    return c.json(parsed, 201);
  },
);

// ── GET / — List messages via REST ────────────────────────────────────

messagesRouter.get(
  "/",
  requireScopes("comm:messages:read"),
  async (c) => {
    const query = c.req.query();

    const args: Record<string, unknown> = {};
    if (query.channel) args.channel = query.channel;
    if (query.direction) args.direction = query.direction;
    if (query.read !== undefined) args.read = query.read === "true";
    if (query.client_id) args.client_id = query.client_id;
    if (query.since) args.since = query.since;
    if (query.until) args.until = query.until;
    if (query.limit) args.limit = Number(query.limit);
    if (query.cursor) args.cursor = query.cursor;

    const result = await handleGetInbox(args, db);
    const parsed = JSON.parse(result.content[0].text as string);
    return c.json(parsed);
  },
);

export { messagesRouter };
