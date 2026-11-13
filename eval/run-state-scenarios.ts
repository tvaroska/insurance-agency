/**
 * CLI & programmatic runner for deterministic multi-turn DB-state scenarios
 * (`eval/deterministic/*.yaml`).
 *
 * Modes:
 *   bun eval/run-state-scenarios.ts --list
 *   bun eval/run-state-scenarios.ts --verify-reference [--scenario DT-01,DT-02]
 *   bun eval/run-state-scenarios.ts --score-snapshots --scenario DT-01 --before <path> --after <path> [--out <path>]
 */

import { parseArgs } from "util";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { tmpdir } from "os";

import type { GymSnapshot } from "./types";
import { resolveBaseUrls } from "./collect-trace";
import { fetchGymSnapshot } from "./evaluators/state-diff";
import {
  evaluateSnapshotsAgainstContract,
  formatStateContractReport,
  loadStateScenarios,
  seedStateScenario,
  type StateContractResult,
  type StateScenarioDefinition,
} from "./evaluators/state-contract";
import {
  DETERMINISTIC_SCENARIO_SCRIPTS,
  type ScenarioActionStep,
} from "./deterministic/reference-scripts";

let isolatedTempDataDir: string | undefined;
let inProcessInitialized = false;

function cleanupIsolatedTempDataDir(): void {
  if (!isolatedTempDataDir) return;
  const dir = isolatedTempDataDir;
  isolatedTempDataDir = undefined;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors on exit
  }
}

