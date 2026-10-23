/**
 * Princeton HAL (`hal-harness`) Holistic Agent Leaderboard Exporter (`eval/hal/export-hal.ts`).
 *
 * Converts Evergreen `ScenarioReport`s and OTLP GenAI token/latency telemetry into the
 * standardized Princeton HAL (`hal_results.json`) schema for Cost-vs-Accuracy Pareto
 * frontier comparison alongside tau-bench, AppWorld, and SWE-bench.
 *
 * Usage:
 *   bun eval/hal/export-hal.ts --runs <dir-or-file> --model gemini-3.8-flash --agent google-adk [--out hal_results.json]
 */

import { readdir, readFile, writeFile } from "fs/promises";
import { join, resolve } from "path";
import type { OtlpAttribute, OtlpTrace, ScenarioReport } from "../types";

export interface ModelPricing {
  inputCostPer1MUsd: number;
  outputCostPer1MUsd: number;
}

export const MODEL_PRICING_USD_PER_1M: Record<string, ModelPricing> = {
  "gemini-3.8-flash": { inputCostPer1MUsd: 0.15, outputCostPer1MUsd: 0.6 },
  "gemini-4-argon": { inputCostPer1MUsd: 1.25, outputCostPer1MUsd: 5.0 },
  "gemini-3.5-flash-lite": { inputCostPer1MUsd: 0.075, outputCostPer1MUsd: 0.3 },
};

export interface TaskTelemetryUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  latency_sec: number;
  llm_calls: number;
}

export interface HalTaskResult {
  task_id: string;
  scenario_id: string;
  case_id: string;
  seed: string;
  score: number;
  successful: boolean;
  eo_compliant: boolean;
  trace_score: number;
  output_score: number;
  api_calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  latency_sec: number;
}

export interface HalUploadPayload {
  config: {
    benchmark_name: "evergreen_insurance_gym";
    benchmark_version: string;
    model_name: string;
    agent_name: string;
    seed_mode: string;
    pass_threshold: number;
    timestamp: string;
  };
  benchmark_name: "evergreen_insurance_gym";
  model_name: string;
  agent_name: string;
  total_cost_usd: number;
  total_tokens: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  latencies: {
    mean_sec: number;
    median_sec: number;
    p95_sec: number;
    total_sec: number;
  };
  results: {
    accuracy: number;
    mean_score: number;
    eo_compliance_rate: number;
    successful_tasks: string[];
    failed_tasks: string[];
    eo_violated_tasks: string[];
  };
  eo_compliance_rate: number;
  pareto_metrics: {
    score_per_dollar: number;
    cost_per_successful_task_usd: number;
    mean_score: number;
    mean_cost_usd: number;
    mean_latency_sec: number;
    pareto_efficiency_index: number;
  };
  task_results: Record<string, HalTaskResult>;
}

function getNumericAttr(
  attrs: OtlpAttribute[] | undefined,
  key: string,
): number | undefined {
  if (!attrs) return undefined;
  const found = attrs.find((a) => a.key === key);
  if (!found) return undefined;
  if (typeof found.value.intValue === "number") return found.value.intValue;
  if (typeof found.value.intValue === "string") {
    const parsed = Number(found.value.intValue);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (typeof found.value.stringValue === "string") {
    const parsed = Number(found.value.stringValue);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Extracts token usage, dollar cost, and wall-clock latency from an OTLP trace.
 */
export function extractUsageFromOtlpTrace(
  trace: OtlpTrace,
  modelName = "gemini-3.8-flash",
): TaskTelemetryUsage {
  const pricing =
    MODEL_PRICING_USD_PER_1M[modelName] ??
    MODEL_PRICING_USD_PER_1M["gemini-3.8-flash"];

  let inputTokens = 0;
  let outputTokens = 0;
  let llmCalls = 0;
  let minStartNs: bigint | undefined;
  let maxEndNs: bigint | undefined;

  for (const rs of trace.resourceSpans ?? []) {
    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        const inTok =
          getNumericAttr(span.attributes, "gen_ai.usage.input_tokens") ??
          getNumericAttr(span.attributes, "gen_ai.usage.prompt_tokens") ??
          0;
        const outTok =
          getNumericAttr(span.attributes, "gen_ai.usage.output_tokens") ??
          getNumericAttr(span.attributes, "gen_ai.usage.completion_tokens") ??
          0;

        if (inTok > 0 || outTok > 0) {
          inputTokens += inTok;
          outputTokens += outTok;
          llmCalls += 1;
        }

        if (span.startTimeUnixNano && span.endTimeUnixNano) {
          try {
            const s = BigInt(span.startTimeUnixNano);
            const e = BigInt(span.endTimeUnixNano);
            if (minStartNs === undefined || s < minStartNs) minStartNs = s;
            if (maxEndNs === undefined || e > maxEndNs) maxEndNs = e;
          } catch {
            // Ignore malformed timestamps
          }
        }
      }
    }
  }

  const totalTokens = inputTokens + outputTokens;
  const costUsd =
    (inputTokens / 1_000_000) * pricing.inputCostPer1MUsd +
    (outputTokens / 1_000_000) * pricing.outputCostPer1MUsd;

  const latencySec =
    minStartNs !== undefined && maxEndNs !== undefined && maxEndNs >= minStartNs
      ? Number(maxEndNs - minStartNs) / 1e9
      : 0;

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    cost_usd: Math.round(costUsd * 1_000_000) / 1_000_000,
    latency_sec: Math.round(latencySec * 1000) / 1000,
    llm_calls: llmCalls,
  };
}

function computePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sortedValues.length) - 1),
  );
  return sortedValues[idx];
}

export interface BuildHalExportOptions {
  reports: ScenarioReport[];
  modelName?: string;
  agentName?: string;
  passThreshold?: number;
  usageByTaskId?: Record<string, Partial<TaskTelemetryUsage>>;
}

/**
 * Converts a list of Evergreen `ScenarioReport`s (and optional per-task token/cost telemetry)
 * into the Princeton HAL (`hal_results.json`) leaderboard payload.
 */
export function buildHalResults(
  options: BuildHalExportOptions,
): HalUploadPayload {
  const modelName = options.modelName ?? "gemini-3.8-flash";
  const agentName = options.agentName ?? "google-adk";
  const passThreshold = options.passThreshold ?? 0.7;
  const pricing =
    MODEL_PRICING_USD_PER_1M[modelName] ??
    MODEL_PRICING_USD_PER_1M["gemini-3.8-flash"];

  const taskResults: Record<string, HalTaskResult> = {};
  const successfulTasks: string[] = [];
  const failedTasks: string[] = [];
  const eoViolatedTasks: string[] = [];
  const latenciesSec: number[] = [];

  let sumInputTokens = 0;
  let sumOutputTokens = 0;
  let sumCostUsd = 0;
  let sumScore = 0;
  let eoCompliantCount = 0;

  for (const report of options.reports) {
    const taskId = `${report.scenario}-${report.caseId}`;
    const explicitUsage =
      options.usageByTaskId?.[taskId] ??
      options.usageByTaskId?.[report.scenario] ??
      (report as any).economics;

    // Estimate deterministic baseline tokens from API call count when raw GenAI spans are absent
    const inputTokens =
      explicitUsage?.input_tokens ??
      explicitUsage?.inputTokens ??
      report.overall.apiCalls * 650;
    const outputTokens =
      explicitUsage?.output_tokens ??
      explicitUsage?.outputTokens ??
      report.overall.apiCalls * 180;
    const totalTokens = inputTokens + outputTokens;

    const costUsd =
      explicitUsage?.cost_usd ??
      explicitUsage?.costUsd ??
      Math.round(
        ((inputTokens / 1_000_000) * pricing.inputCostPer1MUsd +
          (outputTokens / 1_000_000) * pricing.outputCostPer1MUsd) *
          1_000_000,
      ) / 1_000_000;

    const latencySec =
      explicitUsage?.latency_sec ??
      explicitUsage?.latencySec ??
      (explicitUsage?.durationMs
        ? explicitUsage.durationMs / 1000
        : Math.max(0.5, report.overall.apiCalls * 0.45));

    const successful =
      report.overall.eoCompliant && report.overall.score >= passThreshold;

    if (successful) {
      successfulTasks.push(taskId);
    } else {
      failedTasks.push(taskId);
    }
    if (!report.overall.eoCompliant) {
      eoViolatedTasks.push(taskId);
    } else {
      eoCompliantCount += 1;
    }

    sumInputTokens += inputTokens;
    sumOutputTokens += outputTokens;
    sumCostUsd += costUsd;
    sumScore += report.overall.score;
    latenciesSec.push(latencySec);

    taskResults[taskId] = {
      task_id: taskId,
      scenario_id: report.scenario,
      case_id: report.caseId,
      seed: report.seed,
      score: report.overall.score,
      successful,
      eo_compliant: report.overall.eoCompliant,
      trace_score: report.trace.score,
      output_score: report.output.score,
      api_calls: report.overall.apiCalls,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      cost_usd: costUsd,
      latency_sec: Math.round(latencySec * 1000) / 1000,
    };
  }

  const n = Math.max(1, options.reports.length);
  const sortedLatencies = [...latenciesSec].sort((a, b) => a - b);
  const totalLatencySec = latenciesSec.reduce((a, b) => a + b, 0);
  const meanLatencySec = totalLatencySec / n;
  const medianLatencySec = computePercentile(sortedLatencies, 50);
  const p95LatencySec = computePercentile(sortedLatencies, 95);

  const meanScore = Math.round((sumScore / n) * 1000) / 1000;
  const accuracy =
    Math.round((successfulTasks.length / n) * 1000) / 1000;
  const eoComplianceRate =
    Math.round((eoCompliantCount / n) * 1000) / 1000;
  const totalCostRounded = Math.round(sumCostUsd * 1_000_000) / 1_000_000;
  const meanCostUsd = Math.round((sumCostUsd / n) * 1_000_000) / 1_000_000;

  const scorePerDollar =
    totalCostRounded > 0
      ? Math.round((meanScore / meanCostUsd) * 100) / 100
      : 0;
  const costPerSuccessfulTaskUsd =
    successfulTasks.length > 0
      ? Math.round((totalCostRounded / successfulTasks.length) * 1_000_000) /
        1_000_000
      : totalCostRounded;

  // Pareto Efficiency Index: rewards high score & E&O compliance while penalizing dollar cost & latency
  const paretoEfficiencyIndex =
    Math.round(
      ((meanScore * eoComplianceRate) /
        (1 + meanCostUsd * 10 + meanLatencySec / 60)) *
        1000,
    ) / 1000;

  return {
    config: {
      benchmark_name: "evergreen_insurance_gym",
      benchmark_version: "0.4.0",
      model_name: modelName,
      agent_name: agentName,
      seed_mode: options.reports[0]?.seed ?? "realistic",
      pass_threshold: passThreshold,
      timestamp: new Date().toISOString(),
    },
    benchmark_name: "evergreen_insurance_gym",
    model_name: modelName,
    agent_name: agentName,
    total_cost_usd: totalCostRounded,
    total_tokens: {
      input_tokens: sumInputTokens,
      output_tokens: sumOutputTokens,
      total_tokens: sumInputTokens + sumOutputTokens,
    },
    latencies: {
      mean_sec: Math.round(meanLatencySec * 1000) / 1000,
      median_sec: Math.round(medianLatencySec * 1000) / 1000,
      p95_sec: Math.round(p95LatencySec * 1000) / 1000,
      total_sec: Math.round(totalLatencySec * 1000) / 1000,
    },
    results: {
      accuracy,
      mean_score: meanScore,
      eo_compliance_rate: eoComplianceRate,
      successful_tasks: successfulTasks,
      failed_tasks: failedTasks,
      eo_violated_tasks: eoViolatedTasks,
    },
    eo_compliance_rate: eoComplianceRate,
    pareto_metrics: {
      score_per_dollar: scorePerDollar,
      cost_per_successful_task_usd: costPerSuccessfulTaskUsd,
      mean_score: meanScore,
      mean_cost_usd: meanCostUsd,
      mean_latency_sec: Math.round(meanLatencySec * 1000) / 1000,
      pareto_efficiency_index: paretoEfficiencyIndex,
    },
    task_results: taskResults,
  };
}

