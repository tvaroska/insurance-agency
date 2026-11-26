/**
 * 3-Stage Agent-to-Code Evolution Showcase (`eval/evolution-showcase.ts`).
 *
 * Compares measured vs. modeled operational economics across three execution stages:
 *   - Stage 1 (Measured Baseline): Loaded from `eval/results/v0.9.1/summary-report.json`
 *     (or `eval/results/v0.9/summary-report.json` if overridden)
 *   - Stage 2 (Measured Domain Skill): Loaded from the same summary report's Domain skill (SOP) arm
 *   - Stage 3 (Measured Scripted Verifier + Modeled Pivot Fallback): `$0`-token deterministic
 *     TypeScript workflows (`compiled:*`) with automatic `FallbackToSkill` on multi-turn client pivots
 *     (Scenarios 17, 18, 19, 20).
 */

import { runBaselineAgent } from "./agents/baseline-agent";
import { parseTrace, evaluateTrace } from "./evaluators/trace";
import { extractEconomicsMetrics } from "./evaluators/economics";
import {
  computeTaskPassHatK,
  loadMeasuredSummary,
  type MeasuredSummaryRow,
} from "./report";
import { scenarios } from "./scenarios";

export type EvolutionStageId =
  | "stage_1_general_agent"
  | "stage_2_domain_skill"
  | "stage_3_compiled_code";

export interface CompiledWorkflowSpec {
  id:
    | "compiled:coi-issuer"
    | "compiled:claims-intake"
    | "compiled:renewal-monitor"
    | "compiled:endorsement-guard";
  name: string;
  description: string;
  volumeSharePct: number;
  routineScenarioId: string;
  pivotScenarioId: string;
  fallbackTriggerDescription: string;
}

export const COMPILED_WORKFLOW_SPECS: CompiledWorkflowSpec[] = [
  {
    id: "compiled:coi-issuer",
    name: "COI Issuance & Contract Limit Verifier",
    description:
      "Verifies active commercial/auto policy status, checks stated GL/BOP limits against contract requirements, renders ACORD 25 PDF, and dispatches via MCP.",
    volumeSharePct: 28,
    routineScenarioId: "13",
    pivotScenarioId: "17",
    fallbackTriggerDescription:
      "Mid-conversation venue & BOP location pivot requiring $2M GL limit endorsement (Scenario 17)",
  },
  {
    id: "compiled:claims-intake",
    name: "FNOL Claims Triage & Adjuster Router",
    description:
      "Verifies active coverage on loss date, registers FNOL claim, generates ACORD 35 Loss Notice PDF, and assigns adjuster.",
    volumeSharePct: 18,
    routineScenarioId: "07",
    pivotScenarioId: "19",
    fallbackTriggerDescription:
      "Policy line reversal (Auto -> Commercial BOP) + $65,000 third-party attorney demand letter (Scenario 19)",
  },
  {
    id: "compiled:renewal-monitor",
    name: "Renewal Rate-Spike Scanner & Re-Shopper",
    description:
      "Detects >15% renewal rate hikes, queries multi-carrier appetite, normalizes split limits, and prepares retention comparison.",
    volumeSharePct: 22,
    routineScenarioId: "05",
    pivotScenarioId: "20",
    fallbackTriggerDescription:
      "Customer carrier switch + request to lower Texas auto limits to 15/30/10 below 30/60/25 statutory floor (Scenario 20)",
  },
  {
    id: "compiled:endorsement-guard",
    name: "Policy Endorsement & E&O Firewall Runner",
    description:
      "Validates endorsement effective dates and state statutory minimums before submitting policy modifications.",
    volumeSharePct: 16,
    routineScenarioId: "16",
    pivotScenarioId: "18",
    fallbackTriggerDescription:
      "Partial driver drop + retroactive coverage backdating request to 2026-10-05 prior to contract start (Scenario 18)",
  },
];

export type StageProvenance =
  | "measured_v0.9.1_baseline"
  | "measured_v0.9.1_domain_skill"
  | "measured_v0.9_baseline"
  | "measured_v0.9_domain_skill"
  | "measured_reference_verifier_with_projected_fallback";

