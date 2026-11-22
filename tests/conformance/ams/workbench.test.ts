import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { startService, startStub, type Service, type Stub } from "../harness";
import { book, endorsement, escalation, ISO_UTC, policy, start, workbenchCatalogue, type Ctx } from "./support";

const catalogue = workbenchCatalogue();

let ctx: Ctx;
// One stand-in for the rater, both carrier portals and the ECM. The other siblings stay unreachable.
let peers: Stub;
let live: Service;

const SHOWCASE_IDS = ["esc_showcase_01", "esc_showcase_02", "esc_showcase_03"];

beforeAll(async () => {
  ctx = await start();
  peers = startStub();
  live = await startService("ams", {
    env: {
      WORKBENCH_LIVE_STACK: "1",
      RATER_BASE_URL: peers.url,
      SUMMIT_BASE_URL: peers.url,
      COASTAL_BASE_URL: peers.url,
      ECM_BASE_URL: peers.url,
    },
  });
}, 60_000);
afterAll(() => {
  peers?.stop();
});
beforeEach(async () => {
  await ctx.svc.seed({ tables: book() });
  peers.clear(true);
});

const wb = (path: string, body?: unknown) => ctx.svc.http.post(`/workbench/api/${path}`, body);
const overview = async (svc: Service = ctx.svc) => (await svc.http.get("/workbench/api/overview")).body;
const today = () => new Date().toISOString().slice(0, 10);

