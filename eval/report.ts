import type {
  ScenarioReport,
  TraceScore,
  OutputScore,
  EoTrapResult,
} from "./types";
import { DEFAULT_WEIGHTS } from "./types";

// ── Report generation ───────────────────────────────────────────────

export interface ReportInput {
  runId: string;
  scenario: string;
  caseId: string;
  seed: "clean" | "realistic";
  traceScores: TraceScore[];
  outputScores: OutputScore[];
  eoTrapResults: EoTrapResult[];
  apiCallCount: number;
  expectedRange: [number, number];
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

  // E&O override: any uncaught trap caps score at 0
  const overall = eoCompliant ? combined : 0;

  return {
    runId: input.runId,
    timestamp: new Date().toISOString(),
    scenario: input.scenario,
    caseId: input.caseId,
    seed: input.seed,
    overall: {
      score: Math.round(overall * 1000) / 1000,
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

  return lines.join("\n");
}
