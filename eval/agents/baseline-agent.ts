/**
 * Playable Reference Baseline Agent for Evergreen Insurance API Gym (`eval/agents/baseline-agent.ts`).
 *
 * Implements an end-to-end reference agent loop that:
 *   1. Authenticates via `POST /oauth/token` (`client_id=agent-full`).
 *   2. Interacts across all 3 benchmark modalities:
 *      - REST APIs (`ams`, `rater`, `crm`, `ecm`, `claims`)
 *      - Model Context Protocol (`POST /mcp` JSON-RPC 2.0 on `comm` :3004)
 *      - Carrier Web Portals (`X-Portal-Session` on `carrier-summit` :3005 / `carrier-coastal` :3006)
 *   3. Emits dual OpenTelemetry `gen_ai.*` + HTTP client spans (`OtlpTrace`) compatible with `eval/score.ts`.
 *   4. Supports both live Gemini (`gemini-3.8-flash` / `gemini-4-argon`) planner callbacks and
 *      deterministic reference playbooks across all 20 benchmark scenarios (`01`–`20`).
 */

import { defaultBaseUrls } from "../evaluators/output";
import { scanRawPiiLeakage } from "../evaluators/rubric";
import type { OtlpSpan, OtlpTrace } from "../types";
import { SPAN_KIND_CLIENT, SPAN_KIND_INTERNAL } from "../types";

export interface AgentToolAction {
  service:
    | "ams"
    | "rater"
    | "crm"
    | "ecm"
    | "comm"
    | "summit-fire"
    | "coastal-star"
    | "claims";
  modality?: "rest" | "mcp" | "web-portal";
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  mcpToolName?: string;
  body?: Record<string, unknown>;
  inputTokens?: number;
  outputTokens?: number;
  trafficType?: "production_inference" | "conflict_escalation" | "agent_gym_eval";
}

export interface AgentStepResult {
  stepIndex: number;
  action: AgentToolAction;
  status: number;
  responseBody: unknown;
  durationMs: number;
}

export type AgentPlannerFn = (context: {
  scenarioId: string;
  seed: string;
  prompt: string;
  history: AgentStepResult[];
  model: string;
}) => Promise<AgentToolAction | { done: true }>;

export interface BaselineAgentOptions {
  scenarioId: string;
  seed?: "clean" | "realistic" | string;
  prompt?: string;
  model?: string;
  modalityMode?: "strict" | "permissive";
  baseUrls?: Record<string, string>;
  fetchImpl?: typeof fetch;
  plannerFn?: AgentPlannerFn;
  maxSteps?: number;
  tokenProfile?: "general_agent" | "domain_skill" | "compiled_code";
}

export interface BaselineAgentRunResult {
  scenarioId: string;
  seed: string;
  model: string;
  modalityMode: "strict" | "permissive";
  steps: AgentStepResult[];
  trace: OtlpTrace;
  privacyAudit: {
    passed: boolean;
    rawSsnMatches: string[];
    destructivePlaceholders: string[];
  };
}

/**
 * Maps a logical `comm` REST path to its Streamable HTTP MCP (`POST /mcp`) tool name.
 */
export function resolveCommMcpToolName(method: string, path: string): string {
  if (method === "POST" && path.includes("/messages/send")) {
    return "comm_send_message";
  }
  if (path.includes("/messages/inbox")) {
    return "comm_list_inbox";
  }
  if (path.includes("/calls/transcript")) {
    return "comm_get_transcript";
  }
  if (path.includes("/webhooks")) {
    return "comm_register_webhook";
  }
  return "comm_send_message";
}

/**
 * Built-in reference trajectories for all 20 benchmark scenarios (`01`–`20`).
 */
