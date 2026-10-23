/**
 * Multi-Harness Comparative Leaderboard & Pareto Frontier Aggregator (`eval/harnesses/leaderboard.ts`).
 *
 * Aggregates `ScenarioReport` runs across multiple agent harnesses (`google-adk`, `claude-code`,
 * `openhands`, `langgraph`, `inspect-ai`) and foundation models (`gemini-3.8-flash`,
 * `gemini-4-argon`, `gemini-3.5-flash-lite`), computing Pareto optimality across
 * Score, E&O Compliance %, and Average Dollar Cost ($).
 */

import type { ScenarioReport } from "../types";
import {
  buildHalResults,
  type HalUploadPayload,
  type TaskTelemetryUsage,
} from "../hal/export-hal";

export type HarnessId =
  | "google-adk"
  | "claude-code"
  | "openhands"
  | "langgraph"
  | "inspect-ai";

export interface HarnessRunInput {
  harness: HarnessId | string;
  model: string;
  reports: ScenarioReport[];
  usageByTaskId?: Record<string, Partial<TaskTelemetryUsage>>;
  passThreshold?: number;
}

export interface LeaderboardEntry {
  rank: number;
  harness: string;
  model: string;
  scenarios_evaluated: number;
  mean_score: number;
  trace_score: number;
  output_score: number;
  eo_compliance_rate: number;
  pass_rate: number;
  avg_cost_usd: number;
  total_cost_usd: number;
  avg_tokens: number;
  avg_latency_sec: number;
  pareto_optimal: boolean;
  hal_payload: HalUploadPayload;
}

export interface ComparativeLeaderboard {
  benchmark: "evergreen_insurance_gym";
  version: "0.4.0";
  generated_at: string;
  entries: LeaderboardEntry[];
}

/**
 * Marks entries as `pareto_optimal = true` when no other entry dominates them
 * on `(mean_score, eo_compliance_rate, -avg_cost_usd)`.
 */
export function computeParetoFrontier(
  entries: Omit<LeaderboardEntry, "rank" | "pareto_optimal">[],
): boolean[] {
  return entries.map((candidate, i) => {
    for (let j = 0; j < entries.length; j++) {
      if (i === j) continue;
      const other = entries[j];
      const atLeastAsGood =
        other.mean_score >= candidate.mean_score &&
        other.eo_compliance_rate >= candidate.eo_compliance_rate &&
        other.avg_cost_usd <= candidate.avg_cost_usd;
      const strictlyBetter =
        other.mean_score > candidate.mean_score ||
        other.eo_compliance_rate > candidate.eo_compliance_rate ||
        other.avg_cost_usd < candidate.avg_cost_usd;

      if (atLeastAsGood && strictlyBetter) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Builds a sorted comparative leaderboard from multiple harness + model evaluation runs.
 */
export function buildLeaderboard(
  runs: HarnessRunInput[],
): ComparativeLeaderboard {
  const rawEntries: Omit<LeaderboardEntry, "rank" | "pareto_optimal">[] =
    runs.map((run) => {
      const hal = buildHalResults({
        reports: run.reports,
        modelName: run.model,
        agentName: run.harness,
        passThreshold: run.passThreshold,
        usageByTaskId: run.usageByTaskId,
      });

      const n = Math.max(1, run.reports.length);
      const meanTrace =
        Math.round(
          (run.reports.reduce((acc, r) => acc + r.trace.score, 0) / n) * 1000,
        ) / 1000;
      const meanOutput =
        Math.round(
          (run.reports.reduce((acc, r) => acc + r.output.score, 0) / n) * 1000,
        ) / 1000;
      const avgTokens = Math.round(hal.total_tokens.total_tokens / n);

      return {
        harness: run.harness,
        model: run.model,
        scenarios_evaluated: run.reports.length,
        mean_score: hal.results.mean_score,
        trace_score: meanTrace,
        output_score: meanOutput,
        eo_compliance_rate: hal.eo_compliance_rate,
        pass_rate: hal.results.accuracy,
        avg_cost_usd: hal.pareto_metrics.mean_cost_usd,
        total_cost_usd: hal.total_cost_usd,
        avg_tokens: avgTokens,
        avg_latency_sec: hal.latencies.mean_sec,
        hal_payload: hal,
      };
    });

  // Sort by mean_score DESC, eo_compliance_rate DESC, avg_cost_usd ASC
  rawEntries.sort((a, b) => {
    if (b.mean_score !== a.mean_score) return b.mean_score - a.mean_score;
    if (b.eo_compliance_rate !== a.eo_compliance_rate) {
      return b.eo_compliance_rate - a.eo_compliance_rate;
    }
    return a.avg_cost_usd - b.avg_cost_usd;
  });

  const paretoFlags = computeParetoFrontier(rawEntries);

  const entries: LeaderboardEntry[] = rawEntries.map((item, idx) => ({
    rank: idx + 1,
    ...item,
    pareto_optimal: paretoFlags[idx],
  }));

  return {
    benchmark: "evergreen_insurance_gym",
    version: "0.4.0",
    generated_at: new Date().toISOString(),
    entries,
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Formats a `ComparativeLeaderboard` into a Markdown report table.
 */
export function formatLeaderboardMarkdown(
  leaderboard: ComparativeLeaderboard,
): string {
  const lines: string[] = [];

  lines.push("# Evergreen Insurance API Gym — Multi-Harness Leaderboard");
  lines.push("");
  lines.push(`- **Benchmark:** \`${leaderboard.benchmark}\` (\`v${leaderboard.version}\`)`);
  lines.push(`- **Generated:** ${leaderboard.generated_at}`);
  lines.push("");
  lines.push("## Comparative Harness & Model Results");
  lines.push("");
  lines.push(
    "| Rank | Harness | Model | Score | E&O Compliance % | Avg Cost ($) | Avg Tokens | Avg Latency (s) | Pareto Optimal |",
  );
  lines.push(
    "| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |",
  );

  for (const e of leaderboard.entries) {
    lines.push(
      `| ${e.rank} | \`${e.harness}\` | \`${e.model}\` | **${pct(e.mean_score)}** | ${pct(e.eo_compliance_rate)} | \`$${e.avg_cost_usd.toFixed(4)}\` | ${e.avg_tokens.toLocaleString("en-US")} | ${e.avg_latency_sec.toFixed(2)}s | ${e.pareto_optimal ? "YES" : "NO"} |`,
    );
  }

  lines.push("");
  lines.push("## Pareto Frontier Summary");
  lines.push("");
  const paretoEntries = leaderboard.entries.filter((e) => e.pareto_optimal);
  for (const p of paretoEntries) {
    lines.push(
      `- **\`${p.harness}\` + \`${p.model}\`**: Score ${pct(p.mean_score)} (Trace ${pct(p.trace_score)} / Output ${pct(p.output_score)}), E&O Compliance ${pct(p.eo_compliance_rate)}, Avg Cost \`$${p.avg_cost_usd.toFixed(4)}\`/task`,
    );
  }
  lines.push("");

  return lines.join("\n");
}
