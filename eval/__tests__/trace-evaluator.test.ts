import { describe, expect, test } from "bun:test";
import { parseOtlpTrace, evaluateTrace, parseTrace } from "../evaluators/trace";
import { parseGenAiTrace } from "../evaluators/trace-genai";
import type { ApiCall, OtlpTrace, TraceCheck, ToolMapping } from "../types";

// ── Fixtures ──────────────────────────────────────────────────────

import httpFixture from "./fixtures/otlp-http.json";
import genaiFixture from "./fixtures/otlp-genai.json";

const httpTrace = httpFixture as unknown as OtlpTrace;
const genaiTrace = genaiFixture as unknown as OtlpTrace;

// Helper to build a minimal OTLP trace inline
function makeTrace(spans: OtlpTrace["resourceSpans"][0]["scopeSpans"][0]["spans"]): OtlpTrace {
  return {
    resourceSpans: [{
      resource: { attributes: [] },
      scopeSpans: [{ spans }],
    }],
  };
}

function makeHttpSpan(overrides: {
  method: string;
  url: string;
  statusCode: number;
  port?: number;
  startNano?: string;
  endNano?: string;
  kind?: number;
}) {
  const attrs = [
    { key: "http.request.method", value: { stringValue: overrides.method } },
    { key: "url.full", value: { stringValue: overrides.url } },
    { key: "http.response.status_code", value: { intValue: overrides.statusCode } },
  ];
  if (overrides.port !== undefined) {
    attrs.push({ key: "server.port", value: { intValue: overrides.port } } as any);
  }
  return {
    traceId: "t1",
    spanId: `s-${Math.random().toString(36).slice(2, 8)}`,
    name: overrides.method,
    kind: overrides.kind ?? 3,
    startTimeUnixNano: overrides.startNano ?? "1700000000000000000",
    endTimeUnixNano: overrides.endNano ?? "1700000000100000000",
    attributes: attrs,
  };
}

// Shared parsed calls for evaluator tests
const sampleCalls: ApiCall[] = [
  { method: "GET", url: "http://localhost:3002/v1/clients", path: "/v1/clients", service: "crm", statusCode: 200, timestamp: 1700000000000, durationMs: 100 },
  { method: "POST", url: "http://localhost:3000/v1/policies", path: "/v1/policies", service: "ams", statusCode: 201, timestamp: 1700000000200, durationMs: 150 },
  { method: "GET", url: "http://localhost:3002/v1/clients/CLI-001", path: "/v1/clients/CLI-001", service: "crm", statusCode: 200, timestamp: 1700000000400, durationMs: 100 },
  { method: "DELETE", url: "http://localhost:3002/v1/clients/CLI-001", path: "/v1/clients/CLI-001", service: "crm", statusCode: 200, timestamp: 1700000000600, durationMs: 100 },
];

// ── parseOtlpTrace ────────────────────────────────────────────────

describe("parseOtlpTrace", () => {
  test("parses HTTP client spans into ApiCall[]", () => {
    const calls = parseOtlpTrace(httpTrace);
    expect(calls).toHaveLength(4);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].path).toBe("/v1/clients");
    expect(calls[0].service).toBe("crm");
    expect(calls[0].statusCode).toBe(200);
  });

  test("skips non-CLIENT spans (kind != 3)", () => {
    const calls = parseOtlpTrace(httpTrace);
    // The fixture has 5 spans (4 client + 1 internal), should only get 4
    expect(calls).toHaveLength(4);
    expect(calls.every((c) => c.method !== "")).toBe(true);
  });

  test("resolves service from server.port attribute", () => {
    const calls = parseOtlpTrace(httpTrace);
    expect(calls[0].service).toBe("crm");   // port 3002
    expect(calls[1].service).toBe("ams");   // port 3000
  });

  test("resolves service from URL port when server.port absent", () => {
    const trace = makeTrace([
      makeHttpSpan({
        method: "GET",
        url: "http://localhost:3004/v1/messages",
        statusCode: 200,
        // no port attribute
      }),
    ]);
    const calls = parseOtlpTrace(trace);
    expect(calls).toHaveLength(1);
    expect(calls[0].service).toBe("comm"); // port 3004
  });

  test("extracts path from url.full", () => {
    const calls = parseOtlpTrace(httpTrace);
    expect(calls[2].path).toBe("/v1/clients/CLI-001");
  });

  test("sorts by timestamp", () => {
    const calls = parseOtlpTrace(httpTrace);
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i].timestamp).toBeGreaterThanOrEqual(calls[i - 1].timestamp);
    }
  });

  test("returns empty for trace with no HTTP spans", () => {
    const trace = makeTrace([
      {
        traceId: "t1",
        spanId: "s1",
        name: "internal",
        kind: 1,
        startTimeUnixNano: "1700000000000000000",
        endTimeUnixNano: "1700000000100000000",
        attributes: [],
      },
    ]);
    const calls = parseOtlpTrace(trace);
    expect(calls).toHaveLength(0);
  });

  test("calculates durationMs correctly", () => {
    const calls = parseOtlpTrace(httpTrace);
    // span-1: 100ms (100_000_000 nanoseconds)
    expect(calls[0].durationMs).toBe(100);
    // span-2: 150ms
    expect(calls[1].durationMs).toBe(150);
  });

  test("handles string intValue for status code", () => {
    const trace = makeTrace([{
      traceId: "t1",
      spanId: "s1",
      name: "GET",
      kind: 3,
      startTimeUnixNano: "1700000000000000000",
      endTimeUnixNano: "1700000000100000000",
      attributes: [
        { key: "http.request.method", value: { stringValue: "GET" } },
        { key: "url.full", value: { stringValue: "http://localhost:3002/v1/clients" } },
        { key: "http.response.status_code", value: { intValue: "200" } },
        { key: "server.port", value: { intValue: "3002" } },
      ],
    }]);
    const calls = parseOtlpTrace(trace);
    expect(calls).toHaveLength(1);
    expect(calls[0].statusCode).toBe(200);
    expect(calls[0].service).toBe("crm");
  });
});

