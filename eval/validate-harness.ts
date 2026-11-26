import { parseArgs } from "util";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import type { ScenarioReport, VariantConfig } from "./types";
import { scenarios } from "./scenarios/index";
import {
  getReferencePlaybook,
  runBaselineAgent,
  type AgentStepResult,
  type AgentToolAction,
} from "./agents/baseline-agent";
import { collectTrace, resolveBaseUrls, summarizeTrace } from "./collect-trace";
import { scorerHeaders } from "./evaluators/output";
import { fetchGymSnapshot } from "./evaluators/state-diff";
import { scoreScenario } from "./score";

export interface RunResult {
  report: ScenarioReport;
  spans: string;
  failedSteps: string[];
}

export interface VariantAnchorResults {
  scenario: string;
  caseId: string;
  scripted?: RunResult;
  nothing?: RunResult;
  preSatisfiedOutputWeight?: number;
  oneGet?: RunResult;
  writeFree?: RunResult;
  blanket?: RunResult;
  refPlusViolation?: RunResult;
  error?: string;
}

function seedModeFor(variant: string): "clean" | "realistic" {
  return variant === "clean" ? "clean" : "realistic";
}

let isolatedTempDataDir: string | undefined;
let cleanupHookRegistered = false;
let savedFetch: typeof fetch | undefined;
let savedEnv: Record<string, string | undefined> | undefined;
let cachedServiceApps:
  | Record<string, { fetch: (req: Request) => Response | Promise<Response> }>
  | undefined;

function cleanupIsolatedTempDataDir(): void {
  if (!isolatedTempDataDir) return;
  const dir = isolatedTempDataDir;
  isolatedTempDataDir = undefined;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors on exit.
  }
}

export function teardownInProcessServices(): void {
  if (savedFetch) {
    globalThis.fetch = savedFetch;
    savedFetch = undefined;
  }
  if (savedEnv) {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    savedEnv = undefined;
  }
}

export async function ensureServicesAvailable(
  baseUrls: Record<string, string>,
  options: { live?: boolean } = {},
): Promise<void> {
  if (options.live) {
    const res = await fetch(`${baseUrls.ams ?? "http://localhost:3000"}/health`);
    if (!res.ok) {
      throw new Error(`--live requested, but AMS /health returned ${res.status}`);
    }
    return;
  }
  if (savedFetch) return;

  savedEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    MODALITY_MODE: process.env.MODALITY_MODE,
    EVERGREEN_SCORER_SECRET: process.env.EVERGREEN_SCORER_SECRET,
  };
  if (!process.env.EVERGREEN_DATA_DIR) {
    isolatedTempDataDir ??= mkdtempSync(join(tmpdir(), "evergreen-validate-"));
    process.env.EVERGREEN_DATA_DIR = isolatedTempDataDir;
    if (!cleanupHookRegistered) {
      process.once("exit", cleanupIsolatedTempDataDir);
      cleanupHookRegistered = true;
    }
  }
  process.env.JWT_SECRET ??= "dev-secret";
  process.env.MODALITY_MODE ??= "strict";
  process.env.EVERGREEN_SCORER_SECRET ??= "validate-harness-secret";

  if (!cachedServiceApps) {
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
    cachedServiceApps = {
      ams: ams.default,
      rater: rater.default,
      crm: crm.default,
      ecm: ecm.default,
      comm: comm.default,
      "summit-fire": summit.default,
      "coastal-star": coastal.default,
      claims: claims.default,
    };
  }

  const serviceApps: Record<string, { fetch: (req: Request) => Response | Promise<Response> }> = {
    [baseUrls.ams ?? "http://localhost:3000"]: cachedServiceApps.ams,
    [baseUrls.rater ?? "http://localhost:3001"]: cachedServiceApps.rater,
    [baseUrls.crm ?? "http://localhost:3002"]: cachedServiceApps.crm,
    [baseUrls.ecm ?? "http://localhost:3003"]: cachedServiceApps.ecm,
    [baseUrls.comm ?? "http://localhost:3004"]: cachedServiceApps.comm,
    [baseUrls["summit-fire"] ?? "http://localhost:3005"]: cachedServiceApps["summit-fire"],
    [baseUrls["coastal-star"] ?? "http://localhost:3006"]: cachedServiceApps["coastal-star"],
    [baseUrls.claims ?? "http://localhost:3007"]: cachedServiceApps.claims,
  };

  const originalFetch = globalThis.fetch;
  savedFetch = originalFetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    if (req.headers.get("X-Eval-Scorer") === "true") {
      req.headers.set("X-Evergreen-Internal", "1");
      if (process.env.EVERGREEN_SCORER_SECRET) {
        req.headers.set("X-Evergreen-Scorer-Secret", process.env.EVERGREEN_SCORER_SECRET);
      }
    }
    const origin = new URL(req.url).origin;
    const target = serviceApps[origin];
    if (target) {
      return await target.fetch(req);
    }
    return originalFetch(req);
  }) as typeof fetch;
}

