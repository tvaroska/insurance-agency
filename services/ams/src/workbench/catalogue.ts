import { PRINCIPAL_BINDING_AUTHORITY_USD } from "@evergreen/shared";

function pdfEscape(text: string): string {
  return text.replace(/[\\()]/g, (ch) => `\\${ch}`).replace(/[^\x20-\x7e]/g, "-");
}

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
  { id: "ANOM-01", category: "E&O / Statutory", severity: "CRITICAL", client: "Tanya Marsh (CLI-027, TX)", policy: "POL-PA-2026-000030", finding: "Seeded TX auto limits 15/30/5 violate Texas statutory minimum (30/60/25)", service: "AMS / Rater", status: "Blocked by 1st-Line Firewall" },
  { id: "ANOM-02", category: "E&O / Backdating", severity: "CRITICAL", client: "Megan Sullivan (CLI-022)", policy: "POL-AU-2025-018", finding: "Attempted collision deductible reduction backdated 14 days prior to loss date", service: "AMS / Claims", status: "Blocked + Escalated to Principal" },
  { id: "ANOM-03", category: "Binding Authority", severity: "HIGH", client: "Robert Kim (CLI-008)", policy: "POL-GL-2025-000022", finding: "$14,200 commercial package bind exceeds $10,000 automated producer authority cap", service: "Rater / AMS", status: "Awaiting Principal Approval" },
  { id: "ANOM-04", category: "Document Hygiene", severity: "HIGH", client: "Victor Marsh (CLI-026)", policy: "POL-HO-2025-029", finding: "Active policy bound with unsigned ACORD application in ECM (pending_signature)", service: "ECM / AMS", status: "Task Queued for CSR" },
  { id: "ANOM-05", category: "COI Compliance", severity: "CRITICAL", client: "George Papadopoulos (CLI-015)", policy: "POL-GL-2025-002", finding: "Certificate holder requested Blanket Additional Insured (CG 20 10) not endorsed on policy", service: "ECM (:3003)", status: "COI Hold + Endorsement Quoted" },
  { id: "ANOM-06", category: "Renewal Retention", severity: "MEDIUM", client: "Maria Rodriguez (CLI-003)", policy: "POL-PA-2025-002103", finding: "+26.4% renewal premium increase triggered remarketing across 5 REST carriers", service: "AMS / Rater", status: "Remarketed (Saved $640/yr)" },
  { id: "ANOM-07", category: "Lapsed + Open Claim", severity: "CRITICAL", client: "Derek Hawkins (CLI-025)", policy: "POL-AU-2025-051", finding: "Lapsed personal auto policy has active post-lapse claim CLM-2026-00010", service: "Claims (:3007)", status: "SIU Flag + Principal Escalation" },
  { id: "ANOM-08", category: "Attorney Triage", severity: "CRITICAL", client: "Brian Lawson (CLI-021)", policy: "POL-AU-2025-039", finding: "Claimant representation notice from plaintiff counsel on bodily injury claim", service: "Comm / Claims", status: "Escalated to Principal & Carrier" },
  { id: "ANOM-09", category: "Coverage Gap", severity: "HIGH", client: "David Thompson (CLI-004)", policy: "POL-PA-2024-003210", finding: "Personal Umbrella requires $250K/$500K underlying auto BI; gap flagged in book audit", service: "AMS / CRM", status: "Underlying Limit Endorsement Queued" },
  { id: "ANOM-10", category: "Commission Audit", severity: "MEDIUM", client: "Rosa Jimenez (CLI-018)", policy: "POL-GL-2025-011", finding: "Hartland Commercial statement paid 12.0% vs. 15.0% contracted agency schedule", service: "AMS Accounting", status: "$1,290 Variance Flagged" },
  { id: "ANOM-11", category: "Entity Resolution", severity: "HIGH", client: "Sarah Chen (CLI-001 / CLI-030)", policy: "POL-HO-2025-000312", finding: "Duplicate client records across Personal Auto and Homeowners with split household discount", service: "AMS / CRM", status: "Merged + Multi-Policy Credit Applied" },
  { id: "ANOM-12", category: "Entity Resolution", severity: "HIGH", client: "Derek Hawkins (CLI-025 / CLI-031)", policy: "POL-AU-2025-051", finding: "Duplicate client profile hiding prior cancellation and claim history", service: "AMS / CRM", status: "Merged + E&O Alert Logged" },
  { id: "ANOM-13", category: "Portal Sync", severity: "MEDIUM", client: "Natasha Brooks (CLI-012)", policy: "SUB-SUMMIT-904", finding: "Summit Fire & Casualty portal (:3005) commercial quote ready but unlinked in AMS", service: "Carrier-Summit (:3005)", status: "Synced via Portal Session" },
  { id: "ANOM-14", category: "Driver / MVR", severity: "HIGH", client: "Tyler Morrison (CLI-019)", policy: "POL-PA-2025-003200", finding: "Carrier denial recovery & MVR violation gate routed through Coastal Star Auto portal (:3006)", service: "Carrier-Coastal (:3006)", status: "Non-Standard Quote Bound" },
  { id: "ANOM-15", category: "Cancellation Rescue", severity: "HIGH", client: "Jennifer Kim (CLI-009)", policy: "POL-WC-2025-007", finding: "Pending non-payment cancellation in 72 hours on active Workers Comp policy", service: "AMS / Comm (:3004)", status: "Urgent Outreach Sent" },
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

