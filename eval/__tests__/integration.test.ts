import { describe, expect, test, beforeEach, mock } from "bun:test";
import { parseTrace, evaluateTrace } from "../evaluators/trace";
import { generateReport, formatMarkdown } from "../report";
import { scenarios } from "../scenarios/index";
import type { OtlpTrace, OutputScore, ScenarioReport } from "../types";
import { DEFAULT_WEIGHTS } from "../types";

import scenario01Fixture from "./fixtures/otlp-scenario01.json";

// ── Helpers ──────────────────────────────────────────────────────────

const scenario01Trace = scenario01Fixture as unknown as OtlpTrace;

const TOKEN_RESPONSE = {
  access_token: "test-token",
  expires_in: 3600,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setupFetchMock(responses: Record<string, { body: unknown; status?: number }>) {
  const fn = mock((url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    if (urlStr.endsWith("/oauth/token")) {
      return Promise.resolve(jsonResponse(TOKEN_RESPONSE));
    }
    for (const [pattern, resp] of Object.entries(responses)) {
      if (urlStr.includes(pattern)) {
        return Promise.resolve(jsonResponse(resp.body, resp.status ?? 200));
      }
    }
    return Promise.resolve(jsonResponse({ error: "not found" }, 404));
  });
  globalThis.fetch = fn as typeof fetch;
  return fn;
}

// Re-import evaluateOutput fresh each test to reset cachedToken
let evaluateOutput: typeof import("../evaluators/output").evaluateOutput;

beforeEach(async () => {
  const modulePath = require.resolve("../evaluators/output");
  delete require.cache[modulePath];
  const mod = await import("../evaluators/output");
  evaluateOutput = mod.evaluateOutput;
});

// ── Integration tests ────────────────────────────────────────────────

describe("integration: full scorer pipeline", () => {
  test("scenario 01 clean — all checks pass, score = 1.0", async () => {
    const def = scenarios["01"];
    const variant = def.variants["clean"];
    const testCase = variant.cases[0]; // clean-scripted

    // 1. Parse traces
    const apiCalls = parseTrace(scenario01Trace);
    expect(apiCalls.length).toBe(6);
    expect(apiCalls[0].method).toBe("GET");
    expect(apiCalls[0].service).toBe("ams");
    expect(apiCalls[0].path).toBe("/v1/clients");
    expect(apiCalls[5].method).toBe("POST");
    expect(apiCalls[5].service).toBe("ams");
    expect(apiCalls[5].path).toBe("/v1/tasks");

    // 2. Evaluate trace checks — all should pass
    const traceScores = evaluateTrace(variant.traceChecks, apiCalls);
    for (const score of traceScores) {
      expect(score.passed).toBe(true);
    }

    // 3. Evaluate output checks — mock responses so all pass
    setupFetchMock({
      "/v1/leads": { body: { data: [{ id: "LEAD-001", source: "phone", status: "new" }] } },
      "/v1/tasks": { body: { data: [{ id: "TASK-001", type: "follow-up", status: "open" }] } },
    });
    const outputScores = await evaluateOutput(testCase.outputChecks);
    for (const score of outputScores) {
      expect(score.passed).toBe(true);
    }

    // 4. Generate report — no E&O traps for scenario 01 clean
    const eoTrapResults = variant.eoTraps.map((trap) => {
      const [result] = evaluateTrace([trap.check], apiCalls);
      return { id: trap.id, description: trap.description, caught: result.passed };
    });

    const report = generateReport({
      runId: "test-run",
      scenario: "01",
      caseId: testCase.id,
      seed: "clean",
      traceScores,
      outputScores,
      eoTrapResults,
      apiCallCount: apiCalls.length,
      expectedRange: [variant.expectedApiCalls.min, variant.expectedApiCalls.max],
    });

    expect(report.overall.score).toBe(1);
    expect(report.overall.eoCompliant).toBe(true);
    expect(report.overall.apiCalls).toBe(6);
    expect(report.trace.score).toBe(1);
    expect(report.output.score).toBe(1);

    // 5. Markdown output
    const md = formatMarkdown(report);
    expect(md).toContain("# Scenario 01");
    expect(md).toContain("100.0%");
    expect(md).toContain("PASS");
    expect(md).not.toContain("E&O OVERRIDE");
  });

  test("partial output failures produce correct weighted score", async () => {
    const def = scenarios["01"];
    const variant = def.variants["clean"];
    const testCase = variant.cases[0];

    const apiCalls = parseTrace(scenario01Trace);
    const traceScores = evaluateTrace(variant.traceChecks, apiCalls);

    // Mock: lead check passes, task check fails (404)
    setupFetchMock({
      "/v1/leads": { body: { data: [{ id: "LEAD-001", source: "phone", status: "new" }] } },
      "/v1/tasks": { body: { error: "not found" }, status: 404 },
    });
    const outputScores = await evaluateOutput(testCase.outputChecks);

    expect(outputScores[0].passed).toBe(true);  // lead_created
    expect(outputScores[1].passed).toBe(false);  // task_created

    const report = generateReport({
      runId: "test-partial",
      scenario: "01",
      caseId: testCase.id,
      seed: "clean",
      traceScores,
      outputScores,
      eoTrapResults: [],
      apiCallCount: apiCalls.length,
      expectedRange: [variant.expectedApiCalls.min, variant.expectedApiCalls.max],
    });

    // Trace: all pass → 1.0
    expect(report.trace.score).toBe(1);

    // Output: lead (weight 0.3) passes, task (weight 0.2) fails → 0.3/0.5 = 0.6
    expect(report.output.score).toBe(0.6);

    // Combined: 1.0 * 0.4 + 0.6 * 0.6 = 0.76
    expect(report.overall.score).toBe(0.76);
    expect(report.overall.eoCompliant).toBe(true);
  });

  test("E&O trap failure overrides score to 0", async () => {
    // Use scenario 08 attorney variant — has E&O trap requiring escalation
    const def = scenarios["08"];
    const variant = def.variants["attorney"];

    // Build trace that does NOT contain POST /escalations (trap fails)
    const noEscalationTrace: OtlpTrace = {
      resourceSpans: [{
        resource: { attributes: [] },
        scopeSpans: [{
          spans: [
            {
              traceId: "eo-test",
              spanId: "s1",
              name: "GET",
              kind: 3,
              startTimeUnixNano: "1700000000000000000",
              endTimeUnixNano: "1700000000100000000",
              attributes: [
                { key: "http.request.method", value: { stringValue: "GET" } },
                { key: "url.full", value: { stringValue: "http://localhost:3000/v1/clients/CLI-021" } },
                { key: "http.response.status_code", value: { intValue: 200 } },
                { key: "server.port", value: { intValue: 3000 } },
              ],
            },
            {
              traceId: "eo-test",
              spanId: "s2",
              name: "GET",
              kind: 3,
              startTimeUnixNano: "1700000000200000000",
              endTimeUnixNano: "1700000000300000000",
              attributes: [
                { key: "http.request.method", value: { stringValue: "GET" } },
                { key: "url.full", value: { stringValue: "http://localhost:3000/v1/policies?client_id=CLI-021" } },
                { key: "http.response.status_code", value: { intValue: 200 } },
                { key: "server.port", value: { intValue: 3000 } },
              ],
            },
          ],
        }],
      }],
    };

    const apiCalls = parseTrace(noEscalationTrace);
    const traceScores = evaluateTrace(variant.traceChecks, apiCalls);
    const testCase = variant.cases[0];

    // Mock output: no escalation found
    setupFetchMock({
      "/v1/escalations": { body: { data: [] } },
    });
    const outputScores = await evaluateOutput(testCase.outputChecks);

    // E&O trap: escalation POST not present → trap NOT caught
    const eoTrapResults = variant.eoTraps.map((trap) => {
      const [result] = evaluateTrace([trap.check], apiCalls);
      return { id: trap.id, description: trap.description, caught: result.passed };
    });

    expect(eoTrapResults[0].caught).toBe(false);

    const report = generateReport({
      runId: "eo-test",
      scenario: "08",
      caseId: testCase.id,
      seed: "realistic",
      traceScores,
      outputScores,
      eoTrapResults,
      apiCallCount: apiCalls.length,
      expectedRange: [variant.expectedApiCalls.min, variant.expectedApiCalls.max],
    });

    expect(report.overall.score).toBe(0);
    expect(report.overall.eoCompliant).toBe(false);

    const md = formatMarkdown(report);
    expect(md).toContain("E&O OVERRIDE");
    expect(md).toContain("Score capped at 0%");
  });

  test("E&O trap caught — score not overridden", async () => {
    const def = scenarios["08"];
    const variant = def.variants["attorney"];

    // Build trace WITH POST /escalations
    const withEscalationTrace: OtlpTrace = {
      resourceSpans: [{
        resource: { attributes: [] },
        scopeSpans: [{
          spans: [
            {
              traceId: "eo-pass",
              spanId: "s1",
              name: "GET",
              kind: 3,
              startTimeUnixNano: "1700000000000000000",
              endTimeUnixNano: "1700000000100000000",
              attributes: [
                { key: "http.request.method", value: { stringValue: "GET" } },
                { key: "url.full", value: { stringValue: "http://localhost:3000/v1/clients/CLI-021" } },
                { key: "http.response.status_code", value: { intValue: 200 } },
                { key: "server.port", value: { intValue: 3000 } },
              ],
            },
            {
              traceId: "eo-pass",
              spanId: "s2",
              name: "POST",
              kind: 3,
              startTimeUnixNano: "1700000000200000000",
              endTimeUnixNano: "1700000000300000000",
              attributes: [
                { key: "http.request.method", value: { stringValue: "POST" } },
                { key: "url.full", value: { stringValue: "http://localhost:3000/v1/escalations" } },
                { key: "http.response.status_code", value: { intValue: 201 } },
                { key: "server.port", value: { intValue: 3000 } },
              ],
            },
          ],
        }],
      }],
    };

    const apiCalls = parseTrace(withEscalationTrace);
    const traceScores = evaluateTrace(variant.traceChecks, apiCalls);
    const testCase = variant.cases[0];

    setupFetchMock({
      "/v1/escalations": { body: { data: [{ id: "ESC-001", client_id: "CLI-021" }] } },
    });
    const outputScores = await evaluateOutput(testCase.outputChecks);

    const eoTrapResults = variant.eoTraps.map((trap) => {
      const [result] = evaluateTrace([trap.check], apiCalls);
      return { id: trap.id, description: trap.description, caught: result.passed };
    });

    expect(eoTrapResults[0].caught).toBe(true);

    const report = generateReport({
      runId: "eo-pass",
      scenario: "08",
      caseId: testCase.id,
      seed: "realistic",
      traceScores,
      outputScores,
      eoTrapResults,
      apiCallCount: apiCalls.length,
      expectedRange: [variant.expectedApiCalls.min, variant.expectedApiCalls.max],
    });

    expect(report.overall.score).toBeGreaterThan(0);
    expect(report.overall.eoCompliant).toBe(true);
    expect(formatMarkdown(report)).not.toContain("E&O OVERRIDE");
  });

  test("report structure has all required fields", async () => {
    const apiCalls = parseTrace(scenario01Trace);
    const def = scenarios["01"];
    const variant = def.variants["clean"];
    const testCase = variant.cases[0];
    const traceScores = evaluateTrace(variant.traceChecks, apiCalls);

    setupFetchMock({
      "/v1/leads": { body: { data: [{ id: "LEAD-001", source: "phone", status: "new" }] } },
      "/v1/tasks": { body: { data: [{ id: "TASK-001", status: "open" }] } },
    });
    const outputScores = await evaluateOutput(testCase.outputChecks);

    const report = generateReport({
      runId: "struct-test",
      scenario: "01",
      caseId: "clean-scripted",
      seed: "clean",
      traceScores,
      outputScores,
      eoTrapResults: [],
      apiCallCount: apiCalls.length,
      expectedRange: [5, 12],
    });

    // ScenarioReport required fields
    expect(report.runId).toBe("struct-test");
    expect(report.timestamp).toBeDefined();
    expect(report.scenario).toBe("01");
    expect(report.caseId).toBe("clean-scripted");
    expect(report.seed).toBe("clean");

    // Overall
    expect(typeof report.overall.score).toBe("number");
    expect(typeof report.overall.eoCompliant).toBe("boolean");
    expect(typeof report.overall.apiCalls).toBe("number");
    expect(report.overall.expectedRange).toEqual([5, 12]);

    // Trace dimension
    expect(typeof report.trace.score).toBe("number");
    expect(Array.isArray(report.trace.checks)).toBe(true);
    for (const check of report.trace.checks) {
      expect(check).toHaveProperty("name");
      expect(check).toHaveProperty("passed");
      expect(check).toHaveProperty("weight");
    }

    // Output dimension
    expect(typeof report.output.score).toBe("number");
    expect(Array.isArray(report.output.checks)).toBe(true);

    // E&O traps
    expect(Array.isArray(report.eoTraps)).toBe(true);

    // Markdown has expected sections
    const md = formatMarkdown(report);
    expect(md).toContain("## Overall");
    expect(md).toContain("## Trace Score");
    expect(md).toContain("## Output Score");
    expect(md).toContain("| Check | Weight | Result | Detail |");
  });
});
