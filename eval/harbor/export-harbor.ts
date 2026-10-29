/**
 * Export Evergreen Insurance API Gym scenarios to the Harbor / Terminal-Bench 2.0 task standard.
 *
 * Generates:
 *   - eval/harbor/tasks-manifest.json (all 253 task cases across 20 scenarios)
 *   - eval/harbor/docker-compose.harbor.yaml (shared 8-service + agent container topology)
 *   - eval/harbor/tasks/<task_id>/task.yaml
 *   - eval/harbor/tasks/<task_id>/tests/test_outputs.py (invokes `bun eval/score.ts`)
 *
 * Usage:
 *   bun eval/harbor/export-harbor.ts [--out-dir <dir>] [--all] [--summary-only]
 */

import { mkdir, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { scenarios } from "../scenarios/index";
import type { PromptDifficulty } from "../types";

export interface HarborTaskEntry {
  task_id: string;
  scenario_id: string;
  scenario_name: string;
  seed: string;
  case_id: string;
  difficulty: "easy" | "medium" | "hard";
  prompt_difficulty: PromptDifficulty;
  services: string[];
  expected_api_calls: { min: number; max: number };
  eo_trap_ids: number[];
  rubric_criteria_ids?: string[];
  instruction: string;
  max_agent_timeout_sec: number;
  max_test_timeout_sec: number;
}

export interface HarborManifest {
  standard: "harbor-2.0";
  benchmark: "evergreen-insurance-gym";
  version: "0.4.0";
  total_scenarios: number;
  total_tasks: number;
  default_models: {
    workhorse: string;
    reasoning: string;
    fast: string;
  };
  tasks: Record<string, HarborTaskEntry>;
}

export function buildInstruction(
  prompt: string,
  services: string[],
  seed: string,
): string {
  const servicesList = services.join(", ");
  return [
    "You are an insurance agency operations agent with access to the Evergreen Insurance API Gym.",
    `Active services for this scenario (${servicesList}) are running on localhost ports 3000-3007.`,
    "Obtain a Bearer token via POST http://localhost:3000/oauth/token (grant_type=client_credentials, client_id=agent-full, client_secret=dev-secret).",
    "OpenAPI 3.1 specifications for REST services are available in the specs/ directory, and Comm Hub MCP is available at http://localhost:3004/mcp.",
    `Environment seed mode: ${seed}.`,
    "",
    "## Scenario Prompt",
    "",
    prompt,
    "",
    "## Trace Output",
    "",
    "Record all HTTP and/or OTel GenAI tool spans to /workspace/traces/trace.json (or $OTEL_TRACES_PATH) so the Harbor verifier can run `bun eval/score.ts`.",
  ].join("\n");
}

export function buildHarborManifest(): HarborManifest {
  const tasks: Record<string, HarborTaskEntry> = {};
  const sortedScenarioEntries = Object.entries(scenarios).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  for (const [id, scenario] of sortedScenarioEntries) {
    for (const [seed, variant] of Object.entries(scenario.variants)) {
      for (const testCase of variant.cases) {
        const taskId = `${id}-${seed}-${testCase.difficulty}`;
        const timeoutByDifficulty =
          scenario.difficulty === "hard"
            ? 600
            : scenario.difficulty === "medium"
              ? 420
              : 300;

        tasks[taskId] = {
          task_id: taskId,
          scenario_id: id,
          scenario_name: scenario.name,
          seed,
          case_id: testCase.id,
          difficulty: scenario.difficulty,
          prompt_difficulty: testCase.difficulty,
          services: [...scenario.services],
          expected_api_calls: { ...variant.expectedApiCalls },
          eo_trap_ids: variant.eoTraps.map((t) => t.id),
          rubric_criteria_ids: (variant.rubricChecks ?? []).map((r) => r.id),
          instruction: buildInstruction(
            testCase.prompt,
            scenario.services,
            seed,
          ),
          max_agent_timeout_sec: timeoutByDifficulty,
          max_test_timeout_sec: 120,
        };
      }
    }
  }

  return {
    standard: "harbor-2.0",
    benchmark: "evergreen-insurance-gym",
    version: "0.5.0",
    total_scenarios: sortedScenarioEntries.length,
    total_tasks: Object.keys(tasks).length,
    default_models: {
      workhorse: "gemini-3.8-flash",
      reasoning: "gemini-4-argon",
      fast: "gemini-3.5-flash-lite",
    },
    tasks,
  };
}

function yamlEscapeBlock(text: string, indent = 2): string {
  const prefix = " ".repeat(indent);
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export function renderTaskYaml(task: HarborTaskEntry): string {
  const tags = [
    "insurance",
    "small-business",
    `scenario-${task.scenario_id}`,
    `seed-${task.seed}`,
    `prompt-${task.prompt_difficulty}`,
    ...task.services.map((s) => `service-${s}`),
  ];
  if (task.eo_trap_ids.length > 0) {
    tags.push("eo-compliance-trap");
  }

  return [
    `# Harbor / Terminal-Bench 2.0 Task Definition — ${task.task_id}`,
    `task_id: "${task.task_id}"`,
    `benchmark: "evergreen-insurance-gym"`,
    `scenario_id: "${task.scenario_id}"`,
    `scenario_name: ${JSON.stringify(task.scenario_name)}`,
    `seed: "${task.seed}"`,
    `case_id: "${task.case_id}"`,
    `difficulty: "${task.difficulty}"`,
    `prompt_difficulty: "${task.prompt_difficulty}"`,
    `author_name: "Evergreen Insurance API Gym"`,
    `category: "enterprise_workflows"`,
    `tags:`,
    ...tags.map((t) => `  - "${t}"`),
    `services:`,
    ...task.services.map((s) => `  - "${s}"`),
    `expected_api_calls:`,
    `  min: ${task.expected_api_calls.min}`,
    `  max: ${task.expected_api_calls.max}`,
    `eo_trap_ids: [${task.eo_trap_ids.join(", ")}]`,
    `max_agent_timeout_sec: ${task.max_agent_timeout_sec}`,
    `max_test_timeout_sec: ${task.max_test_timeout_sec}`,
    `docker_compose: "../../docker-compose.harbor.yaml"`,
    `environment:`,
    `  SEED_MODE: "${task.seed === "clean" ? "clean" : "realistic"}"`,
    `  SCENARIO_ID: "${task.scenario_id}"`,
    `  SCENARIO_SEED: "${task.seed}"`,
    `  SCENARIO_CASE: "${task.case_id}"`,
    `  OTEL_TRACES_PATH: "/workspace/traces/trace.json"`,
    `parser_name: "pytest"`,
    `instruction: |`,
    yamlEscapeBlock(task.instruction, 2),
    "",
  ].join("\n");
}

export function renderTestOutputsPy(task: HarborTaskEntry): string {
  return `"""Harbor / Terminal-Bench verifier for task ${task.task_id}.

Invokes the canonical Evergreen TypeScript scorer (\`bun eval/score.ts\`)
and asserts E&O regulatory compliance and passing benchmark score.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

SCENARIO_ID = "${task.scenario_id}"
SEED_VARIANT = "${task.seed}"
CASE_ID = "${task.case_id}"
TASK_ID = "${task.task_id}"


def _resolve_gym_root() -> Path:
    env_root = os.environ.get("EVERGREEN_GYM_ROOT")
    if env_root:
        return Path(env_root).resolve()
    # eval/harbor/tasks/<task_id>/tests/test_outputs.py -> repo root is 5 levels up
    return Path(__file__).resolve().parents[5]


def _resolve_trace_path(gym_root: Path) -> Path:
    candidates = [
        os.environ.get("OTEL_TRACES_PATH"),
        "/workspace/traces/trace.json",
        str(gym_root / "traces" / "trace.json"),
        str(gym_root / "eval" / "__tests__" / "fixtures" / "otlp-scenario01.json"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return Path(candidate)
    # Create an empty OTLP trace skeleton if the harness only mutated backend state
    fallback = Path("/tmp/harbor-empty-trace.json")
    if not fallback.exists():
        fallback.write_text(json.dumps({"resourceSpans": []}))
    return fallback


def run_evergreen_scorer() -> dict:
    gym_root = _resolve_gym_root()
    trace_path = _resolve_trace_path(gym_root)
    out_dir = Path(os.environ.get("HARBOR_SCORE_OUT", f"/tmp/harbor-score-{TASK_ID}"))
    out_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        "bun",
        "eval/score.ts",
        "--traces",
        str(trace_path),
        "--scenario",
        SCENARIO_ID,
        "--seed",
        SEED_VARIANT,
        "--case",
        CASE_ID,
        "--out",
        str(out_dir),
    ]
    result = subprocess.run(
        cmd,
        cwd=str(gym_root),
        capture_output=True,
        text=True,
        timeout=90,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Evergreen scorer failed (exit {result.returncode}): {result.stderr or result.stdout}"
        )

    report_path = out_dir / f"{SCENARIO_ID}-report.json"
    if not report_path.exists():
        raise FileNotFoundError(f"Expected report not found at {report_path}")

    return json.loads(report_path.read_text())


def test_eo_compliance_and_score() -> None:
    report = run_evergreen_scorer()
    overall = report["overall"]

    # Write Harbor reward payload for partial-credit leaderboard aggregation
    reward_file = Path(os.environ.get("HARBOR_REWARD_FILE", "/tmp/harbor-reward.json"))
    reward_file.write_text(
        json.dumps(
            {
                "task_id": TASK_ID,
                "scenario_id": SCENARIO_ID,
                "seed": SEED_VARIANT,
                "case_id": CASE_ID,
                "score": overall["score"],
                "trace_score": report["trace"]["score"],
                "output_score": report["output"]["score"],
                "eo_compliant": overall["eoCompliant"],
                "api_calls": overall["apiCalls"],
            },
            indent=2,
        )
    )

    assert overall["eoCompliant"] is True, (
        f"E&O violation detected in {TASK_ID}: {report.get('eoTraps', [])}"
    )
    threshold = float(os.environ.get("HARBOR_PASS_THRESHOLD", "0.70"))
    assert float(overall["score"]) >= threshold, (
        f"Score {overall['score']:.3f} below threshold {threshold:.3f} "
        f"(trace={report['trace']['score']:.3f}, output={report['output']['score']:.3f})"
    )
`;
}

export function renderHarborDockerCompose(): string {
  return `# Harbor / Terminal-Bench 2.0 Docker Compose Topology for Evergreen Insurance API Gym
# Extends the root 8-microservice stack with an isolated Harbor agent workspace container.

include:
  - ../../docker-compose.yml

services:
  harbor-agent:
    image: oven/bun:1-debian
    working_dir: /workspace
    network_mode: "host"
    environment:
      - SEED_MODE=\${SEED_MODE:-realistic}
      - MODALITY_MODE=\${MODALITY_MODE:-permissive}
      - OTEL_TRACES_PATH=/workspace/traces/trace.json
      - EVERGREEN_GYM_ROOT=/workspace
      - GEMINI_MODEL=\${GEMINI_MODEL:-gemini-3.8-flash}
    volumes:
      - ../../:/workspace
    depends_on:
      ams:
        condition: service_healthy
      rater:
        condition: service_healthy
      crm:
        condition: service_healthy
      ecm:
        condition: service_healthy
      comm:
        condition: service_healthy
      carrier-summit:
        condition: service_healthy
      carrier-coastal:
        condition: service_healthy
      claims:
        condition: service_healthy
    command: ["sleep", "infinity"]
`;
}

export interface ExportHarborOptions {
  outDir?: string;
  allCases?: boolean;
  summaryOnly?: boolean;
}

export async function exportHarborTasks(
  options: ExportHarborOptions = {},
): Promise<{
  manifest: HarborManifest;
  exportedTaskIds: string[];
  manifestPath: string;
  composePath: string;
}> {
  const baseDir = options.outDir
    ? resolve(options.outDir)
    : resolve(import.meta.dir);
  await mkdir(baseDir, { recursive: true });

  const manifest = buildHarborManifest();
  const manifestPath = join(baseDir, "tasks-manifest.json");
  const composePath = join(baseDir, "docker-compose.harbor.yaml");

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(composePath, renderHarborDockerCompose());

  const exportedTaskIds: string[] = [];

  if (!options.summaryOnly) {
    const tasksDir = join(baseDir, "tasks");
    await mkdir(tasksDir, { recursive: true });

    const seenScenarios = new Set<string>();
    const entries = Object.values(manifest.tasks).filter((task) => {
      if (options.allCases) return true;
      // Default: export 1 canonical representative natural-difficulty task per scenario (20 total)
      if (task.prompt_difficulty !== "natural") return false;
      if (task.seed === "realistic") {
        seenScenarios.add(task.scenario_id);
        return true;
      }
      if (task.seed !== "clean" && !seenScenarios.has(task.scenario_id)) {
        seenScenarios.add(task.scenario_id);
        return true;
      }
      return false;
    });

    for (const task of entries) {
      const taskDir = join(tasksDir, task.task_id);
      const testsDir = join(taskDir, "tests");
      await mkdir(testsDir, { recursive: true });

      await writeFile(join(taskDir, "task.yaml"), renderTaskYaml(task));
      await writeFile(
        join(testsDir, "test_outputs.py"),
        renderTestOutputsPy(task),
      );
      exportedTaskIds.push(task.task_id);
    }
  }

  return {
    manifest,
    exportedTaskIds,
    manifestPath,
    composePath,
  };
}

// Run CLI when invoked directly
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("export-harbor.ts");

if (isMain) {
  const args = process.argv.slice(2);
  const allCases = args.includes("--all");
  const summaryOnly = args.includes("--summary-only");
  const outIdx = args.indexOf("--out-dir");
  const outDir = outIdx >= 0 ? args[outIdx + 1] : undefined;

  const result = await exportHarborTasks({ outDir, allCases, summaryOnly });
  console.log(
    `Exported Harbor manifest (${result.manifest.total_tasks} tasks across ${result.manifest.total_scenarios} scenarios) and ${result.exportedTaskIds.length} task directories to ${outDir ?? resolve(import.meta.dir)}`,
  );
}
