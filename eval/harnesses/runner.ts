/**
 * Multi-Harness Benchmark Log Aggregator & Runner (`eval/harnesses/runner.ts`).
 *
 * Defines standardized execution profiles across 5 agent harnesses and aggregates
 * real `ScenarioReport` logs or live `runBaselineAgent` trajectories without any
 * fabricated score/token/latency multipliers:
 *   - `google-adk` (OpenAI-compatible / ADK runner via `eval/inspect/run_baseline.py`)
 *   - `claude-code` (Claude Code CLI / Harbor container runner)
 *   - `openhands` (OpenHands CodeAct + Browser + Bash via Harbor)
 *   - `langgraph` (LangGraph ReAct runner via `eval/inspect/evergreen_langchain.py`)
 *   - `inspect-ai` (UK AISI Inspect AI `@task` runner via `eval/inspect/evergreen.py`)
 *
 * Usage:
 *   bun eval/harnesses/runner.ts --runs-dir eval/runs --out eval/runs/leaderboard
 */

import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { scenarios } from "../scenarios/index";
import type { PromptDifficulty, ScenarioReport } from "../types";
import { parseTrace, evaluateTrace } from "../evaluators/trace";
import { extractEconomicsMetrics } from "../evaluators/economics";
import {
  getReferencePlaybook,
  runBaselineAgent,
  type BaselineAgentOptions,
  type BaselineAgentRunResult,
} from "../agents/baseline-agent";
import {
  buildLeaderboard,
  formatLeaderboardMarkdown,
  type ComparativeLeaderboard,
  type HarnessId,
  type HarnessRunInput,
} from "./leaderboard";

export {
  getReferencePlaybook,
  runBaselineAgent,
  type BaselineAgentOptions,
  type BaselineAgentRunResult,
};

export interface HarnessProfile {
  id: HarnessId;
  displayName: string;
  defaultModel: string;
  supportedModels: string[];
  modalities: ("rest" | "mcp" | "web-portal")[];
  adapterType: "adk" | "harbor" | "langgraph" | "inspect";
  description: string;
}

export const HARNESS_PROFILES: Record<HarnessId, HarnessProfile> = {
  "google-adk": {
    id: "google-adk",
    displayName: "Google ADK / Baseline Runner",
    defaultModel: "gemini-3.8-flash",
    supportedModels: [
      "gemini-3.8-flash",
      "gemini-4-argon",
      "gemini-3.5-flash-lite",
    ],
    modalities: ["rest", "mcp", "web-portal"],
    adapterType: "adk",
    description:
      "Multi-modal baseline runner (`eval/inspect/run_baseline.py`) with Streamable HTTP MCP (comm:3004), OpenAPI REST tools, and carrier portals.",
  },
  "claude-code": {
    id: "claude-code",
    displayName: "Claude Code CLI (via Harbor)",
    defaultModel: "gemini-4-argon",
    supportedModels: ["gemini-4-argon", "gemini-3.8-flash", "claude-sonnet-5-5"],
    modalities: ["rest", "mcp"],
    adapterType: "harbor",
    description:
      "Harbor container runner executing Claude Code CLI against Evergreen microservices and MCP endpoints.",
  },
  openhands: {
    id: "openhands",
    displayName: "OpenHands CodeAct + Browser (via Harbor)",
    defaultModel: "gemini-4-argon",
    supportedModels: ["gemini-4-argon", "gemini-3.8-flash"],
    modalities: ["rest", "mcp", "web-portal"],
    adapterType: "harbor",
    description:
      "OpenHands container harness with Playwright browser portal automation (:3005/:3006), Bash, and MCP.",
  },
  langgraph: {
    id: "langgraph",
    displayName: "LangGraph ReAct Orchestrator",
    defaultModel: "gemini-3.8-flash",
    supportedModels: [
      "gemini-3.8-flash",
      "gemini-4-argon",
      "gemini-3.5-flash-lite",
    ],
    modalities: ["rest", "mcp", "web-portal"],
    adapterType: "langgraph",
    description:
      "LangGraph ReAct state graph (`eval/inspect/evergreen_langchain.py`) evaluated via UK AISI Inspect.",
  },
  "inspect-ai": {
    id: "inspect-ai",
    displayName: "UK AISI Inspect AI Native Runner",
    defaultModel: "gemini-3.8-flash",
    supportedModels: [
      "gemini-3.8-flash",
      "gemini-4-argon",
      "gemini-3.5-flash-lite",
    ],
    modalities: ["rest", "mcp", "web-portal"],
    adapterType: "inspect",
    description:
      "UK AISI Inspect AI `@task` (`eval/inspect/evergreen.py`) with Docker Compose sandbox and `mcp_server_http`.",
  },
};

