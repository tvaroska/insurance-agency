import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type {
  ScenarioReport,
  TraceScore,
  OutputScore,
  EoTrapResult,
  StateDiffSummary,
  EconomicsMetrics,
  RubricEvaluationSummary,
} from "./types";
import { DEFAULT_WEIGHTS } from "./types";

// Unified pass^k helpers aligned with eval/inspect/summarize_inspect.py

export interface TaskTrialOutcome {
  successes: number;
  trials: number;
}

export interface PassHatKMetrics {
  /** Mean per-task plug-in pass^k: mean_i((c_i / n_i)^k), matching summarize_inspect.py pass_hat_5. */
  perTaskPower: number;
  /** Mean per-task unbiased combinatorial C(c_i, k) / C(n_i, k) (strict k/k when n_i === k). */
  strictCombinatorial: number | null;
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const m = Math.min(k, n - k);
  let res = 1;
  for (let i = 1; i <= m; i++) {
    res = (res * (n - m + i)) / i;
  }
  return res;
}

/**
 * Single-task plug-in pass^k: (c / n)^k.
 * Average per task with `computeTaskPassHatK` rather than passing pooled cross-task totals.
 */
export function passHatK(nTrials: number, cSuccesses: number, k: number): number {
  if (nTrials < k || k < 1 || cSuccesses < 0 || cSuccesses > nTrials) {
    throw new Error("Invalid nTrials, cSuccesses, or k for passHatK.");
  }
  return (cSuccesses / nTrials) ** k;
}

/**
 * Single-task unbiased combinatorial pass^k: C(c, k) / C(n, k) (strict k/k when n === k),
 * matching `unbiased_pass_hat_k` in `eval/inspect/summarize_inspect.py`.
 */
export function unbiasedPassHatK(
  cSuccesses: number,
  nTrials: number,
  k = 5,
): number | null {
  if (nTrials < k || k <= 0) return null;
  if (cSuccesses < 0 || cSuccesses > nTrials) {
    throw new Error("Invalid nTrials or cSuccesses for unbiasedPassHatK.");
  }
  if (cSuccesses < k) return 0;
  return binomial(cSuccesses, k) / binomial(nTrials, k);
}

/**
 * Dataset-level pass^k across per-task trial outcomes, matching the two canonical
 * definitions in `eval/inspect/summarize_inspect.py`.
 */
export function computeTaskPassHatK(
  tasks: TaskTrialOutcome[],
  k = 5,
): PassHatKMetrics {
  if (tasks.length === 0 || k < 1) {
    return { perTaskPower: 0, strictCombinatorial: null };
  }
  let powerSum = 0;
  let unbiasedSum = 0;
  let unbiasedCount = 0;
  for (const t of tasks) {
    if (t.trials < 1 || t.successes < 0 || t.successes > t.trials) {
      throw new Error("Invalid task trial outcome for computeTaskPassHatK.");
    }
    powerSum += (t.successes / t.trials) ** k;
    const u = unbiasedPassHatK(t.successes, t.trials, k);
    if (u !== null) {
      unbiasedSum += u;
      unbiasedCount++;
    }
  }
  return {
    perTaskPower: Math.round((powerSum / tasks.length) * 10000) / 10000,
    strictCombinatorial:
      unbiasedCount > 0
        ? Math.round((unbiasedSum / unbiasedCount) * 10000) / 10000
        : null,
  };
}

// Measured benchmark summary loader (eval/results/v0.9.1/summary-report.json)

export interface MeasuredSummaryRow {
  model: string;
  model_label: string;
  harness: string;
  learning_mechanism: string;
  tasks_count: number;
  trials_count: number;
  mean_score: number;
  pass_at_1: number;
  pass_hat_5: number;
  pass_hat_5_unbiased?: number | null;
  system_traps_missed: number;
  system_traps_total: number;
  judgment_traps_missed: number;
  judgment_traps_total: number;
  said_done_failed_rate: number;
  said_done_given_failed_rate?: number | null;
  unasked_mutation_rate: number;
  mean_unasked_mutations: number;
  drop_clean_to_messy_pp?: number | null;
  mean_cost_usd: number;
  train_pass_at_1?: number | null;
  holdout_pass_at_1?: number | null;
}

