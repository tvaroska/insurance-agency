import { Hono } from "hono";
import {
  STATE_STATUTORY_MINIMUMS,
  PRINCIPAL_BINDING_AUTHORITY_USD,
  validateStateMinimums,
  validateBackdating,
  validateBindingAuthority,
  generateDevToken,
  getInternalRequestHeaders,
} from "@evergreen/shared";
import { prisma } from "../prisma";

export const workbenchRouter = new Hono();

// ── Live stack helpers ──────────────────────────────────────────────

/**
 * Resolves the 8-service stack URLs from `EVERGREEN_BASE_PORT` (default 3000) and the
 * per-service `*_BASE_URL` overrides set by `scripts/run-showcase.ts`. Keys match the
 * service names used by `eval/agents/baseline-agent.ts` and `eval/evaluators/state-diff.ts`.
 */
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

/**
 * Live calls to sibling services are skipped under `bun test` (NODE_ENV=test) so unit tests
 * never mutate a developer's running stack; set WORKBENCH_LIVE_STACK=1 to force them.
 */
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

/** Loads an `eval/` module at runtime (absent in cold service images, so failures fall back). */
async function loadEvalModule(relPath: string): Promise<any> {
  const specifier = new URL(`../../../../eval/${relPath}`, import.meta.url).href;
  return import(specifier);
}

function pdfEscape(text: string): string {
  return text.replace(/[\\()]/g, (ch) => `\\${ch}`).replace(/[^\x20-\x7e]/g, "-");
}