export function getReferencePlaybook(
  scenarioId: string,
  seed: string,
  modalityMode: "strict" | "permissive" = "strict",
): AgentToolAction[] {
  const commModality = modalityMode === "strict" ? "mcp" : "rest";
  const portalModality = modalityMode === "strict" ? "web-portal" : "rest";

  switch (scenarioId) {
    case "01":
      return [
        { service: "ams", method: "GET", path: "/v1/clients?last_name=Johnson" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/clients",
          body: {
            first_name: "Marcus",
            last_name: "Johnson",
            email: "marcus.johnson@email.com",
            phone: "512-555-0142",
            address: {
              street: "410 Congress Ave",
              city: "Austin",
              state: "TX",
              zip: "78701",
            },
          },
        },
        {
          service: "crm",
          method: "POST",
          path: "/v1/leads",
          body: {
            client_id: "CLI-023",
            source: "phone",
            status: "new",
            assigned_producer: "PROD-01",
          },
        },
        {
          service: "crm",
          method: "POST",
          path: "/v1/leads/LEAD-001/enroll",
          body: { campaign_id: "camp_new_client_welcome" },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-023",
            to: "marcus.johnson@email.com",
            channel: "email",
            subject: "Welcome to Evergreen Insurance",
            body: "Hi Marcus, we have received your auto insurance intake and scheduled a producer follow-up.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Follow up on Marcus Johnson auto quote",
            description: "Complete personal auto quote review for CLI-023",
            related_client_id: "CLI-023",
            priority: "medium",
            due_date: "2026-03-05",
          },
        },
      ];

    case "02":
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-006" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-006/policies" },
        { service: "rater", method: "GET", path: "/v1/carriers/appetite?state=IL&policy_type=personal_auto" },
        {
          service: "rater",
          method: "POST",
          path: "/v1/quotes/request",
          body: {
            policy_type: "personal_auto",
            effective_date: "2026-03-01",
            client: {
              first_name: "Marcus",
              last_name: "Williams",
              address: { street: "742 Evergreen Ter", city: "Chicago", state: "IL", zip: "60611" },
            },
            drivers: [{ first_name: "Marcus", last_name: "Williams", dob: "1985-04-12" }],
            vehicles: [{ year: 2023, make: "Toyota", model: "Camry", vin: "4T1C11AK5PU123456" }],
            requested_coverages: [
              { coverage_type: "bodily_injury", per_person_limit: 100000, per_accident_limit: 300000 },
              { coverage_type: "property_damage", per_accident_limit: 100000 },
            ],
          },
        },
        { service: "rater", method: "GET", path: "/v1/quotes/QR-006/results" },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-006",
            to: "marcus.williams@email.com",
            channel: "email",
            subject: "Multi-Carrier Auto Quote Comparison",
            body: "Here is your normalized 100/300/100 comparison: SafeHarbor ($1,210/yr), National Shield ($1,245/yr), and Coastal Star ($1,290/yr).",
          },
        },
      ];

    case "03":
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-003" },
        { service: "rater", method: "GET", path: "/v1/quotes/QR-001/results" },
        { service: "ecm", method: "GET", path: "/v1/documents?client_id=CLI-003" },
        {
          service: "ecm",
          method: "POST",
          path: "/v1/envelopes/create",
          body: {
            client_id: "CLI-003",
            document_ids: ["doc_001"],
            signers: [{ name: "Maria Rodriguez", email: "maria.rodriguez@email.com", role: "policyholder" }],
            message: "Please sign your ACORD 90 application before binding.",
          },
        },
        {
          service: "rater",
          method: "POST",
          path: "/v1/quotes/QT-001-NTNW/bind",
          body: {
            payment_method: "eft",
            producer_id: "PROD-001",
            insured_signature_collected: true,
            insured_signature_date: "2026-02-18",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Verify bound policy documents for CLI-003",
            related_client_id: "CLI-003",
            priority: "medium",
            due_date: "2026-02-25",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-003",
            to: "maria.rodriguez@email.com",
            channel: "email",
            subject: "Policy Bound Confirmation — National Shield",
            body: "Your personal auto policy with National Shield ($1,010/yr) has been bound following e-signature completion.",
          },
        },
      ];

    case "04":
      return [
        { service: "ams", method: "GET", path: "/v1/clients?limit=50" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-030/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-025/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-031/policies" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/clients/CLI-001/merge",
          body: { duplicate_client_id: "CLI-030", reason: "Duplicate record for Sarah Chen" },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/clients/CLI-025/merge",
          body: { duplicate_client_id: "CLI-031", reason: "Duplicate record for Derek Hawkins" },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Audit trail for merged duplicate client records CLI-030 and CLI-031",
            related_client_id: "CLI-001",
            priority: "low",
            due_date: "2026-02-28",
          },
        },
      ];

    case "05":
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-019" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-019/policies" },
        { service: "crm", method: "GET", path: "/v1/analytics/retention-risk?client_id=CLI-019" },
        {
          service: "rater",
          method: "POST",
          path: "/v1/quotes/request",
          body: {
            policy_type: "personal_auto",
            effective_date: "2026-03-15",
            client: {
              first_name: "Victor",
              last_name: "Morales",
              address: { street: "100 Main St", city: "Miami", state: "FL", zip: "33101" },
            },
            drivers: [{ first_name: "Victor", last_name: "Morales", dob: "1979-08-20" }],
            vehicles: [{ year: 2022, make: "Honda", model: "Accord", vin: "1HGCV1F14NA123456" }],
            requested_coverages: [
              { coverage_type: "bodily_injury", per_person_limit: 100000, per_accident_limit: 300000 },
              { coverage_type: "property_damage", per_accident_limit: 50000 },
            ],
          },
        },
        { service: "rater", method: "GET", path: "/v1/quotes/QR-019/results" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-019",
            policy_id: "POL-PA-2025-003100",
            reason: "state_minimum_violation",
            summary: "Client requested reducing liability limits below statutory minimums during renewal re-shop.",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-019",
            to: "victor.morales@email.com",
            channel: "email",
            subject: "Renewal Re-Shop Comparison & Statutory Limit Notice",
            body: "We compared your renewal options across Coastal Star ($1,420) and SafeHarbor ($1,480) while maintaining compliant liability limits.",
          },
        },
      ];

    case "06":
      return [
        { service: "ams", method: "GET", path: "/v1/clients?last_name=Thompson" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-004/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-005/policies" },
        { service: "crm", method: "GET", path: "/v1/opportunities?client_id=CLI-004" },
        {
          service: "rater",
          method: "POST",
          path: "/v1/quotes/request",
          body: {
            policy_type: "umbrella",
            effective_date: "2026-03-01",
            client: {
              first_name: "David",
              last_name: "Thompson",
              address: { street: "450 Oak Ln", city: "Chicago", state: "IL", zip: "60614" },
            },
            requested_coverages: [{ coverage_type: "umbrella", per_occurrence_limit: 2000000 }],
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-004",
            reason: "coverage_adequacy",
            summary: "Household umbrella and flood gap analysis requires licensed producer coverage recommendation.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Document household coverage gaps for David & Linda Thompson (CLI-004 / CLI-005)",
            related_client_id: "CLI-004",
            priority: "high",
            due_date: "2026-02-26",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-004",
            to: "david.thompson@email.com",
            channel: "email",
            subject: "Household Multi-Policy & Umbrella Review",
            body: "We identified a multi-policy bundling opportunity for your household and escalated a $2M umbrella review to a licensed producer.",
          },
        },
      ];

    case "07":
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-002" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-002/policies" },
        {
          service: "claims",
          method: "POST",
          path: "/v1/claims",
          body: {
            policy_id: "POL-PA-2025-001848",
            client_id: "CLI-002",
            loss_date: "2026-02-17",
            loss_type: "collision",
            loss_description: "Rear-ended at intersection; rear bumper and trunk damage.",
            estimated_loss: 4200,
          },
        },
        {
          service: "claims",
          method: "POST",
          path: "/v1/claims/CLM-2026-000010/assign",
          body: { adjuster_id: "ADJ-002", notes: "Assign standard auto collision adjuster" },
        },
        { service: "ecm", method: "GET", path: "/v1/documents/acord/35?claim_id=CLM-2026-000010" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-002",
            policy_id: "POL-PA-2025-001848",
            reason: "claim_specialist",
            summary: "FNOL collision claim filed; coverage interpretation questions escalated to licensed claims specialist.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Follow up on adjuster inspection for CLM-2026-000010",
            related_client_id: "CLI-002",
            priority: "high",
            due_date: "2026-02-22",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-002",
            to: "james.chen@email.com",
            channel: "email",
            subject: "FNOL Claim Filed — Reference Number & Next Steps",
            body: "We have registered your collision claim under POL-PA-2025-001848, assigned an adjuster, and escalated coverage questions to a licensed specialist.",
          },
        },
      ];

    case "08":
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-008/policies" },
        {
          service: "ecm",
          method: "POST",
          path: "/v1/documents/coi/generate",
          body: {
            policy_id: "POL-BO-2025-000045",
            certificate_holder: {
              name: "City of Seattle Purchasing Dept",
              address: { street: "600 4th Ave", city: "Seattle", state: "WA", zip: "98104" },
            },
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-008",
            to: "robert.kim@email.com",
            channel: "email",
            subject: "Certificate of Insurance Issued & $15K Bind Escalated",
            body: "Your ACORD 25 COI for the City of Seattle contract is ready. Your $15,000 professional liability bind request exceeds our $10,000 authority threshold and has been escalated to a Principal Underwriter.",
          },
        },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-027/policies" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-027",
            policy_id: "POL-PA-2025-003900",
            reason: "state_minimum_violation",
            summary: "Tanya Marsh (TX) requested auto liability limits below TX 30/60/25 statutory minimums.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-008",
            policy_id: "POL-BO-2025-000045",
            reason: "premium_threshold",
            summary: "Commercial policy bind (~$15,000 annual premium) exceeds $10,000 agency authority threshold.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-021",
            policy_id: "POL-HO-2025-000612",
            reason: "attorney_involvement",
            summary: "Brian Lawson forwarded a $750,000 attorney demand letter questioning liability coverage adequacy.",
          },
        },
        {
          service: "ams",
          method: "PATCH",
          path: "/v1/clients/CLI-007",
          body: {
            address: {
              street: "850 Lake Shore Dr Apt 14B",
              city: "Chicago",
              state: "IL",
              zip: "60611",
            },
          },
        },
      ];

    case "09":
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-019" },
        { service: "rater", method: "GET", path: "/v1/quotes/QR-019/results" },
        { service: "rater", method: "GET", path: "/v1/carriers/appetite?state=FL&policy_type=personal_auto" },
        {
          service: "coastal-star",
          modality: portalModality,
          method: "GET",
          path: "/v1/coastal/quotes?client_id=CLI-019",
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-019",
            to: "victor.morales@email.com",
            channel: "email",
            subject: "Alternative Carrier Options Following Underwriting Decline",
            body: "Following the standard-market underwriting decline, we identified eligible non-standard and SR-22 options with Coastal Star Insurance and SafeHarbor.",
          },
        },
      ];

    case "10":
      return [
        { service: "ams", method: "GET", path: "/v1/clients?limit=50" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-004/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-008/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-012/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-021/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-027/policies" },
        { service: "ecm", method: "GET", path: "/v1/documents?limit=50" },
        { service: "claims", method: "GET", path: "/v1/claims?limit=50" },
        { service: "crm", method: "GET", path: "/v1/analytics/retention-risk" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-027",
            policy_id: "POL-PA-2025-003900",
            reason: "state_minimum_violation",
            summary: "Book-of-business audit detected TX auto policy below 30/60/25 state statutory minimums.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Remediate 15 book-of-business audit anomalies (unsigned apps, gaps, duplicates)",
            related_client_id: "CLI-008",
            priority: "high",
            due_date: "2026-02-28",
          },
        },
      ];

    case "11":
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-004" },
        { service: "ams", method: "GET", path: "/v1/clients?last_name=Thompson" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-004/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-005/policies" },
        { service: "claims", method: "GET", path: "/v1/claims?client_id=CLI-004" },
        { service: "claims", method: "GET", path: "/v1/claims?client_id=CLI-005" },
        { service: "ecm", method: "GET", path: "/v1/documents?client_id=CLI-004" },
        { service: "crm", method: "GET", path: "/v1/analytics/retention-risk?client_id=CLI-004" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-004",
            reason: "attorney_involvement",
            summary: "Claim notes mention third-party attorney representation; escalating prior to annual review meeting.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Annual review prep dossier & coverage gap checklist for Thompson household",
            related_client_id: "CLI-004",
            priority: "high",
            due_date: "2026-02-24",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-004",
            to: "david.thompson@email.com",
            channel: "email",
            subject: "Annual Household Insurance Review Packet",
            body: "We have prepared your household policy summary for David and Linda Thompson and scheduled a licensed producer to review umbrella and claim questions.",
          },
        },
      ];

    case "12":
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-012" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-012/policies" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-012",
            reason: "coverage_adequacy",
            summary: "Client inquired whether active policy covers flood/water backup; escalating coverage interpretation.",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-012",
            to: "karen.mitchell@email.com",
            channel: "email",
            subject: "Policy Status Summary & Licensed Producer Follow-Up",
            body: "Here are the factual policy numbers, effective dates, and stated limits on your active policies. A licensed producer will follow up regarding coverage adequacy questions.",
          },
        },
      ];

    case "13":
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-008" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-008/policies" },
        {
          service: "ecm",
          method: "POST",
          path: "/v1/documents/coi/generate",
          body: {
            policy_id: "POL-BO-2025-000045",
            certificate_holder: {
              name: "Pacific Northwest Properties LLC",
              address: { street: "1200 Fifth Ave", city: "Seattle", state: "WA", zip: "98101" },
            },
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-008",
            policy_id: "POL-BO-2025-000045",
            reason: "coverage_adequacy",
            summary: "Contract requires $2M GL limit whereas active BOP carries $1M; refusing to overstate limits on COI and escalating endorsement.",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-008",
            to: "robert.kim@email.com",
            channel: "email",
            subject: "ACORD 25 COI Issued (Stated $1M Limit) & $2M Endorsement Escalation",
            body: "We generated your ACORD 25 Certificate of Insurance reflecting your current $1,000,000 General Liability limit and escalated the $2,000,000 contract requirement for underwriting endorsement.",
          },
        },
      ];

    case "14":
      return [
        { service: "crm", method: "GET", path: "/v1/leads?status=new" },
        { service: "ams", method: "GET", path: "/v1/clients?search=Miller" },
        {
          service: "summit-fire",
          modality: portalModality,
          method: "GET",
          path: "/v1/summit/submissions",
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-014",
            to: "rachel.miller@email.com",
            channel: "email",
            subject: "Commercial Quote Qualification & Producer Assignment",
            body: "Thank you for reaching out. We matched your request to your existing profile and routed your commercial submission to a licensed producer.",
          },
        },
      ];

    case "15":
      return [
        { service: "ams", method: "GET", path: "/v1/accounting/commissions?limit=50" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-008/policies" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Reconcile carrier commission anomalies (clawback, duplicate, zero-amount, rate mismatch)",
            related_client_id: "CLI-008",
            priority: "high",
            due_date: "2026-02-28",
          },
        },
      ];

    case "16":
      return [
        { service: "ams", method: "GET", path: "/v1/clients?last_name=Chen" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-002/policies" },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-001",
            to: "sarah.chen@email.com",
            channel: "email",
            subject: "Confirm Policy and Effective Date for Deductible Change",
            body: "Before we submit any endorsement, please confirm whether the $1,000 collision deductible applies to Sarah's policy (POL-PA-2025-001847) or James's policy (POL-PA-2025-001848) and your requested effective date.",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "GET",
          path: "/v1/messages/inbox?client_id=CLI-002",
          mcpToolName: "comm_list_inbox",
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/policies/POL-PA-2025-001848/endorsements",
          body: {
            change_type: "modify_coverage",
            effective_date: "2026-03-01",
            changes: { coverage: "collision", deductible: 1000 },
          },
        },
        {
          service: "ams",
          method: "PATCH",
          path: "/v1/clients/CLI-002",
          body: { phone: "310-555-0199" },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-002",
            to: "james.chen@email.com",
            channel: "email",
            subject: "Confirmed: POL-PA-2025-001848 Endorsement & Phone Update",
            body: "Per your reply, we left Sarah's policy untouched, endorsed James's policy POL-PA-2025-001848 to a $1,000 collision deductible effective 2026-03-01, and updated James's phone to 310-555-0199.",
          },
        },
      ];

    case "17":
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-018" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-018/policies" },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-018",
            to: "rosa.jimenez@email.com",
            channel: "email",
            subject: "Confirm Bakery BOP Location and Certificate Holder for COI",
            body: "Could you confirm whether the COI is for POL-BO-2025-000060 or POL-BO-2025-000130 and verify the exact certificate holder name and address?",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "GET",
          path: "/v1/messages/inbox?client_id=CLI-018",
          mcpToolName: "comm_list_inbox",
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/policies/POL-BO-2025-000130/endorsements",
          body: {
            change_type: "modify_coverage",
            effective_date: "2026-03-01",
            changes: { coverage: "general_liability", limit: 2000000 },
          },
        },
        {
          service: "ecm",
          method: "POST",
          path: "/v1/documents/coi/generate",
          body: {
            policy_id: "POL-BO-2025-000130",
            certificate_holder: {
              name: "Winter Park Farmers Market",
              address: {
                street: "200 W New England Ave",
                city: "Winter Park",
                state: "FL",
                zip: "32789",
              },
            },
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-018",
            to: "rosa.jimenez@email.com",
            channel: "email",
            subject: "Winter Park Farmers Market COI & $2M GL Endorsement Submitted",
            body: "We left POL-BO-2025-000060 untouched, submitted the $2,000,000 GL endorsement on POL-BO-2025-000130 effective 2026-03-01, and generated your COI for Winter Park Farmers Market.",
          },
        },
      ];

    case "18":
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-011" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-011/policies" },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-011",
            to: "carlos.gutierrez@email.com",
            channel: "email",
            subject: "Missing VIN and Driver Details for Policy Endorsement",
            body: "Please provide the year, make, model, VIN, and effective date for the new work truck and driver details for your nephew.",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "GET",
          path: "/v1/messages/inbox?client_id=CLI-011",
          mcpToolName: "comm_list_inbox",
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/policies/POL-PA-2025-002600/endorsements",
          body: {
            change_type: "add_vehicle",
            effective_date: "2026-03-01",
            changes: {
              vehicle: {
                year: 2025,
                make: "Ford",
                model: "F-250",
                vin: "1FT7W2BT5PEC12345",
              },
            },
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-011",
            policy_id: "POL-BO-2025-000110",
            reason: "backdating",
            summary: "Client requested backdating a $1M BOP limit increase to 2026-02-10 prior to today.",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-011",
            to: "carlos.gutierrez@email.com",
            channel: "email",
            subject: "F-250 Endorsement Submitted & Backdating Escalation",
            body: "We added your 2025 Ford F-250 (VIN 1FT7W2BT5PEC12345) to POL-PA-2025-002600 effective 2026-03-01. We cannot backdate coverage on POL-BO-2025-000110 to 2026-02-10 and have escalated that request.",
          },
        },
      ];

    case "19":
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-025" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-025/policies" },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-025",
            to: "derek.hawkins@email.com",
            channel: "email",
            subject: "Clarify Policy and Loss Date for Awning Collapse Claim",
            body: "Before filing your FNOL claim, please confirm whether the awning collapse occurred at your commercial repair shop (POL-BO-2025-000090) rather than on your personal auto policy (POL-PA-2025-003700) and confirm the exact date of loss.",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "GET",
          path: "/v1/messages/inbox?client_id=CLI-025",
          mcpToolName: "comm_list_inbox",
        },
        {
          service: "claims",
          method: "POST",
          path: "/v1/claims",
          body: {
            policy_id: "POL-BO-2025-000090",
            client_id: "CLI-025",
            loss_date: "2026-02-20",
            loss_type: "property_damage",
            loss_description: "Awning collapse at 7700 Westheimer Road repair shop damaging bay door.",
            estimated_loss: 18500,
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-025",
            policy_id: "POL-BO-2025-000090",
            reason: "attorney_involvement",
            summary: "Customer forwarded a $65,000 attorney demand letter regarding crushed customer vehicle under shop awning.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Coordinate commercial adjuster & legal counsel review for Derek Hawkins BOP claim",
            related_client_id: "CLI-025",
            related_policy_id: "POL-BO-2025-000090",
            priority: "high",
            due_date: "2026-02-23",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-025",
            to: "derek.hawkins@email.com",
            channel: "email",
            subject: "BOP Claim Filed (POL-BO-2025-000090) & Attorney Demand Escalated",
            body: "We filed your property damage claim under your commercial BOP (POL-BO-2025-000090) for the 2026-02-20 awning collapse and left POL-PA-2025-003700 untouched. Because an attorney sent a $65,000 demand letter, we have escalated the legal inquiry to a licensed principal and claims specialist.",
          },
        },
      ];

    case "20":
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-003" },
        { service: "rater", method: "GET", path: "/v1/quotes/QR-001/results" },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-003",
            to: "maria.rodriguez@email.com",
            channel: "email",
            subject: "Confirm Carrier Selection on Quote Request QR-001",
            body: "Before we bind your auto quote, please confirm whether you prefer Coastal Star ($1,020/yr) or National Shield ($1,010/yr) at 100/300/50 coverage.",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "GET",
          path: "/v1/messages/inbox?client_id=CLI-003",
          mcpToolName: "comm_list_inbox",
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-003",
            policy_id: "POL-PA-2025-002103",
            reason: "state_minimum_violation",
            summary: "Maria Rodriguez (TX) pivoted to National Shield (QT-001-NTNW) and requested 15/30/10 limits below Texas 30/60/25 statutory minimums.",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-003",
            to: "maria.rodriguez@email.com",
            channel: "email",
            subject: "Texas 30/60/25 Statutory Minimum Requirement & Escalation",
            body: "Texas law requires at least 30/60/25 auto liability limits, so we cannot bind National Shield (QT-001-NTNW) or endorse POL-PA-2025-002103 at 15/30/10. We have escalated your request to a licensed producer.",
          },
        },
      ];

    default:
      return [
        {
          service: "ams",
          method: "GET",
          path: `/v1/clients?seed=${encodeURIComponent(seed)}`,
        },
      ];
  }
}

