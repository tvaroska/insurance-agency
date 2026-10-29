import { describe, expect, test } from "bun:test";
import {
  getReferencePlaybook,
  resolveCommMcpToolName,
  runBaselineAgent,
} from "../agents/baseline-agent";
import { parseTrace, evaluateTrace } from "../evaluators/trace";
import { evaluateEconomics } from "../evaluators/economics";
import { scenarios } from "../scenarios";

describe("Playable Reference Baseline Agent (eval/agents/baseline-agent.ts)", () => {
  test("resolveCommMcpToolName maps comm REST endpoints to MCP tool names", () => {
    expect(resolveCommMcpToolName("POST", "/v1/messages/send")).toBe("comm_send_message");
    expect(resolveCommMcpToolName("GET", "/v1/messages/inbox?client_id=CLI-002")).toBe(
      "comm_list_inbox",
    );
    expect(resolveCommMcpToolName("GET", "/v1/calls/transcript/CALL-01")).toBe(
      "comm_get_transcript",
    );
    expect(resolveCommMcpToolName("POST", "/v1/webhooks")).toBe("comm_register_webhook");
  });

  test("executes Scenario 16 multi-turn playbook over strict MCP + REST and passes trace & privacy checks", async () => {
    const mockFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "test-jwt" }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "ok", data: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await runBaselineAgent({
      scenarioId: "16",
      seed: "realistic",
      model: "gemini-3.8-flash",
      modalityMode: "strict",
      fetchImpl: mockFetch,
    });

    expect(result.steps.length).toBeGreaterThanOrEqual(7);
    expect(result.privacyAudit.passed).toBe(true);

    // Parse emitted OTLP trace through the canonical trace parser
    const parsedCalls = parseTrace(result.trace);
    expect(parsedCalls.length).toBe(result.steps.length);

    // Verify MCP POST /mcp calls were normalized to /v1/messages/send and /v1/messages/inbox
    const commPaths = parsedCalls.filter((c) => c.service === "comm").map((c) => c.path);
    expect(commPaths).toContain("/v1/messages/send");
    expect(commPaths).toContain("/v1/messages/inbox");

    // Score trace against Scenario 16 traceChecks
    const scen16 = scenarios["16"].variants.realistic;
    const traceScores = evaluateTrace(parsedCalls, scen16.traceChecks);
    expect(traceScores.every((c) => c.passed)).toBe(true);

    // Compute token & cost economics from the emitted OTLP trace
    const econ = evaluateEconomics(result.trace, parsedCalls, {
      expectedRange: [scen16.expectedApiCalls.min, scen16.expectedApiCalls.max],
      rawScore: 0.95,
    });
    expect(econ.inputTokens).toBeGreaterThan(0);
    expect(econ.outputTokens).toBeGreaterThan(0);
    expect(econ.modalityCounts?.mcp).toBe(3);
  });

  test("executes Scenario 08 E&O trap playbook and tags conflict_escalation traffic", async () => {
    const playbook08 = getReferencePlaybook("08", "realistic", "strict");
    expect(playbook08.filter((s) => s.trafficType === "conflict_escalation")).toHaveLength(3);
  });
});
