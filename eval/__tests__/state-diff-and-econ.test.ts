import { describe, expect, test, mock } from "bun:test";
import {
  extractRowKey,
  fetchGymSnapshot,
  diffSnapshots,
  evaluateCollateralDamage,
  summarizeStateDiff,
} from "../evaluators/state-diff";
import {
  MODEL_PRICING_PER_1M,
  normalizeModelName,
  resolveModelPricing,
  calculateModelCost,
  computeTurnBudgetScore,
  computeParetoEfficiency,
  extractEconomicsMetrics,
} from "../evaluators/economics";
import { countCommTurns, evaluateTurnBudget, parseTrace } from "../evaluators/trace";
import { generateReport, formatMarkdown } from "../report";
import type { GymSnapshot, OtlpTrace } from "../types";

// ── S3-DIFF-1: State Diffing & Collateral Damage Tests ──────────────

describe("S3-DIFF-1: state-diff evaluator", () => {
  test("extractRowKey prioritizes child entity PKs over foreign keys", () => {
    // Endorsement has both endorsement_id and policy_id
    const endorsement = {
      endorsement_id: "END-001",
      policy_id: "POL-PA-2025-001848",
      change_type: "modify_coverage",
    };
    expect(extractRowKey(endorsement, "endorsements")).toBe("endorsement_id:END-001");

    // Claim has claim_id, policy_id, and client_id
    const claim = {
      claim_id: "CLM-100",
      policy_id: "POL-HO-2025-001",
      client_id: "CLI-007",
    };
    expect(extractRowKey(claim, "claims")).toBe("claim_id:CLM-100");

    // Fallback to canonical hash when no standard PK exists
    const anonRow = { b: 2, a: 1 };
    expect(extractRowKey(anonRow)).toBe('hash:{"a":1,"b":2}');
  });

  test("diffSnapshots detects inserted, updated, and deleted records across services", () => {
    const before: GymSnapshot = {
      ams: {
        clients: [
          { id: "CLI-001", first_name: "Sarah", phone: "310-555-0101", updated_at: "2026-01-01T00:00:00Z" },
          { id: "CLI-002", first_name: "James", phone: "310-555-0102", updated_at: "2026-01-01T00:00:00Z" },
          { id: "CLI-030", first_name: "Sara", phone: "310-555-0101", updated_at: "2026-01-01T00:00:00Z" },
        ],
        endorsements: [],
      },
      comm: {
        messages: [
          { message_id: "MSG-001", client_id: "CLI-001", direction: "inbound" },
        ],
      },
    };

    const after: GymSnapshot = {
      ams: {
        clients: [
          // CLI-001 only has updated_at changed -> should NOT be flagged as substantive update
          { id: "CLI-001", first_name: "Sarah", phone: "310-555-0101", updated_at: "2026-02-01T00:00:00Z" },
          // CLI-002 has phone updated -> substantive update
          { id: "CLI-002", first_name: "James", phone: "310-555-0199", updated_at: "2026-02-01T00:00:00Z" },
          // CLI-030 deleted -> deletion
        ],
        endorsements: [
          // New endorsement -> insertion
          {
            endorsement_id: "END-001",
            policy_id: "POL-PA-2025-001848",
            change_type: "modify_coverage",
          },
        ],
      },
      comm: {
        messages: [
          { message_id: "MSG-001", client_id: "CLI-001", direction: "inbound" },
          { message_id: "MSG-002", client_id: "CLI-002", direction: "outbound" },
        ],
      },
    };

    const diff = diffSnapshots(before, after);

    expect(diff.summary.insertedCount).toBe(2); // END-001 + MSG-002
    expect(diff.summary.updatedCount).toBe(1);  // CLI-002
    expect(diff.summary.deletedCount).toBe(1);  // CLI-030
    expect(diff.summary.totalMutations).toBe(4);

    expect(diff.services.ams.clients.updated).toHaveLength(1);
    expect(diff.services.ams.clients.updated[0].key).toBe("id:CLI-002");
    expect(diff.services.ams.clients.updated[0].changedFields).toContain("phone");
    expect(diff.services.ams.clients.deleted).toHaveLength(1);
    expect(diff.services.ams.clients.deleted[0].id).toBe("CLI-030");
    expect(diff.services.ams.endorsements.inserted).toHaveLength(1);
    expect(diff.services.comm.messages.inserted).toHaveLength(1);
  });

  test("fetchGymSnapshot sends X-Eval-Scorer header and unwraps /sim/snapshot tables", async () => {
    const fetchMock = mock((url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.["X-Eval-Scorer"]).toBe("true");
      const urlStr = String(url);
      if (urlStr.includes("3000/sim/snapshot")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              service: "ams",
              timestamp: "2026-10-23T00:00:00Z",
              simulated_time: "2026-10-23T00:00:00Z",
              tables: {
                clients: [{ id: "CLI-001", first_name: "Sarah" }],
              },
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ tables: {} }), { status: 200 }),
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const snap = await fetchGymSnapshot({
      ams: "http://localhost:3000",
      crm: "http://localhost:3002",
    });

    expect(snap.ams.clients).toHaveLength(1);
    expect(snap.ams.clients[0].id).toBe("CLI-001");
    expect(snap.crm).toEqual({});
  });

  test("evaluateCollateralDamage passes when all mutations match allowedClientIds and allowedPolicyIds", () => {
    const before: GymSnapshot = {
      ams: {
        clients: [
          { id: "CLI-001", phone: "310-555-0101" },
          { id: "CLI-002", phone: "310-555-0102" },
        ],
        endorsements: [],
      },
    };
    const after: GymSnapshot = {
      ams: {
        clients: [
          { id: "CLI-001", phone: "310-555-0101" },
          { id: "CLI-002", phone: "310-555-0199" },
        ],
        endorsements: [
          {
            endorsement_id: "END-001",
            policy_id: "POL-PA-2025-001848",
            change_type: "modify_coverage",
          },
        ],
      },
    };

    const diff = diffSnapshots(before, after);
    const collateral = evaluateCollateralDamage(diff, {
      allowedClientIds: ["CLI-002"],
      allowedPolicyIds: ["POL-PA-2025-001848"],
    });

    expect(collateral.collateralFree).toBe(true);
    expect(collateral.unauthorizedMutations).toBe(0);
    expect(collateral.collateralPenalty).toBe(0);
    expect(collateral.findings).toHaveLength(0);
  });

  test("evaluateCollateralDamage flags unauthorized client/policy edits, deletions, and excessive rows", () => {
    const before: GymSnapshot = {
      ams: {
        clients: [
          { id: "CLI-001", phone: "310-555-0101" },
          { id: "CLI-002", phone: "310-555-0102" },
          { id: "CLI-030", phone: "310-555-0101" },
        ],
        endorsements: [],
        tasks: [],
      },
    };
    const after: GymSnapshot = {
      ams: {
        clients: [
          // Wrong spouse edited!
          { id: "CLI-001", phone: "310-555-9999" },
          { id: "CLI-002", phone: "310-555-0199" },
          // CLI-030 hard deleted!
        ],
        endorsements: [
          // Wrong policy endorsed!
          {
            endorsement_id: "END-BAD",
            policy_id: "POL-PA-2025-001847",
            change_type: "modify_coverage",
          },
        ],
        tasks: [
          { id: "T-1", title: "junk 1" },
          { id: "T-2", title: "junk 2" },
          { id: "T-3", title: "junk 3" },
        ],
      },
    };

    const diff = diffSnapshots(before, after);
    const collateral = evaluateCollateralDamage(diff, {
      allowedClientIds: ["CLI-002"],
      allowedPolicyIds: ["POL-PA-2025-001848"],
      allowDeletions: false,
      maxInsertedPerTable: 2,
    });

    expect(collateral.collateralFree).toBe(false);
    // 1 unauthorized deletion (CLI-030) + 1 wrong client update (CLI-001) + 1 wrong policy insert (END-BAD) + 1 excess task insert = 4
    expect(collateral.unauthorizedMutations).toBe(4);
    expect(collateral.collateralPenalty).toBe(1);
    expect(collateral.findings.map((f) => f.type)).toEqual(
      expect.arrayContaining([
        "unauthorized_deletion",
        "unauthorized_client_mutation",
        "unauthorized_policy_mutation",
        "excessive_insertions",
      ]),
    );
  });
});

