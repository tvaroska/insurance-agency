import { parseArgs } from "util";
import { readdir, readFile, mkdir, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { randomUUID } from "crypto";

import type { OtlpTrace, EoTrapResult } from "./types";
import { parseTrace, evaluateTrace } from "./evaluators/trace";
import { evaluateOutput } from "./evaluators/output";
import { loadToolMapping } from "./tool-mapping";
import { generateReport, formatMarkdown } from "./report";
import { scenarios } from "./scenarios/index";

// ── CLI ─────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    traces: { type: "string" },
    scenario: { type: "string" },
    seed: { type: "string", default: "realistic" },
    case: { type: "string" },
    out: { type: "string" },
    help: { type: "boolean", default: false },
  },
  strict: true,
});

if (values.help || !values.traces || !values.scenario) {
  console.log(`Usage: bun eval/score.ts --traces <path> --scenario <id> --seed <variant>

Options:
  --traces    Path to OTLP JSON file or directory of .json files
  --scenario  Scenario ID (e.g. 01) or comma-separated IDs (01,04,07,08)
  --seed      Variant name (default: realistic). Common: clean, realistic, attorney, state-minimum
  --case      Test case ID (optional, runs first case if omitted)
  --out       Output directory (default: eval/runs/<run-id>/)
  --help      Show this help`);
  process.exit(values.help ? 0 : 1);
}

const seed = values.seed!;

// ── Load traces ─────────────────────────────────────────────────────

async function loadTraces(tracePath: string): Promise<OtlpTrace> {
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

// ── Score one scenario ──────────────────────────────────────────────

async function scoreScenario(scenarioId: string, trace: OtlpTrace) {
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
  const testCase =
    values.case
      ? variant.cases.find((c) => c.id === values.case)
      : variant.cases[0];

  if (!testCase) {
    console.error(
      `Case "${values.case}" not found. Available: ${variant.cases.map((c) => c.id).join(", ")}`,
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

  // Evaluate E&O traps
  const eoTrapResults: EoTrapResult[] = variant.eoTraps.map((trap) => {
    const [result] = evaluateTrace([trap.check], apiCalls);
    return {
      id: trap.id,
      description: trap.description,
      caught: result.passed,
    };
  });

  // Generate report
  const runId = randomUUID().slice(0, 8);
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
  });

  return { report, runId };
}

// ── Main ────────────────────────────────────────────────────────────

const scenarioIds = values.scenario!.split(",").map((s) => s.trim());
const trace = await loadTraces(values.traces!);

for (const scenarioId of scenarioIds) {
  const { report, runId } = await scoreScenario(scenarioId, trace);

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
  console.log(
    `Scenario ${scenarioId}: ${(report.overall.score * 100).toFixed(1)}% ` +
      `(trace ${(report.trace.score * 100).toFixed(1)}% / output ${(report.output.score * 100).toFixed(1)}%) ` +
      `E&O: ${eoStatus} | ${report.overall.apiCalls} API calls | ${outDir}`,
  );
}
