import { parseArgs } from "util";

import type { ScenarioReport } from "./types";
import { scenarios } from "./scenarios/index";
import { runBaselineAgent, type AgentStepResult } from "./agents/baseline-agent";
import { collectTrace, resolveBaseUrls, summarizeTrace } from "./collect-trace";
import { fetchGymSnapshot } from "./evaluators/state-diff";
import { scoreScenario } from "./score";

// Pre-spend check (ADR-005 item 6). Scored from the service-side trace, the scripted
// reference agent must score 1.0 and an agent that does nothing must score 0 on every
// scenario's first test case. Needs the live services (bun run showcase).

interface RunResult {
  report: ScenarioReport;
  spans: string;
  failedSteps: string[];
}

interface Row {
  scenario: string;
  caseId: string;
  scripted?: RunResult;
  nothing?: RunResult;
  error?: string;
}

/** Same mapping as the OpenEnv adapter: only the "clean" variant uses the clean seed. */
function seedModeFor(variant: string): "clean" | "realistic" {
  return variant === "clean" ? "clean" : "realistic";
}

async function resetServices(baseUrls: Record<string, string>, seedMode: string): Promise<void> {
  await Promise.all(
    Object.entries(baseUrls).map(async ([service, baseUrl]) => {
      const res = await fetch(`${baseUrl}/sim/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed_mode: seedMode }),
      });
      if (!res.ok) {
        throw new Error(`${service}: POST /sim/reset returned ${res.status}: ${await res.text()}`);
      }
    }),
  );
}

/** Reset, snapshot, act, collect the service-side trace, snapshot, and score like eval/score.ts. */
async function scoreRun(
  scenarioId: string,
  variant: string,
  caseId: string,
  baseUrls: Record<string, string>,
  act: () => Promise<AgentStepResult[]>,
): Promise<RunResult> {
  await resetServices(baseUrls, seedModeFor(variant));
  const snapshotBefore = await fetchGymSnapshot(baseUrls);
  const steps = await act();
  const trace = await collectTrace(baseUrls);
  const snapshotAfter = await fetchGymSnapshot(baseUrls);
  const { report } = await scoreScenario(scenarioId, trace, {
    seed: variant,
    caseId,
    snapshotBefore,
    snapshotAfter,
    baseUrls,
  });
  return {
    report,
    spans: summarizeTrace(trace),
    failedSteps: steps
      .filter((s) => s.status < 200 || s.status >= 300)
      .map((s) => `${s.action.method} ${s.action.service} ${s.action.path} returned ${s.status}`),
  };
}

function failureLines(run: RunResult): string[] {
  const { report } = run;
  return [
    ...run.failedSteps.map((s) => `agent step: ${s}`),
    ...report.trace.checks
      .filter((c) => !c.passed)
      .map((c) => `trace ${c.name}: ${c.detail ?? "failed"}`),
    ...report.output.checks
      .filter((c) => !c.passed)
      .map((c) => `output ${c.name}: ${c.detail ?? "failed"}`),
    ...report.eoTraps.filter((t) => !t.caught).map((t) => `E&O trap ${t.id} not caught: ${t.description}`),
    ...(report.stateDiff?.findings ?? []).map((f) => `collateral ${f.type}: ${f.detail}`),
  ];
}

function passedLines(run: RunResult): string[] {
  const { report } = run;
  return [
    ...report.trace.checks.filter((c) => c.passed).map((c) => `trace ${c.name} passed`),
    ...report.output.checks.filter((c) => c.passed).map((c) => `output ${c.name} passed`),
  ];
}

function isMismatch(row: Row): boolean {
  return (
    row.error !== undefined ||
    row.scripted?.report.overall.score !== 1 ||
    row.nothing?.report.overall.score !== 0
  );
}

function formatScore(run: RunResult | undefined): string {
  return run ? run.report.overall.score.toFixed(3) : "-";
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      scenario: { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`Usage: bun eval/validate-harness.ts [--scenario 01,02]

For each scenario's first test case, against the live services: the scripted
reference agent must score 1.0 and an agent that does nothing must score 0, both
scored from the service-side trace (GET /sim/trace). Exits non-zero on any
mismatch. Base URLs honor EVERGREEN_BASE_URLS like eval/collect-trace.ts.`);
    process.exit(0);
  }

  const baseUrls = resolveBaseUrls();
  const ids = values.scenario
    ? values.scenario.split(",").map((s) => s.trim().padStart(2, "0"))
    : Object.keys(scenarios).sort();
  const unknown = ids.filter((id) => !scenarios[id]);
  if (unknown.length > 0) {
    console.error(`Unknown scenario(s): ${unknown.join(", ")}`);
    process.exit(1);
  }

  const rows: Row[] = [];
  for (const id of ids) {
    const [variant, variantDef] = Object.entries(scenarios[id].variants)[0];
    const testCase = variantDef.cases[0];
    const row: Row = { scenario: id, caseId: `${variant}/${testCase.id}` };
    rows.push(row);
    try {
      row.scripted = await scoreRun(id, variant, testCase.id, baseUrls, async () => {
        const result = await runBaselineAgent({ scenarioId: id, seed: variant, baseUrls });
        return result.steps;
      });
      row.nothing = await scoreRun(id, variant, testCase.id, baseUrls, async () => []);
    } catch (err) {
      row.error = err instanceof Error ? err.message : String(err);
    }
    console.error(`scenario ${id}: ${isMismatch(row) ? "MISMATCH" : "ok"}`);
  }

  const header = ["Scenario", "Case", "Scripted", "No-op", "Scripted spans", "Result"];
  const table = rows.map((row) => [
    row.scenario,
    row.caseId,
    formatScore(row.scripted),
    formatScore(row.nothing),
    row.scripted?.spans ?? "-",
    isMismatch(row) ? (row.error ? "ERROR" : "MISMATCH") : "OK",
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...table.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  console.log(line(header));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const r of table) console.log(line(r));

  const mismatches = rows.filter(isMismatch);
  for (const row of mismatches) {
    console.log(`\nScenario ${row.scenario} (${row.caseId}):`);
    if (row.error) {
      console.log(`  error: ${row.error}`);
      continue;
    }
    if (row.scripted && row.scripted.report.overall.score !== 1) {
      console.log(`  scripted agent scored ${formatScore(row.scripted)}, expected 1.000`);
      for (const l of failureLines(row.scripted)) console.log(`    ${l}`);
    }
    if (row.nothing && row.nothing.report.overall.score !== 0) {
      console.log(`  no-op agent scored ${formatScore(row.nothing)}, expected 0.000`);
      for (const l of passedLines(row.nothing)) console.log(`    ${l}`);
    }
  }

  console.log(
    `\n${rows.length - mismatches.length}/${rows.length} scenarios OK` +
      (mismatches.length > 0 ? `; mismatches: ${mismatches.map((r) => r.scenario).join(", ")}` : ""),
  );
  process.exit(mismatches.length > 0 ? 1 : 0);
}
