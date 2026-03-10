import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { z } from "zod";
import type * as schemaTypes from "./schema";
import { getInboxToolDef, handleGetInbox } from "./tools/get_inbox";
import { sendMessageToolDef, handleSendMessage } from "./tools/send_message";
import {
  getTranscriptToolDef,
  handleGetTranscript,
} from "./tools/get_transcript";
import {
  manageWebhookToolDef,
  handleManageWebhook,
} from "./tools/manage_webhook";

type DB = BunSQLiteDatabase<typeof schemaTypes>;

export function createServer(db: DB): McpServer {
  const server = new McpServer(
    { name: "evergreen-comm", version: "1.4.0" },
    { capabilities: { tools: {} } },
  );

  // MCP SDK 1.27+ requires Zod schemas for tool input validation
  server.registerTool(getInboxToolDef.name, {
    description: getInboxToolDef.description,
    inputSchema: {
      channel: z.enum(["email", "sms", "phone", "whatsapp"]).optional().describe("Filter by communication channel"),
      direction: z.enum(["inbound", "outbound"]).optional().describe("Filter by message direction"),
      read: z.boolean().optional().describe("Filter by read status"),
      client_id: z.string().optional().describe("Filter by client ID"),
      since: z.string().optional().describe("ISO-8601 timestamp lower bound (inclusive)"),
      until: z.string().optional().describe("ISO-8601 timestamp upper bound (inclusive)"),
      limit: z.number().min(1).max(100).optional().describe("Number of results per page (default 25)"),
      cursor: z.string().optional().describe("Opaque pagination cursor"),
    },
  }, async (args) => handleGetInbox(args as Record<string, unknown>, db));

  server.registerTool(sendMessageToolDef.name, {
    description: sendMessageToolDef.description,
    inputSchema: {
      to: z.string().describe("Recipient address (email or E.164 phone number)"),
      channel: z.enum(["email", "sms", "whatsapp"]).describe("Delivery channel"),
      subject: z.string().optional().describe("Subject line (required for email channel)"),
      body: z.string().describe("Message body text"),
      template_id: z.string().optional().describe("Optional template ID (tmpl_* format)"),
      client_id: z.string().optional().describe("Client ID to associate the message with"),
    },
  }, async (args) => handleSendMessage(args as Record<string, unknown>, db));

  server.registerTool(getTranscriptToolDef.name, {
    description: getTranscriptToolDef.description,
    inputSchema: {
      call_id: z.string().describe("Call ID (e.g. CALL-001)"),
    },
  }, async (args) => handleGetTranscript(args as Record<string, unknown>, db));

  server.registerTool(manageWebhookToolDef.name, {
    description: manageWebhookToolDef.description,
    inputSchema: {
      action: z.enum(["subscribe", "unsubscribe"]).describe("Action to perform"),
      url: z.string().optional().describe("HTTPS webhook endpoint (required for subscribe)"),
      events: z.array(z.string()).optional().describe("Event types to subscribe to (required for subscribe)"),
      webhook_id: z.string().optional().describe("Webhook ID (required for unsubscribe)"),
    },
  }, async (args) => handleManageWebhook(args as Record<string, unknown>, db));

  return server;
}
