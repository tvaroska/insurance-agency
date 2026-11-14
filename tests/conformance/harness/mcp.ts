import type { Client, HttpResult } from "./service";

export interface JsonRpcMessage {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpReply {
  http: HttpResult;
  /** Every JSON-RPC message in the reply, in the order received. */
  messages: JsonRpcMessage[];
  /** The first message, for the common single-request case. */
  message: JsonRpcMessage | undefined;
}

/** Extracts the JSON payloads of the `data:` lines of a server-sent-event stream. */
export function parseSse(text: string): unknown[] {
  const payloads: unknown[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data === "") continue;
    try {
      payloads.push(JSON.parse(data));
    } catch {
      payloads.push(data);
    }
  }
  return payloads;
}

/**
 * Sends one JSON-RPC message (or a batch) to a streamable-HTTP MCP endpoint
 * and returns the JSON-RPC replies, whether the server answers with JSON or
 * with a server-sent-event stream. `jsonrpc: "2.0"` is filled in when absent.
 */
export async function mcpCall(
  client: Client,
  message: JsonRpcMessage | JsonRpcMessage[],
  opts: { path?: string; headers?: Record<string, string> } = {},
): Promise<McpReply> {
  const fill = (m: JsonRpcMessage) => ({ jsonrpc: "2.0" as const, ...m });
  const payload = Array.isArray(message) ? message.map(fill) : fill(message);
  const http = await client.post(opts.path ?? "/mcp", payload, {
    headers: { Accept: "application/json, text/event-stream", ...opts.headers },
  });
  const type = http.headers.get("content-type") ?? "";
  let messages: JsonRpcMessage[] = [];
  if (type.includes("text/event-stream")) {
    messages = parseSse(http.text).flatMap((p) => (Array.isArray(p) ? p : [p])) as JsonRpcMessage[];
  } else if (type.includes("json") && http.body !== null && typeof http.body === "object") {
    messages = Array.isArray(http.body) ? http.body : [http.body];
  }
  return { http, messages, message: messages[0] };
}