// ── S3-ECON-1 & S3-SIM-1: Economics & Turn-Budget Tests ─────────────

describe("S3-ECON-1 & S3-SIM-1: economics & turn-budget evaluator", () => {
  test("normalizeModelName strips internal suffixes (-qcd, -rc, -ga, -001) and prefixes", () => {
    expect(normalizeModelName("models/gemini-3.8-flash-001")).toBe("gemini-3.8-flash");
    expect(normalizeModelName("publishers/google/models/gemini-4-argon-rc")).toBe("gemini-4-argon");
    expect(normalizeModelName("gemini-3.8-flash-qcd")).toBe("gemini-3.8-flash");
    expect(normalizeModelName("gemini-3.5-flash-lite-ga")).toBe("gemini-3.5-flash-lite");
  });

  test("calculateModelCost computes accurate pricing for gemini-3.8-flash and gemini-4-argon", () => {
    expect(MODEL_PRICING_PER_1M["gemini-3.8-flash"]).toEqual({
      input: 0.15,
      output: 0.6,
    });
    expect(MODEL_PRICING_PER_1M["gemini-4-argon"]).toEqual({
      input: 1.25,
      output: 5.0,
    });

    // 1M input + 1M output on gemini-3.8-flash = $0.15 + $0.60 = $0.75
    expect(calculateModelCost("gemini-3.8-flash", 1_000_000, 1_000_000)).toBe(0.75);

    // 100k input + 20k output on gemini-4-argon-001 = 0.1 * 1.25 + 0.02 * 5.0 = 0.125 + 0.10 = $0.225
    expect(calculateModelCost("gemini-4-argon-001", 100_000, 20_000)).toBe(0.225);

    // Unknown model falls back to default pricing
    expect(resolveModelPricing("unknown-custom-model")).toEqual({
      input: 0.15,
      output: 0.6,
    });
  });

  test("computeTurnBudgetScore rewards within-budget turns and decays excessive turns", () => {
    expect(computeTurnBudgetScore(2, 5, 1)).toBe(1.0);
    expect(computeTurnBudgetScore(5, 5, 1)).toBe(1.0);
    // 1 turn over budget -> 0.8
    expect(computeTurnBudgetScore(6, 5, 1)).toBe(0.8);
    // 3 turns over budget -> 0.4
    expect(computeTurnBudgetScore(8, 5, 1)).toBe(0.4);
    // 6 turns over budget -> floored at 0
    expect(computeTurnBudgetScore(11, 5, 1)).toBe(0);
    // Below minTurns (0 turns when minTurns = 2) -> 0
    expect(computeTurnBudgetScore(0, 5, 2)).toBe(0);
    expect(computeTurnBudgetScore(1, 5, 2)).toBe(0.5);
  });

  test("extractEconomicsMetrics parses OTel GenAI tokens, models, latency, errors, retries, and turns", () => {
    const trace: OtlpTrace = {
      resourceSpans: [
        {
          resource: { attributes: [] },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "econ-1",
                  spanId: "llm-1",
                  name: "chat gemini-3.8-flash",
                  kind: 1,
                  startTimeUnixNano: "1700000000000000000",
                  endTimeUnixNano: "1700000000500000000",
                  attributes: [
                    { key: "gen_ai.operation.name", value: { stringValue: "chat" } },
                    { key: "gen_ai.request.model", value: { stringValue: "gemini-3.8-flash-001" } },
                    { key: "gen_ai.usage.input_tokens", value: { intValue: 100_000 } },
                    { key: "gen_ai.usage.output_tokens", value: { intValue: 10_000 } },
                  ],
                },
                {
                  traceId: "econ-1",
                  spanId: "llm-2",
                  name: "generate_content gemini-4-argon",
                  kind: 1,
                  startTimeUnixNano: "1700000000600000000",
                  endTimeUnixNano: "1700000001500000000",
                  attributes: [
                    { key: "gen_ai.operation.name", value: { stringValue: "generate_content" } },
                    { key: "gen_ai.response.model", value: { stringValue: "gemini-4-argon" } },
                    { key: "gen_ai.usage.prompt_tokens", value: { intValue: 40_000 } },
                    { key: "gen_ai.usage.completion_tokens", value: { intValue: 5_000 } },
                  ],
                },
                // HTTP 503 error followed by retry 200 on AMS
                {
                  traceId: "econ-1",
                  spanId: "http-1",
                  name: "GET",
                  kind: 3,
                  startTimeUnixNano: "1700000001600000000",
                  endTimeUnixNano: "1700000001700000000",
                  attributes: [
                    { key: "http.request.method", value: { stringValue: "GET" } },
                    { key: "url.full", value: { stringValue: "http://localhost:3000/v1/clients" } },
                    { key: "http.response.status_code", value: { intValue: 503 } },
                    { key: "server.port", value: { intValue: 3000 } },
                  ],
                },
                {
                  traceId: "econ-1",
                  spanId: "http-2",
                  name: "GET",
                  kind: 3,
                  startTimeUnixNano: "1700000001800000000",
                  endTimeUnixNano: "1700000001900000000",
                  attributes: [
                    { key: "http.request.method", value: { stringValue: "GET" } },
                    { key: "url.full", value: { stringValue: "http://localhost:3000/v1/clients" } },
                    { key: "http.response.status_code", value: { intValue: 200 } },
                    { key: "server.port", value: { intValue: 3000 } },
                  ],
                },
                // HTTP 422 validation error on AMS
                {
                  traceId: "econ-1",
                  spanId: "http-3",
                  name: "POST",
                  kind: 3,
                  startTimeUnixNano: "1700000002000000000",
                  endTimeUnixNano: "1700000002100000000",
                  attributes: [
                    { key: "http.request.method", value: { stringValue: "POST" } },
                    { key: "url.full", value: { stringValue: "http://localhost:3000/v1/policies/POL-1/endorsements" } },
                    { key: "http.response.status_code", value: { intValue: 422 } },
                    { key: "server.port", value: { intValue: 3000 } },
                  ],
                },
                // Outbound Comm Hub message (interactive turn)
                {
                  traceId: "econ-1",
                  spanId: "http-4",
                  name: "POST",
                  kind: 3,
                  startTimeUnixNano: "1700000002200000000",
                  endTimeUnixNano: "1700000002500000000",
                  attributes: [
                    { key: "http.request.method", value: { stringValue: "POST" } },
                    { key: "url.full", value: { stringValue: "http://localhost:3004/v1/messages/send" } },
                    { key: "http.response.status_code", value: { intValue: 201 } },
                    { key: "server.port", value: { intValue: 3004 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const apiCalls = parseTrace(trace);
    expect(countCommTurns(apiCalls)).toBe(1);
    expect(evaluateTurnBudget(apiCalls, 3, 1).passed).toBe(true);

    const econ = extractEconomicsMetrics(trace, apiCalls, {
      score: 0.9,
      maxTurns: 3,
      minTurns: 1,
    });

    expect(econ.inputTokens).toBe(140_000);
    expect(econ.outputTokens).toBe(15_000);
    expect(econ.totalTokens).toBe(155_000);
    expect(econ.llmCalls).toBe(2);
    expect(econ.toolCalls).toBe(4);
    expect(econ.wallClockMs).toBe(2500);
    expect(econ.errorCount4xx).toBe(1);
    expect(econ.errorCount5xx).toBe(1);
    expect(econ.retryRate).toBe(0.25); // 1 retry out of 4 HTTP calls
    // Cost:
    // Span 1 (gemini-3.8-flash): 0.1 * 0.15 + 0.01 * 0.60 = 0.015 + 0.006 = 0.021
    // Span 2 (gemini-4-argon):   0.04 * 1.25 + 0.005 * 5.0 = 0.05 + 0.025 = 0.075
    // Total = 0.096 USD
    expect(econ.estimatedCostUsd).toBe(0.096);
    expect(econ.turnCount).toBe(1);
    expect(econ.turnBudgetScore).toBe(1.0);
    expect(econ.paretoEfficiency).toBe(computeParetoEfficiency(0.9, 0.096));
    expect(econ.modelsUsed).toEqual(["gemini-3.8-flash", "gemini-4-argon"]);
  });

  test("generateReport and formatMarkdown include stateDiff and economics sections", () => {
    const diff = diffSnapshots(
      { ams: { clients: [{ id: "CLI-002", phone: "310-555-0102" }] } },
      { ams: { clients: [{ id: "CLI-002", phone: "310-555-0199" }] } },
    );
    const collateral = evaluateCollateralDamage(diff, {
      allowedClientIds: ["CLI-002"],
    });
    const stateDiffSummary = summarizeStateDiff(diff, collateral);

    const economics = {
      inputTokens: 50_000,
      outputTokens: 5_000,
      totalTokens: 55_000,
      llmCalls: 3,
      toolCalls: 6,
      wallClockMs: 1850,
      errorCount4xx: 0,
      errorCount5xx: 0,
      retryRate: 0,
      estimatedCostUsd: 0.0105,
      turnCount: 2,
      turnBudgetScore: 1.0,
      paretoEfficiency: 95.24,
      modelsUsed: ["gemini-3.8-flash"],
      modalityCounts: { rest: 4, mcp: 2, ui: 0 },
    };

    const report = generateReport({
      runId: "econ-diff-run",
      scenario: "16",
      caseId: "clean-natural",
      seed: "clean",
      traceScores: [{ name: "clarify_before_endorsement", passed: true, weight: 1 }],
      outputScores: [{ name: "james_endorsement_created", passed: true, weight: 1 }],
      eoTrapResults: [],
      apiCallCount: 6,
      expectedRange: [5, 18],
      stateDiff: stateDiffSummary,
      economics,
    });

    expect(report.overall.score).toBe(1);
    expect(report.stateDiff).toBeDefined();
    expect(report.stateDiff?.collateralFree).toBe(true);
    expect(report.economics).toBeDefined();
    expect(report.economics?.paretoEfficiency).toBe(95.24);

    const md = formatMarkdown(report);
    expect(md).toContain("## State Diff & Collateral Damage");
    expect(md).toContain("| Updated Rows | 1 |");
    expect(md).toContain("| Collateral Free | PASS |");
    expect(md).toContain("## Economics & Efficiency");
    expect(md).toContain("| Input Tokens | 50,000 |");
    expect(md).toContain("| Estimated Cost (USD) | $0.010500 |");
    expect(md).toContain("| Interactive Turns | 2 |");
    expect(md).toContain("| Models Used | gemini-3.8-flash |");
  });

  test("generateReport penalizes overall.score and formatMarkdown warns when collateralPenalty > 0", () => {
    const diff = diffSnapshots(
      {
        ams: {
          clients: [
            { id: "CLI-001", phone: "310-555-0101" },
            { id: "CLI-002", phone: "310-555-0102" },
          ],
        },
      },
      {
        ams: {
          clients: [
            // Unauthorized mutation on CLI-001 (1 unauthorized mutation -> 0.25 penalty)
            { id: "CLI-001", phone: "310-555-9999" },
            { id: "CLI-002", phone: "310-555-0199" },
          ],
        },
      },
    );
    const collateral = evaluateCollateralDamage(diff, {
      allowedClientIds: ["CLI-002"],
    });
    const stateDiffSummary = summarizeStateDiff(diff, collateral);

    expect(stateDiffSummary.collateralFree).toBe(false);
    expect(stateDiffSummary.unauthorizedMutations).toBe(1);
    expect(stateDiffSummary.collateralPenalty).toBe(0.25);

    const report = generateReport({
      runId: "collateral-penalty-run",
      scenario: "16",
      caseId: "clean-natural",
      seed: "clean",
      traceScores: [{ name: "clarify_before_endorsement", passed: true, weight: 1 }],
      outputScores: [{ name: "james_endorsement_created", passed: true, weight: 1 }],
      eoTrapResults: [],
      apiCallCount: 6,
      expectedRange: [5, 18],
      stateDiff: stateDiffSummary,
    });

    // Combined score is 1.0, minus 25% collateral penalty = 0.75
    expect(report.overall.score).toBe(0.75);

    const md = formatMarkdown(report);
    expect(md).toContain(
      "> **COLLATERAL DAMAGE PENALTY:** Overall score reduced by 25.0% due to 1 unauthorized state mutation(s).",
    );
  });
});