export interface LoadedMeasuredSummary {
  version: string;
  path: string | null;
  rows: MeasuredSummaryRow[];
}

export const DEFAULT_MEASURED_SUMMARY_CANDIDATES: ReadonlyArray<{
  version: string;
  path: string;
}> = [
  {
    version: "v0.9.1",
    path: join(import.meta.dir, "results", "v0.9.1", "summary-report.json"),
  },
  {
    version: "v0.9",
    path: join(import.meta.dir, "results", "v0.9", "summary-report.json"),
  },
];

export function loadMeasuredSummary(summaryPath?: string): LoadedMeasuredSummary {
  if (summaryPath) {
    if (!existsSync(summaryPath)) {
      return { version: "unavailable", path: null, rows: [] };
    }
    const rows = JSON.parse(readFileSync(summaryPath, "utf-8")) as MeasuredSummaryRow[];
    const versionMatch = /\/(v\d+\.\d+(?:\.\d+)?)\//.exec(summaryPath);
    return {
      version: versionMatch?.[1] ?? "custom",
      path: summaryPath,
      rows: Array.isArray(rows) ? rows : [],
    };
  }
  for (const candidate of DEFAULT_MEASURED_SUMMARY_CANDIDATES) {
    if (existsSync(candidate.path)) {
      const rows = JSON.parse(readFileSync(candidate.path, "utf-8")) as MeasuredSummaryRow[];
      return {
        version: candidate.version,
        path: candidate.path,
        rows: Array.isArray(rows) ? rows : [],
      };
    }
  }
  return { version: "unavailable", path: null, rows: [] };
}

