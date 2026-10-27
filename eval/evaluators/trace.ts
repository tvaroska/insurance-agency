import type {
  ApiCall,
  OtlpTrace,
  OtlpSpan,
  OtlpAttribute,
  TraceCheck,
  TraceScore,
  ToolMapping,
} from "../types";
import { PORT_SERVICE_MAP, SPAN_KIND_CLIENT } from "../types";
import { BUILTIN_MCP_TOOL_MAPPING, parseGenAiTrace } from "./trace-genai";

// ── Attribute helpers ───────────────────────────────────────────────

function getAttr(
  attrs: OtlpAttribute[],
  key: string,
): string | number | undefined {
  const attr = attrs.find((a) => a.key === key);
  if (!attr) return undefined;
  if (attr.value.stringValue !== undefined) return attr.value.stringValue;
  if (attr.value.intValue !== undefined) {
    return typeof attr.value.intValue === "string"
      ? parseInt(attr.value.intValue, 10)
      : attr.value.intValue;
  }
  return undefined;
}

function resolveMcpToolFromSpan(span: OtlpSpan): { method: string; path: string } | undefined {
  const candidateAttrs = [
    getAttr(span.attributes, "mcp.tool.name"),
    getAttr(span.attributes, "gen_ai.tool.name"),
    getAttr(span.attributes, "rpc.method"),
  ];

  for (const attrVal of candidateAttrs) {
    if (typeof attrVal === "string" && BUILTIN_MCP_TOOL_MAPPING[attrVal]) {
      const mapped = BUILTIN_MCP_TOOL_MAPPING[attrVal];
      return { method: mapped.method, path: mapped.path };
    }
  }

  const bodyRaw =
    getAttr(span.attributes, "http.request.body") ??
    getAttr(span.attributes, "mcp.request.body");
  if (typeof bodyRaw === "string") {
    try {
      const parsed = JSON.parse(bodyRaw) as {
        method?: string;
        params?: { name?: string };
        tool?: string;
        name?: string;
      };
      const toolName = parsed?.params?.name ?? parsed?.tool ?? parsed?.name ?? parsed?.method;
      if (typeof toolName === "string" && BUILTIN_MCP_TOOL_MAPPING[toolName]) {
        const mapped = BUILTIN_MCP_TOOL_MAPPING[toolName];
        return { method: mapped.method, path: mapped.path };
      }
    } catch {
      for (const [toolKey, mapped] of Object.entries(BUILTIN_MCP_TOOL_MAPPING)) {
        if (bodyRaw.includes(toolKey)) {
          return { method: mapped.method, path: mapped.path };
        }
      }
    }
  }

  return undefined;
}

// ── OTLP parsing ────────────────────────────────────────────────────

export function parseOtlpTrace(trace: OtlpTrace): ApiCall[] {
  const calls: ApiCall[] = [];

  for (const rs of trace.resourceSpans) {
    for (const ss of rs.scopeSpans) {
      for (const span of ss.spans) {
        if (span.kind !== SPAN_KIND_CLIENT) continue;

        const rawMethod = getAttr(span.attributes, "http.request.method");
        const urlFull = getAttr(span.attributes, "url.full");
        const statusCode = getAttr(span.attributes, "http.response.status_code");
        const serverPort = getAttr(span.attributes, "server.port");

        if (typeof rawMethod !== "string" || typeof urlFull !== "string") continue;

        let method = rawMethod;
        let path: string;
        try {
          path = new URL(urlFull).pathname;
        } catch {
          path = urlFull;
        }

        const port = typeof serverPort === "number"
          ? serverPort
          : typeof serverPort === "string"
            ? parseInt(serverPort, 10)
            : parsePortFromUrl(urlFull);

        const service = port !== undefined
          ? PORT_SERVICE_MAP[port] ?? "unknown"
          : "unknown";

        // Normalize raw HTTP MCP calls (POST /mcp on comm under MODALITY_MODE=strict)
        if (service === "comm" && (path === "/mcp" || path.startsWith("/mcp/"))) {
          const normalized = resolveMcpToolFromSpan(span);
          if (normalized) {
            method = normalized.method;
            path = normalized.path;
          }
        }

        const startNano = BigInt(span.startTimeUnixNano);
        const endNano = BigInt(span.endTimeUnixNano);
        const timestamp = Number(startNano / 1_000_000n);
        const durationMs = Number((endNano - startNano) / 1_000_000n);

        calls.push({
          method,
          url: urlFull as string,
          path,
          service,
          statusCode: typeof statusCode === "number" ? statusCode : Number(statusCode ?? 0),
          timestamp,
          durationMs,
        });
      }
    }
  }

  return calls.sort((a, b) => a.timestamp - b.timestamp);
}

function parsePortFromUrl(url: string): number | undefined {
  try {
    const port = new URL(url).port;
    return port ? parseInt(port, 10) : undefined;
  } catch {
    return undefined;
  }
}

// ── Pattern matching ────────────────────────────────────────────────

function isSuccessStatus(statusCode: number): boolean {
  return statusCode === 0 || (statusCode >= 200 && statusCode < 300);
}