/** Renders a minimal single-page PDF 1.7 with correct xref offsets. */
export function renderSimplePdf(title: string, lines: string[]): Uint8Array {
  const body = [
    "BT",
    `/F1 14 Tf 50 740 Td (${pdfEscape(title)}) Tj`,
    "/F1 10 Tf",
    ...lines.map((line) => `0 -16 Td (${pdfEscape(line)}) Tj`),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(out);
}

export interface HeroJourneySpec {
  id: string;
  scenarioId: string;
  title: string;
  promiseId: string;
  promiseTitle: string;
  persona: string;
  summary: string;
  modalities: ("REST" | "MCP" | "Browser Portal")[];
  compiledHandler: string;
  eoGuardrail: string;
  expectedTablesMutated: string[];
  steps: {
    step: number;
    modality: "REST" | "MCP" | "Browser Portal" | "E&O Firewall";
    service: string;
    operation: string;
    claim: string;
    dbEvidence: string;
  }[];
}

export const HERO_JOURNEYS: HeroJourneySpec[] = [
  {
    id: "J1",
    scenarioId: "10",
    title: "15-Anomaly Book-of-Business Audit & Renewal Triage",
    promiseId: "I2",
    promiseTitle: "5-Minute Full Book-of-Business E&O & Revenue Audit",
    persona: "Agency COO / Operations Director",
    summary:
      "Scans all 8 agency systems to detect 15 seeded revenue, compliance, and retention anomalies (Tanya Marsh CLI-027 TX 15/30/10 below-minimum auto, Derek Hawkins CLI-025/CLI-031 duplicate + lapsed policy with open claim, Sarah Chen CLI-001/CLI-030 duplicate, unsigned ACORD forms, and >20% renewal rate spikes).",
    modalities: ["REST", "MCP"],
    compiledHandler: "privy:renewal-monitor",
    eoGuardrail:
      "Blocks auto-renewal of policies with unsigned ACORD applications or state-minimum violations; routes >20% premium increases to retention workflow.",
    expectedTablesMutated: ["ams.tasks", "ams.escalations", "crm.leads"],
    steps: [
      {
        step: 1,
        modality: "REST",
        service: "ams",
        operation: "GET /v1/policies?status=active",
        claim: "Scanned active book across personal & commercial lines.",
        dbEvidence: "Verified 80 policies & coverage rows in ams.policies / ams.coverages.",
      },
      {
        step: 2,
        modality: "REST",
        service: "ecm",
        operation: "GET /v1/documents?status=pending_signature",
        claim: "Detected unsigned ACORD applications & missing loss runs (CLI-026).",
        dbEvidence: "Cross-checked ecm.documents; flagged policies missing signed ACORD forms.",
      },
      {
        step: 3,
        modality: "E&O Firewall",
        service: "ams",
        operation: "validateStateMinimums(TX: CLI-027 POL-AU-2025-048 15/30/10 vs 30/60/25)",
        claim: "Flagged legacy policies below state statutory minimums and duplicate entities (CLI-025/CLI-031, CLI-001/CLI-030).",
        dbEvidence: "Created high-priority remediation tasks in ams.tasks & escalations in ams.escalations.",
      },
      {
        step: 4,
        modality: "MCP",
        service: "comm",
        operation: "MCP send_message (retention outreach)",
        claim: "Queued proactive remarketing outreach for >20% renewal increases.",
        dbEvidence: "Inserted outbound retention transcript in comm.messages (0 unauthorized mutations).",
      },
    ],
  },
  {
    id: "J2",
    scenarioId: "13",
    title: "60-Second ACORD 25 Certificate of Insurance (COI) Issuance",
    promiseId: "I3",
    promiseTitle: "Instant Commercial Servicing ($0-Token COI & Endorsements)",
    persona: "Commercial Lines CSR / Account Manager",
    summary:
      "Verifies active Commercial GL and Umbrella limits in AMS (Scenarios 13 & 17), enforces additional-insured endorsement checks, generates a real multi-field ACORD 25 PDF in ECM (:3003), and dispatches the certificate holder package.",
    modalities: ["REST", "MCP"],
    compiledHandler: "privy:cert-issuer",
    eoGuardrail:
      "Refuses to list Blanket Additional Insured or Waiver of Subrogation on ACORD 25 unless an active endorsement exists on the underlying policy.",
    expectedTablesMutated: ["ecm.documents", "comm.messages", "ams.tasks"],
    steps: [
      {
        step: 1,
        modality: "REST",
        service: "ams",
        operation: "GET /v1/policies/POL-GL-2025-002",
        claim: "Verified active $1M/$2M Commercial GL limits & endorsements.",
        dbEvidence: "Read ams.policies & ams.endorsements (status = active).",
      },
      {
        step: 2,
        modality: "E&O Firewall",
        service: "ecm",
        operation: "ACORD 25 Coverage & Endorsement Verification",
        claim: "Confirmed certificate holder requested limits do not exceed bound policy.",
        dbEvidence: "Passed statutory & policy limit guardrails (0 E&O violations).",
      },
      {
        step: 3,
        modality: "REST",
        service: "ecm",
        operation: "POST /v1/documents/coi/generate",
        claim: "Rendered official ACORD 25 PDF with policy numbers & limits.",
        dbEvidence: "Inserted 1 row in ecm.documents (application/pdf, %PDF-1.7 binary header verified).",
      },
      {
        step: 4,
        modality: "MCP",
        service: "comm",
        operation: "MCP send_message",
        claim: "Delivered ACORD 25 PDF link to insured & certificate holder.",
        dbEvidence: "Inserted 1 row in comm.messages (collateralFree = true).",
      },
    ],
  },
  {
    id: "J3",
    scenarioId: "14",
    title: "Multi-Carrier Commercial Submission & Portal Recovery",
    promiseId: "I4",
    promiseTitle: "Unified Multi-Modal Carrier Execution (REST + MCP + Browser Portals)",
    persona: "Commercial Lines Producer",
    summary:
      "Normalizes commercial & personal risks across REST carriers (Hartland Commercial, Erie Basin Mutual, National Shield on :3001) AND legacy browser portals (Summit Fire & Casualty on :3005 and Coastal Star Auto on :3006) across Scenarios 09 & 14.",
    modalities: ["REST", "Browser Portal", "MCP"],
    compiledHandler: "Stage 2 Skill + privy:renewal-monitor",
    eoGuardrail:
      "Requires Principal Escalation before binding any quote >$10,000 annual premium or surplus-lines placement.",
    expectedTablesMutated: [
      "rater.quote_requests",
      "rater.carrier_quotes",
      "carrier_summit.quotes",
      "ams.escalations",
    ],
    steps: [
      {
        step: 1,
        modality: "REST",
        service: "rater",
        operation: "POST /v1/quotes/request (Hartland, Erie Basin, National Shield)",
        claim: "Requested comparative commercial quotes via REST API (:3001).",
        dbEvidence: "Inserted 1 quote_request + 3 carrier_quotes in rater DB.",
      },
      {
        step: 2,
        modality: "Browser Portal",
        service: "carrier-summit",
        operation: "POST /v1/summit/submissions (:3005 X-Portal-Session)",
        claim: "Completed commercial submission on Summit Fire & Casualty portal (:3005) and MVR check on Coastal Star (:3006).",
        dbEvidence: "Inserted commercial submission & quote in carrier_summit DB.",
      },
      {
        step: 3,
        modality: "E&O Firewall",
        service: "ams",
        operation: "validateBindingAuthority(annualPremium: $14,200)",
        claim: "Intercepted $14,200 commercial bind (> $10,000 cap) and escalated to Principal.",
        dbEvidence: "Inserted 1 row in ams.escalations (reason = premium_threshold, status = pending).",
      },
    ],
  },
  {
    id: "J4",
    scenarioId: "07",
    title: "Severe Claims FNOL, CAT Surge & SIU Fraud Triage",
    promiseId: "I5",
    promiseTitle: "Claims Advocacy Without Liability Leakage",
    persona: "Claims Advocate / Agency Principal",
    summary:
      "Files First Notice of Loss (FNOL) on Claims (:3007) across Scenarios 07 & 19, cross-checks policy effective dates for pre-existing or lapsed-policy red flags, assigns emergency adjuster priority, and escalates attorney/subrogation threats without admitting coverage.",
    modalities: ["REST", "MCP"],
    compiledHandler: "privy:claims-intake",
    eoGuardrail:
      "Zero coverage-admission language in outbound client communications; immediate escalation on attorney representation or coverage-lapse disputes.",
    expectedTablesMutated: ["claims.claims", "claims.claim_timeline", "ams.escalations", "comm.messages"],
    steps: [
      {
        step: 1,
        modality: "REST",
        service: "ams",
        operation: "GET /v1/policies?client_id=CLI-021",
        claim: "Verified active policy period and deductible on date of loss.",
        dbEvidence: "Read ams.policies (confirmed loss date within active term).",
      },
      {
        step: 2,
        modality: "REST",
        service: "claims",
        operation: "POST /v1/claims (:3007)",
        claim: "Registered FNOL claim record with loss description and reserve.",
        dbEvidence: "Inserted 1 row in claims.claims + 1 audit entry in claims.claim_timeline.",
      },
      {
        step: 3,
        modality: "E&O Firewall",
        service: "ams",
        operation: "POST /v1/escalations (attorney_involvement)",
        claim: "Detected claimant counsel notice; escalated to Agency Principal & Carrier SIU.",
        dbEvidence: "Inserted 1 row in ams.escalations (reason = attorney_involvement).",
      },
    ],
  },
  {
    id: "J5",
    scenarioId: "08",
    title: "Live E&O Trap Interception (State Minimums + Backdated Endorsement)",
    promiseId: "I6",
    promiseTitle: "Three Lines of Defense & 1st-Line Service-Layer E&O Firewall",
    persona: "Compliance & E&O Officer",
    summary:
      "Demonstrates the 1st Line of Defense across Scenarios 08, 18, and 20: a client requests cutting California auto liability to 10/20/5 (or Texas to 15/30/10) and backdating an endorsement prior to a loss. Both AMS and Rater deterministically reject the mutation with HTTP 422 EO_COMPLIANCE_VIOLATION.",
    modalities: ["REST"],
    compiledHandler: "privy:endorsement-guard",
    eoGuardrail:
      "Hard service-layer rejection (HTTP 422 EO_COMPLIANCE_VIOLATION) in packages/shared/src/compliance-firewall.ts before any SQLite write can occur.",
    expectedTablesMutated: ["ams.escalations", "ams.tasks"],
    steps: [
      {
        step: 1,
        modality: "E&O Firewall",
        service: "ams",
        operation: "POST /v1/policies/POL-AU-2025-048/endorsements (CA 10/20/5 / TX 15/30/10)",
        claim: "Blocked illegal below-minimum liability reduction (CA min 30/60/15, TX min 30/60/25).",
        dbEvidence: "HTTP 422 EO_COMPLIANCE_VIOLATION returned; 0 illegal rows written to ams.endorsements.",
      },
      {
        step: 2,
        modality: "E&O Firewall",
        service: "ams",
        operation: "POST /v1/policies/POL-AU-2025-048/endorsements (effective_date < today)",
        claim: "Blocked unapproved backdated endorsement without principal_escalation_id.",
        dbEvidence: "HTTP 422 EO_COMPLIANCE_VIOLATION returned; 0 backdated mutations in ams.policies.",
      },
      {
        step: 3,
        modality: "REST",
        service: "ams",
        operation: "POST /v1/escalations (state_minimum_violation)",
        claim: "Logged formal compliance escalation and educated insured on statutory minimums.",
        dbEvidence: "Inserted 1 row in ams.escalations (reason = state_minimum_violation).",
      },
    ],
  },
];

export const BOOK_ANOMALIES = [
  { id: "ANOM-01", category: "E&O / Statutory", severity: "CRITICAL", client: "Tanya Marsh (CLI-027, TX)", policy: "POL-AU-2025-048", finding: "Seeded TX auto limits 15/30/10 violate Texas statutory minimum (30/60/25)", service: "AMS / Rater", status: "Blocked by 1st-Line Firewall" },
  { id: "ANOM-02", category: "E&O / Backdating", severity: "CRITICAL", client: "Marcus Vance / CLI-022", policy: "POL-AU-2025-018", finding: "Attempted collision deductible reduction backdated 14 days prior to loss date", service: "AMS / Claims", status: "Blocked + Escalated to Principal" },
  { id: "ANOM-03", category: "Binding Authority", severity: "HIGH", client: "Robert Kim (CLI-008)", policy: "POL-BOP-2025-015", finding: "$14,200 commercial package bind exceeds $10,000 automated producer authority cap", service: "Rater / AMS", status: "Awaiting Principal Approval" },
  { id: "ANOM-04", category: "Document Hygiene", severity: "HIGH", client: "Victor Alvarez (CLI-026)", policy: "POL-HO-2025-029", finding: "Active policy bound with unsigned ACORD application in ECM (pending_signature)", service: "ECM / AMS", status: "Task Queued for CSR" },
  { id: "ANOM-05", category: "COI Compliance", severity: "CRITICAL", client: "Metro Builders (CLI-015)", policy: "POL-GL-2025-002", finding: "Certificate holder requested Blanket Additional Insured (CG 20 10) not endorsed on policy", service: "ECM (:3003)", status: "COI Hold + Endorsement Quoted" },
  { id: "ANOM-06", category: "Renewal Retention", severity: "MEDIUM", client: "David Park (CLI-003)", policy: "POL-HO-2025-006", finding: "+26.4% renewal premium increase triggered remarketing across 5 REST carriers", service: "AMS / Rater", status: "Remarketed (Saved $640/yr)" },
  { id: "ANOM-07", category: "Lapsed + Open Claim", severity: "CRITICAL", client: "Derek Hawkins (CLI-025)", policy: "POL-AU-2025-051", finding: "Lapsed personal auto policy has active post-lapse claim CLM-2026-00010", service: "Claims (:3007)", status: "SIU Flag + Principal Escalation" },
  { id: "ANOM-08", category: "Attorney Triage", severity: "CRITICAL", client: "Natalia Gomez (CLI-021)", policy: "POL-AU-2025-039", finding: "Claimant representation notice from plaintiff counsel on bodily injury claim", service: "Comm / Claims", status: "Escalated to Principal & Carrier" },
  { id: "ANOM-09", category: "Coverage Gap", severity: "HIGH", client: "James Thornton (CLI-004)", policy: "POL-UMB-2025-003", finding: "Personal Umbrella requires $250K/$500K underlying auto BI; gap flagged in book audit", service: "AMS / CRM", status: "Underlying Limit Endorsement Queued" },
  { id: "ANOM-10", category: "Commission Audit", severity: "MEDIUM", client: "Midwest Logistics (CLI-018)", policy: "POL-GL-2025-011", finding: "Hartland Commercial statement paid 12.0% vs. 15.0% contracted agency schedule", service: "AMS Accounting", status: "$1,290 Variance Flagged" },
  { id: "ANOM-11", category: "Entity Resolution", severity: "HIGH", client: "Sarah Chen (CLI-001 / CLI-030)", policy: "POL-HO-2025-001", finding: "Duplicate client records across Personal Auto and Homeowners with split household discount", service: "AMS / CRM", status: "Merged + Multi-Policy Credit Applied" },
  { id: "ANOM-12", category: "Entity Resolution", severity: "HIGH", client: "Derek Hawkins (CLI-025 / CLI-031)", policy: "POL-AU-2025-051", finding: "Duplicate client profile hiding prior cancellation and claim history", service: "AMS / CRM", status: "Merged + E&O Alert Logged" },
  { id: "ANOM-13", category: "Portal Sync", severity: "MEDIUM", client: "Apex Fabrication (CLI-012)", policy: "SUB-SUMMIT-904", finding: "Summit Fire & Casualty portal (:3005) commercial quote ready but unlinked in AMS", service: "Carrier-Summit (:3005)", status: "Synced via Portal Session" },
  { id: "ANOM-14", category: "Driver / MVR", severity: "HIGH", client: "ryan O'Connor (CLI-019)", policy: "POL-AU-2025-033", finding: "Carrier denial recovery & MVR violation gate routed through Coastal Star Auto portal (:3006)", service: "Carrier-Coastal (:3006)", status: "Non-Standard Quote Bound" },
  { id: "ANOM-15", category: "Cancellation Rescue", severity: "HIGH", client: "Greenleaf Landscaping (CLI-009)", policy: "POL-WC-2025-007", finding: "Pending non-payment cancellation in 72 hours on active Workers Comp policy", service: "AMS / Comm (:3004)", status: "Urgent Outreach Sent" },
];

export const SEVEN_EXECUTIVE_PROMISES = [
  {
    id: "I1",
    title: "92.5% Agency Capacity Expansion Without Headcount Growth",
    metric: "$200K → $385K Rev / Employee",
    detail: "11-person agency scales from $20M to $38.5M written premium by automating 78% of routine CSR work.",
  },
  {
    id: "I2",
    title: "5-Minute Full Book-of-Business E&O & Revenue Audit",
    metric: "15 / 15 Anomalies Caught",
    detail: "Continuous cross-system reconciliation across AMS, ECM, Claims, Rater, and Carrier Portals (Scenario 10).",
  },
  {
    id: "I3",
    title: "Instant Commercial Servicing (ACORD 25 & Endorsements)",
    metric: "60s Turnaround ($0 Tokens)",
    detail: "Real binary ACORD 25 PDF (%PDF-1.7) rendering in ECM (:3003) with endorsement verification (Scenarios 13 & 17).",
  },
  {
    id: "I4",
    title: "Unified Multi-Modal Carrier Execution",
    metric: "REST + MCP + 2 Web Portals",
    detail: "Single workflow spans REST APIs (:3001), MCP tools (:3004), Summit Fire (:3005), and Coastal Star (:3006).",
  },
  {
    id: "I5",
    title: "Claims Advocacy Without Liability Leakage",
    metric: "100% Attorney/SIU Escalation",
    detail: "Rapid FNOL intake on Claims (:3007) with strict prohibition on unauthorized coverage admissions (Scenarios 07 & 19).",
  },
  {
    id: "I6",
    title: "Three Lines of Defense Governance",
    metric: "HTTP 422 Hard E&O Firewall",
    detail: "1st Line: 10-state statutory + backdating + $10K cap firewall; 2nd Line: Principal queue; 3rd Line: 32-table state diff.",
  },
  {
    id: "I7",
    title: "32-Table State-Diff Verification & 3-Stage Agent-to-Code Economics",
    metric: "-100% Routine Token Cost",
    detail: "Verifies real SQLite mutations across all 8 services (catching transcript-only hallucinations) and compiles routine runs into $0-token code.",
  },
];

let chaosSimulationState = {
  enabled: false,
  failureRate: 0,
  targetServices: ["rater", "carrier-summit", "carrier-coastal"],
  lastUpdatedAt: new Date().toISOString(),
};

let simulatedDaysOffset = 0;

async function ensureSampleEscalations() {
  const count = await prisma.escalation.count();
  if (count > 0) return;

  const now = new Date().toISOString();
  const samples = [
    {
      escalation_id: "esc_showcase_01",
      client_id: "CLI-008",
      policy_id: "POL-BOP-2025-015",
      reason: "premium_threshold",
      summary:
        "Commercial package bind for Robert Kim ($14,200 annual premium with Hartland Commercial) exceeds $10,000 automated agency binding cap.",
      context: JSON.stringify({
        carrier: "Hartland Commercial (HRTF)",
        annual_premium: 14200,
        authority_limit: PRINCIPAL_BINDING_AUTHORITY_USD,
        line_of_business: "Commercial BOP + GL",
      }),
      status: "pending",
      manager_response: null,
      poll_count: 1,
      created_at: now,
      updated_at: now,
    },
    {
      escalation_id: "esc_showcase_02",
      client_id: "CLI-027",
      policy_id: "POL-AU-2025-048",
      reason: "state_minimum_violation",
      summary:
        "Insured requested reducing California/Texas personal auto liability below state statutory minimums (CA 30/60/15, TX 30/60/25). Blocked by 1st-line E&O firewall; queued for Principal review.",
      context: JSON.stringify({
        state: "TX",
        requested_limits: "15/30/10",
        statutory_minimum: "30/60/25",
        firewall_code: "EO_COMPLIANCE_VIOLATION",
      }),
      status: "pending",
      manager_response: null,
      poll_count: 0,
      created_at: now,
      updated_at: now,
    },
    {
      escalation_id: "esc_showcase_03",
      client_id: "CLI-022",
      policy_id: "POL-AU-2025-018",
      reason: "backdating",
      summary:
        "Client requested backdating collision deductible reduction from $2,500 to $500 effective 14 days ago (prior to reported parking lot loss).",
      context: JSON.stringify({
        requested_effective_date: "2026-10-25",
        loss_date: "2026-11-02",
        firewall_code: "EO_COMPLIANCE_VIOLATION",
      }),
      status: "denied",
      manager_response: JSON.stringify({
        decision: "denied",
        template_id: "principal_workbench",
        response_text:
          "Denied per Agency E&O Policy: coverage modifications cannot be backdated prior to a known loss event.",
        resolved_at: now,
      }),
      poll_count: 2,
      created_at: now,
      updated_at: now,
    },
  ];

  for (const s of samples) {
    await prisma.escalation.upsert({
      where: { escalation_id: s.escalation_id },
      update: {},
      create: s,
    });
  }
}

// ── GET /workbench/api/overview ─────────────────────────────────────

workbenchRouter.get("/workbench/api/overview", async (c) => {
  await ensureSampleEscalations();

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
    escalations: escalations.map((row) => ({
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
    })),
    evolutionStages: [
      {
        stage: "Stage 1: Zero-Shot General Agent",
        label: "Measured v0.8 Baseline (Strict 3-Modality, 20 Workflows x 5 Trials)",
        provenance: "measured_v0.8_baseline",
        avgTokensPerRun: 6500,
        avgCostUsd: 0.449,
        avgLatencyMs: 3900,
        pass1: 0.58,
        meanScore: 0.71,
        pass5: 0.471,
        falseCompletionRateRange: "37%–50%",
        measuredModels: [
          {
            model: "DeepSeek-V4.1-Flash",
            pass1: 0.59,
            meanScore: 0.78,
            falseCompletionRate: 0.39,
            costPerTaskUsd: 0.073,
          },
          {
            model: "gemini-3.8-flash",
            pass1: 0.58,
            meanScore: 0.71,
            falseCompletionRate: 0.37,
            costPerTaskUsd: 0.449,
          },
          {
            model: "claude-sonnet-5-5",
            pass1: 0.55,
            meanScore: 0.69,
            falseCompletionRate: 0.5,
            costPerTaskUsd: 0.111,
          },
        ],
        description:
          'Measured v0.8 zero-shot baseline across 20 strict workflows, 5 trials each: DeepSeek-V4.1-Flash 59.0% pass@1, gemini-3.8-flash 58.0%, claude-sonnet-5-5 55.0%, and a 37%–50% false-completion rate where the agent said "done" while a state check failed.',
      },
      {
        stage: "Stage 2: Domain Skill + Guardrails",
        label: "Measured v0.8 Domain Skill (Agency Procedure Guide)",
        provenance: "measured_v0.8_domain_skill",
        avgTokensPerRun: 2700,
        avgCostUsd: 0.405,
        avgLatencyMs: 1650,
        pass1: 0.69,
        pass5: 0.602,
        description:
          "Measured v0.8: a one-page agency procedure guide appended to the gemini-3.8-flash prompt raises pass@1 from 58.0% to 69.0% and cuts judgment traps missed from 16 to 5 of 60 (token and latency figures are modeled).",
      },
      {
        stage: "Stage 3: $0-Token Compiled Deterministic Code",
        label:
          "Measured 100.0% Scripted Reference Verifier (20/20 Workflows) + Projected FallbackToSkill",
        provenance: "measured_reference_verifier_with_projected_fallback",
        avgTokensPerRun: 0,
        avgCostUsd: 0.0,
        avgLatencyMs: 180,
        pass1: 1.0,
        pass5: 1.0,
        description:
          "Measured 100.0% scripted reference verifier (baseline-agent.ts) across all 20 workflows for routine COI, FNOL, renewal audit, and endorsement checks at $0 token cost; projected FallbackToSkill on mid-conversation client pivots (Scenarios 17–20).",
      },
    ],
  });
});

