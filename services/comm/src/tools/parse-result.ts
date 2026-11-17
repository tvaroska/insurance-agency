import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function parseToolResultJson<T = any>(result: CallToolResult): T {
  const first = result.content[0];
  if (!first || first.type !== "text") {
    throw new Error(`Expected text MCP content block, got ${first?.type ?? "empty"}`);
  }
  return JSON.parse(first.text) as T;
}