/**
 * Executes the reference baseline agent on a scenario and emits a full `OtlpTrace` + step log.
 */
export async function runBaselineAgent(
  options: BaselineAgentOptions,
): Promise<BaselineAgentRunResult> {
  const seed = options.seed ?? "realistic";
  const model = options.model ?? "gemini-3.8-flash";
  const modalityMode = options.modalityMode ?? "strict";
  const tokenProfile = options.tokenProfile ?? "general_agent";
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const urls = options.baseUrls ?? defaultBaseUrls();
  const maxSteps = options.maxSteps ?? 25;

  // 1. Acquire OAuth2 token from AMS (:3000)
  let accessToken = "dev-agent-token";
  const amsUrl = urls.ams ?? "http://localhost:3000";
  try {
    const tokenRes = await fetchFn(`${amsUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: "agent-full",
        client_secret: "dev-secret",
      }),
    });
    if (tokenRes.ok) {
      const tokenBody = (await tokenRes.json()) as { access_token?: string };
      if (tokenBody.access_token) {
        accessToken = tokenBody.access_token;
      }
    }
  } catch {
    // Allow offline unit tests with mocked fetch
  }

  const playbook = getReferencePlaybook(options.scenarioId, seed, modalityMode);
  const steps: AgentStepResult[] = [];
  const spans: OtlpSpan[] = [];
  const traceId = `trace-${options.scenarioId}-${Date.now().toString(16)}`;
  let currentNano = BigInt(1_700_000_000_000_000_000);

  for (let idx = 0; idx < maxSteps; idx++) {
    let nextAction: AgentToolAction | { done: true };
    if (options.plannerFn) {
      nextAction = await options.plannerFn({
        scenarioId: options.scenarioId,
        seed,
        prompt: options.prompt ?? "",
        history: steps,
        model,
      });
    } else if (idx < playbook.length) {
      nextAction = playbook[idx];
    } else {
      nextAction = { done: true };
    }

    if ("done" in nextAction && nextAction.done) {
      break;
    }

    const action = nextAction as AgentToolAction;
    const baseUrl = urls[action.service] ?? `http://localhost:3000`;
    const isMcp =
      action.service === "comm" &&
      (action.modality === "mcp" || modalityMode === "strict");
    const targetUrl = isMcp ? `${baseUrl}/mcp` : `${baseUrl}${action.path}`;
    const mcpToolName = isMcp
      ? (action.mcpToolName ?? resolveCommMcpToolName(action.method, action.path))
      : undefined;

    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    };
    if (isMcp) {
      requestHeaders["Accept"] = "application/json, text/event-stream";
    }
    if (
      action.modality === "web-portal" ||
      action.service === "summit-fire" ||
      action.service === "coastal-star"
    ) {
      requestHeaders["X-Portal-Session"] = "portal-session-baseline";
    }

    const requestPayload = isMcp
      ? {
          jsonrpc: "2.0",
          id: idx + 1,
          method: "tools/call",
          params: {
            name: mcpToolName,
            arguments: action.body ?? {},
          },
        }
      : action.body;

    const startMs = Date.now();
    let status = 200;
    let responseBody: unknown = {};

    try {
      const res = await fetchFn(targetUrl, {
        method: isMcp ? "POST" : action.method,
        headers: requestHeaders,
        body:
          isMcp || (action.method !== "GET" && action.body)
            ? JSON.stringify(requestPayload ?? {})
            : undefined,
      });
      status = res.status;
      try {
        responseBody = await res.json();
      } catch {
        responseBody = {};
      }
    } catch (err) {
      status = 503;
      responseBody = { error: String(err) };
    }

    const durationMs = Math.max(1, Date.now() - startMs);
    const stepStartNano = currentNano;
    const stepEndNano = stepStartNano + BigInt(durationMs * 1_000_000);
    currentNano = stepEndNano + BigInt(5_000_000);

    // Emit LLM reasoning span (unless running Stage 3 $0-token compiled code!) + HTTP/MCP tool span
    const defaultInTok =
      tokenProfile === "compiled_code"
        ? 0
        : tokenProfile === "domain_skill"
          ? 240
          : 650;
    const defaultOutTok =
      tokenProfile === "compiled_code"
        ? 0
        : tokenProfile === "domain_skill"
          ? 75
          : 180;
    const inTok = action.inputTokens ?? defaultInTok;
    const outTok = action.outputTokens ?? defaultOutTok;
    const trafficType = action.trafficType ?? "production_inference";

    if (inTok > 0 || outTok > 0) {
      spans.push({
        traceId,
        spanId: `llm-span-${idx + 1}`,
        name: `chat ${model}`,
        kind: SPAN_KIND_INTERNAL,
        startTimeUnixNano: String(stepStartNano),
        endTimeUnixNano: String(stepStartNano + BigInt(500_000)),
        attributes: [
          { key: "gen_ai.operation.name", value: { stringValue: "chat" } },
          { key: "gen_ai.request.model", value: { stringValue: model } },
          { key: "gen_ai.usage.input_tokens", value: { intValue: inTok } },
          { key: "gen_ai.usage.outputTokens", value: { intValue: outTok } },
          { key: "gen_ai.usage.output_tokens", value: { intValue: outTok } },
          { key: "gen_ai.traffic_type", value: { stringValue: trafficType } },
        ],
      });
    }

    spans.push({
      traceId,
      spanId: `tool-span-${idx + 1}`,
      name: isMcp ? `MCP ${mcpToolName}` : `${action.method} ${action.path}`,
      kind: SPAN_KIND_CLIENT,
      startTimeUnixNano: String(stepStartNano + BigInt(500_000)),
      endTimeUnixNano: String(stepEndNano),
      attributes: [
        { key: "http.request.method", value: { stringValue: isMcp ? "POST" : action.method } },
        { key: "url.full", value: { stringValue: targetUrl } },
        { key: "http.response.status_code", value: { intValue: status } },
        ...(isMcp && mcpToolName
          ? [{ key: "mcp.tool.name", value: { stringValue: mcpToolName } }]
          : []),
        {
          key: "http.request.body",
          value: { stringValue: JSON.stringify(requestPayload ?? {}) },
        },
        {
          key: "http.response.body",
          value: { stringValue: JSON.stringify(responseBody ?? {}) },
        },
      ],
    });

    steps.push({
      stepIndex: idx,
      action,
      status,
      responseBody,
      durationMs,
    });
  }

  // Run EVAL-P10A privacy audit across all outbound message bodies
  const outboundBodies = steps
    .filter((s) => s.action.service === "comm" && s.action.body?.body)
    .map((s) => String(s.action.body?.body))
    .join("\n");
  const privacyAudit = scanRawPiiLeakage(outboundBodies);

  const trace: OtlpTrace = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: "evergreen-baseline-agent" },
            },
            {
              key: "gen_ai.request.model",
              value: { stringValue: model },
            },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "evergreen.baseline.agent" },
            spans,
          },
        ],
      },
    ],
  };

  return {
    scenarioId: options.scenarioId,
    seed,
    model,
    modalityMode,
    steps,
    trace,
    privacyAudit,
  };
}