describe("workbench page", () => {
  test("AMS-R103: GET / serves one self-contained HTML page without credentials", async () => {
    const res = await ctx.svc.http.get("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.text.trimStart().toLowerCase().startsWith("<!doctype html>")).toBe(true);
    expect(res.text).toContain("<title>");
    // No build step: styles and script are inline, nothing is loaded from another file of this service.
    expect(res.text).toContain("<style");
    expect(res.text).toContain("<script");
    expect(res.text).not.toMatch(/<script[^>]+src=["']\//);
    expect(res.text).not.toMatch(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']\//);
  });

  test("AMS-R103: the page refers to every workbench route it must drive", async () => {
    const html = (await ctx.svc.http.get("/")).text;
    for (const route of [
      "/workbench/api/overview",
      "/workbench/api/seed-escalations",
      "/workbench/api/run-journey",
      "/workbench/api/time-travel",
      "/workbench/api/chaos",
      "/workbench/api/test-firewall",
      "/workbench/api/escalations/",
      "/resolve",
      "/workbench/api/acord25-preview.pdf",
      "/workbench/api/documents/DOC-002/pdf",
    ]) {
      expect([route, html.includes(route)]).toEqual([route, true]);
    }
    for (const mode of ["governed", "unguarded_transcript"]) expect(html).toContain(mode);
  });
});

describe("overview", () => {
  test("AMS-R104: the overview carries the fixed catalogue and the live row counts", async () => {
    const res = await ctx.svc.http.get("/workbench/api/overview");
    expect(res.status).toBe(200);
    const body = res.body;
    expect(Object.keys(body).sort()).toEqual([
      "agencyProfile",
      "anomalies",
      "escalations",
      "evolutionStages",
      "heroJourneys",
      "principalBindingAuthorityLimitUsd",
      "sevenPromises",
      "simulationControls",
      "stateSnapshotSummary",
      "stateStatutoryMinimums",
    ]);
    expect(body.sevenPromises.map((p: any) => p.id)).toEqual(["I1", "I2", "I3", "I4", "I5", "I6", "I7"]);
    expect(body.heroJourneys.map((j: any) => [j.id, j.scenarioId])).toEqual([
      ["J1", "10"],
      ["J2", "13"],
      ["J3", "14"],
      ["J4", "07"],
      ["J5", "08"],
    ]);
    for (const journey of body.heroJourneys) {
      for (const key of ["title", "persona", "summary", "compiledHandler", "eoGuardrail"]) expect(typeof journey[key]).toBe("string");
      for (const key of ["modalities", "expectedTablesMutated", "steps"]) expect(Array.isArray(journey[key])).toBe(true);
    }
    expect(body.anomalies).toHaveLength(15);
    expect(body.anomalies[0].id).toBe("ANOM-01");
    expect(body.evolutionStages).toHaveLength(3);
    expect(body.principalBindingAuthorityLimitUsd).toBe(10000);
    expect(typeof body.agencyProfile.name).toBe("string");

    expect(body.stateSnapshotSummary).toMatchObject({ totalServices: 8, totalSqliteTables: 32 });
    expect(body.stateSnapshotSummary.amsLiveCounts).toEqual({
      clients: 4,
      policies: 8,
      coverages: 5,
      endorsements: 0,
      commissions: 0,
      tasks: 0,
      escalations: 0,
    });
    expect(typeof body.simulationControls.chaos.enabled).toBe("boolean");
    expect(typeof body.simulationControls.chaos.failureRate).toBe("number");
    expect(Array.isArray(body.simulationControls.chaos.targetServices)).toBe(true);
    expect(typeof body.simulationControls.simulatedDaysOffset).toBe("number");
  });

  test("AMS-R104: the profile, promises, journeys, anomalies and stages are exactly the catalogue of Appendix A", async () => {
    const body = await overview();
    for (const key of ["agencyProfile", "sevenPromises", "heroJourneys", "anomalies", "evolutionStages"]) {
      expect(catalogue[key]).toBeDefined();
      expect(body[key]).toEqual(catalogue[key]);
    }
    expect(catalogue.heroJourneys).toHaveLength(5);
    expect(catalogue.anomalies).toHaveLength(15);
  });

  test("AMS-R104, AMS-R85: the overview publishes the same state minimums the firewall enforces", async () => {
    const minimums = (await overview()).stateStatutoryMinimums;
    expect(minimums).toEqual({
      CA: { state: "CA", per_person_bi: 30000, per_accident_bi: 60000, property_damage: 15000, shorthand: "30/60/15" },
      TX: { state: "TX", per_person_bi: 30000, per_accident_bi: 60000, property_damage: 25000, shorthand: "30/60/25" },
      FL: { state: "FL", per_person_bi: 10000, per_accident_bi: 20000, property_damage: 10000, shorthand: "10/20/10" },
      NY: { state: "NY", per_person_bi: 25000, per_accident_bi: 50000, property_damage: 10000, shorthand: "25/50/10" },
      IL: { state: "IL", per_person_bi: 25000, per_accident_bi: 50000, property_damage: 20000, shorthand: "25/50/20" },
      PA: { state: "PA", per_person_bi: 15000, per_accident_bi: 30000, property_damage: 5000, shorthand: "15/30/5" },
      OH: { state: "OH", per_person_bi: 25000, per_accident_bi: 50000, property_damage: 25000, shorthand: "25/50/25" },
      GA: { state: "GA", per_person_bi: 25000, per_accident_bi: 50000, property_damage: 25000, shorthand: "25/50/25" },
      NC: { state: "NC", per_person_bi: 50000, per_accident_bi: 100000, property_damage: 50000, shorthand: "50/100/50" },
      MI: { state: "MI", per_person_bi: 50000, per_accident_bi: 100000, property_damage: 10000, shorthand: "50/100/10" },
    });
  });

  test("AMS-R104, AMS-R105: GET /workbench/api/overview is read-only; POST /workbench/api/seed-escalations inserts three sample escalations without events when empty", async () => {
    const readCheck = await ctx.svc.changes(() => ctx.svc.http.get("/workbench/api/overview"));
    expect(readCheck.diff).toEqual({});
    expect(readCheck.result.body.escalations).toEqual([]);

    const { result, diff } = await ctx.svc.changes(() => wb("seed-escalations"));
    expect(result.status).toBe(200);
    expect(result.body.seededCount).toBe(3);
    expect(Object.keys(diff)).toEqual(["escalations"]);
    const rows = Object.fromEntries(diff.escalations.added.map((r) => [r.escalation_id, r]));
    expect(Object.keys(rows).sort()).toEqual(SHOWCASE_IDS);
    expect(rows.esc_showcase_01).toMatchObject({
      client_id: "CLI-008",
      policy_id: "POL-BOP-2025-015",
      reason: "premium_threshold",
      status: "pending",
      poll_count: 1,
      manager_response: null,
    });
    expect(rows.esc_showcase_02).toMatchObject({
      client_id: "CLI-027",
      policy_id: "POL-AU-2025-048",
      reason: "state_minimum_violation",
      status: "pending",
      poll_count: 0,
    });
    expect(rows.esc_showcase_03).toMatchObject({
      client_id: "CLI-022",
      policy_id: "POL-AU-2025-018",
      reason: "backdating",
      status: "denied",
      poll_count: 2,
    });
    expect(JSON.parse(rows.esc_showcase_03.manager_response as string)).toMatchObject({ decision: "denied", template_id: "principal_workbench" });

    expect(result.body.escalations.map((e: any) => e.escalation_id).sort()).toEqual(SHOWCASE_IDS);
    const listed = result.body.escalations.find((e: any) => e.escalation_id === "esc_showcase_01");
    expect(Object.keys(listed).sort()).toEqual([
      "client_id",
      "context",
      "created_at",
      "escalation_id",
      "manager_response",
      "policy_id",
      "reason",
      "status",
      "summary",
      "updated_at",
    ]);
    expect(typeof listed.context).toBe("object");
  });

  test("AMS-R105: a sample escalation behaves like any other: one more read decides the first one", async () => {
    await wb("seed-escalations");
    const res = await ctx.api.get("/v1/escalations/esc_showcase_01");
    expect(res.body).toMatchObject({ status: "approved", poll_count: 2 });
    expect(res.body.manager_response.template_id).toBe("premium_threshold_approval");
  });

  test("AMS-R104, AMS-R105: with escalations present neither seed-escalations nor overview inserts rows or counts a poll", async () => {
    await ctx.svc.seed({
      tables: book({
        escalations: [
          escalation("esc_old", { created_at: "2026-01-01T00:00:00.000Z" }),
          escalation("esc_new", { created_at: "2026-02-01T00:00:00.000Z", status: "approved", context: '{"k":1}' }),
        ],
      }),
    });
    const seededAgain = await ctx.svc.changes(() => wb("seed-escalations"));
    expect(seededAgain.diff).toEqual({});
    expect(seededAgain.result.body.seededCount).toBe(0);

    const { result, diff } = await ctx.svc.changes(() => ctx.svc.http.get("/workbench/api/overview"));
    expect(diff).toEqual({});
    expect(result.body.escalations.map((e: any) => e.escalation_id)).toEqual(["esc_new", "esc_old"]);
    expect(result.body.escalations[0]).toMatchObject({ status: "approved", context: { k: 1 }, manager_response: null });
    expect(result.body.stateSnapshotSummary.amsLiveCounts.escalations).toBe(2);
  });

  test("AMS-R104: the overview lists at most the 25 most recent escalations", async () => {
    const many = Array.from({ length: 27 }, (_, i) =>
      escalation(`esc_${String(i).padStart(2, "0")}`, { created_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }),
    );
    await ctx.svc.seed({ tables: book({ escalations: many }) });
    const body = await overview();
    expect(body.escalations).toHaveLength(25);
    expect(body.escalations[0].escalation_id).toBe("esc_26");
    expect(body.escalations.at(-1).escalation_id).toBe("esc_02");
  });
});

describe("run-journey", () => {
  test("AMS-R106: an unguarded transcript run writes nothing and reports a failed state diff", async () => {
    const { result, diff } = await ctx.svc.changes(() => wb("run-journey", { journeyId: "J2", evalMode: "unguarded_transcript" }));
    expect(result.status).toBe(200);
    expect(diff).toEqual({});
    expect(result.body.evalMode).toBe("unguarded_transcript");
    expect(result.body.journey.id).toBe("J2");
    expect(typeof result.body.runId).toBe("string");
    expect(result.body.timestamp).toMatch(ISO_UTC);
    expect(result.body.runId).toMatch(/^wb_unguarded_[0-9a-z]+$/);
    expect(result.body.journey).toEqual(catalogue.heroJourneys[1]);
    expect(result.body.executionSummary).toEqual(catalogue.runJourney.unguardedExecutionSummary);
    expect(result.body.executionSummary.status).toBe("FAIL_STATE_DIFF");
    expect(result.body.stateDiffReceipt).toMatchObject(catalogue.runJourney.receiptFixedFields);
    expect(result.body.stateDiffReceipt).toMatchObject({
      createdTaskId: null,
      mutatedTables: [],
      missingExpectedTables: result.body.journey.expectedTablesMutated,
      amsTasksBefore: 0,
      amsTasksAfter: 0,
      amsEscalationsBefore: 0,
      amsEscalationsAfter: 0,
    });
  });

  test("AMS-R106: a governed run records one completed audit task and reports it", async () => {
    const { result, diff } = await ctx.svc.changes(() => wb("run-journey", { journeyId: "J2", evalMode: "governed" }));
    expect(result.status).toBe(200);
    expect(result.body.evalMode).toBe("governed");
    expect(result.body.executionSummary).toMatchObject({
      status: "PASS",
      executionMode: "local_ams_fallback",
      fallbackUsed: true,
    });
    const journey = catalogue.heroJourneys[1];
    expect(result.body.runId).toMatch(/^wb_[0-9a-z]+$/);
    expect(result.body.journey).toEqual(journey);
    const { fallbackReason, wallClockMs, compiledHandler, ...fixed } = result.body.executionSummary;
    expect(fixed).toEqual(catalogue.runJourney.governedFallbackExecutionSummary);
    expect(fallbackReason).toBe(catalogue.runJourney.fallbackReasonLiveDisabled);
    expect(compiledHandler).toBe(journey.compiledHandler);
    expect(typeof wallClockMs).toBe("number");
    expect(result.body.stateDiffReceipt).toMatchObject({
      ...catalogue.runJourney.receiptFixedFields,
      expectedTablesMutated: journey.expectedTablesMutated,
      amsEscalationsBefore: 0,
      amsEscalationsAfter: 0,
    });

    expect(Object.keys(diff)).toEqual(["tasks"]);
    expect(diff.tasks.added).toHaveLength(1);
    const row = diff.tasks.added[0];
    expect(row.id).toMatch(/^TSK-WB-[0-9A-Z]{1,6}$/);
    expect(row).toMatchObject({
      title: `[Workbench J2] ${result.body.journey.title}`,
      status: "completed",
      priority: "high",
      assigned_to: "exec-workbench",
      related_client_id: "CLI-001",
      related_policy_id: null,
    });
    expect([today(), result.body.timestamp.slice(0, 10)]).toContain(row.due_date);
    expect(row.created_at).toBe(result.body.timestamp);
    expect(row.description).toBe(
      `Executed Hero Journey J2 (Scenario 13) via ${journey.compiledHandler} (local AMS fallback). Guardrail verified: ${journey.eoGuardrail}`,
    );

    expect(result.body.stateDiffReceipt).toMatchObject({
      createdTaskId: row.id,
      amsTasksBefore: 0,
      amsTasksAfter: 1,
      mutatedTables: ["ams.tasks"],
      totalMutations: 1,
    });
  });

  test("AMS-R106: the journey is chosen by id or scenario id; anything else runs J1 in governed mode", async () => {
    const pick = async (body?: unknown) => {
      const res = await wb("run-journey", body);
      return [res.body.journey.id, res.body.evalMode];
    };
    expect(await pick({ journeyId: "J4" })).toEqual(["J4", "governed"]);
    expect(await pick({ journeyId: "13" })).toEqual(["J2", "governed"]);
    expect(await pick({ journeyId: "08", evalMode: "unguarded_transcript" })).toEqual(["J5", "unguarded_transcript"]);
    expect(await pick({ journeyId: "J9" })).toEqual(["J1", "governed"]);
    expect(await pick({ evalMode: "something else" })).toEqual(["J1", "governed"]);
    expect(await pick()).toEqual(["J1", "governed"]);
  });

  test("AMS-R106: with live execution on, the sibling services are probed and an offline sibling forces the fallback", async () => {
    await live.seed({ tables: book() });
    peers.on("GET", "/health", { body: { status: "ok" } });
    const res = await live.http.post("/workbench/api/run-journey", { journeyId: "J1" });
    expect(res.status).toBe(200);
    expect(res.body.executionSummary).toMatchObject({ status: "PASS", fallbackUsed: true, executionMode: "local_ams_fallback" });
    // crm, comm and claims point at a closed port; the stub answers for the other four.
    const reason: string = res.body.executionSummary.fallbackReason;
    expect(reason).toBe("Sibling services offline (claims, comm, crm); recorded local AMS SQLite audit task only");
    for (const offline of ["claims", "comm", "crm"]) expect(reason).toContain(offline);
    for (const online of ["rater", "ecm", "summit-fire", "coastal-star"]) expect(reason).not.toContain(online);
    expect(peers.calls.filter((c) => c.method === "GET" && c.path === "/health").length).toBe(4);
    expect(await live.table("tasks")).toHaveLength(1);
  });
});

describe("resolve an escalation", () => {
  beforeEach(async () => {
    await ctx.svc.seed({
      tables: book({
        escalations: [
          escalation("esc_p", { status: "pending", poll_count: 1 }),
          escalation("esc_info", { status: "needs_info", poll_count: 4 }),
        ],
      }),
    });
  });

  test("AMS-R107: an unknown id is 404 in the workbench's own error shape", async () => {
    const { result, diff } = await ctx.svc.changes(() => wb("escalations/esc_missing/resolve", { decision: "approved" }));
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: "Escalation not found" });
    expect(diff).toEqual({});
  });

  test("AMS-R107: approving sets the status, the manager response and one audit event; the poll count stays", async () => {
    const { result, diff } = await ctx.svc.changes(() => wb("escalations/esc_p/resolve", { decision: "approved" }));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      escalation_id: "esc_p",
      status: "approved",
      manager_response: {
        decision: "approved",
        template_id: "principal_workbench",
        response_text: "Approved by Agency Principal via Executive Governance Workbench.",
        resolved_at: result.body.updated_at,
      },
      updated_at: result.body.updated_at,
    });
    expect(result.body.updated_at).toMatch(ISO_UTC);

    expect(Object.keys(diff).sort()).toEqual(["escalation_events", "escalations"]);
    const change = diff.escalations.changed[0];
    expect(change.fields.sort()).toEqual(["manager_response", "status", "updated_at"]);
    expect(change.after).toMatchObject({ status: "approved", poll_count: 1 });
    expect(JSON.parse(change.after.manager_response as string)).toEqual(result.body.manager_response);

    expect(diff.escalation_events.added).toHaveLength(1);
    const event = diff.escalation_events.added[0];
    expect(event).toMatchObject({
      escalation_id: "esc_p",
      event_type: "principal_workbench_reviewed",
      from_status: "pending",
      to_status: "approved",
      created_at: result.body.updated_at,
    });
    expect(JSON.parse(event.details as string)).toEqual(result.body.manager_response);
  });

  test("AMS-R107: only the exact value 'denied' denies; notes replace the default text", async () => {
    const denied = await wb("escalations/esc_p/resolve", { decision: "denied" });
    expect(denied.body.status).toBe("denied");
    expect(denied.body.manager_response.response_text).toBe("Denied by Agency Principal due to E&O / statutory compliance exposure.");

    for (const body of [{ decision: "DENIED" }, { decision: "needs_info" }, {}, undefined]) {
      expect((await wb("escalations/esc_p/resolve", body)).body.status).toBe("approved");
    }
    const noted = await wb("escalations/esc_p/resolve", { decision: "denied", notes: "Loss history too poor." });
    expect(noted.body.manager_response).toMatchObject({ decision: "denied", response_text: "Loss history too poor." });
  });

  test("AMS-R107: an escalation can be resolved from any status, any number of times, each with its own event", async () => {
    await wb("escalations/esc_info/resolve", { decision: "approved" });
    await wb("escalations/esc_info/resolve", { decision: "denied" });
    const res = await ctx.api.get("/v1/escalations/esc_info");
    expect(res.body).toMatchObject({ status: "denied", poll_count: 5 });
    expect(res.body.manager_response).toMatchObject({ decision: "denied", template_id: "principal_workbench" });
    expect(res.body.events.map((e: any) => [e.event_type, e.from_status, e.to_status])).toEqual([
      ["principal_workbench_reviewed", "needs_info", "approved"],
      ["principal_workbench_reviewed", "approved", "denied"],
    ]);
    expect(res.body.events[1].details).toMatchObject({ decision: "denied", template_id: "principal_workbench" });
  });

  test("AMS-R107, AMS-R77: an escalation resolved in the workbench is not decided again by reading it", async () => {
    await wb("escalations/esc_p/resolve", { decision: "denied" });
    const res = await ctx.api.get("/v1/escalations/esc_p");
    expect(res.body).toMatchObject({ status: "denied", poll_count: 2 });
    expect(res.body.manager_response.template_id).toBe("principal_workbench");
  });
});