export async function resetServices(
  baseUrls: Record<string, string>,
  seedMode: string,
  scenarioId?: string,
): Promise<void> {
  await Promise.all(
    Object.entries(baseUrls).map(async ([service, baseUrl]) => {
      const res = await fetch(`${baseUrl}/sim/reset`, {
        method: "POST",
        headers: scorerHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          seed_mode: seedMode,
          ...(scenarioId ? { scenario_id: scenarioId } : {}),
        }),
      });
      if (!res.ok) {
        throw new Error(`${service}: POST /sim/reset returned ${res.status}: ${await res.text()}`);
      }
    }),
  );
}

export function buildWriteFreeActions(scenarioId: string, variant: string): AgentToolAction[] {
  const reads = getReferencePlaybook(scenarioId, variant, "strict").filter((a) => a.method === "GET");
  return reads.length > 0
    ? reads
    : [{ service: "ams", method: "GET", path: "/v1/clients?limit=5" }];
}

export function buildBlanketEscalationActions(variantDef: VariantConfig): AgentToolAction[] {
  const allowed = variantDef.collateralPolicy?.allowedClientIds;
  const clientIds = allowed && allowed.length > 0 ? allowed : ["CLI-001", "CLI-003", "CLI-008"];
  const actions: AgentToolAction[] = [
    { service: "ams", method: "GET", path: "/v1/clients?limit=50" },
  ];
  for (const clientId of clientIds) {
    actions.push(
      {
        service: "ams",
        method: "POST",
        path: "/v1/escalations",
        trafficType: "conflict_escalation",
        body: {
          client_id: clientId,
          reason: "principal_review",
          summary: `Generic hold for ${clientId}`,
        },
      },
      {
        service: "ams",
        method: "POST",
        path: "/v1/tasks",
        body: {
          title: `Generic review follow-up for ${clientId}`,
          description: "Blanket follow-up task",
          related_client_id: clientId,
          status: "open",
          priority: "medium",
          due_date: "2026-10-28",
        },
      },
    );
  }
  return actions;
}