function matchesPattern(
  call: ApiCall,
  pattern: TraceCheck["pattern"],
  requireSuccess = true,
): boolean {
  if (pattern.method !== undefined && call.method !== pattern.method) return false;
  if (pattern.service !== undefined && call.service !== pattern.service) return false;
  if (pattern.statusCode !== undefined) {
    if (call.statusCode !== pattern.statusCode) return false;
  } else if (requireSuccess && !isSuccessStatus(call.statusCode)) {
    return false;
  }
  if (pattern.pathPattern !== undefined) {
    const re = new RegExp(pattern.pathPattern);
    if (!re.test(call.path)) return false;
  }
  return true;
}

// ── Trace evaluator ─────────────────────────────────────────────────

export function evaluateTrace(
  checks: TraceCheck[],
  apiCalls: ApiCall[],
): TraceScore[] {
  return checks.map((check) => {
    switch (check.type) {
      case "presence":
        return evalPresence(check, apiCalls);
      case "absence":
        return evalAbsence(check, apiCalls);
      case "sequence":
        return evalSequence(check, apiCalls);
      case "count":
        return evalCount(check, apiCalls);
    }
  });
}

function evalPresence(check: TraceCheck, calls: ApiCall[]): TraceScore {
  const found = calls.some((c) => matchesPattern(c, check.pattern, true));
  return {
    name: check.name,
    passed: found,
    weight: check.weight,
    detail: found ? undefined : `No API call matched pattern: ${formatPattern(check.pattern)}`,
  };
}

function evalAbsence(check: TraceCheck, calls: ApiCall[]): TraceScore {
  const found = calls.find((c) => matchesPattern(c, check.pattern, false));
  return {
    name: check.name,
    passed: !found,
    weight: check.weight,
    detail: found
      ? `Unexpected call matched pattern: ${found.method} ${found.path} (${found.service})`
      : undefined,
  };
}

function evalSequence(check: TraceCheck, calls: ApiCall[]): TraceScore {
  if (!check.sequence || check.sequence.length === 0) {
    return { name: check.name, passed: true, weight: check.weight };
  }

  // Subsequence match: sequence elements must appear in order (not necessarily consecutive)
  // and must have a 2xx (or unrecorded 0) status code.
  let seqIdx = 0;
  for (const call of calls) {
    if (!isSuccessStatus(call.statusCode)) continue;
    const step = check.sequence[seqIdx];
    if (
      call.method === step.method &&
      new RegExp(step.pathPattern).test(call.path)
    ) {
      seqIdx++;
      if (seqIdx >= check.sequence.length) break;
    }
  }

  const passed = seqIdx >= check.sequence.length;
  return {
    name: check.name,
    passed,
    weight: check.weight,
    detail: passed
      ? undefined
      : `Sequence incomplete: matched ${seqIdx}/${check.sequence.length} steps (stuck at: ${check.sequence[seqIdx].method} ${check.sequence[seqIdx].pathPattern})`,
  };
}

function evalCount(check: TraceCheck, calls: ApiCall[]): TraceScore {
  const matching = calls.filter((c) => matchesPattern(c, check.pattern, true)).length;
  const range = check.countRange ?? { min: 0, max: Infinity };
  const passed = matching >= range.min && matching <= range.max;
  return {
    name: check.name,
    passed,
    weight: check.weight,
    detail: passed
      ? undefined
      : `Count ${matching} outside range [${range.min}, ${range.max}]`,
  };
}

function formatPattern(pattern: TraceCheck["pattern"]): string {
  const parts: string[] = [];
  if (pattern.method) parts.push(pattern.method);
  if (pattern.pathPattern) parts.push(pattern.pathPattern);
  if (pattern.service) parts.push(`(${pattern.service})`);
  if (pattern.statusCode) parts.push(`→${pattern.statusCode}`);
  return parts.join(" ") || "(empty pattern)";
}

// ── Unified parser ──────────────────────────────────────────────────

/**
 * Auto-detect trace format and parse to ApiCall[].
 * Tries HTTP client spans first, falls back to GenAI tool spans.
 */
export function parseTrace(
  trace: OtlpTrace,
  toolMapping?: ToolMapping,
): ApiCall[] {
  const httpCalls = parseOtlpTrace(trace);
  if (httpCalls.length > 0) return httpCalls;

  return parseGenAiTrace(trace, toolMapping);
}

// ── Multi-turn turn-budget helpers (S3-SIM-1) ──────────────────────

/**
 * Counts outbound Comm Hub messages (`POST /v1/messages/send`, `POST /v1/messages`,
 * or `POST /mcp` on `comm`) representing interactive turns with simulated personas.
 */
export function countCommTurns(apiCalls: ApiCall[]): number {
  return apiCalls.filter(
    (c) =>
      c.service === "comm" &&
      c.method === "POST" &&
      (c.path.includes("/messages/send") ||
        c.path.endsWith("/messages") ||
        c.path.startsWith("/mcp")),
  ).length;
}

/**
 * Evaluates whether interactive turns fall within `[minTurns, maxTurns]`.
 */
export function evaluateTurnBudget(
  apiCalls: ApiCall[],
  maxTurns = 5,
  minTurns = 0,
  weight = 0.1,
): TraceScore {
  const turns = countCommTurns(apiCalls);
  const passed = turns >= minTurns && turns <= maxTurns;
  return {
    name: "turn_budget",
    passed,
    weight,
    detail: passed
      ? undefined
      : `Turn count ${turns} outside turn budget [${minTurns}, ${maxTurns}]`,
  };
}