describe("firewall tester", () => {
  test("AMS-R108: the defaults break all three rules and are reported in order, with every failing limit", async () => {
    const { result, diff } = await ctx.svc.changes(() => wb("test-firewall", {}));
    expect(result.status).toBe(422);
    expect(diff).toEqual({});
    expect(result.body).toMatchObject({ status: 422, error_code: "EO_COMPLIANCE_VIOLATION", blocked: true });
    expect(result.body.evaluatedAt).toMatch(ISO_UTC);
    expect(result.body.violations.map((v: any) => [v.valid, v.rule, v.errorCode])).toEqual([
      [false, "state_minimum_violation", "E_EO_STATE_MINIMUM_VIOLATION"],
      [false, "backdating", "E_EO_BACKDATING_PROHIBITED"],
      [false, "premium_threshold", "E_EO_PREMIUM_THRESHOLD_EXCEEDED"],
    ]);
    const [stateMin, backdating, premium] = result.body.violations;
    expect(stateMin).toMatchObject({
      state: "CA",
      requiredMinimums: { state: "CA", per_person_bi: 30000, per_accident_bi: 60000, property_damage: 15000, shorthand: "30/60/15" },
      violations: [
        "Bodily injury per-person limit ($10,000) is below CA statutory minimum of $30,000 (30/60/15).",
        "Bodily injury per-accident limit ($20,000) is below CA statutory minimum of $60,000 (30/60/15).",
        "Property damage limit ($5,000) is below CA statutory minimum of $15,000 (30/60/15).",
      ],
      message: "Bodily injury per-person limit ($10,000) is below CA statutory minimum of $30,000 (30/60/15).",
    });
    expect(backdating.message).toBe(
      "E&O Firewall: Retroactive coverage backdating to 2020-01-01 (prior to 2026-10-14) is prohibited without Principal Underwriter approval.",
    );
    expect(premium.message).toBe("Premium of $14200.00 exceeds the $10,000 threshold requiring manager approval.");
  });

  test("AMS-R108: values that satisfy every rule answer 200 with no violations", async () => {
    const res = await wb("test-firewall", {
      state: "fl",
      biPerPerson: 10000,
      biPerAccident: 20000,
      pdPerAccident: 10000,
      effectiveDate: "2026-10-14",
      annualPremium: 10000,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 200, error_code: null, blocked: false, violations: [] });
  });

  test("AMS-R108: each rule is evaluated on its own", async () => {
    const ok = { state: "TX", biPerPerson: 30, biPerAccident: 60, pdPerAccident: 25, effectiveDate: "2026-11-01", annualPremium: 500 };
    const rules = async (overrides: Record<string, unknown>) =>
      (await wb("test-firewall", { ...ok, ...overrides })).body.violations.map((v: any) => v.rule);
    expect(await rules({})).toEqual([]);
    expect(await rules({ pdPerAccident: 20000 })).toEqual(["state_minimum_violation"]);
    expect(await rules({ effectiveDate: "2026-10-13" })).toEqual(["backdating"]);
    expect(await rules({ annualPremium: 10001 })).toEqual(["premium_threshold"]);
    expect(await rules({ state: "ZZ", biPerPerson: 24000 })).toEqual(["state_minimum_violation"]);
    expect(await rules({ effectiveDate: "2026-10-13", annualPremium: 10001 })).toEqual(["backdating", "premium_threshold"]);
  });
});

