import type {
  ApiCall,
  OtlpTrace,
  OtlpSpan,
  OtlpAttribute,
  TraceCheck,
  TraceScore,
} from "../types";
import { PORT_SERVICE_MAP, SPAN_KIND_CLIENT } from "../types";

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

// ── OTLP parsing ────────────────────────────────────────────────────

export function parseOtlpTrace(trace: OtlpTrace): ApiCall[] {
  const calls: ApiCall[] = [];

  for (const rs of trace.resourceSpans) {
    for (const ss of rs.scopeSpans) {
      for (const span of ss.spans) {
        if (span.kind !== SPAN_KIND_CLIENT) continue;

        const method = getAttr(span.attributes, "http.request.method");
        const urlFull = getAttr(span.attributes, "url.full");
        const statusCode = getAttr(span.attributes, "http.response.status_code");
        const serverPort = getAttr(span.attributes, "server.port");

        if (typeof method !== "string" || typeof urlFull !== "string") continue;

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

        const startNano = BigInt(span.startTimeUnixNano);
        const endNano = BigInt(span.endTimeUnixNano);
        const timestamp = Number(startNano / 1_000_000n);
        const durationMs = Number((endNano - startNano) / 1_000_000n);

        calls.push({
          method: method as string,
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

function matchesPattern(
  call: ApiCall,
  pattern: TraceCheck["pattern"],
): boolean {
  if (pattern.method !== undefined && call.method !== pattern.method) return false;
  if (pattern.service !== undefined && call.service !== pattern.service) return false;
  if (pattern.statusCode !== undefined && call.statusCode !== pattern.statusCode) return false;
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
  const found = calls.some((c) => matchesPattern(c, check.pattern));
  return {
    name: check.name,
    passed: found,
    weight: check.weight,
    detail: found ? undefined : `No API call matched pattern: ${formatPattern(check.pattern)}`,
  };
}

function evalAbsence(check: TraceCheck, calls: ApiCall[]): TraceScore {
  const found = calls.find((c) => matchesPattern(c, check.pattern));
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
  let seqIdx = 0;
  for (const call of calls) {
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
  const matching = calls.filter((c) => matchesPattern(c, check.pattern)).length;
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
