/**
 * GenAI semantic convention trace parser.
 *
 * Extracts ApiCall[] from OTel spans following the GenAI semconv
 * (gen_ai.operation.name = "execute_tool"). Works with ADK, LangChain,
 * PydanticAI, CrewAI, and any framework following OTel GenAI conventions.
 *
 * Two strategies for extracting HTTP details:
 * 1. Primary: _http metadata in tool response (set by instrumented tools)
 * 2. Fallback: Tool name → OpenAPI spec mapping (operationId lookup)
 */

import type {
  ApiCall,
  OtlpTrace,
  OtlpSpan,
  OtlpAttribute,
  ToolMapping,
} from "../types";
import { PORT_SERVICE_MAP } from "../types";

// ── Attribute helpers ───────────────────────────────────────────────

function getStringAttr(attrs: OtlpAttribute[] | undefined, key: string): string | undefined {
  if (!attrs) return undefined;
  const attr = attrs.find((a) => a.key === key);
  if (!attr) return undefined;
  if (attr.value.stringValue !== undefined) return attr.value.stringValue;
  return undefined;
}

function isToolSpan(span: OtlpSpan): boolean {
  const opName = getStringAttr(span.attributes, "gen_ai.operation.name");
  return opName === "execute_tool";
}

// ── HTTP metadata extraction ────────────────────────────────────────

interface HttpMeta {
  method: string;
  url: string;
  statusCode: number;
}

/**
 * Try to extract _http metadata from the tool response attribute.
 * Checks both GenAI semconv and ADK-proprietary attribute keys.
 */
function extractHttpFromResponse(attrs: OtlpAttribute[]): HttpMeta | undefined {
  // Try standard GenAI semconv first, then ADK proprietary
  const responseJson =
    getStringAttr(attrs, "gen_ai.tool.call.result") ??
    getStringAttr(attrs, "gcp.vertex.agent.tool_response");

  if (!responseJson) return undefined;

  try {
    const response = JSON.parse(responseJson);

    // Look for _http metadata in the response
    const http = response?._http ?? response?.result?._http;
    if (
      http &&
      typeof http.method === "string" &&
      typeof http.url === "string" &&
      typeof http.status_code === "number"
    ) {
      return {
        method: http.method,
        url: http.url,
        statusCode: http.status_code,
      };
    }
  } catch {
    // Not valid JSON or missing _http — fall through
  }

  return undefined;
}

/**
 * Fall back to tool name → OpenAPI spec mapping.
 */
function extractHttpFromMapping(
  attrs: OtlpAttribute[],
  toolMapping?: ToolMapping,
): HttpMeta | undefined {
  if (!toolMapping) return undefined;

  const toolName = getStringAttr(attrs, "gen_ai.tool.name");
  if (!toolName) return undefined;

  // Try exact match first, then strip service prefix (e.g., "ams_listClients" → "listClients")
  let mapping = toolMapping[toolName];
  if (!mapping && toolName.includes("_")) {
    const unprefixed = toolName.substring(toolName.indexOf("_") + 1);
    mapping = toolMapping[unprefixed];
  }

  if (!mapping) return undefined;

  // Reconstruct URL from mapping (path params stay as templates)
  return {
    method: mapping.method,
    url: `${mapping.baseUrl}${mapping.path}`,
    statusCode: 200, // Assumed success when using mapping fallback
  };
}

// ── URL helpers ─────────────────────────────────────────────────────

function parsePathFromUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function serviceFromUrl(url: string): string {
  try {
    const port = parseInt(new URL(url).port, 10);
    return PORT_SERVICE_MAP[port] ?? "unknown";
  } catch {
    return "unknown";
  }
}

// ── Main parser ─────────────────────────────────────────────────────

export function parseGenAiTrace(
  trace: OtlpTrace,
  toolMapping?: ToolMapping,
): ApiCall[] {
  const calls: ApiCall[] = [];

  for (const rs of trace.resourceSpans) {
    for (const ss of rs.scopeSpans) {
      for (const span of ss.spans) {
        if (!isToolSpan(span)) continue;

        // Try primary (response metadata), then fallback (spec mapping)
        const http =
          extractHttpFromResponse(span.attributes) ??
          extractHttpFromMapping(span.attributes, toolMapping);

        if (!http) continue;

        const startNano = BigInt(span.startTimeUnixNano);
        const endNano = BigInt(span.endTimeUnixNano);

        calls.push({
          method: http.method,
          url: http.url,
          path: parsePathFromUrl(http.url),
          service: serviceFromUrl(http.url),
          statusCode: http.statusCode,
          timestamp: Number(startNano / 1_000_000n),
          durationMs: Number((endNano - startNano) / 1_000_000n),
        });
      }
    }
  }

  return calls.sort((a, b) => a.timestamp - b.timestamp);
}
