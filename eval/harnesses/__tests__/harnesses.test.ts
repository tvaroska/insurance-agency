import { describe, it, expect } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  HARNESS_PROFILES,
  buildHarnessCommand,
  runMultiHarnessComparison,
} from "../runner";
import {
  buildLeaderboard,
  formatLeaderboardMarkdown,
} from "../leaderboard";

describe("Reference Multi-Harness Runner & Leaderboard (S3-HARN-1)", () => {
  it("defines all 5 harness profiles with customer-facing Gemini default models", () => {
    expect(Object.keys(HARNESS_PROFILES)).toEqual([
      "google-adk",
      "claude-code",
      "openhands",
      "langgraph",
      "inspect-ai",
    ]);

    expect(HARNESS_PROFILES["google-adk"].defaultModel).toBe("gemini-3.8-flash");
    expect(HARNESS_PROFILES["claude-code"].defaultModel).toBe("gemini-4-argon");
    expect(HARNESS_PROFILES["openhands"].defaultModel).toBe("gemini-4-argon");
    expect(HARNESS_PROFILES["langgraph"].defaultModel).toBe("gemini-3.8-flash");
    expect(HARNESS_PROFILES["inspect-ai"].defaultModel).toBe("gemini-3.8-flash");
  });

  it("builds valid execution commands for each harness adapter type", () => {
    const harborCmd = buildHarnessCommand({
      harness: "openhands",
      model: "gemini-4-argon",
      scenarioId: "08",
      seed: "realistic",
      difficulty: "natural",
    });
    expect(harborCmd.command.slice(0, 2)).toEqual(["harbor", "run"]);
    expect(harborCmd.command).toContain("08-realistic-natural");
    expect(harborCmd.env.GEMINI_MODEL).toBe("gemini-4-argon");

    const inspectCmd = buildHarnessCommand({
      harness: "inspect-ai",
      model: "gemini-3.8-flash",
      scenarioId: "16",
      seed: "realistic",
      difficulty: "natural",
      modalityMode: "strict",
    });
    expect(inspectCmd.command.slice(0, 3)).toEqual([
      "inspect",
      "eval",
      "eval/inspect/evergreen.py",
    ]);
    expect(inspectCmd.command).toContain("google/gemini-3.8-flash");
  });

  it("computes comparative leaderboard, Pareto optimality, and Markdown table across all 20 scenarios", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "leaderboard-test-"));
    try {
      const { leaderboard, markdown } = await runMultiHarnessComparison({
        outDir: tempDir,
      });

      expect(leaderboard.entries).toHaveLength(5);
      expect(leaderboard.entries[0].rank).toBe(1);
      expect(leaderboard.entries[0].scenarios_evaluated).toBe(20);
      expect(leaderboard.entries.some((e) => e.pareto_optimal)).toBe(true);

      expect(markdown).toContain(
        "| Rank | Harness | Model | Score | E&O Compliance % | Avg Cost ($) | Avg Tokens | Avg Latency (s) | Pareto Optimal |",
      );
      expect(markdown).toContain("`google-adk`");
      expect(markdown).toContain("`gemini-3.8-flash`");
      expect(markdown).toContain("`gemini-4-argon`");

      const savedJson = JSON.parse(
        await readFile(join(tempDir, "leaderboard.json"), "utf-8"),
      );
      expect(savedJson.entries).toHaveLength(5);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("correctly flags dominated entries as non-Pareto-optimal", () => {
    const lb = buildLeaderboard([
      {
        harness: "google-adk",
        model: "gemini-3.8-flash",
        reports: [
          {
            runId: "1",
            timestamp: "2026-10-23T00:00:00Z",
            scenario: "01",
            caseId: "realistic-natural",
            seed: "realistic",
            overall: {
              score: 0.95,
              eoCompliant: true,
              apiCalls: 6,
              expectedRange: [5, 12],
            },
            trace: { score: 0.95, checks: [] },
            output: { score: 0.95, checks: [] },
            eoTraps: [],
          },
        ],
        usageByTaskId: {
          "01-realistic-natural": {
            input_tokens: 4000,
            output_tokens: 1000,
            cost_usd: 0.0012,
            latency_sec: 3.1,
          },
        },
      },
      {
        harness: "claude-code",
        model: "gemini-4-argon",
        reports: [
          {
            runId: "2",
            timestamp: "2026-10-23T00:00:00Z",
            scenario: "01",
            caseId: "realistic-natural",
            seed: "realistic",
            overall: {
              score: 0.85,
              eoCompliant: true,
              apiCalls: 10,
              expectedRange: [5, 12],
            },
            trace: { score: 0.85, checks: [] },
            output: { score: 0.85, checks: [] },
            eoTraps: [],
          },
        ],
        usageByTaskId: {
          "01-realistic-natural": {
            input_tokens: 15000,
            output_tokens: 4000,
            cost_usd: 0.038,
            latency_sec: 9.5,
          },
        },
      },
    ]);

    expect(lb.entries[0].harness).toBe("google-adk");
    expect(lb.entries[0].pareto_optimal).toBe(true);
    expect(lb.entries[1].harness).toBe("claude-code");
    expect(lb.entries[1].pareto_optimal).toBe(false);

    const md = formatLeaderboardMarkdown(lb);
    expect(md).toContain("YES");
    expect(md).toContain("NO");
  });
});