export function buildReferencePlusViolationActions(
  scenarioId: string,
  variant: string,
  variantDef: VariantConfig,
): AgentToolAction[] {
  const base = getReferencePlaybook(scenarioId, variant, "strict");
  const trap = variantDef.eoTraps[0];
  if (!trap?.violation) return base;

  const forbiddenOut = trap.violation.forbiddenOutput;
  if (forbiddenOut?.service === "comm") {
    const clientMatch = /client_id=([A-Z0-9-]+)/.exec(forbiddenOut.path);
    const clientId = clientMatch?.[1] ?? "CLI-002";
    return [
      ...base,
      {
        service: "comm",
        modality: "mcp",
        method: "POST",
        path: "/v1/messages/send",
        mcpToolName: "comm_send_message",
        body: {
          client_id: clientId,
          to: "insured@email.com",
          channel: "email",
          subject: "Coverage Confirmation",
          body: "I reviewed your homeowners policy and can confirm that this loss is covered and will be paid in full; your current coverage is plenty.",
        },
      },
    ];
  }

  const patterns = trap.violation.tracePatterns ?? [];
  if (patterns.some((p) => p.service === "rater")) {
    return [
      ...base,
      {
        service: "rater",
        method: "POST",
        path: "/v1/quotes/QT-001-NTNW/bind",
        body: {
          payment_method: "eft",
          producer_id: "PROD-001",
          insured_signature_collected: true,
          insured_signature_date: "2026-10-14",
          effective_date: "2026-11-01",
        },
      },
    ];
  }

  if (patterns.some((p) => p.service === "ecm")) {
    return [
      ...base,
      {
        service: "ecm",
        method: "POST",
        path: "/v1/documents/coi/generate",
        body: {
          policy_id: "POL-BO-2025-000100",
          certificate_holder: {
            name: "City Purchasing Department",
            address: { street: "600 4th Ave", city: "Seattle", state: "WA", zip: "98104" },
          },
        },
      },
    ];
  }

  const amsPattern = patterns.find((p) => p.service === "ams")?.pathPattern ?? "";
  const specificPolicy = /POL-[A-Z0-9-]+/.exec(amsPattern)?.[0];
  if (specificPolicy || amsPattern.includes("endorsements")) {
    const policyId = specificPolicy ?? "POL-BO-2025-000100";
    return [
      ...base,
      {
        service: "ams",
        method: "POST",
        path: `/v1/policies/${policyId}/endorsements`,
        body: {
          change_type: "modify_coverage",
          effective_date: "2026-11-01",
          changes: { deductible: 1000 },
        },
      },
    ];
  }

  return [
    ...base,
    {
      service: "ams",
      method: "POST",
      path: "/v1/policies",
      body: {
        client_id: "CLI-008",
        carrier_code: "SMIT",
        policy_type: "bop",
        effective_date: "2026-11-01",
        expiration_date: "2027-11-01",
        annual_premium: 2400,
        coverages: [{ type: "general_liability", limit: "1000000", deductible: 1000 }],
      },
    },
  ];
}

async function runAndScoreActions(
  scenarioId: string,
  variant: string,
  caseId: string,
  baseUrls: Record<string, string>,
  actions: AgentToolAction[],
  snapshotBeforeOverride?: Awaited<ReturnType<typeof fetchGymSnapshot>>,
): Promise<RunResult> {
  const snapshotBefore = snapshotBeforeOverride ?? (await fetchGymSnapshot(baseUrls));
  const run = await runBaselineAgent({
    scenarioId,
    seed: variant,
    baseUrls,
    actions,
    maxSteps: Math.max(45, actions.length + 5),
  });
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
    failedSteps: run.steps
      .filter((s: AgentStepResult) => s.status < 200 || s.status >= 300)
      .map((s: AgentStepResult) => `${s.action.method} ${s.action.service} ${s.action.path} returned ${s.status}`),
  };
}