export async function ensureServicesForStateScenarios(
  baseUrls: Record<string, string>,
): Promise<void> {
  if (inProcessInitialized) return;
  try {
    const res = await fetch(`${baseUrls.ams ?? "http://localhost:3000"}/health`);
    if (res.ok) return;
  } catch {
    // Fall back to zero-daemon in-process Hono app.request() dispatch
  }

  if (!process.env.EVERGREEN_DATA_DIR) {
    isolatedTempDataDir = mkdtempSync(join(tmpdir(), "evergreen-state-scenarios-"));
    process.env.EVERGREEN_DATA_DIR = isolatedTempDataDir;
    process.once("exit", cleanupIsolatedTempDataDir);
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
    const req =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
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

  inProcessInitialized = true;
}

export async function acquireAccessToken(baseUrls: Record<string, string>): Promise<string> {
  const amsUrl = baseUrls.ams ?? "http://localhost:3000";
  const res = await fetch(`${amsUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: "agent-full",
      client_secret: "dev-secret",
    }),
  });
  if (!res.ok) {
    throw new Error(`POST /oauth/token failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

async function acquirePortalSessionToken(baseUrl: string): Promise<string> {
  const rootRes = await fetch(`${baseUrl}/`);
  const setCookie = rootRes.headers.get("set-cookie") ?? "";
  const cookiePair = setCookie.split(";")[0]?.trim() ?? "";
  const sessRes = await fetch(`${baseUrl}/auth/portal-session`, {
    headers: cookiePair ? { Cookie: cookiePair } : undefined,
  });
  if (!sessRes.ok) {
    throw new Error(
      `GET ${baseUrl}/auth/portal-session failed (${sessRes.status}): ${await sessRes.text()}`,
    );
  }
  const data = (await sessRes.json()) as { session_token: string };
  return data.session_token;
}

function interpolateTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    key in vars ? vars[key] : match,
  );
}

export async function executeActionSteps(
  steps: ScenarioActionStep[],
  baseUrls: Record<string, string>,
  accessToken: string,
): Promise<Array<{ step: ScenarioActionStep; status: number; body: unknown }>> {
  const results: Array<{ step: ScenarioActionStep; status: number; body: unknown }> = [];
  const portalSessions = new Map<string, string>();
  const savedVars: Record<string, string> = {};

  for (const step of steps) {
    const baseUrl = baseUrls[step.service];
    if (!baseUrl) {
      throw new Error(`Unknown service URL key '${step.service}'`);
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };
    if (step.service === "coastal-star" || step.service === "summit-fire") {
      let portalToken = portalSessions.get(step.service);
      if (!portalToken) {
        portalToken = await acquirePortalSessionToken(baseUrl);
        portalSessions.set(step.service, portalToken);
      }
      headers["X-Portal-Session"] = portalToken;
    }
    const resolvedPath = interpolateTemplate(step.path, savedVars);
    const res = await fetch(`${baseUrl}${resolvedPath}`, {
      method: step.method,
      headers,
      body: step.body ? JSON.stringify(step.body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Keep plain text when non-JSON
    }
    if (!step.allowError && (res.status < 200 || res.status >= 300)) {
      throw new Error(
        `Step [turn ${step.turn}] ${step.method} ${step.service}${resolvedPath} failed with ${res.status}: ${text}`,
      );
    }
    if (step.saveAs && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      for (const [varName, fieldName] of Object.entries(step.saveAs)) {
        if (obj[fieldName] !== undefined && obj[fieldName] !== null) {
          savedVars[varName] = String(obj[fieldName]);
        }
      }
    }
    results.push({ step, status: res.status, body: parsed });
  }
  return results;
}

export async function runScenarioWithSteps(
  scenario: StateScenarioDefinition,
  steps: ScenarioActionStep[],
  baseUrls: Record<string, string>,
): Promise<{
  result: StateContractResult;
  before: GymSnapshot;
  after: GymSnapshot;
}> {
  await seedStateScenario(scenario, baseUrls);
  const before = await fetchGymSnapshot(baseUrls);
  if (steps.length > 0) {
    const token = await acquireAccessToken(baseUrls);
    await executeActionSteps(steps, baseUrls, token);
  }
  const after = await fetchGymSnapshot(baseUrls);
  const result = evaluateSnapshotsAgainstContract(before, after, scenario.expected_diff);
  return { result, before, after };
}

export interface VerificationSummaryRow {
  scenarioId: string;
  base: string;
  referencePassed: boolean;
  noopFailed: boolean;
  negativesAllFailed: boolean;
  details: string[];
}

export async function verifyDeterministicSuite(
  scenarios: StateScenarioDefinition[],
  baseUrls: Record<string, string>,
): Promise<{ ok: boolean; rows: VerificationSummaryRow[] }> {
  await ensureServicesForStateScenarios(baseUrls);
  const rows: VerificationSummaryRow[] = [];

  for (const scenario of scenarios) {
    const scripts = DETERMINISTIC_SCENARIO_SCRIPTS[scenario.id];
    const details: string[] = [];
    if (!scripts) {
      rows.push({
        scenarioId: scenario.id,
        base: scenario.start_state.base,
        referencePassed: false,
        noopFailed: false,
        negativesAllFailed: false,
        details: [`No reference script registered for ${scenario.id}`],
      });
      continue;
    }

    const noopRun = await runScenarioWithSteps(scenario, [], baseUrls);
    const noopFailed = !noopRun.result.passed;
    if (!noopFailed) {
      details.push(`no-op unexpectedly PASSED: ${noopRun.result.summary}`);
    }

    const refRun = await runScenarioWithSteps(scenario, scripts.reference, baseUrls);
    const referencePassed = refRun.result.passed;
    if (!referencePassed) {
      details.push(`reference FAILED: ${formatStateContractReport(scenario.id, refRun.result)}`);
    }

    let negativesAllFailed = true;
    for (const neg of scripts.negatives) {
      const negRun = await runScenarioWithSteps(scenario, neg.steps, baseUrls);
      if (negRun.result.passed) {
        negativesAllFailed = false;
        details.push(`negative '${neg.name}' unexpectedly PASSED`);
        continue;
      }
      const hasKind =
        (neg.expectFailureKind === "missing_insert" && negRun.result.missingInserts.length > 0) ||
        (neg.expectFailureKind === "missing_update" && negRun.result.missingUpdates.length > 0) ||
        (neg.expectFailureKind === "unexpected_write" && negRun.result.unexpectedWrites.length > 0);
      if (!hasKind) {
        negativesAllFailed = false;
        details.push(
          `negative '${neg.name}' failed for wrong reason (expected ${neg.expectFailureKind}): ${negRun.result.summary}`,
        );
      }
    }

    rows.push({
      scenarioId: scenario.id,
      base: scenario.start_state.base,
      referencePassed,
      noopFailed,
      negativesAllFailed,
      details,
    });
  }

  const ok = rows.every((r) => r.referencePassed && r.noopFailed && r.negativesAllFailed);
  return { ok, rows };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      list: { type: "boolean", default: false },
      "verify-reference": { type: "boolean", default: false },
      "score-snapshots": { type: "boolean", default: false },
      scenario: { type: "string" },
      before: { type: "string" },
      after: { type: "string" },
      out: { type: "string" },
      dir: { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.help || (!values.list && !values["verify-reference"] && !values["score-snapshots"])) {
    console.log(`Usage:
  bun eval/run-state-scenarios.ts --list
  bun eval/run-state-scenarios.ts --verify-reference [--scenario DT-01,DT-02]
  bun eval/run-state-scenarios.ts --score-snapshots --scenario DT-01 --before <before.json> --after <after.json> [--out <report.json>]`);
    process.exit(values.help ? 0 : 1);
  }

  const allScenarios = loadStateScenarios(
    values.dir ? resolve(values.dir) : resolve(import.meta.dir, "deterministic"),
  );

  if (values.list) {
    for (const s of allScenarios) {
      const inserts = s.expected_diff.must_insert?.length ?? 0;
      const updates = s.expected_diff.must_update?.length ?? 0;
      console.log(
        `${s.id} [${s.difficulty}] base=${s.start_state.base} turns=${s.turns.length} services=${s.services.join(",")} expects=${inserts}ins/${updates}upd — ${s.name}`,
      );
    }
    process.exit(0);
  }

  if (values["score-snapshots"]) {
    if (!values.scenario || !values.before || !values.after) {
      console.error("--score-snapshots requires --scenario, --before, and --after");
      process.exit(1);
    }
    const target = allScenarios.find(
      (s) => s.id === values.scenario || s.slug === values.scenario,
    );
    if (!target) {
      console.error(
        `Unknown deterministic scenario '${values.scenario}'. Available: ${allScenarios.map((s) => s.id).join(", ")}`,
      );
      process.exit(1);
    }
    const before = JSON.parse(readFileSync(values.before, "utf-8")) as GymSnapshot;
    const after = JSON.parse(readFileSync(values.after, "utf-8")) as GymSnapshot;
    const result = evaluateSnapshotsAgainstContract(before, after, target.expected_diff);
    const payload = {
      scenario_id: target.id,
      slug: target.slug,
      name: target.name,
      base: target.start_state.base,
      ...result,
    };
    if (values.out) {
      const outPath = resolve(values.out);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf-8");
    }
    console.log(JSON.stringify(payload, null, 2));
    process.exit(0);
  }

  if (values["verify-reference"]) {
    const filterIds = values.scenario
      ? new Set(values.scenario.split(",").map((s) => s.trim()))
      : null;
    const selected = filterIds
      ? allScenarios.filter((s) => filterIds.has(s.id) || filterIds.has(s.slug))
      : allScenarios;
    if (selected.length === 0) {
      console.error("No matching deterministic scenarios found.");
      process.exit(1);
    }
    const baseUrls = resolveBaseUrls();
    const { ok, rows } = await verifyDeterministicSuite(selected, baseUrls);
    for (const row of rows) {
      const status =
        row.referencePassed && row.noopFailed && row.negativesAllFailed ? "PASS" : "FAIL";
      console.log(
        `[${status}] ${row.scenarioId} (base=${row.base}): ref=${row.referencePassed ? "PASS" : "FAIL"} noop=${row.noopFailed ? "FAIL(ok)" : "PASS(BAD)"} negatives=${row.negativesAllFailed ? "ALL_FAIL(ok)" : "LEAK"}`,
      );
      for (const detail of row.details) {
        console.log(`       ${detail}`);
      }
    }
    process.exit(ok ? 0 : 1);
  }
}