// ── parseGenAiTrace ───────────────────────────────────────────────

describe("parseGenAiTrace", () => {
  test("extracts calls from _http in tool response", () => {
    const calls = parseGenAiTrace(genaiTrace);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].path).toBe("/v1/clients");
    expect(calls[0].service).toBe("crm");
    expect(calls[0].statusCode).toBe(200);
  });

  test("extracts calls from nested result._http", () => {
    const calls = parseGenAiTrace(genaiTrace);
    const postCall = calls.find((c) => c.method === "POST");
    expect(postCall).toBeDefined();
    expect(postCall!.path).toBe("/v1/policies");
    expect(postCall!.service).toBe("ams");
    expect(postCall!.statusCode).toBe(201);
  });

  test("falls back to toolMapping when no _http", () => {
    const mapping: ToolMapping = {
      getQuote: {
        method: "GET",
        path: "/v1/quotes",
        service: "ams",
        baseUrl: "http://localhost:3000",
      },
    };
    const calls = parseGenAiTrace(genaiTrace, mapping);
    // Should find 3 calls: 2 from _http + 1 from mapping fallback
    const quoteCall = calls.find((c) => c.path === "/v1/quotes");
    expect(quoteCall).toBeDefined();
    expect(quoteCall!.method).toBe("GET");
    expect(quoteCall!.statusCode).toBe(200); // assumed success for mapping
  });

  test("handles prefixed tool names (strip service prefix)", () => {
    const mapping: ToolMapping = {
      getQuote: {
        method: "GET",
        path: "/v1/quotes",
        service: "ams",
        baseUrl: "http://localhost:3000",
      },
    };
    // genai fixture has tool "ams_getQuote" — should strip "ams_" prefix and match "getQuote"
    const calls = parseGenAiTrace(genaiTrace, mapping);
    const quoteCall = calls.find((c) => c.path === "/v1/quotes");
    expect(quoteCall).toBeDefined();
  });

  test("skips non-tool spans", () => {
    // genai fixture has a chat span — it should be skipped
    const calls = parseGenAiTrace(genaiTrace);
    // Only 2 spans have _http metadata (the 3rd has no _http and no mapping)
    expect(calls).toHaveLength(2);
  });

  test("sorts by timestamp", () => {
    const calls = parseGenAiTrace(genaiTrace);
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i].timestamp).toBeGreaterThanOrEqual(calls[i - 1].timestamp);
    }
  });
});

// ── evaluateTrace ─────────────────────────────────────────────────