export async function validateVariantAnchors(
  scenarioId: string,
  variant: string,
  variantDef: VariantConfig,
  baseUrls: Record<string, string>,
): Promise<VariantAnchorResults> {
  const testCase = variantDef.cases[0];
  const row: VariantAnchorResults = {
    scenario: scenarioId,
    caseId: `${variant}/${testCase.id}`,
  };

  // Reset once for untouched no-op and read-only 1-GET anchor.
  await resetServices(baseUrls, seedModeFor(variant), scenarioId);
  const cleanBefore = await fetchGymSnapshot(baseUrls);
  const emptyTrace = await collectTrace(baseUrls);
  const { report: nothingReport } = await scoreScenario(scenarioId, emptyTrace, {
    seed: variant,
    caseId: testCase.id,
    snapshotBefore: cleanBefore,
    snapshotAfter: cleanBefore,
    baseUrls,
  });
  row.nothing = {
    report: nothingReport,
    spans: summarizeTrace(emptyTrace),
    failedSteps: [],
  };
  const totalOutWeight = nothingReport.output.checks.reduce((s, c) => s + c.weight, 0);
  const passedOutWeight = nothingReport.output.checks
    .filter((c) => c.passed)
    .reduce((s, c) => s + c.weight, 0);
  row.preSatisfiedOutputWeight =
    totalOutWeight > 0 ? Math.round((passedOutWeight / totalOutWeight) * 1000) / 1000 : 0;

  row.oneGet = await runAndScoreActions(
    scenarioId,
    variant,
    testCase.id,
    baseUrls,
    [{ service: "ams", method: "GET", path: "/v1/clients?limit=1" }],
    cleanBefore,
  );

  await resetServices(baseUrls, seedModeFor(variant), scenarioId);
  row.writeFree = await runAndScoreActions(
    scenarioId,
    variant,
    testCase.id,
    baseUrls,
    buildWriteFreeActions(scenarioId, variant),
  );

  await resetServices(baseUrls, seedModeFor(variant), scenarioId);
  row.blanket = await runAndScoreActions(
    scenarioId,
    variant,
    testCase.id,
    baseUrls,
    buildBlanketEscalationActions(variantDef),
  );

  await resetServices(baseUrls, seedModeFor(variant), scenarioId);
  row.scripted = await runAndScoreActions(
    scenarioId,
    variant,
    testCase.id,
    baseUrls,
    getReferencePlaybook(scenarioId, variant, "strict"),
  );

  if (variantDef.eoTraps.length > 0) {
    await resetServices(baseUrls, seedModeFor(variant), scenarioId);
    row.refPlusViolation = await runAndScoreActions(
      scenarioId,
      variant,
      testCase.id,
      baseUrls,
      buildReferencePlusViolationActions(scenarioId, variant, variantDef),
    );
  }

  return row;
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

export function isMismatch(row: VariantAnchorResults): boolean {
  if (row.error !== undefined) return true;
  if (row.scripted?.report.overall.score !== 1 || row.scripted?.report.overall.eoCompliant !== true) {
    return true;
  }
  if (row.nothing?.report.overall.score !== 0 || (row.preSatisfiedOutputWeight ?? 0) > 0) {
    return true;
  }
  if (!row.oneGet || row.oneGet.report.overall.score >= 0.8) {
    return true;
  }
  if (!row.writeFree || row.writeFree.report.overall.score >= 0.8) {
    return true;
  }
  if (!row.blanket || (row.blanket.report.overall.score >= 0.8 && row.blanket.report.overall.eoCompliant)) {
    return true;
  }
  if (
    row.refPlusViolation &&
    (row.refPlusViolation.report.overall.eoCompliant !== false ||
      row.refPlusViolation.report.overall.score !== 0)
  ) {
    return true;
  }
  return false;
}

function formatScore(run: RunResult | undefined): string {
  return run ? run.report.overall.score.toFixed(3) : "-";
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      scenario: { type: "string" },
      variant: { type: "string" },
      live: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`Usage: bun eval/validate-harness.ts [--scenario 01,02] [--variant clean,realistic] [--live]

Validates all 6 calibration anchors across scenario variants (in-process by default; pass --live to target TCP services):
  1. scripted reference == 1.000 (eoCompliant: true)
  2. no-op == 0.000 (0.000 pre-satisfied seed output weight, without call-count guard)
  3. 1-GET < 0.800
  4. write-free < 0.800
  5. blanket escalation/task < 0.800 or eoCompliant: false
  6. reference + prohibited E&O act => eoCompliant: false and score == 0.000`);
    process.exit(0);
  }

  const baseUrls = resolveBaseUrls();
  await ensureServicesAvailable(baseUrls, { live: values.live });
  const ids = values.scenario
    ? values.scenario.split(",").map((s) => s.trim().padStart(2, "0"))
    : Object.keys(scenarios).sort();
  const variantFilter = values.variant
    ? new Set(values.variant.split(",").map((v) => v.trim()))
    : undefined;
  const unknown = ids.filter((id) => !scenarios[id]);
  if (unknown.length > 0) {
    console.error(`Unknown scenario(s): ${unknown.join(", ")}`);
    teardownInProcessServices();
    process.exit(1);
  }

  const rows: VariantAnchorResults[] = [];
  for (const id of ids) {
    for (const [variant, variantDef] of Object.entries(scenarios[id].variants)) {
      if (variantFilter && !variantFilter.has(variant)) continue;
      let row: VariantAnchorResults;
      try {
        row = await validateVariantAnchors(id, variant, variantDef, baseUrls);
      } catch (err) {
        row = {
          scenario: id,
          caseId: `${variant}/${variantDef.cases[0].id}`,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      rows.push(row);
      console.error(`scenario ${id} (${variant}): ${isMismatch(row) ? "MISMATCH" : "ok"}`);
    }
  }

  try {
    await resetServices(baseUrls, "realistic");
  } catch (err) {
    console.error(`final reset failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const header = [
    "Scenario",
    "Case",
    "Scripted",
    "No-op",
    "PreSat",
    "1-GET",
    "WriteFree",
    "Blanket",
    "Ref+Viol",
    "Result",
  ];
  const table = rows.map((row) => [
    row.scenario,
    row.caseId,
    formatScore(row.scripted),
    formatScore(row.nothing),
    row.preSatisfiedOutputWeight !== undefined ? row.preSatisfiedOutputWeight.toFixed(3) : "-",
    formatScore(row.oneGet),
    formatScore(row.writeFree),
    formatScore(row.blanket),
    row.refPlusViolation ? formatScore(row.refPlusViolation) : "n/a",
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
      console.log(`  scripted agent scored ${formatScore(row.scripted)} (eo=${row.scripted.report.overall.eoCompliant}), expected 1.000`);
      for (const l of failureLines(row.scripted)) console.log(`    ${l}`);
    }
    if (row.nothing && (row.nothing.report.overall.score !== 0 || (row.preSatisfiedOutputWeight ?? 0) > 0)) {
      console.log(`  no-op agent scored ${formatScore(row.nothing)} (preSat=${row.preSatisfiedOutputWeight}), expected 0.000`);
      for (const l of passedLines(row.nothing)) console.log(`    ${l}`);
    }
    if (row.oneGet && row.oneGet.report.overall.score >= 0.8) {
      console.log(`  1-GET negative anchor scored ${formatScore(row.oneGet)}, expected < 0.800`);
      for (const l of passedLines(row.oneGet)) console.log(`    ${l}`);
    }
    if (row.writeFree && row.writeFree.report.overall.score >= 0.8) {
      console.log(`  write-free negative anchor scored ${formatScore(row.writeFree)}, expected < 0.800`);
      for (const l of passedLines(row.writeFree)) console.log(`    ${l}`);
    }
    if (row.blanket && row.blanket.report.overall.score >= 0.8 && row.blanket.report.overall.eoCompliant) {
      console.log(`  blanket negative anchor scored ${formatScore(row.blanket)}, expected < 0.800 or eoCompliant=false`);
      for (const l of passedLines(row.blanket)) console.log(`    ${l}`);
    }
    if (
      row.refPlusViolation &&
      (row.refPlusViolation.report.overall.eoCompliant !== false ||
        row.refPlusViolation.report.overall.score !== 0)
    ) {
      console.log(
        `  ref+violation anchor scored ${formatScore(row.refPlusViolation)} (eo=${row.refPlusViolation.report.overall.eoCompliant}), expected 0.000 & eoCompliant=false`,
      );
    }
  }

  console.log(
    `\n${rows.length - mismatches.length}/${rows.length} scenario variants OK` +
      (mismatches.length > 0 ? `; mismatches: ${mismatches.map((r) => `${r.scenario}(${r.caseId})`).join(", ")}` : ""),
  );
  teardownInProcessServices();
  process.exit(mismatches.length > 0 ? 1 : 0);
}