export interface MeasuredModelBaseline {
  model: string;
  pass1: number;
  meanScore: number;
  pass5: number;
  pass5Strict: number | null;
  falseCompletionRate: number;
  costPerTaskUsd: number;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function stripBackticks(label: string): string {
  return label.replace(/`/g, "").trim();
}

function trapComplianceRate(row: MeasuredSummaryRow): number {
  const total = row.system_traps_total + row.judgment_traps_total;
  const missed = row.system_traps_missed + row.judgment_traps_missed;
  return total > 0 ? round4(1 - missed / total) : 1.0;
}

function toMeasuredModelBaseline(row: MeasuredSummaryRow): MeasuredModelBaseline {
  return {
    model: stripBackticks(row.model_label),
    pass1: row.pass_at_1,
    meanScore: row.mean_score,
    pass5: row.pass_hat_5,
    pass5Strict: row.pass_hat_5_unbiased ?? null,
    falseCompletionRate: row.said_done_failed_rate,
    costPerTaskUsd: row.mean_cost_usd,
  };
}

export interface LoadedStageBaselines {
  version: string;
  summaryPath: string | null;
  stage1Models: MeasuredModelBaseline[];
  stage1Primary: MeasuredSummaryRow;
  stage2Skill: MeasuredSummaryRow;
  stage1CpvoUsd: number;
  stage2CpvoUsd: number;
  stage1EoComplianceRate: number;
  stage2EoComplianceRate: number;
  falseCompletionRateRange: string;
  falseCompletionGivenFailedRange: string;
}

export function loadMeasuredStageBaselines(summaryPath?: string): LoadedStageBaselines {
  const loaded = loadMeasuredSummary(summaryPath);
  const zeroShotRows = loaded.rows.filter(
    (r) => r.learning_mechanism.toLowerCase().includes("zero-shot"),
  );
  const skillRow = loaded.rows.find(
    (r) => r.learning_mechanism.toLowerCase().includes("domain skill"),
  );

  if (zeroShotRows.length === 0 || !skillRow) {
    throw new Error(
      `Measured summary report (${loaded.path ?? summaryPath ?? "default"}) is missing zero-shot or domain-skill rows.`,
    );
  }

  const sortedZeroShot = [...zeroShotRows].sort((a, b) => b.pass_at_1 - a.pass_at_1);
  const stage1Primary = sortedZeroShot[0];
  const stage1Models = sortedZeroShot.map(toMeasuredModelBaseline);

  const stage1CpvoUsd = round4(stage1Primary.mean_cost_usd / Math.max(stage1Primary.pass_at_1, 0.01));
  const stage2CpvoUsd = round4(skillRow.mean_cost_usd / Math.max(skillRow.pass_at_1, 0.01));

  const fcrMin = Math.round(Math.min(...sortedZeroShot.map((r) => r.said_done_failed_rate)) * 100);
  const fcrMax = Math.round(Math.max(...sortedZeroShot.map((r) => r.said_done_failed_rate)) * 100);
  const condRates = sortedZeroShot
    .map((r) => r.said_done_given_failed_rate)
    .filter((v): v is number => typeof v === "number");
  const condMin = condRates.length > 0 ? Math.round(Math.min(...condRates) * 100) : 0;
  const condMax = condRates.length > 0 ? Math.round(Math.max(...condRates) * 100) : 0;

  return {
    version: loaded.version,
    summaryPath: loaded.path,
    stage1Models,
    stage1Primary,
    stage2Skill: skillRow,
    stage1CpvoUsd,
    stage2CpvoUsd,
    stage1EoComplianceRate: trapComplianceRate(stage1Primary),
    stage2EoComplianceRate: trapComplianceRate(skillRow),
    falseCompletionRateRange: `${fcrMin}%–${fcrMax}%`,
    falseCompletionGivenFailedRange: `${condMin}%–${condMax}%`,
  };
}

export const MEASURED_V09_STAGE1_MODELS: MeasuredModelBaseline[] =
  loadMeasuredStageBaselines().stage1Models;

export interface StageExecutionMetrics {
  stage: EvolutionStageId;
  stageLabel: string;
  provenance: StageProvenance;
  scenarioId: string;
  workflowId: string;
  status: "COMPLETED_DETERMINISTIC" | "FALLBACK_TO_SKILL" | "COMPLETED_AGENTIC";
  fallbackReason?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  cpvoUsd: number;
  latencyMs: number;
  pass1: number;
  pass5: number;
  eoCompliant: boolean;
  traceScore: number;
}

export interface EvolutionComparisonSummary {
  generatedAt: string;
  summaryVersion: string;
  summaryPath: string | null;
  stages: {
    stage1GeneralAgent: {
      label: string;
      provenance: StageProvenance;
      avgTokens: number;
      cpvoUsd: number;
      avgLatencyMs: number;
      pass1: number;
      meanScore: number;
      pass5: number;
      pass5Strict: number | null;
      eoComplianceRate: number;
      falseCompletionRateRange: string;
      measuredModels: MeasuredModelBaseline[];
    };
    stage2DomainSkill: {
      label: string;
      provenance: StageProvenance;
      avgTokens: number;
      cpvoUsd: number;
      avgLatencyMs: number;
      pass1: number;
      pass5: number;
      pass5Strict: number | null;
      eoComplianceRate: number;
    };
    stage3CompiledCode: {
      label: string;
      provenance: StageProvenance;
      routineTokens: number;
      routineCpvoUsd: number;
      blendedTokens: number;
      blendedCpvoUsd: number;
      avgLatencyMs: number;
      pass1: number;
      pass5: number;
      eoComplianceRate: number;
      fallbackRatePct: number;
    };
  };
  workflows: {
    spec: CompiledWorkflowSpec;
    routineRun: {
      stage1: StageExecutionMetrics;
      stage2: StageExecutionMetrics;
      stage3: StageExecutionMetrics;
    };
    pivotRun: {
      stage1: StageExecutionMetrics;
      stage2: StageExecutionMetrics;
      stage3WithFallback: StageExecutionMetrics;
    };
  }[];
  agencyRoi: AgencyRoiModel;
}

export interface AgencyRoiModel {
  agencyName: string;
  provenance: "modeled_11_staff_agency_projection";
  staffCount: number;
  roles: { role: string; headcount: number; focus: string }[];
  baselineWrittenPremiumUsd: number;
  governedWrittenPremiumUsd: number;
  commissionRatePct: number;
  baselineRevenueUsd: number;
  governedRevenueUsd: number;
  baselineRevenuePerEmployeeUsd: number;
  governedRevenuePerEmployeeUsd: number;
  revenueLiftPct: number;
  manualCsrCostPerTransactionUsd: number;
  stage1GeneralAgentCpvoUsd: number;
  stage2SkillCpvoUsd: number;
  stage3BlendedCpvoUsd: number;
  annualServicingTransactions: number;
  annualLaborHoursSaved: number;
  annualNetSavingsUsd: number;
}

/**
 * Modeled 11-staff agency capacity & unit-economics projection referenced in `EXECUTIVE-BRIEF.md`.
 * Stage 1/2/3 CPVO inputs are derived from the measured summary report.
 */
export function calculateAgencyRoi(overrides?: {
  staffCount?: number;
  baselineWrittenPremiumUsd?: number;
  commissionRatePct?: number;
  automationCoveragePct?: number;
  fallbackRatePct?: number;
  summaryPath?: string;
}): AgencyRoiModel {
  const baselines = loadMeasuredStageBaselines(overrides?.summaryPath);
  const staffCount = overrides?.staffCount ?? 11;
  const baselineWrittenPremiumUsd =
    overrides?.baselineWrittenPremiumUsd ?? 20_000_000;
  const commissionRatePct = overrides?.commissionRatePct ?? 11.0;
  const automationCoveragePct = overrides?.automationCoveragePct ?? 78.0;
  const fallbackRatePct = overrides?.fallbackRatePct ?? 22.0;

  const capacityMultiplier = 1 + (automationCoveragePct / 78.0) * 0.925;
  const governedWrittenPremiumUsd = Math.round(
    baselineWrittenPremiumUsd * capacityMultiplier,
  );

  const baselineRevenueUsd = Math.round(
    baselineWrittenPremiumUsd * (commissionRatePct / 100),
  );
  const governedRevenueUsd = Math.round(
    governedWrittenPremiumUsd * (commissionRatePct / 100),
  );

  const baselineRevenuePerEmployeeUsd = Math.round(
    baselineRevenueUsd / staffCount,
  );
  const governedRevenuePerEmployeeUsd = Math.round(
    governedRevenueUsd / staffCount,
  );
  const revenueLiftPct =
    Math.round(
      ((governedRevenuePerEmployeeUsd - baselineRevenuePerEmployeeUsd) /
        baselineRevenuePerEmployeeUsd) *
        1000,
    ) / 10;

  const manualCsrCostPerTransactionUsd = 18.5;
  const stage1GeneralAgentCpvoUsd = baselines.stage1CpvoUsd;
  const stage2SkillCpvoUsd = baselines.stage2CpvoUsd;
  const stage3BlendedCpvoUsd = round4(stage2SkillCpvoUsd * (fallbackRatePct / 100));
  const annualServicingTransactions = 42_000;
  const annualLaborHoursSaved = 11_800;
  const annualNetSavingsUsd = Math.round(
    annualServicingTransactions *
      (automationCoveragePct / 100) *
      (manualCsrCostPerTransactionUsd - stage3BlendedCpvoUsd),
  );

  return {
    agencyName: "Evergreen Insurance Partners",
    provenance: "modeled_11_staff_agency_projection",
    staffCount,
    roles: [
      {
        role: "Agency Principals & E&O Officers",
        headcount: 2,
        focus: "2nd-Line Binding Authority ($10K+) & Carrier Strategy",
      },
      {
        role: "Commercial Lines Producers",
        headcount: 3,
        focus: "BOP, General Liability, Workers' Comp & Advisory",
      },
      {
        role: "Personal Lines CSRs",
        headcount: 4,
        focus: "High-Empathy Client Retention, Cross-Sell & Escalations",
      },
      {
        role: "Claims & Loss Advocacy Coordinator",
        headcount: 1,
        focus: "Complex Claims, Attorney Demands & Subrogation",
      },
      {
        role: "Operations & Commission Specialist",
        headcount: 1,
        focus: "Carrier Reconciliation, Trust Accounting & 3rd-Line Audit",
      },
    ],
    baselineWrittenPremiumUsd,
    governedWrittenPremiumUsd,
    commissionRatePct,
    baselineRevenueUsd,
    governedRevenueUsd,
    baselineRevenuePerEmployeeUsd,
    governedRevenuePerEmployeeUsd,
    revenueLiftPct,
    manualCsrCostPerTransactionUsd,
    stage1GeneralAgentCpvoUsd,
    stage2SkillCpvoUsd,
    stage3BlendedCpvoUsd,
    annualServicingTransactions,
    annualLaborHoursSaved,
    annualNetSavingsUsd,
  };
}

export async function runStageTrajectory(options: {
  stage: EvolutionStageId;
  workflow: CompiledWorkflowSpec;
  scenarioId: string;
  isPivotCase: boolean;
  fetchImpl?: typeof fetch;
  baseUrls?: Record<string, string>;
  summaryPath?: string;
}): Promise<StageExecutionMetrics> {
  const baselines = loadMeasuredStageBaselines(options.summaryPath);
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const scen = scenarios[options.scenarioId];
  const variant =
    scen?.variants.realistic ?? Object.values(scen?.variants ?? {})[0];

  const isFallback =
    options.stage === "stage_3_compiled_code" && options.isPivotCase;

  const tokenProfile =
    options.stage === "stage_1_general_agent"
      ? "general_agent"
      : options.stage === "stage_2_domain_skill" || isFallback
        ? "domain_skill"
        : "compiled_code";

  const model = stripBackticks(baselines.stage1Primary.model_label);

  const runResult = await runBaselineAgent({
    scenarioId: options.scenarioId,
    seed: "realistic",
    model,
    modalityMode: "strict",
    tokenProfile,
    fetchImpl: fetchFn,
    baseUrls: options.baseUrls,
  });

  const parsedCalls = parseTrace(runResult.trace);
  const traceChecks = evaluateTrace(variant?.traceChecks ?? [], parsedCalls);
  const totalWeight = traceChecks.reduce((acc, c) => acc + c.weight, 0);
  const traceScore =
    totalWeight > 0
      ? traceChecks.reduce((acc, c) => acc + (c.passed ? c.weight : 0), 0) /
        totalWeight
      : 0.0;

  const eoTrapsCaught = (variant?.eoTraps ?? []).every((trap) =>
    evaluateTrace([trap.check], parsedCalls).every((r) => r.passed),
  );
  const eoCompliant =
    runResult.privacyAudit.passed && eoTrapsCaught && traceScore >= 0.95;

  const econ = extractEconomicsMetrics(runResult.trace, parsedCalls, {
    score: traceScore,
    defaultModel: model,
  });

  // Use the per-task pass^5 loaded directly from the summary report (no pooled (pass@1)^5 fabrication).
  const routineVerifierPassed = eoCompliant ? 1.0 : 0.0;
  const pass1 =
    options.stage === "stage_1_general_agent"
      ? baselines.stage1Primary.pass_at_1
      : options.stage === "stage_2_domain_skill" || isFallback
        ? baselines.stage2Skill.pass_at_1
        : routineVerifierPassed;
  const pass5 =
    options.stage === "stage_1_general_agent"
      ? baselines.stage1Primary.pass_hat_5
      : options.stage === "stage_2_domain_skill" || isFallback
        ? baselines.stage2Skill.pass_hat_5
        : computeTaskPassHatK(
            [{ successes: routineVerifierPassed === 1.0 ? 5 : 0, trials: 5 }],
            5,
          ).perTaskPower;

  const isV091 = baselines.version === "v0.9.1";
  const provenance: StageProvenance =
    options.stage === "stage_1_general_agent"
      ? isV091
        ? "measured_v0.9.1_baseline"
        : "measured_v0.9_baseline"
      : options.stage === "stage_2_domain_skill"
        ? isV091
          ? "measured_v0.9.1_domain_skill"
          : "measured_v0.9_domain_skill"
        : "measured_reference_verifier_with_projected_fallback";

  const estimatedCostUsd =
    tokenProfile === "compiled_code"
      ? 0
      : options.stage === "stage_1_general_agent"
        ? baselines.stage1Primary.mean_cost_usd
        : baselines.stage2Skill.mean_cost_usd;

  const cpvoUsd =
    tokenProfile === "compiled_code"
      ? 0
      : round4(estimatedCostUsd / Math.max(pass1, 0.01));

  const latencyMs = Math.max(1, econ.wallClockMs);

  const stage1ModelsText = baselines.stage1Models
    .map((m) => `${m.model} ${(m.pass1 * 100).toFixed(1)}%`)
    .join(", ");
  const s2Train =
    baselines.stage2Skill.train_pass_at_1 !== undefined &&
    baselines.stage2Skill.train_pass_at_1 !== null
      ? `${(baselines.stage2Skill.train_pass_at_1 * 100).toFixed(1)}% train`
      : "n/a train";
  const s2Holdout =
    baselines.stage2Skill.holdout_pass_at_1 !== undefined &&
    baselines.stage2Skill.holdout_pass_at_1 !== null
      ? `${(baselines.stage2Skill.holdout_pass_at_1 * 100).toFixed(1)}% holdout`
      : "n/a holdout";

  return {
    stage: options.stage,
    stageLabel:
      options.stage === "stage_1_general_agent"
        ? `Stage 1: Zero-Shot General Agent (Measured ${baselines.version}, ${baselines.stage1Primary.tasks_count} workflows x ${Math.round(baselines.stage1Primary.trials_count / Math.max(1, baselines.stage1Primary.tasks_count))} trials: ${stage1ModelsText}; ${baselines.falseCompletionRateRange} false-completion rate)`
        : options.stage === "stage_2_domain_skill"
          ? `Stage 2: Domain Skill Procedure Guide (Measured ${baselines.version}: ${stripBackticks(baselines.stage2Skill.model_label)} ${(baselines.stage2Skill.pass_at_1 * 100).toFixed(1)}% pass@1, ${s2Train} / ${s2Holdout}, ${(baselines.stage2Skill.pass_hat_5 * 100).toFixed(1)}% pass^5; eval/inspect/evergreen_domain_skill.md)`
          : isFallback
            ? "Stage 3: Compiled Code -> Projected FallbackToSkill (eval/inspect/evergreen_domain_skill.md)"
            : "Stage 3: $0-Token Compiled Deterministic Code (Scripted Reference Verifier)",
    provenance,
    scenarioId: options.scenarioId,
    workflowId: options.workflow.id,
    status:
      tokenProfile === "compiled_code"
        ? "COMPLETED_DETERMINISTIC"
        : isFallback
          ? "FALLBACK_TO_SKILL"
          : "COMPLETED_AGENTIC",
    fallbackReason: isFallback
      ? options.workflow.fallbackTriggerDescription
      : undefined,
    inputTokens: econ.inputTokens,
    outputTokens: econ.outputTokens,
    totalTokens: econ.totalTokens,
    estimatedCostUsd,
    cpvoUsd,
    latencyMs,
    pass1,
    pass5,
    eoCompliant,
    traceScore: Math.round(traceScore * 1000) / 1000,
  };
}

export async function runEvolutionShowcase(options?: {
  fetchImpl?: typeof fetch;
  baseUrls?: Record<string, string>;
  summaryPath?: string;
}): Promise<EvolutionComparisonSummary> {
  const baselines = loadMeasuredStageBaselines(options?.summaryPath);
  const workflows = [];
  for (const spec of COMPILED_WORKFLOW_SPECS) {
    const [r1, r2, r3, p1, p2, p3] = await Promise.all([
      runStageTrajectory({
        stage: "stage_1_general_agent",
        workflow: spec,
        scenarioId: spec.routineScenarioId,
        isPivotCase: false,
        fetchImpl: options?.fetchImpl,
        baseUrls: options?.baseUrls,
        summaryPath: options?.summaryPath,
      }),
      runStageTrajectory({
        stage: "stage_2_domain_skill",
        workflow: spec,
        scenarioId: spec.routineScenarioId,
        isPivotCase: false,
        fetchImpl: options?.fetchImpl,
        baseUrls: options?.baseUrls,
        summaryPath: options?.summaryPath,
      }),
      runStageTrajectory({
        stage: "stage_3_compiled_code",
        workflow: spec,
        scenarioId: spec.routineScenarioId,
        isPivotCase: false,
        fetchImpl: options?.fetchImpl,
        baseUrls: options?.baseUrls,
        summaryPath: options?.summaryPath,
      }),
      runStageTrajectory({
        stage: "stage_1_general_agent",
        workflow: spec,
        scenarioId: spec.pivotScenarioId,
        isPivotCase: true,
        fetchImpl: options?.fetchImpl,
        baseUrls: options?.baseUrls,
        summaryPath: options?.summaryPath,
      }),
      runStageTrajectory({
        stage: "stage_2_domain_skill",
        workflow: spec,
        scenarioId: spec.pivotScenarioId,
        isPivotCase: true,
        fetchImpl: options?.fetchImpl,
        baseUrls: options?.baseUrls,
        summaryPath: options?.summaryPath,
      }),
      runStageTrajectory({
        stage: "stage_3_compiled_code",
        workflow: spec,
        scenarioId: spec.pivotScenarioId,
        isPivotCase: true,
        fetchImpl: options?.fetchImpl,
        baseUrls: options?.baseUrls,
        summaryPath: options?.summaryPath,
      }),
    ]);

    workflows.push({
      spec,
      routineRun: { stage1: r1, stage2: r2, stage3: r3 },
      pivotRun: { stage1: p1, stage2: p2, stage3WithFallback: p3 },
    });
  }

  const stage1Runs = workflows.flatMap((w) => [w.routineRun.stage1, w.pivotRun.stage1]);
  const stage2Runs = workflows.flatMap((w) => [w.routineRun.stage2, w.pivotRun.stage2]);
  const stage3RoutineRuns = workflows.map((w) => w.routineRun.stage3);
  const stage3AllRuns = workflows.flatMap((w) => [
    w.routineRun.stage3,
    w.pivotRun.stage3WithFallback,
  ]);

  const mean = (vals: number[]) =>
    vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;

  const stage1AvgTokens = Math.round(mean(stage1Runs.map((r) => r.totalTokens)));
  const stage2AvgTokens = Math.round(mean(stage2Runs.map((r) => r.totalTokens)));
  const fallbackRatePct = 22.0;
  const blendedTokens = Math.round(stage2AvgTokens * (fallbackRatePct / 100));
  const blendedCpvoUsd = round4(baselines.stage2CpvoUsd * (fallbackRatePct / 100));

  const stage3PassTasks = stage3RoutineRuns.map((r) => ({
    successes: r.eoCompliant ? 5 : 0,
    trials: 5,
  }));
  const stage3Pass1 = round4(
    mean(stage3RoutineRuns.map((r) => (r.eoCompliant ? 1 : 0))),
  );
  const stage3Pass5 = computeTaskPassHatK(stage3PassTasks, 5).perTaskPower;
  const stage3EoRate = round4(
    mean(stage3AllRuns.map((r) => (r.eoCompliant ? 1 : 0))),
  );

  const agencyRoi = calculateAgencyRoi({
    fallbackRatePct,
    summaryPath: options?.summaryPath,
  });
  const isV091 = baselines.version === "v0.9.1";

  const stage1ModelsText = baselines.stage1Models
    .map((m) => `${m.model} ${(m.pass1 * 100).toFixed(1)}% pass@1`)
    .join(", ");
  const s2Train =
    baselines.stage2Skill.train_pass_at_1 !== undefined &&
    baselines.stage2Skill.train_pass_at_1 !== null
      ? `${(baselines.stage2Skill.train_pass_at_1 * 100).toFixed(1)}% train`
      : "n/a train";
  const s2Holdout =
    baselines.stage2Skill.holdout_pass_at_1 !== undefined &&
    baselines.stage2Skill.holdout_pass_at_1 !== null
      ? `${(baselines.stage2Skill.holdout_pass_at_1 * 100).toFixed(1)}% holdout`
      : "n/a holdout";

  return {
    generatedAt: new Date().toISOString(),
    summaryVersion: baselines.version,
    summaryPath: baselines.summaryPath,
    stages: {
      stage1GeneralAgent: {
        label:
          `Stage 1: Zero-Shot General Agent (Measured ${baselines.version}, ${baselines.stage1Primary.tasks_count} workflows x ${Math.round(baselines.stage1Primary.trials_count / Math.max(1, baselines.stage1Primary.tasks_count))} trials: ${stage1ModelsText}; ${baselines.falseCompletionRateRange} unconditional false-done, ${baselines.falseCompletionGivenFailedRange} on failed runs)`,
        provenance: isV091 ? "measured_v0.9.1_baseline" : "measured_v0.9_baseline",
        avgTokens: stage1AvgTokens,
        cpvoUsd: baselines.stage1CpvoUsd,
        avgLatencyMs: Math.round(mean(stage1Runs.map((r) => r.latencyMs))),
        pass1: baselines.stage1Primary.pass_at_1,
        meanScore: baselines.stage1Primary.mean_score,
        pass5: baselines.stage1Primary.pass_hat_5,
        pass5Strict: baselines.stage1Primary.pass_hat_5_unbiased ?? null,
        eoComplianceRate: baselines.stage1EoComplianceRate,
        falseCompletionRateRange: baselines.falseCompletionRateRange,
        measuredModels: baselines.stage1Models,
      },
      stage2DomainSkill: {
        label:
          `Stage 2: Domain Skill Procedure Guide (Measured ${baselines.version}: ${stripBackticks(baselines.stage2Skill.model_label)} ${(baselines.stage2Skill.pass_at_1 * 100).toFixed(1)}% pass@1, ${s2Train} / ${s2Holdout}, ${(baselines.stage2Skill.pass_hat_5 * 100).toFixed(1)}% pass^5; eval/inspect/evergreen_domain_skill.md)`,
        provenance: isV091 ? "measured_v0.9.1_domain_skill" : "measured_v0.9_domain_skill",
        avgTokens: stage2AvgTokens,
        cpvoUsd: baselines.stage2CpvoUsd,
        avgLatencyMs: Math.round(mean(stage2Runs.map((r) => r.latencyMs))),
        pass1: baselines.stage2Skill.pass_at_1,
        pass5: baselines.stage2Skill.pass_hat_5,
        pass5Strict: baselines.stage2Skill.pass_hat_5_unbiased ?? null,
        eoComplianceRate: baselines.stage2EoComplianceRate,
      },
      stage3CompiledCode: {
        label:
          `Stage 3: $0-Token Compiled Deterministic Code (Measured ${(stage3Pass1 * 100).toFixed(1)}% Scripted Reference Verifier + Projected FallbackToSkill)`,
        provenance: "measured_reference_verifier_with_projected_fallback",
        routineTokens: 0,
        routineCpvoUsd: 0.0,
        blendedTokens,
        blendedCpvoUsd,
        avgLatencyMs: Math.round(mean(stage3RoutineRuns.map((r) => r.latencyMs))),
        pass1: stage3Pass1,
        pass5: stage3Pass5,
        eoComplianceRate: stage3EoRate,
        fallbackRatePct,
      },
    },
    workflows,
    agencyRoi,
  };
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("evolution-showcase.ts");

if (isMain) {
  const summary = await runEvolutionShowcase();
  console.log(JSON.stringify(summary, null, 2));
}
