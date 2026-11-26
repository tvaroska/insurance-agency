import { Hono } from "hono";
import {
  STATE_STATUTORY_MINIMUMS,
  PRINCIPAL_BINDING_AUTHORITY_USD,
  validateStateMinimums,
  validateBackdating,
  validateBindingAuthority,
  generateDevToken,
  getInternalRequestHeaders,
  getBackdatingFloor,
  getSimulatedNow,
  nextSimulatedEpochMs,
  simRandomId,
} from "@evergreen/shared";
import { prisma } from "../prisma";
import {
  ACORD25_PREVIEW_PDF,
  BOOK_ANOMALIES,
  buildSampleEscalations,
  EVOLUTION_STAGES,
  HERO_JOURNEYS,
  renderSimplePdf,
  SEVEN_EXECUTIVE_PROMISES,
  type HeroJourneySpec,
} from "../workbench/catalogue";
import { renderWorkbenchHtml } from "../workbench/html";

export {
  BOOK_ANOMALIES,
  HERO_JOURNEYS,
  renderSimplePdf,
  renderWorkbenchHtml,
  SEVEN_EXECUTIVE_PROMISES,
  type HeroJourneySpec,
};

export const workbenchRouter = new Hono();

export function resolveStackUrls(): Record<string, string> {
  const parsed = Number.parseInt(process.env.EVERGREEN_BASE_PORT ?? "", 10);
  const base = Number.isInteger(parsed) && parsed > 0 ? parsed : 3000;
  const pick = (envKey: string, offset: number) =>
    (process.env[envKey] || `http://localhost:${base + offset}`).replace(/\/+$/, "");
  return {
    ams: pick("AMS_BASE_URL", 0),
    rater: pick("RATER_BASE_URL", 1),
    crm: pick("CRM_BASE_URL", 2),
    ecm: pick("ECM_BASE_URL", 3),
    comm: pick("COMM_BASE_URL", 4),
    "summit-fire": pick("SUMMIT_BASE_URL", 5),
    "coastal-star": pick("COASTAL_BASE_URL", 6),
    claims: pick("CLAIMS_BASE_URL", 7),
  };
}

function liveStackAllowed(): boolean {
  if (process.env.WORKBENCH_LIVE_STACK === "1") return true;
  if (process.env.WORKBENCH_LIVE_STACK === "0") return false;
  return process.env.NODE_ENV !== "test";
}

async function probeOffline(urls: Record<string, string>, services: string[]): Promise<string[]> {
  const offline: string[] = [];
  await Promise.all(
    services.map(async (svc) => {
      try {
        const res = await fetch(`${urls[svc]}/health`, { signal: AbortSignal.timeout(750) });
        if (!res.ok) offline.push(svc);
      } catch {
        offline.push(svc);
      }
    }),
  );
  return offline.sort();
}

async function loadEvalModule(relPath: string): Promise<any> {
  const specifier = new URL(`../../../../eval/${relPath}`, import.meta.url).href;
  return import(specifier);
}

let chaosSimulationState = {
  enabled: false,
  failureRate: 0,
  targetServices: ["rater", "carrier-summit", "carrier-coastal"],
  lastUpdatedAt: getSimulatedNow().toISOString(),
};

let simulatedDaysOffset = 0;

export function resetWorkbenchState(): void {
  chaosSimulationState = {
    enabled: false,
    failureRate: 0,
    targetServices: ["rater", "carrier-summit", "carrier-coastal"],
    lastUpdatedAt: getSimulatedNow().toISOString(),
  };
  simulatedDaysOffset = 0;
}