describe("workbench time travel", () => {
  test("AMS-R109: each call adds to the day offset and writes one renewal sweep task", async () => {
    const offsetBefore = (await overview()).simulationControls.simulatedDaysOffset;
    await ctx.svc.seed({ tables: book() });
    const { result, diff } = await ctx.svc.changes(() => wb("time-travel", { days: 60 }));
    expect(result.status).toBe(200);
    const total = offsetBefore + 60;
    expect(result.body).toMatchObject({ status: "ok", daysAdvanced: 60, totalSimulatedDaysOffset: total, activatedEndorsementsCount: 0 });
    const baseMs = Date.parse("2026-10-14T12:00:00.000Z");
    const expectedDates = [baseMs, Date.parse("2026-10-14T00:00:00Z")].map((ms) =>
      new Date(ms + total * 86_400_000).toISOString().slice(0, 10),
    );
    expect(expectedDates).toContain(result.body.simulatedAgencyDate);

    expect(Object.keys(diff)).toEqual(["tasks"]);
    const row = diff.tasks.added[0];
    expect(row.id).toMatch(/^TSK-TT-[0-9A-Z]{1,6}$/);
    expect(result.body.createdRenewalTaskId).toBe(row.id);
    expect(row).toMatchObject({
      title: `[Time-Travel +${total}d] Renewal & Quote Expiration Sweep (${result.body.simulatedAgencyDate})`,
      status: "open",
      priority: "high",
      assigned_to: "privy:renewal-monitor",
      related_client_id: "CLI-003",
      related_policy_id: null,
      due_date: result.body.simulatedAgencyDate,
      description: `Advanced simulated agency clock by +60 days (total +${total}d to ${result.body.simulatedAgencyDate}). Activated 0 pending endorsements and queued 60-day renewal remarketing alerts.`,
    });
    expect((await overview()).simulationControls.simulatedDaysOffset).toBe(total);
  });

  test("AMS-R109: days defaults to 30 and is never less than 1", async () => {
    const start = (await overview()).simulationControls.simulatedDaysOffset;
    const byDefault = await wb("time-travel");
    expect(byDefault.body).toMatchObject({ daysAdvanced: 30, totalSimulatedDaysOffset: start + 30 });
    const negative = await wb("time-travel", { days: -5 });
    expect(negative.body).toMatchObject({ daysAdvanced: 1, totalSimulatedDaysOffset: start + 31 });
  });

  test("AMS-R109: it does not move the simulated clock and expires no policy", async () => {
    const clockBefore = (await ctx.svc.status()).clock_offset_ms;
    await wb("time-travel", { days: 365 });
    expect((await ctx.svc.status()).clock_offset_ms).toBe(clockBefore);
    const statuses = (await ctx.svc.table("policies")).filter((p) => p.status === "active").map((p) => p.policy_id);
    expect(statuses.sort()).toEqual(["POL-A-AUTO", "POL-A-HOME", "POL-C-OLD", "POL-D-AUTO"]);
  });

  test("AMS-R109: endorsements with status 'pending_review' become 'applied'; other statuses are left alone", async () => {
    await ctx.svc.seed({
      tables: book({
        endorsements: [
          endorsement("END-P", "POL-A-AUTO", { status: "pending_review", effective_date: "2026-11-01" }),
          endorsement("END-S", "POL-A-AUTO", { status: "submitted_to_carrier", effective_date: "2026-11-01" }),
        ],
      }),
    });
    const res = await wb("time-travel", { days: 30 });
    expect(res.body.activatedEndorsementsCount).toBe(1);
    const status = Object.fromEntries((await ctx.svc.table("endorsements")).map((e) => [e.endorsement_id, e.status]));
    expect(status).toEqual({ "END-P": "applied", "END-S": "submitted_to_carrier" });
  });
});