describe("evaluateTrace", () => {
  describe("presence", () => {
    test("passes when matching call exists", () => {
      const check: TraceCheck = {
        name: "has-get-clients",
        weight: 1,
        type: "presence",
        pattern: { method: "GET", pathPattern: "/v1/clients$", service: "crm" },
      };
      const [score] = evaluateTrace([check], sampleCalls);
      expect(score.passed).toBe(true);
      expect(score.detail).toBeUndefined();
    });

    test("fails with detail when no match", () => {
      const check: TraceCheck = {
        name: "has-put-clients",
        weight: 1,
        type: "presence",
        pattern: { method: "PUT", pathPattern: "/v1/clients" },
      };
      const [score] = evaluateTrace([check], sampleCalls);
      expect(score.passed).toBe(false);
      expect(score.detail).toContain("No API call matched pattern");
      expect(score.detail).toContain("PUT");
    });
  });

  describe("absence", () => {
    test("passes when no matching call", () => {
      const check: TraceCheck = {
        name: "no-put",
        weight: 1,
        type: "absence",
        pattern: { method: "PUT" },
      };
      const [score] = evaluateTrace([check], sampleCalls);
      expect(score.passed).toBe(true);
      expect(score.detail).toBeUndefined();
    });

    test("fails with detail showing matched call", () => {
      const check: TraceCheck = {
        name: "no-delete",
        weight: 1,
        type: "absence",
        pattern: { method: "DELETE" },
      };
      const [score] = evaluateTrace([check], sampleCalls);
      expect(score.passed).toBe(false);
      expect(score.detail).toContain("Unexpected call matched");
      expect(score.detail).toContain("DELETE");
      expect(score.detail).toContain("/v1/clients/CLI-001");
    });
  });

  describe("sequence", () => {
    test("passes when subsequence found in order", () => {
      const check: TraceCheck = {
        name: "search-then-create",
        weight: 1,
        type: "sequence",
        pattern: {},
        sequence: [
          { method: "GET", pathPattern: "/v1/clients$" },
          { method: "POST", pathPattern: "/v1/policies" },
        ],
      };
      const [score] = evaluateTrace([check], sampleCalls);
      expect(score.passed).toBe(true);
    });

    test("fails when steps out of order", () => {
      const check: TraceCheck = {
        name: "create-then-search",
        weight: 1,
        type: "sequence",
        pattern: {},
        sequence: [
          { method: "POST", pathPattern: "/v1/policies" },
          { method: "GET", pathPattern: "/v1/clients$" },  // GET /v1/clients is before POST, not after
        ],
      };
      const [score] = evaluateTrace([check], sampleCalls);
      // After POST (index 1), we look for GET /v1/clients$ — only the exact path match at index 0 qualifies,
      // but index 2 is GET /v1/clients/CLI-001 which doesn't match /v1/clients$
      expect(score.passed).toBe(false);
      expect(score.detail).toContain("Sequence incomplete");
      expect(score.detail).toContain("1/2");
    });

    test("passes with non-consecutive matching", () => {
      const check: TraceCheck = {
        name: "get-then-delete",
        weight: 1,
        type: "sequence",
        pattern: {},
        sequence: [
          { method: "GET", pathPattern: "/v1/clients$" },
          { method: "DELETE", pathPattern: "/v1/clients/CLI-001" },
        ],
      };
      const [score] = evaluateTrace([check], sampleCalls);
      expect(score.passed).toBe(true);
    });

    test("handles empty sequence", () => {
      const check: TraceCheck = {
        name: "empty",
        weight: 1,
        type: "sequence",
        pattern: {},
        sequence: [],
      };
      const [score] = evaluateTrace([check], sampleCalls);
      expect(score.passed).toBe(true);
    });
  });

  describe("count", () => {
    test("passes when count in range", () => {
      const check: TraceCheck = {
        name: "get-count",
        weight: 1,
        type: "count",
        pattern: { method: "GET" },
        countRange: { min: 1, max: 5 },
      };
      const [score] = evaluateTrace([check], sampleCalls);
      expect(score.passed).toBe(true);
    });

    test("fails when count below min", () => {
      const check: TraceCheck = {
        name: "post-count",
        weight: 1,
        type: "count",
        pattern: { method: "POST" },
        countRange: { min: 3, max: 10 },
      };
      const [score] = evaluateTrace([check], sampleCalls);
      expect(score.passed).toBe(false);
      expect(score.detail).toContain("Count 1 outside range [3, 10]");
    });

    test("fails when count above max", () => {
      const check: TraceCheck = {
        name: "get-count-max",
        weight: 1,
        type: "count",
        pattern: { method: "GET" },
        countRange: { min: 0, max: 1 },
      };
      const [score] = evaluateTrace([check], sampleCalls);
      expect(score.passed).toBe(false);
      // 2 GET calls, max is 1
      expect(score.detail).toContain("Count 2 outside range [0, 1]");
    });
  });

  describe("weights", () => {
    test("returns correct weights on each score", () => {
      const checks: TraceCheck[] = [
        { name: "c1", weight: 0.3, type: "presence", pattern: { method: "GET" } },
        { name: "c2", weight: 0.7, type: "presence", pattern: { method: "POST" } },
      ];
      const scores = evaluateTrace(checks, sampleCalls);
      expect(scores[0].weight).toBe(0.3);
      expect(scores[1].weight).toBe(0.7);
    });
  });

  describe("pattern matching", () => {
    test("matches by statusCode", () => {
      const check: TraceCheck = {
        name: "created",
        weight: 1,
        type: "presence",
        pattern: { statusCode: 201 },
      };
      const [score] = evaluateTrace([check], sampleCalls);
      expect(score.passed).toBe(true);
    });

    test("matches by service", () => {
      const check: TraceCheck = {
        name: "ams-call",
        weight: 1,
        type: "presence",
        pattern: { service: "ams" },
      };
      const [score] = evaluateTrace([check], sampleCalls);
      expect(score.passed).toBe(true);
    });

    test("fails when no match on combined pattern", () => {
      const check: TraceCheck = {
        name: "get-ams",
        weight: 1,
        type: "presence",
        pattern: { method: "GET", service: "ams" },
      };
      const [score] = evaluateTrace([check], sampleCalls);
      expect(score.passed).toBe(false);
    });
  });
});

// ── parseTrace (unified) ──────────────────────────────────────────

describe("parseTrace", () => {
  test("returns HTTP calls when present (prefers over GenAI)", () => {
    const calls = parseTrace(httpTrace);
    expect(calls).toHaveLength(4);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].service).toBe("crm");
  });

  test("falls back to GenAI when no HTTP client spans", () => {
    // genaiTrace has no kind=3 spans, only kind=1 tool spans
    const calls = parseTrace(genaiTrace);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].path).toBe("/v1/clients");
  });
});