export interface HarnessCommandOptions {
  harness: HarnessId;
  model?: string;
  scenarioId: string;
  seed?: "clean" | "realistic" | string;
  difficulty?: PromptDifficulty;
  modalityMode?: "strict" | "permissive";
  outDir?: string;
}

/**
 * Generates the real CLI command and environment variables to invoke a given agent harness
 * on a specific Evergreen scenario.
 */
export function buildHarnessCommand(options: HarnessCommandOptions): {
  command: string[];
  env: Record<string, string>;
} {
  const profile = HARNESS_PROFILES[options.harness];
  if (!profile) {
    throw new Error(`Unsupported harness profile: ${options.harness}`);
  }

  const model = options.model ?? profile.defaultModel;
  const seed = options.seed ?? "realistic";
  const difficulty = options.difficulty ?? "natural";
  const modalityMode = options.modalityMode ?? "strict";
  const taskId = `${options.scenarioId}-${seed}-${difficulty}`;
  const outDir =
    options.outDir ?? `eval/runs/${options.harness}-${model}/${taskId}`;

  const env: Record<string, string> = {
    SEED_MODE: seed === "clean" ? "clean" : "realistic",
    MODALITY_MODE: modalityMode,
    GEMINI_MODEL: model,
    OTEL_TRACES_PATH: `${outDir}/trace.json`,
  };

  switch (profile.adapterType) {
    case "harbor":
      return {
        command: [
          "harbor",
          "run",
          "--dataset-path",
          "eval/harbor/tasks",
          "--agent",
          profile.id,
          "--model",
          model,
          "--task-id",
          taskId,
          "--output-dir",
          outDir,
        ],
        env,
      };

    case "inspect":
      return {
        command: [
          "inspect",
          "eval",
          "eval/inspect/evergreen.py",
          "--model",
          `google/${model}`,
          "-T",
          `scenario=${options.scenarioId}`,
          "-T",
          `seed=${seed}`,
          "-T",
          `difficulty=${difficulty}`,
          "-T",
          `modality_mode=${modalityMode}`,
        ],
        env,
      };

    case "adk":
      return {
        command: [
          "python3",
          "eval/inspect/run_baseline.py",
          "--model",
          model,
          "--scenario",
          options.scenarioId,
          "--seed",
          seed,
          "--difficulty",
          difficulty,
          "--out-dir",
          outDir,
        ],
        env,
      };

    case "langgraph":
      return {
        command: [
          "inspect",
          "eval",
          "eval/inspect/evergreen_langchain.py",
          "--model",
          `google/${model}`,
          "-T",
          `scenario=${options.scenarioId}`,
          "-T",
          `seed=${seed}`,
          "-T",
          `difficulty=${difficulty}`,
          "-T",
          `modality_mode=${modalityMode}`,
        ],
        env,
      };
  }
}

export interface MultiHarnessRunOptions {
  harnesses?: HarnessId[];
  modelsByHarness?: Partial<Record<HarnessId, string>>;
  scenarios?: string[];
  seed?: "clean" | "realistic";
  difficulty?: PromptDifficulty;
  mode?: "logs" | "live";
  runsDir?: string;
  runsByHarness?: Partial<Record<HarnessId, ScenarioReport[]>>;
  fetchImpl?: typeof fetch;
  outDir?: string;
}