export async function loadReportsFromPath(
  inputPath: string,
): Promise<ScenarioReport[]> {
  const resolved = resolve(inputPath);
  if (resolved.endsWith(".json")) {
    const raw = JSON.parse(await readFile(resolved, "utf-8"));
    return Array.isArray(raw) ? raw : [raw];
  }

  const entries = await readdir(resolved);
  const reportFiles = entries
    .filter((f) => f.endsWith("-report.json"))
    .sort();
  const reports: ScenarioReport[] = [];
  for (const file of reportFiles) {
    const content = await readFile(join(resolved, file), "utf-8");
    reports.push(JSON.parse(content) as ScenarioReport);
  }
  return reports;
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("export-hal.ts");

if (isMain) {
  const args = process.argv.slice(2);
  const getArg = (flag: string, fallback: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
  };

  const runsPath = getArg("--runs", resolve(import.meta.dir, "../runs"));
  const modelName = getArg("--model", "gemini-3.8-flash");
  const agentName = getArg("--agent", "google-adk");
  const outPath = resolve(getArg("--out", resolve(import.meta.dir, "hal_results.json")));

  const reports = await loadReportsFromPath(runsPath);
  const payload = buildHalResults({ reports, modelName, agentName });
  await writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(
    `Exported HAL leaderboard results (${Object.keys(payload.task_results).length} tasks, model=${modelName}, agent=${agentName}) to ${outPath}`,
  );
}
