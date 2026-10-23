import type {
  ScenarioReport,
  TraceScore,
  OutputScore,
  EoTrapResult,
  StateDiffSummary,
  EconomicsMetrics,
} from "./types";
import { DEFAULT_WEIGHTS } from "./types";

// ── Report generation ───────────────────────────────────────────────

export interface ReportInput {
  runId: string;
  scenario: string;
  caseId: string;
  seed: "clean" | "realistic" | string;
  traceScores: TraceScore[];
  outputScores: OutputScore[];
  eoTrapResults: EoTrapResult[];
  apiCallCount: number;
  expectedRange: [number, number];
  stateDiff?: StateDiffSummary;
  economics?: EconomicsMetrics;
}

function weightedScore(checks: { passed: boolean; weight: number }[]): number {
  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight === 0) return 1;
  const earned = checks.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0);
  return earned / totalWeight;
}

export function generateReport(input: ReportInput): ScenarioReport {
  const traceScore = weightedScore(input.traceScores);
  const outputScore = weightedScore(input.outputScores);

  const eoCompliant = input.eoTrapResults.every((t) => t.caught);

  const combined =
    traceScore * DEFAULT_WEIGHTS.trace + outputScore * DEFAULT_WEIGHTS.output;

  const penalty = input.stateDiff?.collateralPenalty ?? 0;
  const penalized = combined * Math.max(0, 1 - penalty);

  // E&O override: any uncaught trap caps score at 0
  const overall = eoCompliant ? penalized : 0;
  const roundedOverall = Math.round(overall * 1000) / 1000;

  const report: ScenarioReport = {
    runId: input.runId,
    timestamp: new Date().toISOString(),
    scenario: input.scenario,
    caseId: input.caseId,
    seed: input.seed,
    overall: {
      score: roundedOverall,
      eoCompliant,
      apiCalls: input.apiCallCount,
      expectedRange: input.expectedRange,
    },
    trace: {
      score: Math.round(traceScore * 1000) / 1000,
      checks: input.traceScores,
    },
    output: {
      score: Math.round(outputScore * 1000) / 1000,
      checks: input.outputScores,
    },
    eoTraps: input.eoTrapResults,
  };

  if (input.stateDiff !== undefined) {
    report.stateDiff = input.stateDiff;
  }

  if (input.economics !== undefined) {
    const paretoEfficiency =
      Math.round(
        (roundedOverall / Math.max(input.economics.estimatedCostUsd, 0.0001)) *
          100,
      ) / 100;
    report.economics = {
      ...input.economics,
      paretoEfficiency,
    };
  }

  return report;
}

// ── Markdown formatting ─────────────────────────────────────────────

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function icon(passed: boolean): string {
  return passed ? "PASS" : "FAIL";
}

