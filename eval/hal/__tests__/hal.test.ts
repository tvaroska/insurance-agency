import { describe, it, expect } from "bun:test";
import type { OtlpTrace, ScenarioReport } from "../../types";
import {
  extractUsageFromOtlpTrace,
  buildHalResults,
  MODEL_PRICING_USD_PER_1M,
} from "../export-hal";

describe("Princeton HAL (hal-harness) Leaderboard Exporter (S3-INTOP-4)", () => {
  it("defines pricing for customer-facing Gemini models", () => {
    expect(MODEL_PRICING_USD_PER_1M["gemini-3.8-flash"]).toBeDefined();
    expect(MODEL_PRICING_USD_PER_1M["gemini-4-argon"]).toBeDefined();
    expect(MODEL_PRICING_USD_PER_1M["gemini-3.5-flash-lite"]).toBeDefined();
  });

  it("extracts token counts, dollar cost, and latency from OTLP GenAI spans", () => {
    const trace: OtlpTrace = {
      resourceSpans: [
        {
          resource: { attributes: [] },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "t1",
                  spanId: "s1",
                  name: "chat gemini-3.8-flash",
                  kind: 1,
                  startTimeUnixNano: "1000000000",
                  endTimeUnixNano: "2500000000",
                  attributes: [
                    { key: "gen_ai.usage.input_tokens", value: { intValue: 10000 } },
                    { key: "gen_ai.usage.output_tokens", value: { intValue: 2000 } },
                  ],
                },
                {
                  traceId: "t1",
                  spanId: "s2",
                  name: "chat gemini-3.8-flash",
                  kind: 1,
                  startTimeUnixNano: "2600000000",
                  endTimeUnixNano: "4000000000",
                  attributes: [
                    { key: "gen_ai.usage.input_tokens", value: { intValue: 5000 } },
                    { key: "gen_ai.usage.output_tokens", value: { intValue: 1000 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const usage = extractUsageFromOtlpTrace(trace, "gemini-3.8-flash");
    expect(usage.input_tokens).toBe(15000);
    expect(usage.output_tokens).toBe(3000);
    expect(usage.total_tokens).toBe(18000);
    expect(usage.llm_calls).toBe(2);
    expect(usage.latency_sec).toBeCloseTo(3.0, 2);
    expect(usage.cost_usd).toBeGreaterThan(0);
  });

  it("converts ScenarioReports into hal_results.json schema with Pareto metrics", () => {
    const reports: ScenarioReport[] = [
      {
        runId: "r1",
        timestamp: "2026-10-23T00:00:00.000Z",
        scenario: "01",
        caseId: "realistic-natural",
        seed: "realistic",
        overall: {
          score: 0.92,
          eoCompliant: true,
          apiCalls: 7,
          expectedRange: [5, 12],
        },
        trace: { score: 0.85, checks: [] },
        output: { score: 0.967, checks: [] },
        eoTraps: [],
      },
      {
        runId: "r2",
        timestamp: "2026-10-23T00:05:00.000Z",
        scenario: "08",
        caseId: "realistic-natural",
        seed: "realistic",
        overall: {
          score: 0,
          eoCompliant: false,
          apiCalls: 9,
          expectedRange: [6, 15],
        },
        trace: { score: 0.7, checks: [] },
        output: { score: 0.8, checks: [] },
        eoTraps: [{ id: 2, description: "TX state minimum", caught: false }],
      },
    ];

    const hal = buildHalResults({
      reports,
      modelName: "gemini-3.8-flash",
      agentName: "google-adk",
      usageByTaskId: {
        "01-realistic-natural": {
          input_tokens: 8000,
          output_tokens: 1500,
          cost_usd: 0.0021,
          latency_sec: 4.2,
        },
        "08-realistic-natural": {
          input_tokens: 12000,
          output_tokens: 2200,
          cost_usd: 0.00312,
          latency_sec: 6.8,
        },
      },
    });

    expect(hal.benchmark_name).toBe("evergreen_insurance_gym");
    expect(hal.model_name).toBe("gemini-3.8-flash");
    expect(hal.agent_name).toBe("google-adk");
    expect(hal.eo_compliance_rate).toBe(0.5);
    expect(hal.results.accuracy).toBe(0.5);
    expect(hal.results.successful_tasks).toEqual(["01-realistic-natural"]);
    expect(hal.results.eo_violated_tasks).toEqual(["08-realistic-natural"]);
    expect(hal.total_tokens.total_tokens).toBe(23700);
    expect(hal.total_cost_usd).toBeCloseTo(0.00522, 5);
    expect(hal.pareto_metrics.score_per_dollar).toBeGreaterThan(0);
    expect(hal.task_results["01-realistic-natural"].successful).toBe(true);
    expect(hal.task_results["08-realistic-natural"].eo_compliant).toBe(false);
  });
});