describe("workbench chaos switch", () => {
  test("AMS-R110: enabled is set as given, toggled when absent, and never touches the AMS's own fault injection", async () => {
    const on = await wb("chaos", { enabled: true, failureRate: 0.3 });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ status: "ok", chaos: { enabled: true, failureRate: 0.3 } });
    expect(on.body.chaos.targetServices).toEqual(["rater (:3001)", "carrier-summit (:3005)", "carrier-coastal (:3006)"]);
    expect(on.body.message).toBe(
      "Chaos Mode ACTIVE: injecting 30% HTTP 503 outages across carrier endpoints to verify exponential backoff & fallback resilience.",
    );
    expect(on.body.chaos.lastUpdatedAt).toMatch(ISO_UTC);
    expect(typeof on.body.message).toBe("string");
    expect((await overview()).simulationControls.chaos).toMatchObject({ enabled: true, failureRate: 0.3 });

    const toggledOff = await wb("chaos", {});
    expect(toggledOff.body.chaos).toMatchObject({ enabled: false, failureRate: 0 });
    expect(toggledOff.body.message).toBe("Chaos Mode DISABLED: all 8 microservices operating at 100% nominal availability.");
    const toggledOn = await wb("chaos");
    expect(toggledOn.body.chaos).toMatchObject({ enabled: true, failureRate: 0.5 });
    const off = await wb("chaos", { enabled: false, failureRate: 0.9 });
    expect(off.body.chaos).toMatchObject({ enabled: false, failureRate: 0 });

    await wb("chaos", { enabled: true });
    expect((await ctx.svc.status()).chaos.enabled).toBe(false);
    expect((await ctx.api.get("/v1/clients/CLI-A")).status).toBe(200);
    await wb("chaos", { enabled: false });
  });

  test("AMS-R110: with live execution off nothing is forwarded and the response says so", async () => {
    const res = await wb("chaos", { enabled: false });
    expect(res.body.forwarded).toEqual([]);
    expect(res.body.forwardingSkipped).toBe("Live /sim/chaos forwarding disabled in test environment");
  });

  test("AMS-R110: with live execution on, the setting is posted to /sim/chaos of the rater and both carrier portals", async () => {
    peers.on("POST", "/sim/chaos", { body: { status: "ok" } });
    const on = await live.http.post("/workbench/api/chaos", { enabled: true, failureRate: 0.3 });
    expect(on.body.forwardingSkipped).toBeNull();
    expect(on.body.forwarded.every((f: any) => f.url === peers.url)).toBe(true);
    expect(on.body.forwarded.map((f: any) => [f.service, f.ok, f.status])).toEqual([
      ["rater", true, 200],
      ["carrier-summit", true, 200],
      ["carrier-coastal", true, 200],
    ]);
    const calls = peers.calls.filter((c) => c.method === "POST" && c.path === "/sim/chaos");
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call.body).toEqual({ enabled: true, error_rate: 0.3, status_code: 503, latency_ms: 50 });

    peers.clear();
    const off = await live.http.post("/workbench/api/chaos", { enabled: false });
    const offCalls = peers.calls.filter((c) => c.path === "/sim/chaos");
    expect(offCalls).toHaveLength(3);
    for (const call of offCalls) expect(call.body).toEqual({ enabled: false, error_rate: 0, status_code: 503, latency_ms: 0 });
    expect(off.body.forwarded.every((f: any) => f.ok)).toBe(true);
  });

  test("AMS-R110: a peer that fails is reported per service and does not fail the request", async () => {
    const res = await live.http.post("/workbench/api/chaos", { enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.forwarded.map((f: any) => [f.service, f.ok, f.status])).toEqual([
      ["rater", false, 404],
      ["carrier-summit", false, 404],
      ["carrier-coastal", false, 404],
    ]);
  });
});

