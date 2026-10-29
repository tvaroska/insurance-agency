/**
 * Export scenario definitions to tasks.json for the METR TaskFamily.
 *
 * Usage: bun eval/metr/export-tasks.ts
 */
import { writeFile } from "fs/promises";
import { resolve } from "path";
import { scenarios } from "../scenarios/index";

interface MeTask {
  scenario_id: string;
  scenario_name: string;
  seed: string;
  case_id: string;
  prompt: string;
  difficulty: string;
  prompt_difficulty: string;
  services: string[];
  eo_trap_ids?: number[];
  rubric_criteria_ids?: string[];
}

const tasks: Record<string, MeTask> = {};

const sortedScenarioEntries = Object.entries(scenarios).sort(([a], [b]) =>
  a.localeCompare(b),
);

for (const [id, scenario] of sortedScenarioEntries) {
  for (const [seed, variant] of Object.entries(scenario.variants)) {
    for (const testCase of variant.cases) {
      const taskId = `${id}-${seed}-${testCase.difficulty}`;
      tasks[taskId] = {
        scenario_id: id,
        scenario_name: scenario.name,
        seed,
        case_id: testCase.id,
        prompt: testCase.prompt,
        difficulty: scenario.difficulty,
        prompt_difficulty: testCase.difficulty,
        services: scenario.services,
        eo_trap_ids: variant.eoTraps.map((t) => t.id),
        rubric_criteria_ids: (variant.rubricChecks ?? []).map((r) => r.id),
      };
    }
  }
}

const outPath = resolve(import.meta.dir, "tasks.json");
await writeFile(outPath, JSON.stringify(tasks, null, 2));
console.log(`Exported ${Object.keys(tasks).length} tasks to ${outPath}`);
