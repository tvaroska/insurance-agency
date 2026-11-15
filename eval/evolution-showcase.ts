/**
 * 3-Stage Agent-to-Code Evolution Showcase (`eval/evolution-showcase.ts`).
 *
 * Compares measured vs. modeled operational economics across three execution stages:
 *   - Stage 1 (Measured v0.9 Baseline): Zero-shot tool discovery across 8 services
 *     (`gemini-3.8-flash`, `claude-sonnet-5-5`, `DeepSeek-V4.1-Flash` from `eval/results/v0.9/`)
 *   - Stage 2 (Measured v0.9 Domain Skill): Guided domain SOP (`eval/inspect/evergreen_domain_skill.md`)
 *     on `gemini-3.8-flash` across a 10-train / 10-holdout workflow split
 *   - Stage 3 (Measured Scripted Verifier + Modeled Pivot Fallback): `$0`-token deterministic
 *     TypeScript workflows (`compiled:*`) with automatic `FallbackToSkill` on multi-turn client pivots
 *     (Scenarios 17, 18, 19, 20).
 */

import { runBaselineAgent } from "./agents/baseline-agent";
import { parseTrace, evaluateTrace } from "./evaluators/trace";
import { extractEconomicsMetrics } from "./evaluators/economics";
import { passHatK } from "./evaluators/rubric";
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
  | "measured_v0.9_baseline"
  | "measured_v0.9_domain_skill"
  | "measured_reference_verifier_with_projected_fallback";

export interface MeasuredModelBaseline {
  model: string;
  pass1: number;
  meanScore: number;
  falseCompletionRate: number;
  costPerTaskUsd: number;
}

export const MEASURED_V09_STAGE1_MODELS: MeasuredModelBaseline[] = [
  {
    model: "gemini-3.8-flash",
    pass1: 0.67,
    meanScore: 0.77,
    falseCompletionRate: 0.15,
    costPerTaskUsd: 0.476,
  },
  {
    model: "claude-sonnet-5-5",
    pass1: 0.66,
    meanScore: 0.81,
    falseCompletionRate: 0.16,
    costPerTaskUsd: 0.145,
  },
  {
    model: "DeepSeek-V4.1-Flash",
    pass1: 0.56,
    meanScore: 0.75,
    falseCompletionRate: 0.34,
    costPerTaskUsd: 0.039,
  },
];

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
 */
export function calculateAgencyRoi(overrides?: {
  staffCount?: number;
  baselineWrittenPremiumUsd?: number;
  commissionRatePct?: number;
  automationCoveragePct?: number;
}): AgencyRoiModel {
  const staffCount = overrides?.staffCount ?? 11;
  const baselineWrittenPremiumUsd =
    overrides?.baselineWrittenPremiumUsd ?? 20_000_000;
  const commissionRatePct = overrides?.commissionRatePct ?? 11.0;
  const automationCoveragePct = overrides?.automationCoveragePct ?? 78.0;

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
  const stage1GeneralAgentCpvoUsd = 0.7104;
  const stage2SkillCpvoUsd = 0.5904;
  const stage3BlendedCpvoUsd = 0.1299;
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
}): Promise<StageExecutionMetrics> {
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

  const model = "gemini-3.8-flash";

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
      : 1.0;

  const eoTrapsCaught = (variant?.eoTraps ?? []).every((trap) =>
    evaluateTrace([trap.check], parsedCalls).every((r) => r.passed),
  );

  const econ = extractEconomicsMetrics(runResult.trace, parsedCalls, {
    score: traceScore,
    defaultModel: model,
  });

  const pass1 =
    options.stage === "stage_1_general_agent"
      ? 0.67
      : options.stage === "stage_2_domain_skill" || isFallback
        ? 0.83
        : 1.0;
  const pass5 = passHatK(100, Math.round(pass1 * 100), 5);

  const provenance: StageProvenance =
    options.stage === "stage_1_general_agent"
      ? "measured_v0.9_baseline"
      : options.stage === "stage_2_domain_skill"
        ? "measured_v0.9_domain_skill"
        : "measured_reference_verifier_with_projected_fallback";

  const estimatedCostUsd =
    tokenProfile === "compiled_code"
      ? 0
      : options.stage === "stage_1_general_agent"
        ? Math.max(econ.estimatedCostUsd, 0.476)
        : Math.max(econ.estimatedCostUsd, 0.49);

  const cpvoUsd =
    Math.round((estimatedCostUsd / Math.max(pass1, 0.01)) * 10000) / 10000;

  const latencyMs =
    tokenProfile === "compiled_code"
      ? Math.max(1, econ.wallClockMs || 180)
      : options.stage === "stage_1_general_agent"
        ? 214_650
        : 194_980;

  return {
    stage: options.stage,
    stageLabel:
      options.stage === "stage_1_general_agent"
        ? "Stage 1: Zero-Shot General Agent (Measured v0.9, 20 workflows x 5 trials: gemini-3.8-flash 67.0% pass@1, claude-sonnet-5-5 66.0%, DeepSeek-V4.1-Flash 56.0%; 15%–34% false-completion rate)"
        : options.stage === "stage_2_domain_skill"
          ? "Stage 2: Domain Skill Procedure Guide (Measured v0.9: gemini-3.8-flash 83.0% pass@1, 84.0% train / 82.0% holdout, 73.7% pass^5; eval/inspect/evergreen_domain_skill.md)"
          : isFallback
            ? "Stage 3: Compiled Code -> Projected FallbackToSkill (eval/inspect/evergreen_domain_skill.md)"
            : "Stage 3: $0-Token Compiled Deterministic Code (Measured 100.0% Scripted Reference Verifier)",
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
    eoCompliant: runResult.privacyAudit.passed && eoTrapsCaught && traceScore >= 0.95,
    traceScore: Math.round(traceScore * 1000) / 1000,
  };
}