describe("workbench PDFs", () => {
  test("AMS-R111: the certificate preview is a fixed PDF", async () => {
    const res = await ctx.svc.http.get("/workbench/api/acord25-preview.pdf");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="ACORD-25-POL-GL-2025-002.pdf"');
    expect(res.text.startsWith("%PDF-1.7")).toBe(true);
    expect(res.text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(catalogue.acord25PreviewLines).toHaveLength(6);
    const shown = [...res.text.matchAll(/\((.*)\) Tj/g)].map((m) => m[1]);
    expect(shown).toEqual(catalogue.acord25PreviewLines);
    expect(res.text).toContain(`/F1 14 Tf 50 740 Td (${catalogue.acord25PreviewLines[0]}) Tj`);
    expect((await ctx.svc.http.get("/workbench/api/acord25-preview.pdf")).text).toBe(res.text);
  });

  test("AMS-R112: with live execution off the built-in DOC-002 PDF is rendered locally and unknown document ids return 404", async () => {
    const res = await ctx.svc.http.get("/workbench/api/documents/DOC-002/pdf");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-evergreen-pdf-source")).toBe("workbench-render");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="ACORD-DOC-002.pdf"');
    expect(res.text.startsWith("%PDF-")).toBe(true);
    const shown = [...res.text.matchAll(/\((.*)\) Tj/g)].map((m) => m[1]);
    expect(shown).toEqual([
      "ACORD 90 - PERSONAL AUTO APPLICATION \\(DOC-002\\)",
      "PRODUCER: Evergreen Insurance Partners",
      "DOCUMENT: DOC-002 | SOURCE: Workbench local render \\(ECM :3003 unavailable or not a generated form\\)",
      "POLICY: \\(no AMS policy on file\\)",
      "1st-Line E&O Gate: state minimums + backdating + $10K binding authority enforced at bind time",
    ]);

    const missing = await ctx.svc.http.get("/workbench/api/documents/NO-SUCH-DOC/pdf");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "Document not found" });
  });

  test("AMS-R112: the DOC-002 local render names the latest policy of client CLI-001", async () => {
    await ctx.svc.seed({
      tables: book({
        clients: [...book().clients, { ...book().clients[0], id: "CLI-001", email: "one@example.test" }],
        policies: [
          ...book().policies,
          policy("POL-ONE-OLD", "CLI-001", { effective_date: "2024-01-01", expiration_date: "2025-01-01" }),
          policy("POL-ONE-NEW", "CLI-001", { policy_type: "homeowners", effective_date: "2025-08-01", expiration_date: "2026-08-01" }),
        ],
      }),
    });
    const res = await ctx.svc.http.get("/workbench/api/documents/DOC-002/pdf");
    expect(res.status).toBe(200);
    expect(res.text).toContain("(POLICY: POL-ONE-NEW | homeowners | 2025-08-01 to 2026-08-01) Tj");
    expect(res.text).toContain("(DOCUMENT: DOC-002 | SOURCE");
  });

  test("AMS-R112: with live execution on, a certificate PDF from the ECM is passed through", async () => {
    peers.on("GET", "/v1/documents/coi/{id}/pdf", { body: "%PDF-1.4 from the ECM stub", headers: { "Content-Type": "application/pdf" } });
    const res = await live.http.get("/workbench/api/documents/COI-7/pdf");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-evergreen-pdf-source")).toBe("ecm-coi");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="COI-7.pdf"');
    expect(res.text).toBe("%PDF-1.4 from the ECM stub");

    const call = peers.calls.find((c) => c.path === "/v1/documents/coi/COI-7/pdf")!;
    const [, payload] = call.headers.authorization.replace("Bearer ", "").split(".");
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    for (const scope of ["ecm:documents:read", "ecm:acord:read"]) expect(claims.scope.split(" ")).toContain(scope);
  });

  test("AMS-R112: otherwise the client's application form is fetched from the ECM: 80 for a home document, 90 for auto", async () => {
    await live.seed({ tables: book() });
    peers.on("GET", "/v1/documents", {
      body: {
        data: [
          { document_id: "DOC-HOME", client_id: "CLI-A", tags: ["dwelling", "signed"] },
          { document_id: "DOC-AUTO", client_id: "CLI-A", tags: ["id-card"] },
        ],
      },
    });
    peers.on("GET", "/v1/documents/acord/{form}", (call) => ({
      body: `%PDF-1.4 form for ${call.query.policy_id}`,
      headers: { "Content-Type": "application/pdf" },
    }));

    const home = await live.http.get("/workbench/api/documents/DOC-HOME/pdf");
    expect(home.headers.get("x-evergreen-pdf-source")).toBe("ecm-acord-80");
    expect(home.headers.get("content-disposition")).toBe('inline; filename="ACORD-80-DOC-HOME.pdf"');
    expect(home.text).toBe("%PDF-1.4 form for POL-A-HOME");

    const auto = await live.http.get("/workbench/api/documents/DOC-AUTO/pdf");
    expect(auto.headers.get("x-evergreen-pdf-source")).toBe("ecm-acord-90");
    expect(auto.text).toBe("%PDF-1.4 form for POL-A-AUTO");
    expect(peers.calls.filter((c) => c.path === "/v1/documents/acord/80")).toHaveLength(1);
    expect(peers.calls.find((c) => c.path === "/v1/documents")!.query.limit).toBe("100");
  });

  test("AMS-R112: when the ECM answers 200 without the document it returns 404; when the ECM refuses, DOC-002 falls back to local render", async () => {
    await live.seed({ tables: book() });
    peers.on("GET", "/v1/documents", { body: { data: [] } });
    const unknown = await live.http.get("/workbench/api/documents/DOC-UNKNOWN/pdf");
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: "Document not found" });

    peers.clear(true);
    peers.on("GET", /.*/, { status: 401, body: { error_code: "AUTH_ERROR", message: "no" } });
    const refused = await live.http.get("/workbench/api/documents/DOC-002/pdf");
    expect(refused.status).toBe(200);
    expect(refused.headers.get("content-type")).toBe("application/pdf");
    expect(refused.headers.get("x-evergreen-pdf-source")).toBe("workbench-render");
  });
});

test("AMS-G15, AMS-G20, AMS-G21 (scope boundaries): platform/workbench routes stay outside the 19-tool /v1 OpenAPI spec and HTML embeds tabs + calculator hooks", async () => {
  const { loadContract } = await import("../harness");
  const amsContract = loadContract("ams");
  expect(amsContract.operations()).toHaveLength(19);
  expect(amsContract.operations().every((op) => op.path.startsWith("/v1/"))).toBe(true);

  const html = (await ctx.svc.http.get("/")).text;
  for (const marker of ["/workbench/api/overview", "/workbench/api/run-journey", "/workbench/api/test-firewall", "governed", "unguarded_transcript"]) {
    expect(html).toContain(marker);
  }
});
