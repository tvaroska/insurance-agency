import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mcpCall, startService, type Client, type HttpResult, type Service } from "../harness";

export const SCOPES = {
  read: "comm:messages:read",
  send: "comm:messages:send",
  calls: "comm:calls:read",
  webhooks: "comm:webhooks:manage",
} as const;

export const EVENT_TYPES = [
  "message.received",
  "message.delivered",
  "message.failed",
  "call.completed",
  "call.missed",
];

export const TOOL_NAMES = [
  "get_inbox",
  "comm_list_inbox",
  "send_message",
  "comm_send_message",
  "get_transcript",
  "comm_get_transcript",
  "manage_webhook",
  "comm_register_webhook",
];

export const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface Ctx {
  svc: Service;
  /** agent-full: every comm scope. */
  api: Client;
}

export async function start(env?: Record<string, string>): Promise<Ctx> {
  const svc = await startService("comm", env ? { env } : {});
  return { svc, api: await svc.client() };
}

export interface ToolResult {
  http: HttpResult;
  /** The JSON-RPC result object of the tools/call reply. */
  result: any;
  isError: boolean;
  /** The text of the first content item. */
  text: string;
  /** The text parsed as JSON, or undefined when it is not JSON. */
  json: any;
}

let nextId = 1;

/** Calls an MCP tool over POST /mcp and unwraps the tool result. */
export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const reply = await mcpCall(client, { id: nextId++, method: "tools/call", params: { name, arguments: args } });
  const result = reply.message?.result;
  const text: string = result?.content?.[0]?.text ?? "";
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { http: reply.http, result, isError: result?.isError === true, text, json };
}

/** A tool call that must succeed; returns the decoded result document. */
export async function tool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = await callTool(client, name, args);
  if (res.http.status !== 200 || res.isError || res.json === undefined) {
    throw new Error(`tool ${name}(${JSON.stringify(args)}) failed: ${res.http.status} ${res.http.text.slice(0, 400)}`);
  }
  return res.json;
}

let seq = 0;

/** A `messages` row with every column set, as POST /sim/seed expects it. */
export function messageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  seq += 1;
  return {
    message_id: `MSG-T${String(seq).padStart(4, "0")}`,
    client_id: "CLI-900",
    direction: "inbound",
    channel: "email",
    subject: "Subject",
    body: "Body",
    from_addr: "client@example.com",
    to_addr: "service@evergreen-ins.com",
    timestamp: "2026-01-01T00:00:00Z",
    read: false,
    call_id: null,
    duration_seconds: null,
    transcript: null,
    sentiment: null,
    topics: "[]",
    status: "delivered",
    template_id: null,
    attachments: "[]",
    ...overrides,
  };
}

export function callRow(callId: string, transcript: string | null, overrides: Record<string, unknown> = {}) {
  return messageRow({
    channel: "phone",
    subject: null,
    body: null,
    from_addr: "caller",
    to_addr: "800-555-EVER",
    call_id: callId,
    duration_seconds: 120,
    transcript,
    sentiment: "neutral",
    topics: JSON.stringify(["billing", "renewal"]),
    ...overrides,
  });
}

export function webhookRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  seq += 1;
  return {
    webhook_id: `whk_seed_${seq}`,
    url: "https://hooks.example.com/evergreen",
    events: JSON.stringify(["message.delivered"]),
    secret: "whsec_seed_test",
    active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The signature a receiver computes for a delivery: hex HMAC-SHA256 of the payload text. */
export function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export interface ScriptEntry {
  scenario_id: string;
  turn: number;
  client_ids: string[];
  recipients: string[];
  keywords: string[];
  reply: { client_id: string; from_addr: string; subject: string; body: string; topics: string[] };
}

/** The reply script, read from Appendix A of the behaviour specification. */
export function replyScript(): ScriptEntry[] {
  const spec = readFileSync(join(import.meta.dir, "..", "..", "..", "specs", "comm.spec.md"), "utf-8");
  const appendix = spec.slice(spec.indexOf("## Appendix A"));
  const block = /```json\n([\s\S]*?)\n```/.exec(appendix);
  if (!block) throw new Error("specs/comm.spec.md has no JSON block under Appendix A");
  return JSON.parse(block[1]);
}

/** Retained empty after aligning specs/comm.yaml Error schema with the service envelope. */
export const ERROR_ENVELOPE_GAP: RegExp[] = [];
