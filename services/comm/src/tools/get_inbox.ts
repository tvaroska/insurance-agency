import { and, eq, gte, lte, desc } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as schemaTypes from "../schema";
import { messages } from "../schema";
import {
  applyCursorPagination,
  paginatedResponse,
} from "@evergreen/shared";

type DB = BunSQLiteDatabase<typeof schemaTypes>;

const VALID_CHANNELS = ["email", "sms", "phone", "whatsapp"] as const;
const VALID_DIRECTIONS = ["inbound", "outbound"] as const;

export const getInboxToolDef = {
  name: "get_inbox",
  description:
    "Retrieve recent messages (email, SMS, phone, WhatsApp) with filtering and cursor pagination. Returns messages ordered by timestamp descending.",
  inputSchema: {
    type: "object" as const,
    properties: {
      channel: {
        type: "string",
        enum: VALID_CHANNELS,
        description: "Filter by communication channel",
      },
      direction: {
        type: "string",
        enum: VALID_DIRECTIONS,
        description: "Filter by message direction",
      },
      read: { type: "boolean", description: "Filter by read status" },
      client_id: { type: "string", description: "Filter by client ID" },
      since: {
        type: "string",
        description: "ISO-8601 timestamp lower bound (inclusive)",
      },
      until: {
        type: "string",
        description: "ISO-8601 timestamp upper bound (inclusive)",
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        description: "Number of results per page (default 25)",
      },
      cursor: { type: "string", description: "Opaque pagination cursor" },
    },
  },
};

export async function handleGetInbox(
  args: Record<string, unknown>,
  db: DB,
): Promise<CallToolResult> {
  const channel = args.channel as string | undefined;
  const direction = args.direction as string | undefined;
  const read = args.read as boolean | undefined;
  const clientId = args.client_id as string | undefined;
  const since = args.since as string | undefined;
  const until = args.until as string | undefined;
  const limit = Math.max(1, Math.min(100, Number(args.limit) || 25));
  const cursor = args.cursor as string | undefined;

  // Build cursor pagination
  const {
    where: cursorWhere,
    orderBy,
    limit: queryLimit,
  } = applyCursorPagination({
    cursor,
    limit,
    orderBy: [
      { column: messages.timestamp, direction: "desc" },
      { column: messages.message_id, direction: "desc" },
    ],
  });

  // Build filters
  const filters = [];
  if (channel) filters.push(eq(messages.channel, channel));
  if (direction) filters.push(eq(messages.direction, direction));
  if (read !== undefined) filters.push(eq(messages.read, read));
  if (clientId) filters.push(eq(messages.client_id, clientId));
  if (since) filters.push(gte(messages.timestamp, since));
  if (until) filters.push(lte(messages.timestamp, until));
  if (cursorWhere) filters.push(cursorWhere);

  const rows = db
    .select()
    .from(messages)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(...orderBy)
    .limit(queryLimit)
    .all();

  // Map DB rows to API response format
  const mapped = rows.map((row) => ({
    message_id: row.message_id,
    client_id: row.client_id,
    direction: row.direction,
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    from: row.from_addr,
    to: row.to_addr,
    timestamp: row.timestamp,
    read: row.read,
    ...(row.channel === "phone"
      ? {
          call_id: row.call_id,
          duration_seconds: row.duration_seconds,
          sentiment: row.sentiment,
          topics: JSON.parse(row.topics),
        }
      : {}),
    status: row.status,
  }));

  const result = paginatedResponse(
    mapped,
    limit,
    ["timestamp", "message_id"],
    cursor,
  );

  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
}
