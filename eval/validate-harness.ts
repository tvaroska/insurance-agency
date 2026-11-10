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

async function ensureServicesAvailable(baseUrls: Record<string, string>): Promise<void> {
  try {
    const res = await fetch(`${baseUrls.ams ?? "http://localhost:3000"}/health`);
    if (res.ok) return;
  } catch {
    // Fall back to in-process Hono service dispatch when live TCP servers are not running
  }

  process.env.JWT_SECRET ??= "dev-secret";
  process.env.MODALITY_MODE ??= "strict";

  const [ams, rater, crm, ecm, comm, summit, coastal, claims] = await Promise.all([
    import("../services/ams/src/index"),
    import("../services/rater/src/index"),
    import("../services/crm/src/index"),
    import("../services/ecm/src/index"),
    import("../services/comm/src/index"),
    import("../services/carrier-summit/src/index"),
    import("../services/carrier-coastal/src/index"),
    import("../services/claims/src/index"),
  ]);

  const serviceApps: Record<string, { fetch: (req: Request) => Response | Promise<Response> }> = {
    [baseUrls.ams ?? "http://localhost:3000"]: ams.default,
    [baseUrls.rater ?? "http://localhost:3001"]: rater.default,
    [baseUrls.crm ?? "http://localhost:3002"]: crm.default,
    [baseUrls.ecm ?? "http://localhost:3003"]: ecm.default,
    [baseUrls.comm ?? "http://localhost:3004"]: comm.default,
    [baseUrls["summit-fire"] ?? "http://localhost:3005"]: summit.default,
    [baseUrls["coastal-star"] ?? "http://localhost:3006"]: coastal.default,
    [baseUrls.claims ?? "http://localhost:3007"]: claims.default,
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    if (req.headers.get("X-Eval-Scorer") === "true") {
      req.headers.set("X-Evergreen-Internal", "1");
    }
    const origin = new URL(req.url).origin;
    const target = serviceApps[origin];
    if (target) {
      return await target.fetch(req);
    }
    return originalFetch(req);
  }) as typeof fetch;
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

/** Reset once per variant, score no-op on untouched state, then act and score scripted agent. */
async function scoreVariantPair(
  scenarioId: string,
  variant: string,
  caseId: string,
  baseUrls: Record<string, string>,
  act: () => Promise<AgentStepResult[]>,
): Promise<{ scripted: RunResult; nothing: RunResult }> {
  await resetServices(baseUrls, seedModeFor(variant));
  const snapshotBefore = await fetchGymSnapshot(baseUrls);

  const emptyTrace = await collectTrace(baseUrls);
  const { report: nothingReport } = await scoreScenario(scenarioId, emptyTrace, {
    seed: variant,
    caseId,
    snapshotBefore,
    snapshotAfter: snapshotBefore,
    baseUrls,
  });
  const nothing: RunResult = {
    report: nothingReport,
    spans: summarizeTrace(emptyTrace),
    failedSteps: [],
  };

  const steps = await act();
  const trace = await collectTrace(baseUrls);
  const snapshotAfter = await fetchGymSnapshot(baseUrls);
  const { report: scriptedReport } = await scoreScenario(scenarioId, trace, {
    seed: variant,
    caseId,
    snapshotBefore,
    snapshotAfter,
    baseUrls,
  });
  const scripted: RunResult = {
    report: scriptedReport,
    spans: summarizeTrace(trace),
    failedSteps: steps
      .filter((s) => s.status < 200 || s.status >= 300)
      .map((s) => `${s.action.method} ${s.action.service} ${s.action.path} returned ${s.status}`),
  };

  return { scripted, nothing };
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
    row.scripted?.report.overall.eoCompliant !== true ||
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
      variant: { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`Usage: bun eval/validate-harness.ts [--scenario 01,02] [--variant clean,realistic]

For each scenario variant's first test case, against the live services: the scripted
reference agent must score 1.000 (passed: true) and an agent that does nothing must
score 0.000 (passed: false), both scored from the service-side trace (GET /sim/trace).
Exits non-zero on any mismatch. Base URLs honor EVERGREEN_BASE_URLS like eval/collect-trace.ts.`);
    process.exit(0);
  }

  const baseUrls = resolveBaseUrls();
  await ensureServicesAvailable(baseUrls);
  const ids = values.scenario
    ? values.scenario.split(",").map((s) => s.trim().padStart(2, "0"))
    : Object.keys(scenarios).sort();
  const variantFilter = values.variant
    ? new Set(values.variant.split(",").map((v) => v.trim()))
    : undefined;
  const unknown = ids.filter((id) => !scenarios[id]);
  if (unknown.length > 0) {
    console.error(`Unknown scenario(s): ${unknown.join(", ")}`);
    process.exit(1);
  }

  const rows: Row[] = [];
  for (const id of ids) {
    for (const [variant, variantDef] of Object.entries(scenarios[id].variants)) {
      if (variantFilter && !variantFilter.has(variant)) continue;
      const testCase = variantDef.cases[0];
      const row: Row = { scenario: id, caseId: `${variant}/${testCase.id}` };
      rows.push(row);
      try {
        const pair = await scoreVariantPair(id, variant, testCase.id, baseUrls, async () => {
          const result = await runBaselineAgent({ scenarioId: id, seed: variant, baseUrls });
          return result.steps;
        });
        row.scripted = pair.scripted;
        row.nothing = pair.nothing;
      } catch (err) {
        row.error = err instanceof Error ? err.message : String(err);
      }
      console.error(`scenario ${id} (${variant}): ${isMismatch(row) ? "MISMATCH" : "ok"}`);
    }
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
    if (row.scripted && (row.scripted.report.overall.score !== 1 || !row.scripted.report.overall.eoCompliant)) {
      console.log(`  scripted agent scored ${formatScore(row.scripted)}, expected 1.000`);
      for (const l of failureLines(row.scripted)) console.log(`    ${l}`);
    }
    if (row.nothing && row.nothing.report.overall.score !== 0) {
      console.log(`  no-op agent scored ${formatScore(row.nothing)}, expected 0.000`);
      for (const l of passedLines(row.nothing)) console.log(`    ${l}`);
    }
  }

  console.log(
    `\n${rows.length - mismatches.length}/${rows.length} scenario variants OK` +
      (mismatches.length > 0 ? `; mismatches: ${mismatches.map((r) => `${r.scenario}(${r.caseId})`).join(", ")}` : ""),
  );
  process.exit(mismatches.length > 0 ? 1 : 0);
}