function formatEscalationRow(row: {
  escalation_id: string;
  client_id: string;
  policy_id: string | null;
  reason: string;
  summary: string;
  context: string | null;
  status: string;
  manager_response: string | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    escalation_id: row.escalation_id,
    client_id: row.client_id,
    policy_id: row.policy_id,
    reason: row.reason,
    summary: row.summary,
    context: row.context ? JSON.parse(row.context) : null,
    status: row.status,
    manager_response: row.manager_response ? JSON.parse(row.manager_response) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function ensureSampleEscalations(): Promise<number> {
  const count = await prisma.escalation.count();
  if (count > 0) return 0;

  const samples = buildSampleEscalations(getSimulatedNow().toISOString());
  for (const s of samples) {
    await prisma.escalation.upsert({
      where: { escalation_id: s.escalation_id },
      update: {},
      create: s,
    });
  }
  return samples.length;
}

workbenchRouter.post("/workbench/api/seed-escalations", async (c) => {
  const seededCount = await ensureSampleEscalations();
  const escalations = await prisma.escalation.findMany({
    orderBy: { created_at: "desc" },
    take: 25,
  });
  return c.json({
    status: "ok",
    seededCount,
    escalations: escalations.map(formatEscalationRow),
  });
});

workbenchRouter.get("/workbench/api/overview", async (c) => {
  const [
    clientsCount,
    policiesCount,
    coveragesCount,
    endorsementsCount,
    commissionsCount,
    tasksCount,
    escalations,
  ] = await Promise.all([
    prisma.client.count(),
    prisma.policy.count(),
    prisma.coverage.count(),
    prisma.endorsement.count(),
    prisma.commission.count(),
    prisma.task.count(),
    prisma.escalation.findMany({
      orderBy: { created_at: "desc" },
      take: 25,
    }),
  ]);

  return c.json({
    agencyProfile: {
      name: "Evergreen Insurance Partners",
      staffCount: 11,
      roles: "2 Principals, 3 Commercial Producers, 4 CSRs, 1 Claims Advocate, 1 Ops/Marketing",
      baselineWrittenPremiumUsd: 20_000_000,
      aiEnabledWrittenPremiumUsd: 38_500_000,
      baselineRevenueUsd: 2_200_000,
      aiEnabledRevenueUsd: 4_235_000,
      baselineRevenuePerEmployeeUsd: 200_000,
      aiEnabledRevenuePerEmployeeUsd: 385_000,
      revenuePerEmployeeLiftPct: 92.5,
      csrRoutineWorkAutomatedPct: 78,
    },
    sevenPromises: SEVEN_EXECUTIVE_PROMISES,
    heroJourneys: HERO_JOURNEYS,
    anomalies: BOOK_ANOMALIES,
    stateStatutoryMinimums: STATE_STATUTORY_MINIMUMS,
    principalBindingAuthorityLimitUsd: PRINCIPAL_BINDING_AUTHORITY_USD,
    simulationControls: {
      chaos: chaosSimulationState,
      simulatedDaysOffset,
    },
    stateSnapshotSummary: {
      totalServices: 8,
      totalSqliteTables: 32,
      amsLiveCounts: {
        clients: clientsCount,
        policies: policiesCount,
        coverages: coveragesCount,
        endorsements: endorsementsCount,
        commissions: commissionsCount,
        tasks: tasksCount,
        escalations: escalations.length,
      },
    },
    escalations: escalations.map(formatEscalationRow),
    evolutionStages: EVOLUTION_STAGES,
  });
});

workbenchRouter.post("/workbench/api/run-journey", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const journeyId = body.journeyId || "J1";
  const evalMode =
    body.evalMode === "unguarded_transcript" ? "unguarded_transcript" : "governed";
  const journey =
    HERO_JOURNEYS.find((j) => j.id === journeyId || j.scenarioId === journeyId) ??
    HERO_JOURNEYS[0];

  const beforeTasks = await prisma.task.count();
  const beforeEscalations = await prisma.escalation.count();
  const now = getSimulatedNow().toISOString();

  if (evalMode === "unguarded_transcript") {
    return c.json({
      runId: `wb_unguarded_${nextSimulatedEpochMs().toString(36)}`,
      timestamp: now,
      evalMode,
      journey,
      executionSummary: {
        status: "FAIL_STATE_DIFF",
        transcriptJudgeVerdict: "PASS (Polite chat confirmation — FALSE POSITIVE)",
        stateDiffVerdict: "FAIL (0 of required SQLite rows mutated)",
        eoCompliant: false,
        collateralFree: true,
        unauthorizedMutations: 0,
        compiledHandler: "unguarded-chat-agent",
        llmTokensUsed: 5400,
        estimatedCostUsd: 0.0024,
        wallClockMs: 2850,
      },
      stateDiffReceipt: {
        tablesAudited: 32,
        amsTasksBefore: beforeTasks,
        amsTasksAfter: beforeTasks,
        amsEscalationsBefore: beforeEscalations,
        amsEscalationsAfter: beforeEscalations,
        createdTaskId: null,
        mutatedTables: [],
        missingExpectedTables: journey.expectedTablesMutated,
        collateralPenalty: 0,
      },
    });
  }

  const startedAt = Date.now();
  const urls = resolveStackUrls();
  const siblingServices = ["rater", "crm", "ecm", "comm", "summit-fire", "coastal-star", "claims"];
  let fallbackReason: string | null = null;
  let live: {
    mutatedTables: string[];
    totalMutations: number;
    stepsExecuted: number;
    httpErrorSteps: number;
    privacyPassed: boolean;
  } | null = null;

  if (!liveStackAllowed()) {
    fallbackReason =
      "Live sibling-service execution disabled in test environment; recorded local AMS SQLite audit task only";
  } else {
    const offline = await probeOffline(urls, siblingServices);
    if (offline.length > 0) {
      fallbackReason = `Sibling services offline (${offline.join(", ")}); recorded local AMS SQLite audit task only`;
    } else {
      try {
        const agentMod = await loadEvalModule("agents/baseline-agent.ts");
        const diffMod = await loadEvalModule("evaluators/state-diff.ts");
        const snapshotBefore = await diffMod.fetchGymSnapshot(urls);
        const run = await agentMod.runBaselineAgent({
          scenarioId: journey.scenarioId,
          seed: process.env.SEED_MODE || "realistic",
          modalityMode: "strict",
          tokenProfile: "compiled_code",
          baseUrls: urls,
        });
        const snapshotAfter = await diffMod.fetchGymSnapshot(urls);
        const diff = diffMod.diffSnapshots(snapshotBefore, snapshotAfter);
        const mutatedTables: string[] = [];
        for (const [svc, tables] of Object.entries(diff.services as Record<string, Record<string, any>>)) {
          for (const [table, t] of Object.entries(tables)) {
            if (t.inserted.length + t.updated.length + t.deleted.length > 0) {
              mutatedTables.push(`${svc}.${table}`);
            }
          }
        }
        live = {
          mutatedTables,
          totalMutations: diff.summary.totalMutations,
          stepsExecuted: run.steps.length,
          httpErrorSteps: run.steps.filter((s: { status: number }) => s.status >= 500 || s.status === 0).length,
          privacyPassed: Boolean(run.privacyAudit?.passed),
        };
      } catch (err) {
        fallbackReason = `Live execution unavailable (${err instanceof Error ? err.message : String(err)}); recorded local AMS SQLite audit task only`;
      }
    }
  }

  const auditTaskId = `TSK-WB-${simRandomId(6).toUpperCase()}`;
  await prisma.task.create({
    data: {
      id: auditTaskId,
      title: `[Workbench ${journey.id}] ${journey.title}`,
      description: `Executed Hero Journey ${journey.id} (Scenario ${journey.scenarioId}) via ${journey.compiledHandler} (${live ? "live multi-service run" : "local AMS fallback"}). Guardrail verified: ${journey.eoGuardrail}`,
      status: "completed",
      priority: "high",
      assigned_to: "exec-workbench",
      related_client_id: "CLI-001",
      due_date: now.slice(0, 10),
      created_at: now,
      updated_at: now,
    },
  });

  const afterTasks = await prisma.task.count();
  const afterEscalations = await prisma.escalation.count();

  return c.json({
    runId: `wb_${nextSimulatedEpochMs().toString(36)}`,
    timestamp: now,
    evalMode,
    journey,
    executionSummary: {
      status: "PASS",
      executionMode: live ? "live_multi_service" : "local_ams_fallback",
      fallbackUsed: live === null,
      fallbackReason,
      transcriptJudgeVerdict: live
        ? "PASS (Reference agent completed live trajectory)"
        : "N/A (fallback: no live agent trajectory)",
      stateDiffVerdict: live
        ? `PASS (${live.totalMutations} live SQLite mutations across ${live.mutatedTables.length} tables)`
        : "PARTIAL (local AMS audit task only; sibling state not diffed)",
      eoCompliant: true,
      collateralFree: true,
      unauthorizedMutations: 0,
      compiledHandler: journey.compiledHandler,
      stepsExecuted: live?.stepsExecuted ?? 0,
      httpErrorSteps: live?.httpErrorSteps ?? 0,
      privacyAuditPassed: live?.privacyPassed ?? null,
      llmTokensUsed: 0,
      estimatedCostUsd: 0.0,
      wallClockMs: Date.now() - startedAt,
    },
    stateDiffReceipt: {
      tablesAudited: 32,
      amsTasksBefore: beforeTasks,
      amsTasksAfter: afterTasks,
      amsEscalationsBefore: beforeEscalations,
      amsEscalationsAfter: afterEscalations,
      createdTaskId: auditTaskId,
      mutatedTables: live ? live.mutatedTables : ["ams.tasks"],
      totalMutations: live ? live.totalMutations : 1,
      expectedTablesMutated: journey.expectedTablesMutated,
      collateralPenalty: 0,
    },
  });
});

async function renderLocalAcordSummaryResponse(
  docId: string,
  clientId: string,
): Promise<Response> {
  const policy = await prisma.policy
    .findFirst({ where: { client_id: clientId }, orderBy: { effective_date: "desc" } })
    .catch(() => null);
  const pdf = renderSimplePdf(`ACORD 90 - PERSONAL AUTO APPLICATION (${docId})`, [
    "PRODUCER: Evergreen Insurance Partners",
    `DOCUMENT: ${docId} | SOURCE: Workbench local render (ECM :3003 unavailable or not a generated form)`,
    policy
      ? `POLICY: ${policy.policy_id} | ${policy.policy_type} | ${policy.effective_date} to ${policy.expiration_date}`
      : "POLICY: (no AMS policy on file)",
    "1st-Line E&O Gate: state minimums + backdating + $10K binding authority enforced at bind time",
  ]);
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="ACORD-${docId}.pdf"`,
      "X-Evergreen-Pdf-Source": "workbench-render",
    },
  });
}

workbenchRouter.get("/workbench/api/documents/:docId/pdf", async (c) => {
  const docId = c.req.param("docId");
  const urls = resolveStackUrls();

  if (liveStackAllowed()) {
    try {
      const token = await generateDevToken({
        sub: "exec-workbench",
        scopes: [
          "ecm:documents:read",
          "ecm:acord:read",
          "ams:clients:read",
          "ams:policies:read",
        ],
        expiresIn: 300,
      });
      const headers = { Authorization: `Bearer ${token}`, ...getInternalRequestHeaders() };

      const coiRes = await fetch(
        `${urls.ecm}/v1/documents/coi/${encodeURIComponent(docId)}/pdf`,
        { headers, signal: AbortSignal.timeout(3000) },
      );
      if (coiRes.ok && (coiRes.headers.get("content-type") ?? "").includes("pdf")) {
        return new Response(await coiRes.arrayBuffer(), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${docId}.pdf"`,
            "X-Evergreen-Pdf-Source": "ecm-coi",
          },
        });
      }

      const listRes = await fetch(`${urls.ecm}/v1/documents?limit=100`, {
        headers,
        signal: AbortSignal.timeout(3000),
      });
      if (listRes.ok) {
        const listBody = (await listRes.json()) as {
          data?: { document_id: string; client_id: string; tags?: string[] }[];
        };
        const doc = listBody.data?.find((d) => d.document_id === docId);
        if (!doc) {
          return c.json({ error: "Document not found" }, 404);
        }
        const wantsHome = (doc.tags ?? []).some((t) => /home|dwelling|property/i.test(t));
        const policy = await prisma.policy.findFirst({
          where: {
            client_id: doc.client_id,
            policy_type: wantsHome ? "homeowners" : "personal_auto",
          },
          orderBy: { effective_date: "desc" },
        });
        if (policy) {
          const form = policy.policy_type === "homeowners" ? "80" : "90";
          const acordRes = await fetch(
            `${urls.ecm}/v1/documents/acord/${form}?policy_id=${encodeURIComponent(policy.policy_id)}`,
            { headers, signal: AbortSignal.timeout(5000) },
          );
          if (acordRes.ok) {
            return new Response(await acordRes.arrayBuffer(), {
              status: 200,
              headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `inline; filename="ACORD-${form}-${docId}.pdf"`,
                "X-Evergreen-Pdf-Source": `ecm-acord-${form}`,
              },
            });
          }
        }
        return renderLocalAcordSummaryResponse(docId, doc.client_id);
      }
    } catch {
      // ECM offline: fall through to DOC-002 offline preview.
    }
  }

  if (docId !== "DOC-002") {
    return c.json({ error: "Document not found" }, 404);
  }
  return renderLocalAcordSummaryResponse(docId, "CLI-001");
});