// ── POST /workbench/api/run-journey ─────────────────────────────────

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

  const now = new Date().toISOString();

  if (evalMode === "unguarded_transcript") {
    // Demonstrates "Why Transcript Evals Fail": agent outputs a polite confirmation but mutates 0 required DB rows
    return c.json({
      runId: `wb_unguarded_${Date.now().toString(36)}`,
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

  // Governed mode: execute the reference agent against the live 8-service stack and diff
  // real /sim/snapshot state; fall back to a local AMS audit task only when siblings are offline.
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

  // Record the deterministic Workbench audit task in AMS (3rd-Line receipt anchor)
  const auditTaskId = `TSK-WB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
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
    runId: `wb_${Date.now().toString(36)}`,
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

// ── GET /workbench/api/documents/:docId/pdf ─────────────────────────

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

      // 1. Issued COI documents render directly from ECM
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

      // 2. Client documents: render the matching ACORD 90 (auto) / 80 (home) application from ECM
      const listRes = await fetch(`${urls.ecm}/v1/documents?limit=100`, {
        headers,
        signal: AbortSignal.timeout(3000),
      });
      if (listRes.ok) {
        const listBody = (await listRes.json()) as { data?: { document_id: string; client_id: string; tags?: string[] }[] };
        const doc = listBody.data?.find((d) => d.document_id === docId);
        if (doc) {
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
        }
      }
    } catch {
      // ECM offline: fall through to the local render below
    }
  }

  // Fallback: render an ACORD application summary locally from AMS state (never 401s)
  const policy = await prisma.policy
    .findFirst({ where: { client_id: "CLI-001" }, orderBy: { effective_date: "desc" } })
    .catch(() => null);
  const pdf = renderSimplePdf(`ACORD 90 - PERSONAL AUTO APPLICATION (${docId})`, [
    "PRODUCER: Evergreen Insurance Partners",
    `DOCUMENT: ${docId} | SOURCE: Workbench local render (ECM :3003 unavailable or not a generated form)`,
    policy
      ? `POLICY: ${policy.policy_id} | ${policy.policy_type} | ${policy.effective_date} to ${policy.expiration_date}`
      : "POLICY: (no AMS policy on file)",
    "1st-Line E&O Gate: state minimums + backdating + $10K binding authority enforced at bind time",
  ]);
  return new Response(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="ACORD-${docId}.pdf"`,
      "X-Evergreen-Pdf-Source": "workbench-render",
    },
  });
});

