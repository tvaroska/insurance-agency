import type { OutputCheck, PromptDifficulty, TestCase } from "../types";

export interface CasePromptSpec {
  id: string;
  difficulty: PromptDifficulty;
  prompt: string;
  outputChecks?: OutputCheck[];
}

/**
 * Resolves shared variant-level `defaultOutputChecks` across a variant's prompt difficulty
 * ladder (`scripted`, `explicit`, `natural`, `vague`, `adversarial`), while allowing
 * individual cases to supply explicit `outputChecks` overrides when needed.
 */
export function buildCases(
  defaultOutputChecks: OutputCheck[],
  specs: CasePromptSpec[],
): TestCase[] {
  return specs.map((spec) => ({
    id: spec.id,
    prompt: spec.prompt,
    difficulty: spec.difficulty,
    outputChecks: spec.outputChecks ?? defaultOutputChecks,
  }));
}
