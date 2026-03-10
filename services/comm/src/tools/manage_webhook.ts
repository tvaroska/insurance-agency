import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as schemaTypes from "../schema";
import { webhooks } from "../schema";

type DB = BunSQLiteDatabase<typeof schemaTypes>;

const VALID_EVENTS = [
  "message.received",
  "message.delivered",
  "message.failed",
  "call.completed",
  "call.missed",
] as const;

export const manageWebhookToolDef = {
  name: "manage_webhook",
  description:
    "Subscribe or unsubscribe to real-time communication events. Use action 'subscribe' to create a webhook or 'unsubscribe' to remove one.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["subscribe", "unsubscribe"],
        description: "Action to perform",
      },
      url: {
        type: "string",
        description: "HTTPS webhook endpoint (required for subscribe)",
      },
      events: {
        type: "array",
        items: { type: "string", enum: VALID_EVENTS },
        description: "Event types to subscribe to (required for subscribe)",
      },
      webhook_id: {
        type: "string",
        description: "Webhook ID (required for unsubscribe)",
      },
    },
    required: ["action"],
  },
};

function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return (
    "whsec_" +
    Array.from(bytes)
      .map((b) => chars[b % chars.length])
      .join("")
  );
}

export async function handleManageWebhook(
  args: Record<string, unknown>,
  db: DB,
): Promise<CallToolResult> {
  const action = args.action as string | undefined;

  if (!action || !["subscribe", "unsubscribe"].includes(action)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "action must be 'subscribe' or 'unsubscribe'",
          }),
        },
      ],
      isError: true,
    };
  }

  if (action === "subscribe") {
    return handleSubscribe(args, db);
  } else {
    return handleUnsubscribe(args, db);
  }
}

async function handleSubscribe(
  args: Record<string, unknown>,
  db: DB,
): Promise<CallToolResult> {
  const url = args.url as string | undefined;
  const events = args.events as string[] | undefined;

  const errors: string[] = [];
  if (!url) errors.push("url is required for subscribe");
  if (!events || events.length === 0) {
    errors.push("events is required for subscribe (at least one event)");
  }
  if (events) {
    for (const evt of events) {
      if (!(VALID_EVENTS as readonly string[]).includes(evt)) {
        errors.push(
          `Invalid event type: ${evt}. Must be one of: ${VALID_EVENTS.join(", ")}`,
        );
      }
    }
  }

  if (errors.length > 0) {
    return {
      content: [{ type: "text", text: JSON.stringify({ errors }) }],
      isError: true,
    };
  }

  const webhookId = `whk_${crypto.randomUUID()}`;
  const secret = generateSecret();
  const now = new Date().toISOString();

  db.insert(webhooks)
    .values({
      webhook_id: webhookId,
      url: url!,
      events: JSON.stringify(events),
      secret,
      active: true,
      created_at: now,
    })
    .run();

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          webhook_id: webhookId,
          url,
          events,
          secret,
          created_at: now,
        }),
      },
    ],
  };
}

async function handleUnsubscribe(
  args: Record<string, unknown>,
  db: DB,
): Promise<CallToolResult> {
  const webhookId = args.webhook_id as string | undefined;

  if (!webhookId) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "webhook_id is required for unsubscribe",
          }),
        },
      ],
      isError: true,
    };
  }

  const existing = db
    .select()
    .from(webhooks)
    .where(eq(webhooks.webhook_id, webhookId))
    .get();

  if (!existing) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "not_found",
            message: `No webhook found with id: ${webhookId}`,
          }),
        },
      ],
      isError: true,
    };
  }

  db.delete(webhooks).where(eq(webhooks.webhook_id, webhookId)).run();

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          deleted: true,
          webhook_id: webhookId,
        }),
      },
    ],
  };
}