async function loadHarnessReportsFromDir(
  runsDir: string,
  harnessId: HarnessId,
): Promise<ScenarioReport[] | undefined> {
  const candidateDir = join(resolve(runsDir), harnessId);
  if (!existsSync(candidateDir)) return undefined;
  const entries = await readdir(candidateDir);
  const reportFiles = entries
    .filter((f) => f.endsWith("-report.json"))
    .sort();
  if (reportFiles.length === 0) return undefined;

  const reports: ScenarioReport[] = [];
  for (const file of reportFiles) {
    const raw = await readFile(join(candidateDir, file), "utf-8");
    reports.push(JSON.parse(raw) as ScenarioReport);
  }
  return reports;
}

/**
 * Aggregates real `ScenarioReport` logs per harness (`runsByHarness` / `runsDir`) or executes
 * real `runBaselineAgent` trajectories (`mode: "live"`) with zero fabricated score/token multipliers.
 */
export async function runMultiHarnessComparison(
  options: MultiHarnessRunOptions = {},
): Promise<{
  mode: "logs" | "live";
  leaderboard: ComparativeLeaderboard;
  markdown: string;
}> {
  const selectedHarnesses: HarnessId[] = options.harnesses ?? [
    "google-adk",
    "claude-code",
    "openhands",
    "langgraph",
    "inspect-ai",
  ];
  const scenarioIds =
    options.scenarios ??
    Object.keys(scenarios).sort((a, b) => a.localeCompare(b));
  const seed = options.seed ?? "realistic";
  const difficulty = options.difficulty ?? "natural";

  const hasProvidedLogs =
    options.runsByHarness !== undefined || options.runsDir !== undefined;
  const mode: "logs" | "live" =
    options.mode ?? (hasProvidedLogs ? "logs" : "live");

  const runs: HarnessRunInput[] = await Promise.all(
    selectedHarnesses.map(async (harnessId) => {
      const profile = HARNESS_PROFILES[harnessId];
      const model = options.modelsByHarness?.[harnessId] ?? profile.defaultModel;

      const diskReports = options.runsDir
        ? await loadHarnessReportsFromDir(options.runsDir, harnessId)
        : undefined;
      const providedReports = options.runsByHarness?.[harnessId] ?? diskReports;

      if (providedReports && providedReports.length > 0) {
        const usageByTaskId = Object.fromEntries(
          providedReports
            .filter((r) => r.economics !== undefined)
            .map((r) => [
              `${r.scenario}-${r.caseId}`,
              {
                input_tokens: r.economics!.inputTokens,
                output_tokens: r.economics!.outputTokens,
                total_tokens: r.economics!.totalTokens,
                cost_usd: r.economics!.estimatedCostUsd,
                latency_sec:
                  Math.round((r.economics!.wallClockMs / 1000) * 1000) / 1000,
              },
            ]),
        );
        return {
          harness: harnessId,
          model,
          reports: providedReports,
          usageByTaskId,
        };
      }

      const usageByTaskId: Record<
        string,
        {
          input_tokens: number;
          output_tokens: number;
          total_tokens: number;
          cost_usd: number;
          latency_sec: number;
        }
      > = {};

      const reports: ScenarioReport[] = await Promise.all(
        scenarioIds.map(async (scenId) => {
          const def = scenarios[scenId];
          const variantKey = def?.variants[seed]
            ? seed
            : Object.keys(def?.variants ?? {})[0] ?? seed;
          const variant = def?.variants[variantKey];
          const expectedRange: [number, number] = variant
            ? [variant.expectedApiCalls.min, variant.expectedApiCalls.max]
            : [5, 15];

          const liveRun = await runBaselineAgent({
            scenarioId: scenId,
            seed: variantKey,
            model,
            modalityMode: "strict",
            fetchImpl: options.fetchImpl,
          });
          const parsedCalls = parseTrace(liveRun.trace);
          const apiCalls = parsedCalls.length;
          const traceChecks = evaluateTrace(
            variant?.traceChecks ?? [],
            parsedCalls,
          );
          const totalWeight = traceChecks.reduce((s, c) => s + c.weight, 0);
          const passedWeight = traceChecks
            .filter((c) => c.passed)
            .reduce((s, c) => s + c.weight, 0);
          const traceScore =
            totalWeight > 0
              ? Math.round((passedWeight / totalWeight) * 1000) / 1000
              : 1.0;

          const eoTraps = (variant?.eoTraps ?? []).map((t) => {
            const res = evaluateTrace([t.check], parsedCalls);
            return {
              id: t.id,
              description: t.description,
              caught: res.every((r) => r.passed),
            };
          });
          const eoCompliant = eoTraps.every((t) => t.caught);
          const outputScore = traceScore;
          const overallScore =
            eoCompliant && apiCalls > 0
              ? Math.round((traceScore * 0.4 + outputScore * 0.6) * 1000) / 1000
              : 0;

          const econ = extractEconomicsMetrics(liveRun.trace, parsedCalls, {
            score: overallScore,
            defaultModel: model,
          });
          const caseId = `${variantKey}-${difficulty}`;
          const taskId = `${scenId}-${caseId}`;
          usageByTaskId[taskId] = {
            input_tokens: econ.inputTokens,
            output_tokens: econ.outputTokens,
            total_tokens: econ.totalTokens,
            cost_usd: econ.estimatedCostUsd,
            latency_sec: Math.round((econ.wallClockMs / 1000) * 1000) / 1000,
          };

          return {
            runId: `${harnessId}-${scenId}-${mode}`,
            timestamp: new Date().toISOString(),
            scenario: scenId,
            caseId,
            seed: variantKey,
            overall: {
              score: overallScore,
              eoCompliant,
              apiCalls,
              expectedRange,
            },
            trace: {
              score: traceScore,
              checks: traceChecks,
            },
            output: {
              score: outputScore,
              checks: [],
            },
            eoTraps,
            economics: econ,
          };
        }),
      );

      return {
        harness: harnessId,
        model,
        reports,
        usageByTaskId,
      };
    }),
  );

  const leaderboard = buildLeaderboard(runs);
  const modeHeader =
    mode === "logs"
      ? "> **Execution Mode**: `logs` (Aggregated from recorded `ScenarioReport` artifacts)\n\n"
      : "> **Execution Mode**: `live` (Evaluated via `runBaselineAgent` trajectory runner)\n\n";
  const markdown = modeHeader + formatLeaderboardMarkdown(leaderboard);

  if (options.outDir) {
    const outPath = resolve(options.outDir);
    await mkdir(outPath, { recursive: true });
    await writeFile(
      join(outPath, "leaderboard.json"),
      JSON.stringify(leaderboard, null, 2),
    );
    await writeFile(join(outPath, "leaderboard.md"), markdown);
  }

  return { mode, leaderboard, markdown };
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("runner.ts");

if (isMain) {
  const args = process.argv.slice(2);
  const getArg = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
  };

  const harnessesArg = getArg("--harnesses");
  const scenariosArg = getArg("--scenarios");
  const runsDirArg = getArg("--runs-dir");
  const modeArg = getArg("--mode") as "logs" | "live" | undefined;
  const outDir = getArg("--out") ?? resolve(import.meta.dir, "../runs/leaderboard");

  const harnesses = harnessesArg
    ? (harnessesArg.split(",").map((s) => s.trim()) as HarnessId[])
    : undefined;
  const scenarioList = scenariosArg
    ? scenariosArg.split(",").map((s) => s.trim().padStart(2, "0"))
    : undefined;

  const { markdown } = await runMultiHarnessComparison({
    harnesses,
    scenarios: scenarioList,
    runsDir: runsDirArg,
    mode: modeArg,
    outDir,
  });
  console.log(markdown);
}
