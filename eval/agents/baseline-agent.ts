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
      if (seed === "realistic") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients?last_name=Chen&first_name=Sarah" },
          {
            service: "crm",
            method: "POST",
            path: "/v1/leads",
            body: {
              client_id: "CLI-001",
              first_name: "Sarah",
              last_name: "Chen",
              email: "sarah.chen@email.com",
              phone: "310-555-0101",
              source: "phone",
              status: "new",
              assigned_producer: "PROD-01",
            },
          },
          {
            service: "crm",
            method: "POST",
            path: "/v1/campaigns/camp_new_client_welcome/enroll",
            body: {
              client_id: "CLI-001",
              trigger_reason: "Existing client auto inquiry",
            },
          },
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
              subject: "Welcome Back to Evergreen Insurance",
              body: "Hi Sarah, we linked your auto insurance inquiry to your existing profile (CLI-001) and scheduled a producer follow-up.",
            },
          },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Follow up on Sarah Chen auto quote",
              description: "Complete personal auto quote review for CLI-001",
              related_client_id: "CLI-001",
              priority: "medium",
              due_date: "2026-03-05",
            },
          },
        ];
      }
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
            first_name: "Marcus",
            last_name: "Johnson",
            email: "marcus.johnson@email.com",
            phone: "512-555-0142",
            source: "phone",
            status: "new",
            assigned_producer: "PROD-01",
          },
        },
        {
          service: "crm",
          method: "POST",
          path: "/v1/campaigns/camp_new_client_welcome/enroll",
          body: {
            client_id: "CLI-023",
            trigger_reason: "New auto insurance prospect intake",
          },
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
            client_id: "CLI-006",
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
            body: "Your current Summit Fire (SMIT) renewal is $1,560/yr (up 21% from $1,290/yr). Here is your normalized 100/300/100 liability limit and $500 collision deductible comparison: SafeHarbor ($1,210/yr), National Shield ($1,245/yr), and Coastal Star ($1,290/yr).",
          },
        },
      ];

    case "03":
      if (seed === "realistic") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-003" },
          { service: "rater", method: "GET", path: "/v1/quotes/QR-001/results" },
          { service: "ecm", method: "GET", path: "/v1/documents?client_id=CLI-003&limit=50" },
          {
            service: "ecm",
            method: "POST",
            path: "/v1/envelopes/create",
            body: {
              client_id: "CLI-003",
              document_ids: ["DOC-011"],
              signers: [{ name: "Maria Rodriguez", email: "maria.rodriguez@email.com", role: "policyholder" }],
              message: "Please sign your auto application (DOC-011) before we can bind your National Shield quote.",
            },
          },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Follow up on pending signature DOC-011 for CLI-003 before binding",
              description: "Wait for Maria Rodriguez (CLI-003) to sign DOC-011 before binding QT-001-NTNW",
              related_client_id: "CLI-003",
              priority: "high",
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
              subject: "Signature Required on Application (DOC-011) Before Binding",
              body: "We verified your accepted National Shield quote ($1,010/yr), but DOC-011 is still pending_signature. We sent an e-signature envelope and will bind once signed.",
            },
          },
        ];
      }
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
            document_ids: ["DOC-009"],
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
          service: "ecm",
          method: "GET",
          path: "/v1/documents/acord/90?policy_id=POL-PA-2025-002103",
        },
        {
          service: "ams",
          method: "GET",
          path: "/v1/accounting/commissions?policy_id=POL-PA-2025-002103",
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
            subject: "Policy Bound Confirmation: National Shield",
            body: "Your personal auto policy with National Shield ($1,010/yr) has been bound following e-signature completion.",
          },
        },
      ];

    case "04":
      if (seed === "clean") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients?limit=50" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-002/policies" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-025/policies" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Client duplicate audit complete: no duplicate records found",
              related_client_id: "CLI-001",
              priority: "low",
              due_date: "2026-02-28",
            },
          },
        ];
      }
      return [
        { service: "ams", method: "GET", path: "/v1/clients?limit=50" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-001" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-025" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-030/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-025/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-031/policies" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/clients/CLI-001/merge",
          body: { source_client_id: "CLI-030", reason: "Duplicate record for Sarah Chen" },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/clients/CLI-025/merge",
          body: { source_client_id: "CLI-031", reason: "Duplicate record for Derek Hawkins" },
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
      if (seed === "clean") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-006" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-006/policies" },
          { service: "crm", method: "GET", path: "/v1/analytics/retention-risk?client_id=CLI-006" },
          {
            service: "rater",
            method: "POST",
            path: "/v1/quotes/request",
            body: {
              client_id: "CLI-006",
              policy_type: "personal_auto",
              effective_date: "2026-03-01",
              client: {
                first_name: "Marcus",
                last_name: "Williams",
                address: { street: "880 Biscayne Blvd", city: "Miami", state: "FL", zip: "33132" },
              },
              drivers: [{ first_name: "Marcus", last_name: "Williams", dob: "1988-07-19" }],
              vehicles: [{ year: 2021, make: "Mazda", model: "CX-5", vin: "JM3KFBCM8M0123456" }],
              requested_coverages: [
                { coverage_type: "bodily_injury", per_person_limit: 50000, per_accident_limit: 100000 },
                { coverage_type: "property_damage", per_accident_limit: 25000 },
              ],
            },
          },
          { service: "rater", method: "GET", path: "/v1/quotes/QR-005/results" },
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
              subject: "Auto Renewal Re-Shop Options ($1,560 vs $1,290 Prior)",
              body: "Following your 21% renewal increase from $1,290 to $1,560 with Coastal Star, we compared quotes across Summit Fire ($1,640) and National Shield ($1,720); Coastal Star ($1,560) remains your lowest option.",
            },
          },
        ];
      }
      if (seed === "bundled") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-001" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
          {
            service: "rater",
            method: "POST",
            path: "/v1/quotes/request",
            body: {
              client_id: "CLI-001",
              policy_type: "personal_auto",
              effective_date: "2026-03-01",
              client: {
                first_name: "Sarah",
                last_name: "Chen",
                address: { street: "742 Maple Dr", city: "San Francisco", state: "CA", zip: "94102" },
              },
              drivers: [{ first_name: "Sarah", last_name: "Chen", dob: "1985-06-15" }],
              vehicles: [{ year: 2022, make: "Honda", model: "CR-V", vin: "2HKRW2H54NH123456" }],
              requested_coverages: [
                { coverage_type: "bodily_injury", per_person_limit: 100000, per_accident_limit: 300000 },
                { coverage_type: "property_damage", per_accident_limit: 100000 },
              ],
            },
          },
          { service: "rater", method: "GET", path: "/v1/quotes/QR-001/results" },
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
              subject: "Bundled Auto & Homeowners Renewal Comparison",
              body: "While standalone auto quotes exist, moving your $1,450 auto policy away from Summit would forfeit the multi-policy bundle discount on your $1,850 homeowners policy, increasing net household cost.",
            },
          },
        ];
      }
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-019" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-019/policies" },
        { service: "crm", method: "GET", path: "/v1/analytics/retention-risk?client_id=CLI-019" },
        {
          service: "rater",
          method: "POST",
          path: "/v1/quotes/request",
          body: {
            client_id: "CLI-019",
            policy_type: "personal_auto",
            effective_date: "2026-03-15",
            client: {
              first_name: "Tyler",
              last_name: "Morrison",
              address: { street: "100 Main St", city: "Los Angeles", state: "CA", zip: "90012" },
            },
            drivers: [{ first_name: "Tyler", last_name: "Morrison", dob: "1995-08-20" }],
            vehicles: [{ year: 2022, make: "Honda", model: "Accord", vin: "1HGCV1F14NA123456" }],
            requested_coverages: [
              { coverage_type: "bodily_injury", per_person_limit: 100000, per_accident_limit: 300000 },
              { coverage_type: "property_damage", per_accident_limit: 50000 },
            ],
          },
        },
        { service: "rater", method: "GET", path: "/v1/quotes/QR-002/results" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-019",
            policy_id: "POL-PA-2025-003200",
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
            to: "tyler.morrison@email.com",
            channel: "email",
            subject: "Renewal Re-Shop Comparison & Statutory Limit Notice",
            body: "Compared against your $2,850 renewal following 2 at-fault accidents (where SMIT and ERIE declined to quote), we maintained your compliant liability limits across Coastal Star ($2,780), Liberty Crest ($3,100), and SafeHarbor ($3,350). Accident surcharges typically age off in 12 to 24 months.",
          },
        },
      ];

    case "06":
      if (seed === "clean") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
          {
            service: "rater",
            method: "POST",
            path: "/v1/quotes/request",
            body: {
              client_id: "CLI-001",
              policy_type: "umbrella",
              effective_date: "2026-03-01",
              client: {
                first_name: "Sarah",
                last_name: "Chen",
                address: { street: "742 Maple Dr", city: "San Francisco", state: "CA", zip: "94102" },
              },
              requested_coverages: [{ coverage_type: "umbrella", per_occurrence_limit: 2000000 }],
            },
          },
          { service: "rater", method: "GET", path: "/v1/quotes/QR-001/results" },
          {
            service: "crm",
            method: "POST",
            path: "/v1/campaigns/camp_life_pivot_2026/enroll",
            body: {
              client_id: "CLI-001",
              trigger_reason: "Umbrella cross-sell gap identified on portfolio review",
            },
          },
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
              subject: "Umbrella Coverage Recommendation for Your Portfolio",
              body: "Based on your active personal auto and homeowners policies, we prepared an umbrella quote comparison and scheduled a licensed producer follow-up.",
            },
          },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Follow up with Sarah Chen (CLI-001) on umbrella cross-sell quote",
              description: "Review umbrella coverage options with CLI-001",
              related_client_id: "CLI-001",
              priority: "medium",
              due_date: "2026-02-26",
            },
          },
        ];
      }
      return [
        { service: "ams", method: "GET", path: "/v1/clients?last_name=Thompson" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-004/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-005/policies" },
        { service: "crm", method: "GET", path: "/v1/leads?client_id=CLI-004" },
        {
          service: "rater",
          method: "POST",
          path: "/v1/quotes/request",
          body: {
            client_id: "CLI-004",
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
            policy_id: "POL-HO-2025-001010",
            client_id: "CLI-002",
            loss_date: "2026-02-17",
            claim_type: "property_damage",
            loss_description: "Neighbor tree fell on fence during storm",
          },
        },
        {
          service: "claims",
          method: "POST",
          path: "/v1/claims/CLM-2026-000013/assign",
          body: { adjuster_id: "ADJ-002", notes: "Assign property damage adjuster" },
        },
        { service: "ecm", method: "GET", path: "/v1/documents/acord/35?claim_id=CLM-2026-000013" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-002",
            policy_id: "POL-HO-2025-001010",
            reason: "claims_specialist",
            summary: "FNOL property damage claim filed; routing to licensed claims specialist per E&O Trigger #7.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Follow up on adjuster inspection for CLM-2026-000013",
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
            subject: "FNOL Claim Filed: Reference Number & Next Steps",
            body: "We have registered your property damage claim under POL-HO-2025-001010, assigned an adjuster, and routed the claim to a licensed specialist.",
          },
        },
      ];

    case "08":
      if (seed === "clean") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-008" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-008/policies" },
          {
            service: "ecm",
            method: "POST",
            path: "/v1/documents/coi/generate",
            body: {
              policy_id: "POL-BO-2025-000100",
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
              subject: "Certificate of Insurance Issued",
              body: "Your ACORD 25 Certificate of Insurance for the City of Seattle contract has been generated.",
            },
          },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-007" },
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
      }
      if (seed === "attorney") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-021" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-021/policies" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-021",
              policy_id: "POL-HO-2025-000890",
              reason: "attorney_involvement",
              summary: "Brian Lawson forwarded a $750,000 attorney demand letter questioning liability coverage adequacy.",
            },
          },
        ];
      }
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-008/policies" },
        {
          service: "ecm",
          method: "POST",
          path: "/v1/documents/coi/generate",
          body: {
            policy_id: "POL-BO-2025-000100",
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
            policy_id: "POL-PA-2026-000030",
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
            policy_id: "POL-BO-2025-000100",
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
            policy_id: "POL-HO-2025-000890",
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
      if (seed === "severe") {
        return [
          { service: "rater", method: "GET", path: "/v1/quotes/QR-014/results" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-026" },
          { service: "ams", method: "GET", path: "/v1/clients?household_id=HH-026" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-027/policies" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-027",
              policy_id: "POL-PA-2026-000030",
              reason: "state_minimum_violation",
              summary: "Tanya Marsh TX auto policy has limits below TX 30/60/25 statutory minimums.",
            },
          },
          {
            service: "comm",
            modality: commModality,
            method: "POST",
            path: "/v1/messages/send",
            mcpToolName: "comm_send_message",
            body: {
              client_id: "CLI-026",
              to: "victor.marsh@email.com",
              channel: "email",
              subject: "Auto Coverage Option & Household Compliance Escalation",
              body: "Following carrier declines due to DUI, National Shield ($5,200/yr) is your available option with SR-22 filing. We also escalated Tanya's TX auto policy for below-minimum limits.",
            },
          },
        ];
      }
      if (seed === "market-exit") {
        return [
          { service: "rater", method: "GET", path: "/v1/quotes/QR-013/results" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-022" },
          { service: "ecm", method: "GET", path: "/v1/documents?client_id=CLI-022&limit=50" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-022",
              reason: "surplus_lines",
              summary: "All standard carriers declined due to FL coastal moratorium; escalating for Citizens Insurance placement.",
            },
          },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Collect signed UM election form (DOC-066) and Citizens application for CLI-022",
              related_client_id: "CLI-022",
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
              client_id: "CLI-022",
              to: "megan.sullivan@email.com",
              channel: "email",
              subject: "Citizens Insurance Eligibility & Pending UM Form (DOC-066)",
              body: "With 3 documented carrier rejections under the FL coastal moratorium, we escalated your placement to Citizens Insurance and created a task to complete your unsigned UM form (DOC-066).",
            },
          },
        ];
      }
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-019" },
        { service: "rater", method: "GET", path: "/v1/quotes/QR-002/results" },
        { service: "rater", method: "GET", path: "/v1/carriers/appetite?state=TX&policy_type=personal_auto" },
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
            to: "tyler.morrison@email.com",
            channel: "email",
            subject: "Alternative Carrier Options Following Underwriting Decline",
            body: "Following the SMIT and ERIE underwriting declines due to 2 at-fault accidents, your remaining options are Coastal Star ($2,780), Liberty Crest ($3,100), and SafeHarbor ($3,350), compared to your prior $1,680 rate. Accident surcharges typically age off in 12 to 24 months.",
          },
        },
      ];

    case "10":
      if (seed === "clean") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients?limit=50" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-002/policies" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-003/policies" },
          { service: "ecm", method: "GET", path: "/v1/documents?limit=50" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Book-of-business compliance audit complete: no issues found",
              related_client_id: "CLI-001",
              priority: "low",
              due_date: "2026-02-28",
            },
          },
        ];
      }
      return [
        { service: "ams", method: "GET", path: "/v1/clients?limit=50" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-004/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-008/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-012/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-024/policies" },
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
            policy_id: "POL-PA-2026-000030",
            reason: "state_minimum_violation",
            summary: "Book-of-business audit detected TX auto policy below 30/60/25 state statutory minimums.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-024",
            policy_id: "POL-PA-2025-003600",
            reason: "state_minimum_violation",
            summary: "Book-of-business audit detected NY auto policy below 25/50/10 state statutory minimums.",
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
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Follow up on duplicate client records CLI-001/CLI-030 and CLI-025/CLI-031",
            related_client_id: "CLI-025",
            priority: "medium",
            due_date: "2026-02-28",
          },
        },
      ];

    case "11":
      if (seed === "clean") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-001" },
          { service: "ams", method: "GET", path: "/v1/clients?household_id=HH-001" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-002/policies" },
          { service: "claims", method: "GET", path: "/v1/claims?client_id=CLI-001" },
          { service: "claims", method: "GET", path: "/v1/claims?client_id=CLI-002" },
          { service: "ecm", method: "GET", path: "/v1/documents?client_id=CLI-001" },
          { service: "ecm", method: "GET", path: "/v1/documents?client_id=CLI-002" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Annual review prep brief for Chen household (HH-001)",
              description: "Compiled Sarah Chen (CLI-001) and James Chen (CLI-002) household auto, homeowners, and umbrella coverage review.",
              related_client_id: "CLI-001",
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
              client_id: "CLI-001",
              to: "sarah.chen@email.com",
              channel: "email",
              subject: "Chen Household Portfolio Review Meeting Brief",
              body: "We have compiled the Chen household (Sarah and James Chen) auto, homeowners, and umbrella policies and claims review for your upcoming meeting.",
            },
          },
        ];
      }
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
            description: "Thompson household (HH-004) review: David (CLI-004) $1M umbrella gap vs $3-5M recommendation, BOP 2nd location expansion, EPLI gap, attorney involvement on CLM-2026-000011; Linda (CLI-005) missing renters/homeowners coverage.",
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
      if (seed === "clean") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-023" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-023/policies" },
          {
            service: "comm",
            modality: commModality,
            method: "POST",
            path: "/v1/messages/send",
            mcpToolName: "comm_send_message",
            body: {
              client_id: "CLI-023",
              to: "kevin.tran@email.com",
              channel: "email",
              subject: "Policy Status Summary for POL-PA-2025-003500",
              body: "Your personal auto policy POL-PA-2025-003500 is active through 2026-02-28 with 100/300/50 liability limits, a $500 collision deductible, and a $250 comprehensive deductible.",
            },
          },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Log policy status inquiry for CLI-023",
              description: "Provided renewal date (2026-02-28) and deductibles ($500/$250) for POL-PA-2025-003500.",
              related_client_id: "CLI-023",
              priority: "low",
              due_date: "2026-02-25",
            },
          },
        ];
      }
      if (seed === "coverage-question") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-023" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-023/policies" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-023",
              reason: "coverage_adequacy",
              summary: "Client asked whether auto coverage limits are adequate; routing to licensed producer.",
            },
          },
          {
            service: "comm",
            modality: commModality,
            method: "POST",
            path: "/v1/messages/send",
            mcpToolName: "comm_send_message",
            body: {
              client_id: "CLI-023",
              to: "kevin.tran@email.com",
              channel: "email",
              subject: "Licensed Producer Review for Coverage Question",
              body: "I have escalated your question to a licensed producer to review whether your current auto coverage limits meet your needs.",
            },
          },
        ];
      }
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-012" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-012/policies" },
        { service: "ecm", method: "GET", path: "/v1/documents?client_id=CLI-012" },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-012",
            to: "natasha.brooks@email.com",
            channel: "email",
            subject: "Bakery BOP Coverage Limits & Pending COI (DOC-053)",
            body: "Your bakery BOP policy carries a $1,000,000 General Liability limit and $500,000 Property limit. We also note your pending Certificate of Insurance request (DOC-053) for the upcoming vendor fair. A licensed producer can assist if you wish to review coverage limits.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Log BOP coverage inquiry and pending COI DOC-053 for CLI-012",
            description: "Provided factual BOP limits ($1,000,000 GL / $500,000 property) and noted pending COI DOC-053.",
            related_client_id: "CLI-012",
            priority: "low",
            due_date: "2026-02-25",
          },
        },
      ];

    case "13":
      if (seed === "clean") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-018" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-018/policies" },
          {
            service: "ecm",
            method: "POST",
            path: "/v1/documents/coi/generate",
            body: {
              policy_id: "POL-BO-2025-000060",
              certificate_holder: {
                name: "Grand Orlando Catering Venue",
                address: { street: "400 Magnolia Ave", city: "Orlando", state: "FL", zip: "32801" },
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
              subject: "ACORD 25 Certificate of Insurance Issued",
              body: "We verified your active BOP policy (POL-BO-2025-000060) carrying $1,000,000 General Liability coverage and generated your ACORD 25 Certificate of Insurance.",
            },
          },
        ];
      }
      if (seed === "expired-policy") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-033" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-033/policies" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-033",
              reason: "principal_review",
              summary: "Client requested COI for an expired policy; refusing COI generation and escalating.",
            },
          },
          {
            service: "comm",
            modality: commModality,
            method: "POST",
            path: "/v1/messages/send",
            mcpToolName: "comm_send_message",
            body: {
              client_id: "CLI-033",
              to: "andre.washington@email.com",
              channel: "email",
              subject: "Unable to Issue COI — Policy Expired",
              body: "Your policy expired on 2025-12-15, so we cannot issue a Certificate of Insurance. We have escalated your account to a producer to discuss reinstatement options.",
            },
          },
        ];
      }
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-008" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-008/policies" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-008",
            policy_id: "POL-BO-2025-000100",
            reason: "coverage_adequacy",
            summary: "Contract requires $5M GL limit whereas active policy carries $2M; refusing to issue COI and escalating limit increase.",
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
            subject: "GL Limit Shortfall for City Contract COI ($2M vs $5M Required)",
            body: "Your current General Liability coverage ($2,000,000) is below the $5,000,000 city contract requirement. We cannot issue a COI showing $5M and have escalated an endorsement request.",
          },
        },
      ];

    case "14":
      if (seed === "realistic") {
        return [
          { service: "crm", method: "GET", path: "/v1/leads?limit=50" },
          { service: "ams", method: "GET", path: "/v1/clients?last_name=Foster" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-010" },
          {
            service: "comm",
            modality: commModality,
            method: "POST",
            path: "/v1/messages/send",
            mcpToolName: "comm_send_message",
            body: {
              client_id: "CLI-010",
              to: "angela.foster@email.com",
              channel: "email",
              subject: "Auto Insurance Inquiry Linked to Existing Profile",
              body: "Hi Angela, we matched your auto insurance inquiry under Angela Foster-Blake to your existing client record (CLI-010) and scheduled a producer follow-up.",
            },
          },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Follow up with Angela Foster-Blake (CLI-010) on auto lead",
              description: "Linked lead to existing client CLI-010 (Angela Foster); producer follow-up required.",
              related_client_id: "CLI-010",
              priority: "medium",
              due_date: "2026-02-26",
            },
          },
        ];
      }
      if (seed === "stale-contact") {
        return [
          { service: "crm", method: "GET", path: "/v1/leads?limit=50" },
          { service: "ams", method: "GET", path: "/v1/clients?last_name=Papadopoulos" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Manual contact verification required for George Papadopoulos (CLI-015)",
              description: "Lead contact info does not match existing client CLI-015; verify before routing.",
              related_client_id: "CLI-015",
              priority: "high",
              due_date: "2026-02-26",
            },
          },
        ];
      }
      return [
        { service: "crm", method: "GET", path: "/v1/leads?limit=50" },
        {
          service: "crm",
          method: "PATCH",
          path: "/v1/leads/lead_a1b2c3d4",
          body: { status: "qualified", score: 87 },
        },
        { service: "ams", method: "GET", path: "/v1/clients?last_name=Williams" },
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
            client_id: "CLI-005",
            to: "jessica.williams@email.com",
            channel: "email",
            subject: "Umbrella Coverage Referral Received & Producer Assigned",
            body: "Thank you for your referral inquiry regarding umbrella coverage for your rental properties. We have qualified your request and assigned a licensed producer to follow up.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Follow up with qualified referral lead Jessica Williams (score 87)",
            description: "Prepare rental property umbrella quote for Jessica Williams (lead_a1b2c3d4)",
            related_client_id: "CLI-005",
            priority: "high",
            due_date: "2026-02-26",
          },
        },
      ];

    case "15":
      return [
        { service: "ams", method: "GET", path: "/v1/accounting/commissions?carrier_code=SMIT&limit=50" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-008/policies" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Reconcile SMIT Q1 2026 commission statement anomalies",
            description: "Commission discrepancy: POL-PA-2025-004500 is cancelled/expired but recorded commission COM-2026-0014, and active policy is missing March commission entry; reconciled Summit Fire (SMIT) Q1 2026 commission records ($739.80 gross / $517.86 net across $217.50, $277.50, $198.00, and $46.80 entries).",
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

  // Strict mode accepts only portal sessions the carrier issued, so open one per
  // carrier the way its web UI does at page load.
  const portalSessions = new Map<string, string>();
  const portalSessionFor = async (baseUrl: string): Promise<string | undefined> => {
    const cached = portalSessions.get(baseUrl);
    if (cached) return cached;
    try {
      const res = await fetchFn(`${baseUrl}/auth/portal-session`);
      const body = res.ok ? ((await res.json()) as { session_token?: string }) : {};
      if (body.session_token) portalSessions.set(baseUrl, body.session_token);
      return body.session_token;
    } catch {
      return undefined;
    }
  };
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
      const portalSession = await portalSessionFor(baseUrl);
      if (portalSession) requestHeaders["X-Portal-Session"] = portalSession;
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