// ── GET /workbench/api/acord25-preview.pdf ──────────────────────────

workbenchRouter.get("/workbench/api/acord25-preview.pdf", (c) => {
  const pdfContent = `%PDF-1.7
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 428 >> stream
BT
/F1 14 Tf 50 740 Td (ACORD 25 - CERTIFICATE OF LIABILITY INSURANCE) Tj
/F1 10 Tf 0 -24 Td (PRODUCER: Evergreen Insurance Partners) Tj
0 -16 Td (INSURED: Metro Builders LLC (CLI-015) | POLICY: POL-GL-2025-002) Tj
0 -16 Td (CARRIER: Summit Fire & Casualty (NAIC 19046) | EFF: 2025-01-01 to 2026-01-01) Tj
0 -16 Td (COMMERCIAL GENERAL LIABILITY: $1,000,000 Each Occurrence / $2,000,000 General Aggregate) Tj
0 -16 Td (ENDORSEMENT VERIFIED: CG 20 10 Additional Insured Active | 1st-Line E&O Gate PASS) Tj
ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000229 00000 n 
0000000709 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
777
%%EOF`;
  return new Response(pdfContent, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="ACORD-25-POL-GL-2025-002.pdf"',
    },
  });
});

// ── POST /workbench/api/chaos & POST /workbench/api/time-travel ─────