export function formatMarkdown(report: ScenarioReport): string {
  const lines: string[] = [];

  lines.push(`# Scenario ${report.scenario} — Evaluation Report`);
  lines.push("");
  lines.push(`- **Run ID:** ${report.runId}`);
  lines.push(`- **Case:** ${report.caseId}`);
  lines.push(`- **Seed:** ${report.seed}`);
  lines.push(`- **Timestamp:** ${report.timestamp}`);
  lines.push("");

  // Overall
  lines.push("## Overall");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Score | **${pct(report.overall.score)}** |`);
  lines.push(`| E&O Compliant | ${icon(report.overall.eoCompliant)} |`);
  lines.push(
    `| API Calls | ${report.overall.apiCalls} (expected ${report.overall.expectedRange[0]}-${report.overall.expectedRange[1]}) |`,
  );
  lines.push("");

  // Trace dimension
  lines.push(`## Trace Score: ${pct(report.trace.score)}`);
  lines.push("");
  if (report.trace.checks.length > 0) {
    lines.push(`| Check | Weight | Result | Detail |`);
    lines.push(`|-------|--------|--------|--------|`);
    for (const c of report.trace.checks) {
      lines.push(
        `| ${c.name} | ${c.weight} | ${icon(c.passed)} | ${c.detail ?? ""} |`,
      );
    }
  } else {
    lines.push("No trace checks defined.");
  }
  lines.push("");

  // Output dimension
  lines.push(`## Output Score: ${pct(report.output.score)}`);
  lines.push("");
  if (report.output.checks.length > 0) {
    lines.push(`| Check | Weight | Result | Detail |`);
    lines.push(`|-------|--------|--------|--------|`);
    for (const c of report.output.checks) {
      lines.push(
        `| ${c.name} | ${c.weight} | ${icon(c.passed)} | ${c.detail ?? ""} |`,
      );
    }
  } else {
    lines.push("No output checks defined.");
  }
  lines.push("");

  // E&O traps
  if (report.eoTraps.length > 0) {
    lines.push("## E&O Traps");
    lines.push("");
    lines.push(`| # | Description | Result |`);
    lines.push(`|---|-------------|--------|`);
    for (const t of report.eoTraps) {
      lines.push(`| ${t.id} | ${t.description} | ${icon(t.caught)} |`);
    }
    lines.push("");
  }

  if (!report.overall.eoCompliant) {
    lines.push(
      "> **E&O OVERRIDE:** Score capped at 0% due to uncaught E&O trap(s).",
    );
    lines.push("");
  }

  // State Diff & Collateral Damage (S3-DIFF-1)
  if (report.stateDiff) {
    const sd = report.stateDiff;
    lines.push("## State Diff & Collateral Damage");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|--------|-------|");
    lines.push(`| Inserted Rows | ${sd.insertedCount} |`);
    lines.push(`| Updated Rows | ${sd.updatedCount} |`);
    lines.push(`| Deleted Rows | ${sd.deletedCount} |`);
    lines.push(`| Total Mutations | ${sd.totalMutations} |`);
    lines.push(`| Collateral Free | ${icon(sd.collateralFree)} |`);
    lines.push(`| Unauthorized Mutations | ${sd.unauthorizedMutations} |`);
    lines.push(`| Collateral Penalty | ${pct(sd.collateralPenalty)} |`);
    lines.push("");

    if (sd.findings.length > 0) {
      lines.push("| Service | Table | Type | Detail |");
      lines.push("|---------|-------|------|--------|");
      for (const f of sd.findings) {
        lines.push(`| ${f.service} | ${f.table} | ${f.type} | ${f.detail} |`);
      }
      lines.push("");
    }

    if (!sd.collateralFree) {
      lines.push(
        `> **COLLATERAL DAMAGE PENALTY:** Overall score reduced by ${pct(sd.collateralPenalty)} due to ${sd.unauthorizedMutations} unauthorized state mutation(s).`,
      );
      lines.push("");
    }
  }

  // Economics & Efficiency (S3-ECON-1)
  if (report.economics) {
    const ec = report.economics;
    lines.push("## Economics & Efficiency");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|--------|-------|");
    lines.push(`| Input Tokens | ${ec.inputTokens.toLocaleString("en-US")} |`);
    lines.push(`| Output Tokens | ${ec.outputTokens.toLocaleString("en-US")} |`);
    lines.push(`| Total Tokens | ${ec.totalTokens.toLocaleString("en-US")} |`);
    lines.push(`| LLM Calls | ${ec.llmCalls} |`);
    lines.push(`| Tool Calls | ${ec.toolCalls} |`);
    lines.push(`| Wall-Clock Latency | ${ec.wallClockMs} ms |`);
    lines.push(`| HTTP 4xx / 5xx Errors | ${ec.errorCount4xx} / ${ec.errorCount5xx} |`);
    lines.push(`| Retry Rate | ${pct(ec.retryRate)} |`);
    lines.push(`| Estimated Cost (USD) | $${ec.estimatedCostUsd.toFixed(6)} |`);
    lines.push(`| Interactive Turns | ${ec.turnCount} |`);
    lines.push(`| Turn Budget Score | ${pct(ec.turnBudgetScore)} |`);
    lines.push(`| Pareto Efficiency (Score/$) | ${ec.paretoEfficiency.toFixed(2)} |`);
    if (ec.modelsUsed && ec.modelsUsed.length > 0) {
      lines.push(`| Models Used | ${ec.modelsUsed.join(", ")} |`);
    }
    if (ec.modalityCounts) {
      lines.push(
        `| Modality Split (REST / MCP / UI) | ${ec.modalityCounts.rest} / ${ec.modalityCounts.mcp} / ${ec.modalityCounts.ui} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