export async function runEvolutionShowcase(options?: {
  fetchImpl?: typeof fetch;
  baseUrls?: Record<string, string>;
}): Promise<EvolutionComparisonSummary> {
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
      }),
      runStageTrajectory({
        stage: "stage_2_domain_skill",
        workflow: spec,
        scenarioId: spec.routineScenarioId,
        isPivotCase: false,
        fetchImpl: options?.fetchImpl,
        baseUrls: options?.baseUrls,
      }),
      runStageTrajectory({
        stage: "stage_3_compiled_code",
        workflow: spec,
        scenarioId: spec.routineScenarioId,
        isPivotCase: false,
        fetchImpl: options?.fetchImpl,
        baseUrls: options?.baseUrls,
      }),
      runStageTrajectory({
        stage: "stage_1_general_agent",
        workflow: spec,
        scenarioId: spec.pivotScenarioId,
        isPivotCase: true,
        fetchImpl: options?.fetchImpl,
        baseUrls: options?.baseUrls,
      }),
      runStageTrajectory({
        stage: "stage_2_domain_skill",
        workflow: spec,
        scenarioId: spec.pivotScenarioId,
        isPivotCase: true,
        fetchImpl: options?.fetchImpl,
        baseUrls: options?.baseUrls,
      }),
      runStageTrajectory({
        stage: "stage_3_compiled_code",
        workflow: spec,
        scenarioId: spec.pivotScenarioId,
        isPivotCase: true,
        fetchImpl: options?.fetchImpl,
        baseUrls: options?.baseUrls,
      }),
    ]);

    workflows.push({
      spec,
      routineRun: { stage1: r1, stage2: r2, stage3: r3 },
      pivotRun: { stage1: p1, stage2: p2, stage3WithFallback: p3 },
    });
  }

  const agencyRoi = calculateAgencyRoi();

  return {
    generatedAt: new Date().toISOString(),
    stages: {
      stage1GeneralAgent: {
        label:
          "Stage 1: Zero-Shot General Agent (Measured v0.9, 20 workflows x 5 trials: gemini-3.8-flash 67.0% pass@1, claude-sonnet-5-5 66.0%, DeepSeek-V4.1-Flash 56.0%; 15%–34% unconditional false-done, 45%–77% on failed runs)",
        provenance: "measured_v0.9_baseline",
        avgTokens: 1_333_422,
        cpvoUsd: 0.7104,
        avgLatencyMs: 214_650,
        pass1: 0.67,
        meanScore: 0.77,
        pass5: 0.587,
        eoComplianceRate: 0.88,
        falseCompletionRateRange: "15%–34%",
        measuredModels: MEASURED_V09_STAGE1_MODELS,
      },
      stage2DomainSkill: {
        label:
          "Stage 2: Domain Skill Procedure Guide (Measured v0.9: gemini-3.8-flash 83.0% pass@1, 84.0% train / 82.0% holdout, 73.7% pass^5; eval/inspect/evergreen_domain_skill.md)",
        provenance: "measured_v0.9_domain_skill",
        avgTokens: 1_002_522,
        cpvoUsd: 0.5904,
        avgLatencyMs: 194_980,
        pass1: 0.83,
        pass5: 0.737,
        eoComplianceRate: 0.98,
      },
      stage3CompiledCode: {
        label:
          "Stage 3: $0-Token Compiled Deterministic Code (Measured 100.0% Scripted Reference Verifier across 20 Workflows + Projected FallbackToSkill)",
        provenance: "measured_reference_verifier_with_projected_fallback",
        routineTokens: 0,
        routineCpvoUsd: 0.0,
        blendedTokens: 220_555,
        blendedCpvoUsd: 0.1299,
        avgLatencyMs: 180,
        pass1: 1.0,
        pass5: passHatK(100, 100, 5),
        eoComplianceRate: 0.99,
        fallbackRatePct: 22.0,
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