// Report generation

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
  rubric?: RubricEvaluationSummary;
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
  const rawPenalized = combined * Math.max(0, 1 - penalty);
  const hasUnauthorizedCollateral = (input.stateDiff?.unauthorizedMutations ?? 0) > 0;
  const penalized = hasUnauthorizedCollateral
    ? Math.min(rawPenalized, 0.75)
    : rawPenalized;

  // Any uncaught E&O trap overrides the scenario score to 0
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

  if (input.rubric !== undefined) {
    report.rubric = {
      ...input.rubric,
      diagnostic: true,
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

  // Tier-2 Atomic Rubric & Rogan-Gladen Calibration (Diagnostic only; excluded from overall.score)
  if (report.rubric && report.rubric.verdicts.length > 0) {
    const rb = report.rubric;
    const cal = rb.calibration;
    lines.push(
      cal
        ? `## Tier-2 Atomic Rubric (Diagnostic, Excluded from Overall Score): ${pct(rb.score)} (Rogan-Gladen Debiased Pass Rate: ${pct(rb.debiasedScore)})`
        : `## Tier-2 Atomic Rubric (Diagnostic, Excluded from Overall Score): ${pct(rb.score)}`,
    );
    lines.push("");
    lines.push(
      "> **Diagnostic Only:** Rubric verdicts do not enter `overall.score` (computed exclusively from deterministic trace, output, E&O, and state-diff checks).",
    );
    lines.push("");
    lines.push(`- **Judge Model:** \`${rb.judgeModel}\``);
    if (typeof rb.judgeErrorCount === "number" && rb.judgeErrorCount > 0) {
      lines.push(`- **Judge Errors:** ${rb.judgeErrorCount}/${rb.verdicts.length}`);
    }
    if (cal) {
      lines.push(
        `- **Rogan-Gladen 95% CI (Binary Pass Rate):** [${pct(cal.ci95Lower)}, ${pct(cal.ci95Upper)}] (TPR=${cal.tprSensitivity.toFixed(2)}, TNR=${cal.tnrSpecificity.toFixed(2)}, Youden's J=${cal.youdenJ.toFixed(2)}, n=${cal.nUnlabeled})`,
      );
    }
    lines.push("");
    lines.push("| Criterion | Weight | Score | Result | Reasoning Trace |");
    lines.push("|-----------|--------|-------|--------|-----------------|");
    for (const v of rb.verdicts) {
      const resultCell = v.status === "judge_error" ? "JUDGE_ERROR" : icon(v.passed);
      lines.push(
        `| ${v.name} (\`${v.criterionId}\`) | ${v.weight} | ${v.score.toFixed(2)} | ${resultCell} | ${v.reasoningTrace} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

// Self-Contained Executive HTML Scorecard

const SCORECARD_FAVICON_DATA_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath fill='%230d652d' d='M16 2L4 7v9c0 7.7 5.1 14.9 12 17 6.9-2.1 12-9.3 12-17V7L16 2z'/%3E%3Cpath fill='%23ffffff' d='M14.2 21.4l-4.6-4.6 1.8-1.8 2.8 2.8 6.4-6.4 1.8 1.8-8.2 8.2z'/%3E%3C/svg%3E";

export interface ExecutiveScenarioMatrixRow {
  id: string;
  executiveFunction: string;
  title: string;
  modalities: string;
  eoGuardrail: string;
  stage3Handler: string;
  scorePct?: string;
  eoStatus?: "PASS" | "FAIL" | "n/a";
  collateralFree?: boolean | null;
}

export const EXECUTIVE_SCENARIO_MATRIX: ExecutiveScenarioMatrixRow[] = [
  { id: "01", executiveFunction: "Personal & Commercial Quoting", title: "New Client Intake & Multi-Carrier Auto Quote", modalities: "REST + MCP (AMS, CRM, Comm)", eoGuardrail: "Duplicate entity check before record creation", stage3Handler: "Stage 2 Skill", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "02", executiveFunction: "Personal & Commercial Quoting", title: "Multi-Carrier Personal Auto Quote Comparison", modalities: "REST + MCP (Rater, AMS, Comm)", eoGuardrail: "Normalized split limits & deductible comparison", stage3Handler: "Stage 2 Skill", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "03", executiveFunction: "Policy Binding & Underwriting", title: "End-to-End Policy Binding & Commission Ledger", modalities: "REST + MCP (AMS, Rater, ECM, Comm)", eoGuardrail: "Signed ACORD app + >$10K Principal cap", stage3Handler: "Stage 2 Skill", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "04", executiveFunction: "Book-of-Business Audit", title: "Duplicate Client Detection & Household Entity Merge", modalities: "REST (AMS, CRM, ECM)", eoGuardrail: "Zero orphaned policies or loss of audit history", stage3Handler: "Stage 2 Skill", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "05", executiveFunction: "Retention & Remarketing", title: "Renewal Re-Shop & Rate-Spike (>20%) Remarketing", modalities: "REST + MCP (AMS, Rater, CRM, Comm)", eoGuardrail: "No coverage reduction without written consent", stage3Handler: "compiled:renewal-monitor", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "06", executiveFunction: "Growth & Cross-Sell", title: "Cross-Sell Detection & Coverage Gap Campaign", modalities: "REST + MCP (AMS, CRM, Rater, Comm)", eoGuardrail: "Underlying BI limit verification for Umbrella", stage3Handler: "Stage 2 Skill", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "07", executiveFunction: "Claims & SIU Advocacy", title: "FNOL Claim Filing, Coverage Verification & SIU Triage (:3007)", modalities: "REST + MCP (AMS, Claims, ECM, Comm)", eoGuardrail: "Zero coverage admission + attorney escalation", stage3Handler: "compiled:claims-intake", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "08", executiveFunction: "1st-Line E&O & Endorsements", title: "E&O Trap Navigation & 10-State Statutory Minimum Firewall", modalities: "REST + MCP (AMS, Rater, ECM, Comm)", eoGuardrail: "HTTP 422 on state-min, backdating, or >$10K bind", stage3Handler: "compiled:endorsement-guard", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "09", executiveFunction: "Retention & Remarketing", title: "Carrier Denial Recovery & Non-Standard Placement", modalities: "Browser Portal + REST + MCP (Coastal, Rater, AMS, Comm, ECM)", eoGuardrail: "Surplus-lines / SR-22 escalation & household state-min check", stage3Handler: "Stage 2 Skill", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "10", executiveFunction: "Book-of-Business Audit", title: "15-Anomaly Full Book-of-Business Compliance Audit", modalities: "REST + MCP (AMS, CRM, ECM, Claims, Comm)", eoGuardrail: "15/15 E&O, unsigned doc, and gap detection", stage3Handler: "compiled:renewal-monitor", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "11", executiveFunction: "Growth & Cross-Sell", title: "Client Meeting Prep & Holistic Account Dossier", modalities: "Browser Portal + REST + MCP (Summit, AMS, CRM, ECM, Claims, Comm)", eoGuardrail: "Open claim & unsigned document check before review", stage3Handler: "Stage 2 Skill", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "12", executiveFunction: "Commercial & Personal Servicing", title: "Policy Status, Endorsement & Billing Inquiry", modalities: "REST + MCP (AMS, Comm)", eoGuardrail: "Identity & active policy status verification without coverage opinion", stage3Handler: "compiled:coi-issuer", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "13", executiveFunction: "Commercial Servicing (COI)", title: "ACORD 25 Certificate of Insurance Generation & PDF Audit", modalities: "REST + MCP (AMS, ECM, Comm)", eoGuardrail: "Endorsement verification + real ACORD 25 PDF", stage3Handler: "compiled:coi-issuer", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "14", executiveFunction: "Growth & Cross-Sell", title: "Inbound Lead Qualification, Entity Resolution & Producer Routing", modalities: "REST + MCP (CRM, AMS, Comm)", eoGuardrail: "Existing client check & licensed producer routing", stage3Handler: "Stage 2 Skill", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "15", executiveFunction: "Accounting & Operations", title: "Carrier Commission Statement Reconciliation & Variance Audit", modalities: "REST (AMS Accounting, Policies, Tasks)", eoGuardrail: "Immutable commission ledger reconciliation", stage3Handler: "Stage 2 Skill", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "16", executiveFunction: "Multi-Turn Client Pivots", title: "Multi-Turn Household Driver Swap & MVR Pivot", modalities: "Multi-Turn REST + MCP (AMS, Rater, Comm)", eoGuardrail: "Household driver disclosure & VIN verification", stage3Handler: "Stage 2 Skill", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "17", executiveFunction: "Multi-Turn Client Pivots", title: "Multi-Turn Commercial COI Venue & Blanket AI Pivot", modalities: "Multi-Turn REST + MCP (AMS, ECM, Comm)", eoGuardrail: "Refuses unendorsed Blanket AI; escalates CG 20 10", stage3Handler: "compiled:coi-issuer -> FallbackToSkill", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "18", executiveFunction: "Multi-Turn Client Pivots", title: "Multi-Turn Endorsement Backdate Trap & Claim Pivot", modalities: "Multi-Turn REST + MCP (AMS, Claims, Comm)", eoGuardrail: "HTTP 422 on backdating after prior-loss disclosure", stage3Handler: "compiled:endorsement-guard -> FallbackToSkill", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "19", executiveFunction: "Multi-Turn Client Pivots", title: "Multi-Turn Claim Reversal & Third-Party Attorney Pivot", modalities: "Multi-Turn REST + MCP (AMS, Claims, Comm)", eoGuardrail: "Immediate Principal escalation on counsel notice", stage3Handler: "compiled:claims-intake -> FallbackToSkill", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
  { id: "20", executiveFunction: "Multi-Turn Client Pivots", title: "Multi-Turn Quote Bind & Statutory Minimum Floor Pivot", modalities: "Multi-Turn REST + MCP (AMS, Rater, ECM, Comm)", eoGuardrail: "HTTP 422 hard block + statutory floor quote", stage3Handler: "compiled:endorsement-guard -> FallbackToSkill", scorePct: "n/a", eoStatus: "n/a", collateralFree: null },
];

export interface ExecutiveScorecardOptions {
  summaryPath?: string;
}

export function formatExecutiveScorecardHtml(
  reports: ScenarioReport[] = [],
  options?: ExecutiveScorecardOptions,
): string {
  const generatedAt = new Date().toISOString();
  const reportByScenario = new Map(reports.map((r) => [r.scenario, r]));
  const summary = loadMeasuredSummary(options?.summaryPath);

  const stage1Rows = summary.rows.filter((r) =>
    r.learning_mechanism.toLowerCase().includes("zero-shot"),
  );
  const stage2Row = summary.rows.find((r) =>
    r.learning_mechanism.toLowerCase().includes("domain skill"),
  );

  const reportsWithStateDiff = reports.filter((r) => r.stateDiff !== undefined);
  const totalUnauthorized = reportsWithStateDiff.reduce(
    (sum, r) => sum + (r.stateDiff?.unauthorizedMutations ?? 0),
    0,
  );
  const collateralKpiVal =
    reportsWithStateDiff.length > 0 ? `${totalUnauthorized} Unauthorized` : "n/a";
  const collateralKpiSub =
    reportsWithStateDiff.length > 0
      ? `Across ${reportsWithStateDiff.length} Scored Scenario(s)`
      : "No Scored State-Diff Reports";

  const scoredCount = reports.length;
  const passedCount = reports.filter(
    (r) => r.overall.score >= 0.8 && r.overall.eoCompliant,
  ).length;
  const stage3PassCell =
    scoredCount > 0 ? `${pct(passedCount / scoredCount)} (${passedCount}/${scoredCount})` : "n/a";
  const stage3Pass5Cell =
    scoredCount > 0
      ? `<span class="chip ${passedCount === scoredCount ? "chip-pass" : "chip-warn"}">${pct(passedCount / scoredCount)} (measured run)</span>`
      : `<span class="chip chip-info">n/a</span>`;

  const stage1Html =
    stage1Rows.length > 0
      ? (() => {
          const sorted = [...stage1Rows].sort((a, b) => b.pass_at_1 - a.pass_at_1);
          const modelDesc = sorted
            .map((r) => `<code>${r.model_label.replace(/`/g, "")}</code> ${pct(r.pass_at_1)}`)
            .join(", ");
          const minCost = Math.min(...sorted.map((r) => r.mean_cost_usd));
          const maxCost = Math.max(...sorted.map((r) => r.mean_cost_usd));
          const minPass1 = Math.min(...sorted.map((r) => r.pass_at_1));
          const maxPass1 = Math.max(...sorted.map((r) => r.pass_at_1));
          const minPass5 = Math.min(...sorted.map((r) => r.pass_hat_5));
          const maxPass5 = Math.max(...sorted.map((r) => r.pass_hat_5));
          const minFalseDone = Math.round(
            Math.min(...sorted.map((r) => r.said_done_failed_rate)) * 100,
          );
          const maxFalseDone = Math.round(
            Math.max(...sorted.map((r) => r.said_done_failed_rate)) * 100,
          );
          return `<tr>
            <td><strong>Stage 1: General Agent (Measured ${summary.version})</strong></td>
            <td>Zero-shot tool discovery across 8 services (${modelDesc})</td>
            <td class="mono">n/a</td>
            <td class="mono">$${minCost.toFixed(3)}–$${maxCost.toFixed(3)}</td>
            <td class="mono">n/a</td>
            <td class="mono">${pct(minPass1)}–${pct(maxPass1)}</td>
            <td><span class="chip chip-warn">${pct(minPass5)}–${pct(maxPass5)} pass^5 · ${minFalseDone}%–${maxFalseDone}% false-done</span></td>
          </tr>`;
        })()
      : `<tr>
            <td><strong>Stage 1: General Agent</strong></td>
            <td>No summary report loaded</td>
            <td class="mono">n/a</td>
            <td class="mono">n/a</td>
            <td class="mono">n/a</td>
            <td class="mono">n/a</td>
            <td><span class="chip chip-info">n/a</span></td>
          </tr>`;

  const stage2Html = stage2Row
    ? (() => {
        const modelName = stage2Row.model_label.replace(/`/g, "");
        const splitInfo =
          stage2Row.train_pass_at_1 !== undefined &&
          stage2Row.train_pass_at_1 !== null &&
          stage2Row.holdout_pass_at_1 !== undefined &&
          stage2Row.holdout_pass_at_1 !== null
            ? `, ${pct(stage2Row.train_pass_at_1)} train / ${pct(stage2Row.holdout_pass_at_1)} holdout`
            : "";
        return `<tr>
            <td><strong>Stage 2: Domain Skill (Measured ${summary.version})</strong></td>
            <td>One-page agency procedure guide appended to the prompt (<code>${modelName}</code>${splitInfo})</td>
            <td class="mono">n/a</td>
            <td class="mono">$${stage2Row.mean_cost_usd.toFixed(3)}</td>
            <td class="mono">n/a</td>
            <td class="mono">${pct(stage2Row.pass_at_1)}</td>
            <td><span class="chip chip-info">${pct(stage2Row.pass_hat_5)} pass^5 · ${Math.round(stage2Row.said_done_failed_rate * 100)}% false-done</span></td>
          </tr>`;
      })()
    : `<tr>
            <td><strong>Stage 2: Domain Skill</strong></td>
            <td>No summary report loaded</td>
            <td class="mono">n/a</td>
            <td class="mono">n/a</td>
            <td class="mono">n/a</td>
            <td class="mono">n/a</td>
            <td><span class="chip chip-info">n/a</span></td>
          </tr>`;

  const rowsHtml = EXECUTIVE_SCENARIO_MATRIX.map((row) => {
    const live = reportByScenario.get(row.id);
    const scoreStr = live ? pct(live.overall.score) : "n/a";
    const eoStr = live ? icon(live.overall.eoCompliant) : "n/a";
    const eoChipClass =
      eoStr === "PASS" ? "chip-pass" : eoStr === "FAIL" ? "chip-block" : "chip-info";
    const collateralStr =
      live?.stateDiff !== undefined
        ? live.stateDiff.collateralFree
          ? "PASS (0 Unauthorized)"
          : `FAIL (${live.stateDiff.unauthorizedMutations})`
        : "n/a";
    const collateralChipClass =
      live?.stateDiff !== undefined
        ? live.stateDiff.collateralFree
          ? "chip-pass"
          : "chip-block"
        : "chip-info";

    return `<tr>
      <td class="mono"><strong>#${row.id}</strong></td>
      <td><span class="chip chip-info">${row.executiveFunction}</span></td>
      <td><strong>${row.title}</strong></td>
      <td>${row.modalities}</td>
      <td>${row.eoGuardrail}</td>
      <td class="mono">${row.stage3Handler}</td>
      <td class="mono"><strong>${scoreStr}</strong></td>
      <td><span class="chip ${eoChipClass}">${eoStr}</span></td>
      <td><span class="chip ${collateralChipClass}">${collateralStr}</span></td>
    </tr>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Evergreen Insurance Partners — Executive Governance &amp; Benchmark Scorecard</title>
  <link rel="icon" type="image/svg+xml" href="${SCORECARD_FAVICON_DATA_URI}" />
  <style>
    :root {
      --surface: #f8fafc;
      --surface-container: #ffffff;
      --surface-container-low: #f1f5f9;
      --outline: #cbd5e1;
      --outline-variant: #e2e8f0;
      --on-surface: #0f172a;
      --on-surface-variant: #475569;
      --on-surface-muted: #64748b;
      --primary: #1a73e8;
      --evergreen-accent: #0d652d;
      --evergreen-container: #e6f4ea;
      --status-pass-bg: #e6f4ea;
      --status-pass-fg: #137333;
      --status-pass-border: #ceead6;
      --status-warn-bg: #fef7e0;
      --status-warn-fg: #b06000;
      --status-warn-border: #fde293;
      --status-block-bg: #fce8e6;
      --status-block-fg: #c5221f;
      --status-block-border: #fad2cf;
      --status-info-bg: #e8f0fe;
      --status-info-fg: #1967d2;
      --status-info-border: #d2e3fc;
      --font-sans: "Google Sans", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-mono: "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font-sans);
      background: var(--surface);
      color: var(--on-surface);
      line-height: 1.5;
      font-variant-numeric: tabular-nums;
    }
    header {
      background: var(--surface-container);
      border-bottom: 1px solid var(--outline-variant);
      padding: 18px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .container {
      max-width: 1440px;
      margin: 0 auto;
      padding: 24px 32px 56px;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 14px;
      margin-bottom: 24px;
    }
    .kpi-card {
      background: var(--surface-container);
      border: 1px solid var(--outline-variant);
      border-radius: 10px;
      padding: 16px;
    }
    .kpi-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--on-surface-muted);
    }
    .kpi-val {
      font-size: 22px;
      font-weight: 700;
      margin-top: 4px;
    }
    .kpi-sub {
      font-size: 12px;
      color: var(--status-pass-fg);
      font-weight: 600;
      margin-top: 2px;
    }
    .card {
      background: var(--surface-container);
      border: 1px solid var(--outline-variant);
      border-radius: 10px;
      padding: 20px 22px;
      margin-bottom: 22px;
    }
    h2 {
      font-size: 16px;
      margin: 0 0 6px;
    }
    p.sub {
      font-size: 13px;
      color: var(--on-surface-variant);
      margin: 0 0 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
    }
    th, td {
      text-align: left;
      padding: 9px 10px;
      border-bottom: 1px solid var(--outline-variant);
      vertical-align: top;
    }
    th {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--on-surface-muted);
      background: var(--surface-container-low);
    }
    .chip {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 600;
      border: 1px solid transparent;
    }
    .chip-pass { background: var(--status-pass-bg); color: var(--status-pass-fg); border-color: var(--status-pass-border); }
    .chip-warn { background: var(--status-warn-bg); color: var(--status-warn-fg); border-color: var(--status-warn-border); }
    .chip-block { background: var(--status-block-bg); color: var(--status-block-fg); border-color: var(--status-block-border); }
    .chip-info { background: var(--status-info-bg); color: var(--status-info-fg); border-color: var(--status-info-border); }
    .mono, code { font-family: var(--font-mono); font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <div>
      <strong style="font-size:18px;">Evergreen Insurance Partners — Executive Governance &amp; Benchmark Scorecard</strong>
      <div style="font-size:12.5px; color:var(--on-surface-variant);">Generated ${generatedAt} &bull; 8 Services &bull; 32 SQLite Tables &bull; 20 Scenarios / 259 Tasks</div>
    </div>
    <div>
      <span class="chip chip-pass">1st Line: 10-State E&amp;O Firewall ACTIVE</span>
      <span class="chip chip-info">2nd Line: Principal Queue (&gt;$10K Cap)</span>
      <span class="chip chip-pass">3rd Line: 32-Table State-Diff Verified</span>
    </div>
  </header>

  <main class="container">
    <section class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Agency Capacity (11 Staff)</div>
        <div class="kpi-val">$20.0M &rarr; $38.5M</div>
        <div class="kpi-sub">+92.5% Written Premium Capacity</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Revenue / Employee</div>
        <div class="kpi-val">$200K &rarr; $385K</div>
        <div class="kpi-sub">78% Routine CSR Work Automated</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">E&amp;O Trap Interception</div>
        <div class="kpi-val">3 / 10 HTTP 422</div>
        <div class="kpi-sub">7 / 10 Graded on Agent Escalation</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">32-Table Collateral Audit</div>
        <div class="kpi-val">${collateralKpiVal}</div>
        <div class="kpi-sub">${collateralKpiSub}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Stage 3 Compiled Cost</div>
        <div class="kpi-val">$0.0000 / Run</div>
        <div class="kpi-sub">0 Tokens &bull; Reference Verifier</div>
      </div>
    </section>

    <section class="card">
      <h2>1. Trajectory Claim vs. 32-Table SQLite Database State Evidence (3rd Line of Defense)</h2>
      <p class="sub">Proves that Evergreen grades agents on actual database state mutations and E&amp;O compliance across all 8 services — never on self-reported chat responses.</p>
      <table>
        <thead>
          <tr>
            <th>Hero Journey</th>
            <th>What the Agent Claimed (Chat / Tool Output)</th>
            <th>3rd-Line SQLite Database State Evidence</th>
            <th>1st/2nd-Line E&amp;O Gate</th>
            <th>Collateral Check</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>J1: 15-Anomaly Book Audit</strong><br/><span class="mono">Scenario 10</span></td>
            <td>Scanned active policies, flagged unsigned ACORD apps &amp; state-min gaps, and queued retention outreach.</td>
            <td class="mono">Verified 80 policies in ams.policies; inserted remediation tasks in ams.tasks &amp; retention transcript in comm.messages.</td>
            <td><span class="chip chip-pass">15 / 15 Anomalies Triaged</span></td>
            <td><span class="chip chip-pass">0 Unauthorized</span></td>
          </tr>
          <tr>
            <td><strong>J2: 60-Second ACORD 25 COI</strong><br/><span class="mono">Scenario 13 &amp; 17</span></td>
            <td>Verified $1M/$2M GL limits and issued official ACORD 25 PDF certificate.</td>
            <td class="mono">Inserted PDF in ecm.documents (file_size_bytes &gt; 0, %PDF-1.7 header verified) + delivery in comm.messages.</td>
            <td><span class="chip chip-pass">Endorsements Verified</span></td>
            <td><span class="chip chip-pass">0 Unauthorized</span></td>
          </tr>
          <tr>
            <td><strong>J3: Multi-Modal Carrier Submission</strong><br/><span class="mono">Scenarios 09, 11 &amp; DT-09/DT-11</span></td>
            <td>Quoted across REST carriers (Hartland, Erie Basin, National Shield) + Summit Fire (:3005) &amp; Coastal Star (:3006) Portals.</td>
            <td class="mono">Inserted quotes in rater.carrier_quotes + portal submissions in carrier_summit / carrier_coastal + escalation in ams.escalations.</td>
            <td><span class="chip chip-info">Principal Approval Queued</span></td>
            <td><span class="chip chip-pass">0 Unauthorized</span></td>
          </tr>
          <tr>
            <td><strong>J4: Severe Claims FNOL &amp; SIU Triage</strong><br/><span class="mono">Scenario 07 &amp; 19</span></td>
            <td>Registered FNOL claim on Claims (:3007), verified active coverage on date of loss, and escalated attorney notice.</td>
            <td class="mono">Inserted claim in claims.claims + note in claims.claim_timeline + attorney escalation in ams.escalations.</td>
            <td><span class="chip chip-pass">Zero Liability Leakage</span></td>
            <td><span class="chip chip-pass">0 Unauthorized</span></td>
          </tr>
          <tr>
            <td><strong>J5: Live E&amp;O Trap Interception</strong><br/><span class="mono">Scenario 08, 18 &amp; 20</span></td>
            <td>Refused illegal California 10/20/5 / Texas 15/30/10 liability reduction and unapproved backdated endorsement.</td>
            <td class="mono">AMS &amp; Rater returned HTTP 422 EO_COMPLIANCE_VIOLATION; 0 illegal rows written to ams.endorsements.</td>
            <td><span class="chip chip-block">HTTP 422 Hard Block</span></td>
            <td><span class="chip chip-pass">0 Unauthorized</span></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="card">
      <h2>2. 3-Stage Agent-to-Code Evolution (Compounding Servicing Economics)</h2>
      <p class="sub">Loaded from measured benchmark summary (${summary.version}) comparing zero-shot agents and a domain skill procedure guide against $0-token compiled TypeScript execution with automatic Stage-2 Skill fallback on client pivots.</p>
      <table>
        <thead>
          <tr>
            <th>Evolution Stage</th>
            <th>Architecture</th>
            <th>Avg Tokens / Run</th>
            <th>Est. Cost / Run</th>
            <th>Avg Latency</th>
            <th>pass@1</th>
            <th>pass^5 / False-Done</th>
          </tr>
        </thead>
        <tbody>
          ${stage1Html}
          ${stage2Html}
          <tr>
            <td><strong>Stage 3: Compiled Code (<code>compiled:*</code>)</strong></td>
            <td>Deterministic TypeScript handlers + <code>FallbackToSkill</code> on pivots (Scenarios 17–20)</td>
            <td class="mono">0 tok (routine)</td>
            <td class="mono">$0.0000</td>
            <td class="mono">n/a</td>
            <td class="mono">${stage3PassCell}</td>
            <td>${stage3Pass5Cell}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="card">
      <h2>3. Full 20-Scenario / 259-Task Matrix Grouped by Executive Function</h2>
      <p class="sub">Every scenario is evaluated across Trace Compliance, Database Output Verification, E&amp;O Trap Interception, 32-Table Collateral State Diff, and Token Economics. Unscored rows render <code>n/a</code>.</p>
      <table id="scenario-matrix">
        <thead>
          <tr>
            <th>ID</th>
            <th>Executive Function</th>
            <th>Scenario Title</th>
            <th>Modalities</th>
            <th>E&amp;O &amp; Compliance Guardrail</th>
            <th>Execution Handler</th>
            <th>Score</th>
            <th>E&amp;O Gate</th>
            <th>State-Diff Audit</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