export const EVOLUTION_STAGES = [
  {
    stage: "Stage 1: Zero-Shot General Agent",
    label: "Measured v0.9 Baseline (Strict 3-Modality, 20 Workflows x 5 Trials + 20 Clean)",
    provenance: "measured_v0.9_baseline",
    avgTokensPerRun: 1333422,
    avgCostUsd: 0.476,
    avgLatencyMs: 214650,
    pass1: 0.67,
    meanScore: 0.77,
    pass5: 0.587,
    falseCompletionRateRange: "15%–34%",
    measuredModels: [
      { model: "gemini-3.8-flash", pass1: 0.67, meanScore: 0.77, falseCompletionRate: 0.15, costPerTaskUsd: 0.476 },
      { model: "claude-sonnet-5-5", pass1: 0.66, meanScore: 0.81, falseCompletionRate: 0.16, costPerTaskUsd: 0.145 },
      { model: "DeepSeek-V4.1-Flash", pass1: 0.56, meanScore: 0.75, falseCompletionRate: 0.34, costPerTaskUsd: 0.039 },
    ],
    description:
      "Measured v0.9 zero-shot baseline across 20 strict workflows, 5 trials each: gemini-3.8-flash 67.0% pass@1, claude-sonnet-5-5 66.0%, DeepSeek-V4.1-Flash 56.0%, and a 15%–34% unconditional false-completion rate across all runs (45.5%–77.3% on failed runs).",
  },
  {
    stage: "Stage 2: Domain Skill + Guardrails",
    label: "Measured v0.9 Domain Skill (Agency Procedure Guide, 10/10 Train-Holdout)",
    provenance: "measured_v0.9_domain_skill",
    avgTokensPerRun: 1002522,
    avgCostUsd: 0.49,
    avgLatencyMs: 194980,
    pass1: 0.83,
    pass5: 0.737,
    description:
      "Measured v0.9: a one-page agency procedure guide appended to the gemini-3.8-flash prompt raises pass@1 from 67.0% to 83.0% (84.0% train, 82.0% holdout), halves the messy-data drop (-28.0 pp to -12.0 pp), and cuts judgment traps missed from 12 to 2 of 60.",
  },
  {
    stage: "Stage 3: $0-Token Compiled Deterministic Code",
    label: "Measured 100.0% Scripted Reference Verifier (20/20 Workflows) + Projected FallbackToSkill",
    provenance: "measured_reference_verifier_with_projected_fallback",
    avgTokensPerRun: 0,
    avgCostUsd: 0.0,
    avgLatencyMs: 180,
    pass1: 1.0,
    pass5: 1.0,
    description:
      "Measured 100.0% scripted reference verifier (baseline-agent.ts) across all 20 workflows for routine COI, FNOL, renewal audit, and endorsement checks at $0 token cost; projected FallbackToSkill on mid-conversation client pivots (Scenarios 17–20).",
  },
];

export function buildSampleEscalations(now: string) {
  return [
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
        requested_effective_date: "2026-09-30",
        loss_date: "2026-10-08",
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
}

export const ACORD25_PREVIEW_PDF = `%PDF-1.7
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