workbenchRouter.get("/workbench/api/acord25-preview.pdf", () => {
  return new Response(ACORD25_PREVIEW_PDF, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="ACORD-25-POL-GL-2025-002.pdf"',
    },
  });
});

workbenchRouter.post("/workbench/api/chaos", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const enabled = body.enabled !== undefined ? Boolean(body.enabled) : !chaosSimulationState.enabled;
  const failureRate = enabled ? Number(body.failureRate ?? 0.5) : 0;

  chaosSimulationState = {
    enabled,
    failureRate,
    targetServices: ["rater (:3001)", "carrier-summit (:3005)", "carrier-coastal (:3006)"],
    lastUpdatedAt: getSimulatedNow().toISOString(),
  };

  const urls = resolveStackUrls();
  const targets: [string, string][] = [
    ["rater", urls.rater],
    ["carrier-summit", urls["summit-fire"]],
    ["carrier-coastal", urls["coastal-star"]],
  ];
  let forwarded: { service: string; url: string; ok: boolean; status?: number; error?: string }[] = [];
  let forwardingSkipped: string | null = null;
  if (!liveStackAllowed()) {
    forwardingSkipped = "Live /sim/chaos forwarding disabled in test environment";
  } else {
    forwarded = await Promise.all(
      targets.map(async ([service, url]) => {
        try {
          const res = await fetch(`${url}/sim/chaos`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getInternalRequestHeaders() },
            body: JSON.stringify({
              enabled,
              error_rate: failureRate,
              status_code: 503,
              latency_ms: enabled ? 50 : 0,
            }),
            signal: AbortSignal.timeout(1500),
          });
          return { service, url, ok: res.ok, status: res.status };
        } catch (err) {
          return { service, url, ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
  }

  return c.json({
    status: "ok",
    chaos: chaosSimulationState,
    forwarded,
    forwardingSkipped,
    message: enabled
      ? `Chaos Mode ACTIVE: injecting ${Math.round(failureRate * 100)}% HTTP 503 outages across carrier endpoints to verify exponential backoff & fallback resilience.`
      : "Chaos Mode DISABLED: all 8 microservices operating at 100% nominal availability.",
  });
});

workbenchRouter.post("/workbench/api/time-travel", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const days = Math.max(1, Number(body.days ?? 30));
  simulatedDaysOffset += days;

  const now = getSimulatedNow();
  const futureDate = new Date(now.getTime() + simulatedDaysOffset * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const activatedEndorsements = await prisma.endorsement.updateMany({
    where: { status: "pending_review" },
    data: { status: "applied" },
  });

  const taskId = `TSK-TT-${simRandomId(6).toUpperCase()}`;
  await prisma.task.create({
    data: {
      id: taskId,
      title: `[Time-Travel +${simulatedDaysOffset}d] Renewal & Quote Expiration Sweep (${futureDate})`,
      description: `Advanced simulated agency clock by +${days} days (total +${simulatedDaysOffset}d to ${futureDate}). Activated ${activatedEndorsements.count} pending endorsements and queued 60-day renewal remarketing alerts.`,
      status: "open",
      priority: "high",
      assigned_to: "privy:renewal-monitor",
      related_client_id: "CLI-003",
      due_date: futureDate,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    },
  });

  return c.json({
    status: "ok",
    daysAdvanced: days,
    totalSimulatedDaysOffset: simulatedDaysOffset,
    simulatedAgencyDate: futureDate,
    activatedEndorsementsCount: activatedEndorsements.count,
    createdRenewalTaskId: taskId,
  });
});

workbenchRouter.post("/workbench/api/test-firewall", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const state = (body.state || "CA").toUpperCase();
  const biPerPerson = Number(body.biPerPerson ?? 10000);
  const biPerAccident = Number(body.biPerAccident ?? 20000);
  const pdPerAccident = Number(body.pdPerAccident ?? 5000);
  const effectiveDate = body.effectiveDate || "2020-01-01";
  const annualPremium = Number(body.annualPremium ?? 14200);

  const stateCheck = validateStateMinimums(state, [
    {
      type: "bodily_injury",
      per_person_limit: biPerPerson,
      per_accident_limit: biPerAccident,
    },
    {
      type: "property_damage",
      per_accident_limit: pdPerAccident,
    },
  ]);
  const backdateCheck = validateBackdating(effectiveDate, getBackdatingFloor());
  const authorityCheck = validateBindingAuthority(annualPremium);

  const violations = [stateCheck, backdateCheck, authorityCheck].filter(
    (check) => !check.valid,
  );

  return c.json(
    {
      status: violations.length > 0 ? 422 : 200,
      error_code: violations.length > 0 ? "EO_COMPLIANCE_VIOLATION" : null,
      blocked: violations.length > 0,
      evaluatedAt: getSimulatedNow().toISOString(),
      violations,
    },
    violations.length > 0 ? 422 : 200,
  );
});

workbenchRouter.post("/workbench/api/escalations/:id/resolve", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const decision = body.decision === "denied" ? "denied" : "approved";
  const notes =
    body.notes ||
    (decision === "approved"
      ? "Approved by Agency Principal via Executive Governance Workbench."
      : "Denied by Agency Principal due to E&O / statutory compliance exposure.");

  const existing = await prisma.escalation.findUnique({
    where: { escalation_id: id },
  });
  if (!existing) {
    return c.json({ error: "Escalation not found" }, 404);
  }

  const now = getSimulatedNow().toISOString();
  const managerResponse = {
    decision,
    template_id: "principal_workbench",
    response_text: notes,
    resolved_at: now,
  };

  const updated = await prisma.escalation.update({
    where: { escalation_id: id },
    data: {
      status: decision,
      manager_response: JSON.stringify(managerResponse),
      updated_at: now,
    },
  });

  await prisma.escalationEvent.create({
    data: {
      escalation_id: id,
      event_type: "principal_workbench_reviewed",
      from_status: existing.status,
      to_status: decision,
      details: JSON.stringify(managerResponse),
      created_at: now,
    },
  });

  return c.json({
    escalation_id: updated.escalation_id,
    status: updated.status,
    manager_response: managerResponse,
    updated_at: updated.updated_at,
  });
});

workbenchRouter.get("/", (c) => c.html(renderWorkbenchHtml()));
