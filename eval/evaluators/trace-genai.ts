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

// Attribute helpers

function getStringAttr(attrs: OtlpAttribute[] | undefined, key: string): string | undefined {
  if (!attrs) return undefined;
  const attr = attrs.find((a) => a.key === key);
  if (!attr) return undefined;
  if (attr.value.stringValue !== undefined) return attr.value.stringValue;
  return undefined;
}

function getIntAttr(attrs: OtlpAttribute[] | undefined, key: string): number | undefined {
  if (!attrs) return undefined;
  const attr = attrs.find((a) => a.key === key);
  if (!attr) return undefined;
  if (typeof attr.value.intValue === "number" && Number.isFinite(attr.value.intValue)) {
    return attr.value.intValue;
  }
  if (typeof attr.value.intValue === "string") {
    const parsed = Number.parseInt(attr.value.intValue, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (typeof attr.value.stringValue === "string") {
    const parsed = Number.parseInt(attr.value.stringValue, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getBoolAttr(attrs: OtlpAttribute[] | undefined, key: string): boolean | undefined {
  if (!attrs) return undefined;
  const attr = attrs.find((a) => a.key === key);
  if (!attr) return undefined;
  if (typeof attr.value.boolValue === "boolean") return attr.value.boolValue;
  return undefined;
}

function isValidHttpStatus(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

function isToolSpan(span: OtlpSpan): boolean {
  const opName = getStringAttr(span.attributes, "gen_ai.operation.name");
  return opName === "execute_tool";
}

// HTTP metadata and status extraction

interface HttpMeta {
  method: string;
  url: string;
  statusCode: number;
}

const SERVICE_PREFIX_ALIASES: Record<string, string> = {
  ams: "ams",
  rater: "rater",
  crm: "crm",
  ecm: "ecm",
  comm: "comm",
  claims: "claims",
  summit: "summit-fire",
  "summit-fire": "summit-fire",
  summit_fire: "summit-fire",
  "carrier-summit": "summit-fire",
  carrier_summit: "summit-fire",
  coastal: "coastal-star",
  "coastal-star": "coastal-star",
  coastal_star: "coastal-star",
  "carrier-coastal": "coastal-star",
  carrier_coastal: "coastal-star",
};

const SORTED_SERVICE_PREFIXES = Object.keys(SERVICE_PREFIX_ALIASES).sort(
  (a, b) => b.length - a.length,
);

function resolveToolStatusCode(span: OtlpSpan, defaultSuccessStatus: number): number {
  const attrs = span.attributes;

  // 1. Explicit HTTP status code attribute on the span
  for (const key of ["http.response.status_code", "http.status_code"]) {
    const code = getIntAttr(attrs, key);
    if (isValidHttpStatus(code)) {
      return code;
    }
  }

  // 2. Explicit HTTP status code or error markers inside tool response payload
  const responseRaw =
    getStringAttr(attrs, "gen_ai.tool.call.result") ??
    getStringAttr(attrs, "gcp.vertex.agent.tool_response");

  let responseHasError = false;
  if (responseRaw) {
    try {
      const parsed = JSON.parse(responseRaw) as Record<string, unknown> | null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const resultObj =
          parsed.result && typeof parsed.result === "object" && !Array.isArray(parsed.result)
            ? (parsed.result as Record<string, unknown>)
            : undefined;
        const errorObj =
          parsed.error && typeof parsed.error === "object" && !Array.isArray(parsed.error)
            ? (parsed.error as Record<string, unknown>)
            : undefined;
        const httpObj =
          parsed._http && typeof parsed._http === "object" && !Array.isArray(parsed._http)
            ? (parsed._http as Record<string, unknown>)
            : resultObj?._http && typeof resultObj._http === "object" && !Array.isArray(resultObj._http)
              ? (resultObj._http as Record<string, unknown>)
              : undefined;

        const statusCandidates = [
          httpObj?.status_code,
          httpObj?.statusCode,
          parsed.status_code,
          parsed.statusCode,
          parsed.status,
          resultObj?.status_code,
          resultObj?.statusCode,
          resultObj?.status,
          errorObj?.status_code,
          errorObj?.statusCode,
          errorObj?.status,
        ];
        for (const candidate of statusCandidates) {
          if (isValidHttpStatus(candidate)) {
            return candidate;
          }
        }

        if (
          parsed.isError === true ||
          resultObj?.isError === true ||
          parsed.ok === false ||
          parsed.success === false ||
          (typeof parsed.error === "string" && parsed.error.trim().length > 0) ||
          errorObj !== undefined ||
          (typeof parsed.error_code === "string" && parsed.error_code.trim().length > 0) ||
          (typeof parsed.status === "string" && parsed.status.toLowerCase() === "error")
        ) {
          responseHasError = true;
        }
      }
    } catch {
      const statusMatch = /\bHTTP(?:\s+status)?\s+([45]\d{2})\b/i.exec(responseRaw);
      if (statusMatch) {
        return Number.parseInt(statusMatch[1], 10);
      }
      if (/^\s*error\s*:/i.test(responseRaw)) {
        responseHasError = true;
      }
    }
  }

  // 3. OTel span error status or error/exception attributes
  const otelStatusCode = getStringAttr(attrs, "otel.status_code");
  const hasErrorAttr =
    span.status?.code === 2 ||
    (otelStatusCode !== undefined && otelStatusCode.toUpperCase() === "ERROR") ||
    Boolean(getStringAttr(attrs, "error.type")) ||
    Boolean(getStringAttr(attrs, "exception.type")) ||
    Boolean(getStringAttr(attrs, "exception.message")) ||
    getBoolAttr(attrs, "error") === true ||
    Boolean(getStringAttr(attrs, "error"));

  if (hasErrorAttr || responseHasError) {
    return 500;
  }

  return defaultSuccessStatus;
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

export const BUILTIN_MCP_TOOL_MAPPING: ToolMapping = {
  "comm:messages:send": {
    method: "POST",
    path: "/v1/messages/send",
    service: "comm",
    baseUrl: "http://localhost:3004",
  },
  send_message: {
    method: "POST",
    path: "/v1/messages/send",
    service: "comm",
    baseUrl: "http://localhost:3004",
  },
  comm_send_message: {
    method: "POST",
    path: "/v1/messages/send",
    service: "comm",
    baseUrl: "http://localhost:3004",
  },
  "comm:messages:read": {
    method: "GET",
    path: "/v1/messages/inbox",
    service: "comm",
    baseUrl: "http://localhost:3004",
  },
  "comm:messages:inbox": {
    method: "GET",
    path: "/v1/messages/inbox",
    service: "comm",
    baseUrl: "http://localhost:3004",
  },
  get_inbox: {
    method: "GET",
    path: "/v1/messages/inbox",
    service: "comm",
    baseUrl: "http://localhost:3004",
  },
  comm_list_inbox: {
    method: "GET",
    path: "/v1/messages/inbox",
    service: "comm",
    baseUrl: "http://localhost:3004",
  },
  "comm:calls:read": {
    method: "GET",
    path: "/v1/calls/transcript",
    service: "comm",
    baseUrl: "http://localhost:3004",
  },
  get_transcript: {
    method: "GET",
    path: "/v1/calls/transcript",
    service: "comm",
    baseUrl: "http://localhost:3004",
  },
  comm_get_transcript: {
    method: "GET",
    path: "/v1/calls/transcript",
    service: "comm",
    baseUrl: "http://localhost:3004",
  },
  "comm:webhooks:manage": {
    method: "POST",
    path: "/v1/webhooks",
    service: "comm",
    baseUrl: "http://localhost:3004",
  },
  manage_webhook: {
    method: "POST",
    path: "/v1/webhooks",
    service: "comm",
    baseUrl: "http://localhost:3004",
  },
  comm_register_webhook: {
    method: "POST",
    path: "/v1/webhooks",
    service: "comm",
    baseUrl: "http://localhost:3004",
  },
};

function normalizeServicePrefix(prefix: string): string | undefined {
  return SERVICE_PREFIX_ALIASES[prefix.toLowerCase()];
}

function resolveSpanServiceHint(span: OtlpSpan): string | undefined {
  const port = getIntAttr(span.attributes, "server.port");
  if (port !== undefined && PORT_SERVICE_MAP[port]) {
    return PORT_SERVICE_MAP[port];
  }
  const svcName = getStringAttr(span.attributes, "service.name");
  if (svcName) {
    return normalizeServicePrefix(svcName) ?? svcName;
  }
  return undefined;
}

function lookupToolMapping(
  toolName: string,
  span: OtlpSpan,
  toolMapping: ToolMapping,
): ToolMapping[string] | undefined {
  // 1. Exact key match (supports both unambiguous short names and "<service>:<operationId>")
  if (toolMapping[toolName]) {
    return toolMapping[toolName];
  }

  // 2. Explicit "<service>:<operationId>" with alias normalization
  if (toolName.includes(":")) {
    const idx = toolName.indexOf(":");
    const rawPrefix = toolName.slice(0, idx);
    const opId = toolName.slice(idx + 1);
    const canonicalService = normalizeServicePrefix(rawPrefix) ?? rawPrefix;
    if (toolMapping[`${canonicalService}:${opId}`]) {
      return toolMapping[`${canonicalService}:${opId}`];
    }
    if (toolMapping[opId]) {
      return toolMapping[opId];
    }
  }

  // 3. Underscore-prefixed tool names (e.g. "ams_listClients", "coastal_bindQuote", "summit_fire_getHealth")
  const lowerTool = toolName.toLowerCase();
  for (const prefix of SORTED_SERVICE_PREFIXES) {
    if (lowerTool.startsWith(`${prefix}_`) && toolName.length > prefix.length + 1) {
      const opId = toolName.slice(prefix.length + 1);
      const canonicalService = SERVICE_PREFIX_ALIASES[prefix];
      if (toolMapping[`${canonicalService}:${opId}`]) {
        return toolMapping[`${canonicalService}:${opId}`];
      }
      if (toolMapping[opId]) {
        return toolMapping[opId];
      }
    }
  }

  if (toolName.includes("_")) {
    const unprefixed = toolName.substring(toolName.indexOf("_") + 1);
    if (toolMapping[unprefixed]) {
      return toolMapping[unprefixed];
    }
  }

  // 4. Colliding bare operationId disambiguated by span service/port attribute if present
  const hintService = resolveSpanServiceHint(span);
  if (hintService && toolMapping[`${hintService}:${toolName}`]) {
    return toolMapping[`${hintService}:${toolName}`];
  }

  return undefined;
}

/**
 * Fall back to tool name -> OpenAPI spec mapping (or built-in Comm MCP tool mapping).
 */
function extractHttpFromMapping(
  span: OtlpSpan,
  toolMapping?: ToolMapping,
): HttpMeta | undefined {
  const toolName = getStringAttr(span.attributes, "gen_ai.tool.name");
  if (!toolName) return undefined;

  if (BUILTIN_MCP_TOOL_MAPPING[toolName]) {
    const mcpMap = BUILTIN_MCP_TOOL_MAPPING[toolName];
    return {
      method: mcpMap.method,
      url: `${mcpMap.baseUrl}${mcpMap.path}`,
      statusCode: resolveToolStatusCode(span, mcpMap.method === "POST" ? 201 : 200),
    };
  }

  if (!toolMapping) return undefined;

  const mapping = lookupToolMapping(toolName, span, toolMapping);
  if (!mapping) return undefined;

  // Reconstruct URL from mapping (path params stay as templates)
  return {
    method: mapping.method,
    url: `${mapping.baseUrl}${mapping.path}`,
    statusCode: resolveToolStatusCode(span, 200),
  };
}

// URL helpers

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

// Main parser

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
          extractHttpFromMapping(span, toolMapping);

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

export {
  MODEL_PRICING_PER_1M,
  DEFAULT_MODEL_PRICING,
  normalizeModelName,
  resolveModelPricing,
  calculateModelCost,
  computeTurnBudgetScore,
  computeParetoEfficiency,
  extractEconomicsMetrics,
} from "./economics";
