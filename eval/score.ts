import { parseArgs } from "util";
import { readdir, readFile, mkdir, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { randomUUID } from "crypto";

import type {
  OtlpTrace,
  EoTrapResult,
  GymSnapshot,
  StateDiffSummary,
  RubricEvaluationSummary,
} from "./types";
import { parseTrace, evaluateTrace } from "./evaluators/trace";
import { evaluateOutput } from "./evaluators/output";
import { evaluateRubrics, DEFAULT_JUDGE_MODEL } from "./evaluators/rubric";
import {
  fetchGymSnapshot,
  diffSnapshots,
  evaluateCollateralDamage,
  summarizeStateDiff,
} from "./evaluators/state-diff";
import { extractEconomicsMetrics } from "./evaluators/economics";
import { loadToolMapping } from "./tool-mapping";
import { generateReport, formatMarkdown } from "./report";
import { scenarios } from "./scenarios/index";

// ── Load traces & snapshots ─────────────────────────────────────────

export async function loadTraces(tracePath: string): Promise<OtlpTrace> {
  const stat = await Bun.file(tracePath).exists();

  if (stat) {
    const content = await readFile(tracePath, "utf-8");
    const trimmed = content.trim();

    // Try parsing as a single JSON object first (standard or pretty-printed)
    try {
      return JSON.parse(trimmed) as OtlpTrace;
    } catch {
      // Fall through to JSONL parsing
    }

    // JSONL: one JSON object per line
    const merged: OtlpTrace = { resourceSpans: [] };
    for (const line of trimmed.split("\n")) {
      if (!line.trim()) continue;
      const obj = JSON.parse(line) as OtlpTrace;
      merged.resourceSpans.push(...obj.resourceSpans);
    }
    return merged;
  }

  // Try as directory
  const files = await readdir(tracePath);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  if (jsonFiles.length === 0) {
    console.error(`No .json files found in ${tracePath}`);
    process.exit(1);
  }

  const merged: OtlpTrace = { resourceSpans: [] };
  for (const file of jsonFiles.sort()) {
    const content = await readFile(join(tracePath, file), "utf-8");
    const obj = JSON.parse(content.trim()) as OtlpTrace;
    merged.resourceSpans.push(...obj.resourceSpans);
  }
  return merged;
}

export async function loadSnapshot(snapshotPath: string): Promise<GymSnapshot> {
  const content = await readFile(snapshotPath, "utf-8");
  return JSON.parse(content.trim()) as GymSnapshot;
}

// ── Score one scenario ──────────────────────────────────────────────

export interface ScoreScenarioOptions {
  seed?: string;
  caseId?: string;
  snapshotBefore?: GymSnapshot;
  snapshotAfter?: GymSnapshot;
  model?: string;
  judgeModel?: string;
}

export async function scoreScenario(
  scenarioId: string,
  trace: OtlpTrace,
  opts: ScoreScenarioOptions = {},
) {
  const seed = opts.seed ?? "realistic";
  const def = scenarios[scenarioId];
  if (!def) {
    console.error(
      `Unknown scenario: ${scenarioId}. Available: ${Object.keys(scenarios).join(", ")}`,
    );
    process.exit(1);
  }

  const variant = def.variants[seed];
  if (!variant) {
    console.error(
      `Unknown variant "${seed}" for scenario ${scenarioId}. Available: ${Object.keys(def.variants).join(", ")}`,
    );
    process.exit(1);
  }
  const testCase = opts.caseId
    ? variant.cases.find((c) => c.id === opts.caseId)
    : variant.cases[0];

  if (!testCase) {
    console.error(
      `Case "${opts.caseId}" not found. Available: ${variant.cases.map((c) => c.id).join(", ")}`,
    );
    process.exit(1);
  }

  // Parse traces
  const specsDir = resolve(import.meta.dir, "../specs");
  const toolMapping = loadToolMapping(specsDir);
  const apiCalls = parseTrace(trace, toolMapping);

  // Evaluate trace
  const traceScores = evaluateTrace(variant.traceChecks, apiCalls);

  // Evaluate output using the selected case's checks
  const outputScores = await evaluateOutput(testCase.outputChecks);

  // Evaluate E&O traps (both trace check and optional outputCheck must pass)
  const eoTrapResults: EoTrapResult[] = [];
  for (const trap of variant.eoTraps) {
    const [traceResult] = evaluateTrace([trap.check], apiCalls);
    let outputPassed = true;
    if (trap.outputCheck) {
      const [outResult] = await evaluateOutput([trap.outputCheck]);
      outputPassed = outResult.passed;
    }
    eoTrapResults.push({
      id: trap.id,
      description: trap.description,
      caught: traceResult.passed && outputPassed,
    });
  }

  // Optional State Diff & Collateral Damage evaluation (S3-DIFF-1)
  let stateDiff: StateDiffSummary | undefined;
  if (opts.snapshotBefore && opts.snapshotAfter) {
    const diffResult = diffSnapshots(opts.snapshotBefore, opts.snapshotAfter);
    const collateral = evaluateCollateralDamage(
      diffResult,
      variant.collateralPolicy,
    );
    stateDiff = summarizeStateDiff(diffResult, collateral, false);
  }

  // Optional Tier-2 Atomic Rubric & Rogan-Gladen Calibration evaluation
  let rubric: RubricEvaluationSummary | undefined;
  if (variant.rubricChecks && variant.rubricChecks.length > 0) {
    rubric = await evaluateRubrics(variant.rubricChecks, {
      judgeModel: opts.judgeModel ?? DEFAULT_JUDGE_MODEL,
    });
  }

  // Preliminary report to obtain overall score for Pareto efficiency
  const runId = randomUUID().slice(0, 8);
  const baseReport = generateReport({
    runId,
    scenario: scenarioId,
    caseId: testCase.id,
    seed,
    traceScores,
    outputScores,
    eoTrapResults,
    apiCallCount: apiCalls.length,
    expectedRange: [variant.expectedApiCalls.min, variant.expectedApiCalls.max],
    stateDiff,
    rubric,
  });

  // Compute Economics & Efficiency metrics (S3-ECON-1 & S3-SIM-1)
  const economics = extractEconomicsMetrics(trace, apiCalls, {
    score: baseReport.overall.score,
    defaultModel: opts.model ?? "gemini-3.8-flash",
    maxTurns: variant.turnBudget?.max ?? 5,
    minTurns: variant.turnBudget?.min ?? 0,
    toolMapping,
  });

  const report = generateReport({
    runId,
    scenario: scenarioId,
    caseId: testCase.id,
    seed,
    traceScores,
    outputScores,
    eoTrapResults,
    apiCallCount: apiCalls.length,
    expectedRange: [variant.expectedApiCalls.min, variant.expectedApiCalls.max],
    stateDiff,
    economics,
    rubric,
  });

  return { report, runId };
}

// ── CLI ─────────────────────────────────────────────────────────────

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      traces: { type: "string" },
      scenario: { type: "string" },
      seed: { type: "string", default: "realistic" },
      case: { type: "string" },
      out: { type: "string" },
      "snapshot-before": { type: "string" },
      "snapshot-after": { type: "string" },
      model: { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.help || !values.traces || !values.scenario) {
    console.log(`Usage: bun eval/score.ts --traces <path> --scenario <id> --seed <variant>

Options:
  --traces           Path to OTLP JSON file or directory of .json files
  --scenario         Scenario ID (e.g. 01) or comma-separated IDs (01,04,07,08)
  --seed             Variant name (default: realistic). Common: clean, realistic, attorney, state-minimum
  --case             Test case ID (optional, runs first case if omitted)
  --snapshot-before  Optional path to pre-run GymSnapshot JSON file
  --snapshot-after   Optional path to post-run GymSnapshot JSON file (or fetched live if omitted when --snapshot-before is set)
  --model            Default model name for token pricing (default: gemini-3.8-flash)
  --out              Output directory (default: eval/runs/<run-id>/)
  --help             Show this help`);
    process.exit(values.help ? 0 : 1);
  }

  const seed = values.seed!;
  const scenarioIds = values.scenario!.split(",").map((s) => s.trim());
  const trace = await loadTraces(values.traces!);

  let snapshotBefore: GymSnapshot | undefined;
  let snapshotAfter: GymSnapshot | undefined;

  if (values["snapshot-before"]) {
    snapshotBefore = await loadSnapshot(values["snapshot-before"]);
    snapshotAfter = values["snapshot-after"]
      ? await loadSnapshot(values["snapshot-after"])
      : await fetchGymSnapshot();
  }

  for (const scenarioId of scenarioIds) {
    const { report, runId } = await scoreScenario(scenarioId, trace, {
      seed,
      caseId: values.case,
      snapshotBefore,
      snapshotAfter,
      model: values.model,
    });

    // Write output
    const outDir = values.out
      ? resolve(values.out)
      : resolve(import.meta.dir, `runs/${runId}`);
    await mkdir(outDir, { recursive: true });

    const jsonPath = join(outDir, `${scenarioId}-report.json`);
    const mdPath = join(outDir, `${scenarioId}-report.md`);

    await writeFile(jsonPath, JSON.stringify(report, null, 2));
    await writeFile(mdPath, formatMarkdown(report));

    // Print summary
    const eoStatus = report.overall.eoCompliant ? "PASS" : "FAIL";
    const costInfo = report.economics
      ? ` | $${report.economics.estimatedCostUsd.toFixed(4)} (${report.economics.totalTokens} tok)`
      : "";
    console.log(
      `Scenario ${scenarioId}: ${(report.overall.score * 100).toFixed(1)}% ` +
        `(trace ${(report.trace.score * 100).toFixed(1)}% / output ${(report.output.score * 100).toFixed(1)}%) ` +
        `E&O: ${eoStatus} | ${report.overall.apiCalls} API calls${costInfo} | ${outDir}`,
    );
  }
}
