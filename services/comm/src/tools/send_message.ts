import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as schemaTypes from "../schema";
import { messages } from "../schema";
import { simulateDelivery } from "../webhook/delivery";

type DB = BunSQLiteDatabase<typeof schemaTypes>;

const VALID_CHANNELS = ["email", "sms", "whatsapp"] as const;

export const sendMessageToolDef = {
  name: "send_message",
  description:
    "Send an outbound message via email, SMS, or WhatsApp. Returns a message_id and queued status.",
  inputSchema: {
    type: "object" as const,
    properties: {
      to: {
        type: "string",
        description: "Recipient address (email or E.164 phone number)",
      },
      channel: {
        type: "string",
        enum: VALID_CHANNELS,
        description: "Delivery channel",
      },
      subject: {
        type: "string",
        description: "Subject line (required for email channel)",
      },
      body: { type: "string", description: "Message body text" },
      template_id: {
        type: "string",
        description: "Optional template ID (tmpl_* format)",
      },
      client_id: {
        type: "string",
        description: "Client ID to associate the message with",
      },
    },
    required: ["to", "channel", "body"],
  },
};

export async function handleSendMessage(
  args: Record<string, unknown>,
  db: DB,
): Promise<CallToolResult> {
  const to = args.to as string | undefined;
  const channel = args.channel as string | undefined;
  const subject = args.subject as string | undefined;
  const body = args.body as string | undefined;
  const templateId = args.template_id as string | undefined;
  const clientId = args.client_id as string | undefined;

  // Validate required fields
  const errors: string[] = [];
  if (!to) errors.push("to is required");
  if (!channel) errors.push("channel is required");
  if (!body) errors.push("body is required");
  if (channel && !(VALID_CHANNELS as readonly string[]).includes(channel)) {
    errors.push(`channel must be one of: ${VALID_CHANNELS.join(", ")}`);
  }
  if (channel === "email" && !subject) {
    errors.push("subject is required for email channel");
  }
  if (templateId && !/^tmpl_[a-z0-9_]+$/.test(templateId)) {
    errors.push("template_id must match format: tmpl_[a-z0-9_]+");
  }

  if (errors.length > 0) {
    return {
      content: [
        { type: "text", text: JSON.stringify({ errors }) },
      ],
      isError: true,
    };
  }

  const messageId = `msg_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  db.insert(messages)
    .values({
      message_id: messageId,
      client_id: clientId ?? "unknown",
      direction: "outbound",
      channel: channel!,
      subject: subject ?? null,
      body: body!,
      from_addr: channel === "email" ? "service@evergreen-ins.com" : "800-555-EVER",
      to_addr: to!,
      timestamp: now,
      read: false,
      status: "queued",
      template_id: templateId ?? null,
      topics: "[]",
      attachments: "[]",
    })
    .run();

  // Trigger webhook delivery for message.delivered event
  simulateDelivery(db, "message.delivered", {
    message_id: messageId,
    channel,
    to,
    status: "queued",
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          message_id: messageId,
          status: "queued",
          channel,
          timestamp: now,
        }),
      },
    ],
  };
}