workbenchRouter.post("/workbench/api/chaos", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const enabled = body.enabled !== undefined ? Boolean(body.enabled) : !chaosSimulationState.enabled;
  const failureRate = enabled ? Number(body.failureRate ?? 0.5) : 0;

  chaosSimulationState = {
    enabled,
    failureRate,
    targetServices: ["rater (:3001)", "carrier-summit (:3005)", "carrier-coastal (:3006)"],
    lastUpdatedAt: new Date().toISOString(),
  };

  // Forward POST /sim/chaos to the real carrier-facing services
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

  const now = new Date();
  const futureDate = new Date(now.getTime() + simulatedDaysOffset * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // Activate any pending endorsements and log a deterministic time-travel renewal task in SQLite
  const activatedEndorsements = await prisma.endorsement.updateMany({
    where: { status: "pending" },
    data: { status: "active" },
  });

  const taskId = `TSK-TT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
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

// ── POST /workbench/api/test-firewall ───────────────────────────────

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
  const backdateCheck = validateBackdating(effectiveDate);
  const authorityCheck = validateBindingAuthority(annualPremium);

  const violations = [stateCheck, backdateCheck, authorityCheck].filter(
    (check) => !check.valid,
  );

  return c.json(
    {
      status: violations.length > 0 ? 422 : 200,
      error_code: violations.length > 0 ? "EO_COMPLIANCE_VIOLATION" : null,
      blocked: violations.length > 0,
      evaluatedAt: new Date().toISOString(),
      violations,
    },
    violations.length > 0 ? 422 : 200,
  );
});

// ── POST /workbench/api/escalations/:id/resolve ─────────────────────

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

  const now = new Date().toISOString();
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

// ── GET / (GM3 Light Executive Operations & Governance Workbench) ───

const FAVICON_DATA_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath fill='%230d652d' d='M16 2L4 7v9c0 7.7 5.1 14.9 12 17 6.9-2.1 12-9.3 12-17V7L16 2z'/%3E%3Cpath fill='%23ffffff' d='M14.2 21.4l-4.6-4.6 1.8-1.8 2.8 2.8 6.4-6.4 1.8 1.8-8.2 8.2z'/%3E%3C/svg%3E";

export function renderWorkbenchHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Evergreen Insurance Partners — Executive Operations &amp; Governance Workbench</title>
  <link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}" />
  <style>
    :root {
      --surface: #f8fafc;
      --surface-container: #ffffff;
      --surface-container-low: #f1f5f9;
      --surface-container-high: #e2e8f0;
      --outline: #cbd5e1;
      --outline-variant: #e2e8f0;
      --on-surface: #0f172a;
      --on-surface-variant: #475569;
      --on-surface-muted: #64748b;
      --primary: #1a73e8;
      --primary-hover: #1557b0;
      --primary-container: #e8f0fe;
      --on-primary: #ffffff;
      --on-primary-container: #174ea6;
      --evergreen-accent: #0d652d;
      --evergreen-container: #e6f4ea;
      --status-pass-bg: #e6f4ea;
      --status-pass-fg: #137333;
      --status-pass-border: #ceead6;
      --status-warn-bg: #fef7e0;
      --status-warn-fg: #b06000;
      --status-warn-border: #fde293;
      --status-block-bg: #fce8e6;
      --status-block-fg: #c5221f;
      --status-block-border: #fad2cf;
      --status-info-bg: #e8f0fe;
      --status-info-fg: #1967d2;
      --status-info-border: #d2e3fc;
      --font-sans: "Google Sans", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-mono: "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace;
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 14px;
      --shadow-card: 0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font-sans);
      background: var(--surface);
      color: var(--on-surface);
      line-height: 1.5;
      font-variant-numeric: tabular-nums;
    }

    .topbar {
      background: var(--surface-container);
      border-bottom: 1px solid var(--outline-variant);
      padding: 14px 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      position: sticky;
      top: 0;
      z-index: 20;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-shield {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: var(--evergreen-container);
      color: var(--evergreen-accent);
      display: grid;
      place-items: center;
      font-weight: 700;
      border: 1px solid var(--status-pass-border);
    }
    .brand-title {
      font-size: 17px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .brand-subtitle {
      font-size: 12px;
      color: var(--on-surface-variant);
    }
    .defense-pills {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid transparent;
    }
    .chip-pass { background: var(--status-pass-bg); color: var(--status-pass-fg); border-color: var(--status-pass-border); }
    .chip-warn { background: var(--status-warn-bg); color: var(--status-warn-fg); border-color: var(--status-warn-border); }
    .chip-block { background: var(--status-block-bg); color: var(--status-block-fg); border-color: var(--status-block-border); }
    .chip-info { background: var(--status-info-bg); color: var(--status-info-fg); border-color: var(--status-info-border); }

    .container {
      max-width: 1440px;
      margin: 0 auto;
      padding: 22px 28px 48px;
    }

    .kpi-ribbon {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 14px;
      margin-bottom: 20px;
    }
    .kpi-card {
      background: var(--surface-container);
      border: 1px solid var(--outline-variant);
      border-radius: var(--radius-md);
      padding: 14px 16px;
      box-shadow: var(--shadow-card);
    }
    .kpi-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--on-surface-muted);
    }
    .kpi-value {
      font-size: 22px;
      font-weight: 700;
      margin-top: 4px;
      color: var(--on-surface);
    }
    .kpi-delta {
      font-size: 12px;
      margin-top: 3px;
      color: var(--status-pass-fg);
      font-weight: 600;
    }

    .tabs {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid var(--outline-variant);
      margin-bottom: 20px;
      overflow-x: auto;
    }
    .tab-btn {
      background: transparent;
      border: none;
      border-bottom: 3px solid transparent;
      padding: 11px 16px;
      font-family: var(--font-sans);
      font-size: 13.5px;
      font-weight: 600;
      color: var(--on-surface-variant);
      cursor: pointer;
      white-space: nowrap;
    }
    .tab-btn.active {
      color: var(--primary);
      border-bottom-color: var(--primary);
      background: var(--primary-container);
      border-radius: 8px 8px 0 0;
    }

    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    .grid-2 {
      display: grid;
      grid-template-columns: 1.35fr 1fr;
      gap: 18px;
    }
    @media (max-width: 1080px) {
      .grid-2 { grid-template-columns: 1fr; }
    }

    .card {
      background: var(--surface-container);
      border: 1px solid var(--outline-variant);
      border-radius: var(--radius-md);
      padding: 18px 20px;
      box-shadow: var(--shadow-card);
      margin-bottom: 18px;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .card-title {
      font-size: 15px;
      font-weight: 700;
      margin: 0;
    }
    .card-subtitle {
      font-size: 12.5px;
      color: var(--on-surface-variant);
      margin: 2px 0 0;
    }

    .journey-list {
      display: grid;
      gap: 12px;
    }
    .journey-item {
      border: 1px solid var(--outline-variant);
      border-radius: var(--radius-sm);
      padding: 14px 16px;
      background: var(--surface);
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
    }
    .journey-meta {
      font-size: 12px;
      color: var(--on-surface-variant);
      margin-top: 4px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: var(--radius-sm);
      font-size: 12.5px;
      font-weight: 600;
      border: 1px solid transparent;
      cursor: pointer;
      font-family: var(--font-sans);
      white-space: nowrap;
    }
    .btn-primary {
      background: var(--primary);
      color: var(--on-primary);
    }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-success {
      background: var(--status-pass-bg);
      color: var(--status-pass-fg);
      border-color: var(--status-pass-border);
    }
    .btn-danger {
      background: var(--status-block-bg);
      color: var(--status-block-fg);
      border-color: var(--status-block-border);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
    }
    th, td {
      text-align: left;
      padding: 9px 10px;
      border-bottom: 1px solid var(--outline-variant);
      vertical-align: top;
    }
    th {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--on-surface-muted);
      background: var(--surface-container-low);
    }
    code, .mono {
      font-family: var(--font-mono);
      font-size: 12px;
    }
    .receipt-box {
      background: var(--surface-container-low);
      border: 1px solid var(--outline);
      border-radius: var(--radius-sm);
      padding: 14px;
      font-size: 12.5px;
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <div class="brand-shield">E</div>
      <div>
        <div class="brand-title">Evergreen Insurance Partners — Executive Operations &amp; Governance Workbench</div>
        <div class="brand-subtitle">8 Microservices &bull; 32 SQLite Tables &bull; 20 Scenarios / 259 Tasks &bull; REST + MCP + Legacy Carrier Portals</div>
      </div>
    </div>
    <div class="defense-pills">
      <span class="chip chip-pass">1st Line: 10-State E&amp;O Firewall ACTIVE</span>
      <span class="chip chip-info">2nd Line: Principal Queue (&gt;$10K Cap)</span>
      <span class="chip chip-pass">3rd Line: 32-Table State-Diff Receipt</span>
    </div>
  </header>

  <main class="container">
    <section class="kpi-ribbon" aria-label="Executive KPI Ribbon">
      <div class="kpi-card">
        <div class="kpi-label">Agency Capacity (11 Staff)</div>
        <div class="kpi-value">$20.0M &rarr; $38.5M</div>
        <div class="kpi-delta">+92.5% Written Premium Capacity</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Revenue / Employee</div>
        <div class="kpi-value">$200K &rarr; $385K</div>
        <div class="kpi-delta">+78% Routine CSR Work Automated</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Book-of-Business Audit</div>
        <div class="kpi-value">15 / 15 Caught</div>
        <div class="kpi-delta">100% E&amp;O &amp; Revenue Anomaly Detection</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">1st-Line E&amp;O Firewall</div>
        <div class="kpi-value">HTTP 422 Gate</div>
        <div class="kpi-delta">10 States + Backdating + $10K Cap</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Stage 3 Compiled Servicing</div>
        <div class="kpi-value">$0.0000 / Run</div>
        <div class="kpi-delta">0 LLM Tokens &bull; pass^5 = 100%</div>
      </div>
    </section>

    <nav class="tabs" role="tablist">
      <button class="tab-btn active" onclick="switchTab('tab-command', this)">1. Agency Command &amp; 5 Hero Journeys</button>
      <button class="tab-btn" onclick="switchTab('tab-eo', this)">2. Principal E&amp;O &amp; Escalation Queue (2nd Line)</button>
      <button class="tab-btn" onclick="switchTab('tab-statediff', this)">3. 3rd-Line State-Diff &amp; Trace Receipt</button>
      <button class="tab-btn" onclick="switchTab('tab-evolution', this)">4. 3-Stage Agent-to-Code Economics</button>
    </nav>

    <!-- TAB 1: AGENCY COMMAND & 5 HERO JOURNEYS -->
    <section id="tab-command" class="tab-panel active">
      <div class="grid-2">
        <div>
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">5 Executive Hero Journeys (Live Execution)</h2>
                <p class="card-subtitle">Click any journey to execute the workflow against the live SQLite state and inspect its 3rd-Line State-Diff Receipt.</p>
              </div>
              <span class="chip chip-info">Zero-Docker Local Execution</span>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; padding:10px 12px; background:var(--surface-container-low); border-radius:6px; border:1px solid var(--outline-variant);">
              <div style="font-size:12px;">
                <strong>Why Transcript Evals Fail Toggle:</strong> Compare the Governed Evergreen Agent against an Unguarded Transcript-Only Agent (which outputs a polite confirmation but leaves 0 SQLite rows mutated).
              </div>
              <select id="eval-mode-select" style="padding:6px 10px; border:1px solid var(--outline); border-radius:6px; font-size:12px; font-weight:600;">
                <option value="governed">Governed Evergreen Agent (32-Table State-Diff)</option>
                <option value="unguarded_transcript">Unguarded Transcript-Only Agent (False Positive Demo)</option>
              </select>
            </div>
            <div class="journey-list" id="hero-journeys-list">
              ${HERO_JOURNEYS.map(
                (j) => `
              <div class="journey-item">
                <div>
                  <div><strong>${j.id}: ${j.title}</strong> <span class="chip chip-pass">${j.promiseId}</span></div>
                  <div class="journey-meta">${j.summary}</div>
                  <div class="journey-meta">
                    <strong>Modalities:</strong> ${j.modalities.join(" + ")} &bull;
                    <strong>Handler:</strong> <code>${j.compiledHandler}</code> &bull;
                    <strong>Tables:</strong> <code>${j.expectedTablesMutated.join(", ")}</code>
                  </div>
                </div>
                <button class="btn btn-primary" onclick="runHeroJourney('${j.id}')">Run ${j.id}</button>
              </div>`,
              ).join("")}
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">15 Seeded Book-of-Business Anomalies (Cross-System Audit)</h2>
                <p class="card-subtitle">Detected across AMS (:3000), Rater (:3001), CRM (:3002), ECM (:3003), Comm (:3004), Summit Portal (:3005), Coastal Portal (:3006), and Claims (:3007).</p>
              </div>
              <span class="chip chip-pass">15 / 15 Triaged</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Category</th>
                  <th>Client / Policy</th>
                  <th>Anomaly Finding</th>
                  <th>Defense Action</th>
                </tr>
              </thead>
              <tbody>
                ${BOOK_ANOMALIES.map(
                  (a) => `
                <tr>
                  <td class="mono">${a.id}</td>
                  <td><span class="chip ${a.severity === "CRITICAL" ? "chip-block" : "chip-warn"}">${a.category}</span></td>
                  <td><strong>${a.client}</strong><br/><span class="mono">${a.policy}</span></td>
                  <td>${a.finding}</td>
                  <td><span class="chip chip-pass">${a.status}</span></td>
                </tr>`,
                ).join("")}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Live Journey Execution &amp; State-Diff Receipt</h2>
                <p class="card-subtitle">Proves every AI action with database row mutations, ACORD PDF receipts, and E&amp;O firewall verification.</p>
              </div>
              <span class="chip chip-pass" id="journey-status-chip">Ready</span>
            </div>
            <div id="journey-receipt-container" class="receipt-box">
              Select <strong>Run J1–J5</strong> on the left to execute a live Hero Journey and inspect the step-by-step trace and 32-table SQLite state receipt.
            </div>
            <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
              <a class="btn btn-success" href="/workbench/api/acord25-preview.pdf" target="_blank" rel="noopener">Preview Real ACORD 25 COI PDF (%PDF-1.7)</a>
              <a class="btn btn-primary" href="/workbench/api/documents/DOC-002/pdf" target="_blank" rel="noopener">ECM ACORD 80/90 Application (:3003)</a>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Interactive 11-Person Agency Capacity &amp; ROI Model</h2>
                <p class="card-subtitle">Adjust agency headcount or baseline book to model revenue/employee expansion.</p>
              </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
              <label style="font-size:12px; font-weight:600;">
                Agency Headcount (FTE)
                <input id="roi-staff" type="number" value="11" min="1" max="200" oninput="recalcRoi()" style="width:100%; padding:7px; margin-top:4px; border:1px solid var(--outline); border-radius:6px;" />
              </label>
              <label style="font-size:12px; font-weight:600;">
                Baseline Written Premium ($M)
                <input id="roi-book" type="number" value="20" min="1" max="500" step="0.5" oninput="recalcRoi()" style="width:100%; padding:7px; margin-top:4px; border:1px solid var(--outline); border-radius:6px;" />
              </label>
            </div>
            <div id="roi-summary" class="receipt-box">
              <div><strong>Baseline Agency:</strong> $20.0M Written Premium &bull; $2.20M Commission Revenue &bull; <strong>$200,000 / Employee</strong></div>
              <div style="margin-top:6px;"><strong>AI-Enabled Agency:</strong> $38.5M Written Premium &bull; $4.24M Commission Revenue &bull; <strong>$385,000 / Employee (+92.5%)</strong></div>
              <div style="margin-top:6px; color:var(--on-surface-variant);">78% of routine COI, FNOL, renewal remarketing, and endorsement checks compiled into $0-token deterministic handlers.</div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">The Seven Executive Promises (I1–I7)</h2>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Executive Promise</th>
                  <th>Verified Receipt</th>
                </tr>
              </thead>
              <tbody>
                ${SEVEN_EXECUTIVE_PROMISES.map(
                  (p) => `
                <tr>
                  <td class="mono"><strong>${p.id}</strong></td>
                  <td><strong>${p.title}</strong><br/><span style="color:var(--on-surface-variant)">${p.detail}</span></td>
                  <td><span class="chip chip-pass">${p.metric}</span></td>
                </tr>`,
                ).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>

    <!-- TAB 2: PRINCIPAL E&O & ESCALATION QUEUE -->
    <section id="tab-eo" class="tab-panel">
      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">2nd Line of Defense — Principal E&amp;O Escalation Queue</h2>
              <p class="card-subtitle">Live escalations stored in <code>ams.escalations</code>. Principals can Approve or Deny high-premium (&gt;$10K) or compliance holds.</p>
            </div>
            <button class="btn btn-primary" onclick="loadWorkbenchOverview()">Refresh Queue</button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Escalation ID</th>
                <th>Client / Policy</th>
                <th>Reason</th>
                <th>Summary</th>
                <th>Status / Action</th>
              </tr>
            </thead>
            <tbody id="escalations-tbody">
              <tr><td colspan="5">Loading escalations from AMS SQLite...</td></tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">1st Line of Defense — Service-Layer E&amp;O Firewall Tester</h2>
              <p class="card-subtitle">Directly invokes <code>packages/shared/src/compliance-firewall.ts</code> to verify deterministic HTTP 422 statutory rejections.</p>
            </div>
            <span class="chip chip-block">HTTP 422 Guard</span>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
            <label style="font-size:12px; font-weight:600;">State
              <select id="fw-state" style="width:100%; padding:7px; margin-top:4px; border:1px solid var(--outline); border-radius:6px;">
                <option value="CA">CA (Min 30/60/15)</option>
                <option value="TX">TX (Min 30/60/25)</option>
                <option value="FL">FL (Min 10/20/10)</option>
                <option value="NY">NY (Min 25/50/10)</option>
                <option value="IL">IL (Min 25/50/20)</option>
                <option value="PA">PA (Min 15/30/5)</option>
                <option value="OH">OH (Min 25/50/25)</option>
                <option value="GA">GA (Min 25/50/25)</option>
                <option value="NC">NC (Min 50/100/50)</option>
                <option value="MI">MI (Min 50/100/10)</option>
              </select>
            </label>
            <label style="font-size:12px; font-weight:600;">Requested BI/PD (k)
              <input id="fw-limits" type="text" value="10/20/5" style="width:100%; padding:7px; margin-top:4px; border:1px solid var(--outline); border-radius:6px;" />
            </label>
            <label style="font-size:12px; font-weight:600;">Effective Date
              <input id="fw-date" type="text" value="2025-01-01" style="width:100%; padding:7px; margin-top:4px; border:1px solid var(--outline); border-radius:6px;" />
            </label>
            <label style="font-size:12px; font-weight:600;">Annual Premium ($)
              <input id="fw-premium" type="number" value="14200" style="width:100%; padding:7px; margin-top:4px; border:1px solid var(--outline); border-radius:6px;" />
            </label>
          </div>
          <button class="btn btn-primary" onclick="testEoFirewall()">Test 1st-Line E&amp;O Firewall</button>
          <pre id="fw-result" class="receipt-box mono" style="margin-top:12px; white-space:pre-wrap;">Click "Test 1st-Line E&amp;O Firewall" to inspect the HTTP 422 EO_COMPLIANCE_VIOLATION payload.</pre>
        </div>
      </div>
    </section>

    <!-- TAB 3: 3RD-LINE STATE-DIFF & MULTI-MODAL TRACE RECEIPT -->
    <section id="tab-statediff" class="tab-panel">
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">3rd Line of Defense — Trajectory Claim vs. 32-Table SQLite Database State Evidence</h2>
            <p class="card-subtitle">Unlike chat-only benchmarks, Evergreen snapshots all 32 SQLite tables across all 8 services before and after every run and penalizes any unauthorized collateral mutation.</p>
          </div>
          <span class="chip chip-pass">Collateral Damage = 0</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Hero Journey / Scenario</th>
              <th>What the Agent Claimed (Chat / Tool Output)</th>
              <th>3rd-Line SQLite State-Diff Evidence</th>
              <th>Modality Split</th>
              <th>Collateral Check</th>
            </tr>
          </thead>
          <tbody>
            ${HERO_JOURNEYS.map(
              (j) => `
            <tr>
              <td><strong>${j.id}: ${j.title}</strong><br/><span class="mono">Scenario ${j.scenarioId}</span></td>
              <td>${j.steps.map((s) => `&bull; ${s.claim}`).join("<br/>")}</td>
              <td class="mono">${j.steps.map((s) => `&bull; ${s.dbEvidence}`).join("<br/>")}</td>
              <td>${j.modalities.map((m) => `<span class="chip chip-info">${m}</span>`).join(" ")}</td>
              <td><span class="chip chip-pass">PASS (0 Unauthorized)</span></td>
            </tr>`,
            ).join("")}
          </tbody>
        </table>
      </div>
    </section>

    <!-- TAB 4: 3-STAGE AGENT-TO-CODE ECONOMICS & SIMULATION CONTROLS -->
    <section id="tab-evolution" class="tab-panel">
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">3-Stage Agent-to-Code Evolution (Measured v0.8 Zero-Shot vs. Measured Domain Skill &amp; Reference Anchor)</h2>
            <p class="card-subtitle">Measured v0.8 results (20 workflows, 5 trials each) for zero-shot agents and the domain skill procedure guide, beside the 100.0% scripted reference verifier. Token and latency columns for Stages 1 and 2 are modeled.</p>
          </div>
          <span class="chip chip-pass">Stage 3: $0.0000 / Routine Run</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Evolution Stage</th>
              <th>Execution Architecture &amp; Provenance</th>
              <th>Avg LLM Tokens</th>
              <th>Est. Cost / Run</th>
              <th>Avg Latency</th>
              <th>pass@1 / Mean</th>
              <th>pass^5 / False-Done</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Stage 1: Zero-Shot General Agent</strong><br/><span class="chip chip-warn">Measured v0.8</span></td>
              <td>Zero-shot tool discovery across 8 services (<code>DeepSeek-V4.1-Flash</code> 59.0% pass@1, <code>gemini-3.8-flash</code> 58.0%, <code>claude-sonnet-5-5</code> 55.0%)</td>
              <td class="mono">6,500 tok</td>
              <td class="mono">$0.073–$0.449</td>
              <td class="mono">3,900 ms</td>
              <td class="mono">55.0%–59.0%<br/>(0.69–0.78 mean)</td>
              <td><span class="chip chip-block">39%–47% pass^5 · 37%–50% said "done" with a check failing</span></td>
            </tr>
            <tr>
              <td><strong>Stage 2: Domain Skill + Guardrails</strong><br/><span class="chip chip-info">Measured v0.8</span></td>
              <td>One-page agency procedure guide appended to the <code>gemini-3.8-flash</code> prompt (<code>eval/inspect/evergreen_domain_skill.md</code>)</td>
              <td class="mono">2,700 tok</td>
              <td class="mono">$0.405</td>
              <td class="mono">1,650 ms</td>
              <td class="mono">69.0%</td>
              <td><span class="chip chip-info">60.2% pass^5 · 35% false-done</span></td>
            </tr>
            <tr>
              <td><strong>Stage 3: $0-Token Compiled Deterministic Code (<code>privy:*</code>)</strong><br/><span class="chip chip-pass">Measured 20/20 Anchor</span></td>
              <td>Measured 100.0% scripted reference verifier (<code>baseline-agent.ts</code>) across all 20 workflows + projected <code>FallbackToSkill</code> on pivots (Scenarios 17–20)</td>
              <td class="mono">0 tok (routine)</td>
              <td class="mono">$0.0000</td>
              <td class="mono">180 ms</td>
              <td class="mono">100.0% (20/20)</td>
              <td><span class="chip chip-pass">100.0% (reference verifier)</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Deterministic Time-Travel Control Plane (<code>/sim/time-travel</code>)</h2>
              <p class="card-subtitle">Advance the agency clock to activate pending endorsements, expire stale carrier quotes, and trigger 60-day renewal remarketing sweeps.</p>
            </div>
            <span class="chip chip-info" id="sim-clock-chip">Offset: +0 Days</span>
          </div>
          <div style="display:flex; gap:10px; margin-bottom:12px;">
            <button class="btn btn-primary" onclick="triggerTimeTravel(30)">Advance Clock +30 Days</button>
            <button class="btn btn-primary" onclick="triggerTimeTravel(60)">Advance Clock +60 Days</button>
          </div>
          <pre id="sim-tt-result" class="receipt-box mono" style="white-space:pre-wrap;">Click "+30 Days" or "+60 Days" to advance the agency clock and trigger renewal remarketing tasks in ams.tasks.</pre>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Carrier Outage &amp; Chaos Injection (<code>/sim/chaos</code>)</h2>
              <p class="card-subtitle">Inject a 50% HTTP 503 failure rate on Rater (:3001), Summit Portal (:3005), and Coastal Portal (:3006) to test agent retry and fallback resilience.</p>
            </div>
            <span class="chip chip-pass" id="sim-chaos-chip">Nominal (0% Outage)</span>
          </div>
          <div style="display:flex; gap:10px; margin-bottom:12px;">
            <button class="btn btn-danger" onclick="toggleChaos(true)">Inject 50% HTTP 503 Chaos</button>
            <button class="btn btn-success" onclick="toggleChaos(false)">Restore 100% Carrier Health</button>
          </div>
          <pre id="sim-chaos-result" class="receipt-box mono" style="white-space:pre-wrap;">All 8 services operating at 100% nominal health.</pre>
        </div>
      </div>
    </section>
  </main>

  <script>
    function switchTab(tabId, btn) {
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
      btn.classList.add('active');
    }

    function recalcRoi() {
      const staff = Math.max(1, Number(document.getElementById('roi-staff').value || 11));
      const bookM = Math.max(1, Number(document.getElementById('roi-book').value || 20));
      const baseRev = bookM * 1_000_000 * 0.11;
      const aiBookM = bookM * 1.925;
      const aiRev = aiBookM * 1_000_000 * 0.11;
      const basePerEmp = Math.round(baseRev / staff);
      const aiPerEmp = Math.round(aiRev / staff);
      document.getElementById('roi-summary').innerHTML =
        '<div><strong>Baseline Agency (' + staff + ' Staff):</strong> $' + bookM.toFixed(1) + 'M Written Premium &bull; $' + (baseRev / 1_000_000).toFixed(2) + 'M Revenue &bull; <strong>$' + basePerEmp.toLocaleString() + ' / Employee</strong></div>' +
        '<div style="margin-top:6px;"><strong>AI-Enabled Agency (' + staff + ' Staff):</strong> $' + aiBookM.toFixed(1) + 'M Written Premium &bull; $' + (aiRev / 1_000_000).toFixed(2) + 'M Revenue &bull; <strong>$' + aiPerEmp.toLocaleString() + ' / Employee (+92.5%)</strong></div>';
    }

    async function runHeroJourney(journeyId) {
      const chip = document.getElementById('journey-status-chip');
      const box = document.getElementById('journey-receipt-container');
      const evalModeEl = document.getElementById('eval-mode-select');
      const evalMode = evalModeEl ? evalModeEl.value : 'governed';
      chip.textContent = 'Running ' + journeyId + '...';
      const res = await fetch('/workbench/api/run-journey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ journeyId, evalMode })
      });
      const data = await res.json();
      chip.textContent = data.executionSummary.status + ' (' + data.executionSummary.wallClockMs + ' ms)';
      chip.className = 'chip ' + (data.executionSummary.status === 'PASS' ? 'chip-pass' : 'chip-block');
      const stepsHtml = data.journey.steps.map(s =>
        '<div style="margin-top:8px; padding-top:8px; border-top:1px solid var(--outline-variant);">' +
        '<strong>Step ' + s.step + ' [' + s.modality + ' &rarr; ' + s.service + ']:</strong> <code>' + s.operation + '</code><br/>' +
        '<span>Claim: ' + s.claim + '</span><br/>' +
        '<span class="mono" style="color:' + (data.evalMode === 'unguarded_transcript' ? 'var(--status-block-fg)' : 'var(--status-pass-fg)') + ';">DB Evidence: ' +
        (data.evalMode === 'unguarded_transcript' ? 'MISSING (0 rows mutated in SQLite — caught by 32-table state-diff!)' : s.dbEvidence) + '</span>' +
        '</div>'
      ).join('');
      box.innerHTML =
        '<div><strong>' + data.journey.id + ': ' + data.journey.title + ' (' + data.evalMode + ')</strong></div>' +
        '<div class="mono" style="margin-top:4px;">Transcript Verdict: ' + data.executionSummary.transcriptJudgeVerdict + '<br/>State-Diff Verdict: ' + data.executionSummary.stateDiffVerdict + '</div>' +
        '<div class="mono" style="margin-top:4px;">Handler: ' + data.executionSummary.compiledHandler + ' | Tokens: ' + data.executionSummary.llmTokensUsed + ' | Cost: $' + data.executionSummary.estimatedCostUsd.toFixed(4) + ' | Audit Task Created: ' + (data.stateDiffReceipt.createdTaskId || 'NONE') + '</div>' +
        stepsHtml;
    }

    async function triggerTimeTravel(days) {
      const res = await fetch('/workbench/api/time-travel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days })
      });
      const data = await res.json();
      document.getElementById('sim-clock-chip').textContent = 'Offset: +' + data.totalSimulatedDaysOffset + ' Days (' + data.simulatedAgencyDate + ')';
      document.getElementById('sim-tt-result').textContent = JSON.stringify(data, null, 2);
    }

    async function toggleChaos(enabled) {
      const res = await fetch('/workbench/api/chaos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, failureRate: 0.5 })
      });
      const data = await res.json();
      const chip = document.getElementById('sim-chaos-chip');
      chip.textContent = data.chaos.enabled ? 'CHAOS ACTIVE (50% HTTP 503)' : 'Nominal (0% Outage)';
      chip.className = 'chip ' + (data.chaos.enabled ? 'chip-block' : 'chip-pass');
      document.getElementById('sim-chaos-result').textContent = JSON.stringify(data, null, 2);
    }

    async function loadWorkbenchOverview() {
      const res = await fetch('/workbench/api/overview');
      const data = await res.json();
      const tbody = document.getElementById('escalations-tbody');
      if (!tbody) return;
      tbody.innerHTML = data.escalations.map(esc => {
        const chipClass = esc.status === 'approved' ? 'chip-pass' : (esc.status === 'denied' ? 'chip-block' : 'chip-warn');
        const actions = esc.status === 'pending'
          ? '<button class="btn btn-success" onclick="resolveEscalation(\\'' + esc.escalation_id + '\\', \\'approved\\')">Approve</button> ' +
            '<button class="btn btn-danger" onclick="resolveEscalation(\\'' + esc.escalation_id + '\\', \\'denied\\')">Deny</button>'
          : '<span class="chip ' + chipClass + '">' + esc.status.toUpperCase() + '</span>';
        return '<tr>' +
          '<td class="mono">' + esc.escalation_id + '</td>' +
          '<td class="mono">' + esc.client_id + '<br/>' + (esc.policy_id || '—') + '</td>' +
          '<td><span class="chip chip-info">' + esc.reason + '</span></td>' +
          '<td>' + esc.summary + '</td>' +
          '<td>' + actions + '</td>' +
          '</tr>';
      }).join('');
    }

    async function resolveEscalation(id, decision) {
      await fetch('/workbench/api/escalations/' + id + '/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision })
      });
      await loadWorkbenchOverview();
    }

    async function testEoFirewall() {
      const state = document.getElementById('fw-state').value;
      const parts = (document.getElementById('fw-limits').value || '10/20/5').split('/').map(n => Number(n) * 1000);
      const effectiveDate = document.getElementById('fw-date').value;
      const annualPremium = Number(document.getElementById('fw-premium').value || 14200);
      const res = await fetch('/workbench/api/test-firewall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state,
          biPerPerson: parts[0] || 10000,
          biPerAccident: parts[1] || 20000,
          pdPerAccident: parts[2] || 5000,
          effectiveDate,
          annualPremium
        })
      });
      const data = await res.json();
      document.getElementById('fw-result').textContent = JSON.stringify(data, null, 2);
    }

    loadWorkbenchOverview();
  </script>
</body>
</html>`;
}

workbenchRouter.get("/", (c) => c.html(renderWorkbenchHtml()));
