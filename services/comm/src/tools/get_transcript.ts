import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as schemaTypes from "../schema";
import { messages } from "../schema";

type DB = BunSQLiteDatabase<typeof schemaTypes>;

export const getTranscriptToolDef = {
  name: "get_transcript",
  description:
    "Get the full transcript of a recorded client call with sentiment analysis and extracted topics.",
  inputSchema: {
    type: "object" as const,
    properties: {
      call_id: {
        type: "string",
        description: "Call ID (e.g. CALL-001)",
      },
    },
    required: ["call_id"],
  },
};

/**
 * Extract agent name from transcript text.
 * Looks for "Agent: ... this is {Name}" pattern.
 */
function extractAgentName(transcript: string | null): string | null {
  if (!transcript) return null;
  const match = transcript.match(
    /Agent:.*?(?:this is|I'm|I am)\s+(\w+)/i,
  );
  return match ? match[1] : null;
}

export async function handleGetTranscript(
  args: Record<string, unknown>,
  db: DB,
): Promise<CallToolResult> {
  const callId = args.call_id as string | undefined;

  if (!callId) {
    return {
      content: [
        { type: "text", text: JSON.stringify({ error: "call_id is required" }) },
      ],
      isError: true,
    };
  }

  const row = db
    .select()
    .from(messages)
    .where(eq(messages.call_id, callId))
    .get();

  if (!row) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "not_found",
            message: `No transcript found for call_id: ${callId}`,
          }),
        },
      ],
      isError: true,
    };
  }

  const agentName = extractAgentName(row.transcript);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          call_id: row.call_id,
          client_id: row.client_id,
          agent_name: agentName,
          duration_seconds: row.duration_seconds,
          transcript_text: row.transcript,
          sentiment: row.sentiment,
          topics: JSON.parse(row.topics),
          timestamp: row.timestamp,
        }),
      },
    ],
  };
}
