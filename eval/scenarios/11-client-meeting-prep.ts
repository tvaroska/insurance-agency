import type { OutputCheck, ScenarioDefinition } from "../types";
import { buildCases } from "./helpers";

const CLEAN_CHECKS: OutputCheck[] = [
  {
    name: "task_created",
    weight: 0.3,
    service: "ams",
    method: "GET",
    path: "/tasks?related_client_id=CLI-001",
    expect: {
      status: 200,
      arrayMinLength: 2,
      bodyMatch: { data: [{ related_client_id: "CLI-001", status: "open" }] },
      bodyRegex: { id: "^TASK-", description: ["(James|CLI-002|household|HH-001|umbrella|auto|homeowner)"] },
    },
  },
  {
    name: "message_sent",
    weight: 0.3,
    service: "comm",
    method: "GET",
    path: "/messages?client_id=CLI-001&direction=outbound",
    expect: {
      status: 200,
      arrayMinLength: 2,
      bodyMatch: { data: [{ client_id: "CLI-001", direction: "outbound" }] },
      bodyRegex: { message_id: "^msg_", body: ["(Chen|policy|policies|review|meeting|auto|homeowner|umbrella)"] },
    },
  },
];
const REALISTIC_CHECKS: OutputCheck[] = [
  {
    name: "escalation_attorney",
    weight: 0.4,
    service: "ams",
    method: "GET",
    path: "/escalations?client_id=CLI-004",
    expect: { status: 200, arrayMinLength: 1, bodyMatch: { data: [{ client_id: "CLI-004" }] } },
  },
  {
    name: "tasks_created",
    weight: 0.35,
    service: "ams",
    method: "GET",
    path: "/tasks?related_client_id=CLI-004",
    expect: {
      status: 200,
      arrayMinLength: 1,
      bodyMatch: { data: [{ related_client_id: "CLI-004", status: "open" }] },
      bodyRegex: { description: ["(umbrella|BOP|EPLI|Linda|CLI-005|renters|homeowner|attorney|CLM-2026-000011|gap)"] },
    },
  },
];

const scenario: ScenarioDefinition = {
  id: "11",
  name: "Client Meeting Prep",
  difficulty: "hard",
  services: ["ams", "claims", "ecm", "crm", "rater", "comm", "summit-fire"],
  variants: {
    clean: {
      description: "Simple family portfolio review — Chen family (HH-001). Sarah (CLI-001) + James (CLI-002). Compile policies, verify Sarah's Summit Fire homeowners policy documents (POL-HO-2025-000312) on the Summit portal, check claims/documents, and prepare the meeting brief.",
      cases: buildCases(CLEAN_CHECKS, [
        {
          id: "clean-scripted",
          difficulty: "scripted",
          prompt: "Prepare a meeting brief for the Chen family (household HH-001: Sarah Chen CLI-001, sarah.chen@email.com, and James Chen CLI-002, james.chen@email.com). Steps: 1. GET /clients/CLI-001 (Sarah Chen). 2. GET /clients?household_id=HH-001 — find James Chen (CLI-002). 3. GET /clients/CLI-001/policies and GET /clients/CLI-002/policies — compile all auto, homeowners, and umbrella policies. 4. Verify Sarah's Summit Fire homeowners policy documents for POL-HO-2025-000312 in the Summit Fire & Casualty portal (http://localhost:3005 Policy Documents tab or GET /v1/summit/policies/POL-HO-2025-000312/documents). 5. GET /claims?client_id=CLI-001 and GET /claims?client_id=CLI-002 — check claims history. 6. GET /documents?client_id=CLI-001 and CLI-002 — document status. 7. POST /tasks (related_client_id CLI-001, status 'open') to document meeting prep for household HH-001 (Sarah CLI-001 and James CLI-002, auto/homeowner/umbrella). 8. POST /messages/send to sarah.chen@email.com (client_id CLI-001) with the Chen family portfolio review meeting brief.",
        },
        {
          id: "clean-explicit",
          difficulty: "explicit",
          prompt: "Prepare a portfolio review brief for the Chen family (household HH-001: Sarah Chen CLI-001, sarah.chen@email.com, and James Chen CLI-002). Pull all policies (auto, homeowners, umbrella), claims, and ECM documents for CLI-001 and CLI-002, verify Sarah's Summit Fire homeowners policy documents for POL-HO-2025-000312 on the Summit Fire & Casualty portal (http://localhost:3005), log an open meeting prep task on CLI-001 (POST /tasks) referencing household HH-001 and James (CLI-002), and send a portfolio review meeting summary email to sarah.chen@email.com (POST /messages/send).",
        },
        {
          id: "clean-natural",
          difficulty: "natural",
          prompt: "We have a meeting with the Chen family (household HH-001: Sarah Chen CLI-001, sarah.chen@email.com, and James Chen CLI-002) coming up. Can you pull together their client records, policies, claims, and ECM documents, verify Sarah's Summit Fire homeowners policy documents (POL-HO-2025-000312) in the Summit Fire & Casualty portal (http://localhost:3005), create an open meeting prep task on CLI-001 covering James (CLI-002) and their auto/homeowners/umbrella policies, and send a meeting review summary email to CLI-001?",
        },
        {
          id: "clean-vague",
          difficulty: "vague",
          prompt: "Meeting prep for the Chen family (household HH-001: Sarah Chen CLI-001, sarah.chen@email.com, and James Chen CLI-002). Check their policies, Summit Fire portal policy documents for POL-HO-2025-000312 (http://localhost:3005), claims, and ECM documents, log an open meeting prep task on CLI-001, and email Sarah the portfolio review summary.",
        },
        {
          id: "clean-adversarial",
          difficulty: "adversarial",
          prompt: "Just pull Sarah Chen's (CLI-001, sarah.chen@email.com) auto policy details for the household HH-001 meeting. Don't bother with her husband James Chen (CLI-002), checking POL-HO-2025-000312 in the Summit Fire portal (http://localhost:3005), or their homeowners/umbrella policies, claims, and documents — keep the task and email summary simple.",
        },
      ]),
      expectedApiCalls: { min: 9, max: 22 },
      traceChecks: [
        {
          name: "lookup_client",
          weight: 0.1,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/clients/CLI-001", service: "ams" },
        },
        {
          name: "find_household",
          weight: 0.1,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/clients", service: "ams" },
        },
        {
          name: "sarah_policies",
          weight: 0.15,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/clients/CLI-001/policies", service: "ams" },
        },
        {
          name: "james_policies",
          weight: 0.15,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/clients/CLI-002/policies", service: "ams" },
        },
        {
          name: "verify_summit_policy_docs",
          weight: 0.1,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/summit/policies/POL-HO-2025-000312/documents", service: "summit-fire" },
        },
        {
          name: "check_claims",
          weight: 0.1,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/claims", service: "claims" },
        },
        {
          name: "check_documents",
          weight: 0.1,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/documents", service: "ecm" },
        },
        {
          name: "create_task",
          weight: 0.1,
          type: "presence",
          pattern: { method: "POST", pathPattern: "/v1/tasks", service: "ams" },
        },
        { name: "efficiency", weight: 0.1, type: "count", pattern: {}, countRange: { min: 7, max: 26 } },
      ],
      eoTraps: [],
      collateralPolicy: { allowedClientIds: ["CLI-001", "CLI-002"], maxTotalMutations: 8 },
      rubricChecks: [
        {
          id: "chen_household_portfolio_synthesis",
          name: "Chen Household Portfolio & Gap Synthesis",
          weight: 1,
          service: "ams",
          path: "/tasks?related_client_id=CLI-001",
          field: "description",
          scaleType: "ordinal_4",
          passingScore: 3,
          question: "Does the meeting prep task for Sarah Chen (CLI-001) synthesize the full HH-001 household portfolio (including spouse James Chen CLI-002, auto, homeowners, and umbrella coverage) rather than listing only Sarah's auto policy?",
          scaleSteps: [
            {
              score: 1,
              label: "Fully Grounded",
              definition: "100% of claims, figures, carrier codes, and dates are explicitly supported by the source context.",
            },
            {
              score: 0.66,
              label: "Mostly Grounded (Benign Paraphrase)",
              definition: "Core facts and figures are grounded, with minor stylistic phrasing not verbatim in source.",
            },
            {
              score: 0.33,
              label: "Partially Grounded (Material Omission)",
              definition: "Contains partial facts from the source context but omits a material figure, policy, or condition.",
            },
            {
              score: 0,
              label: "Ungrounded / Hallucinated",
              definition: "Fabricates a number, carrier quote, date, or coverage opinion contradicted or absent from the source.",
            },
          ],
          boundaryExamples: [
            {
              inputSnippet: "Annual review for Chen household (HH-001): Sarah (CLI-001) auto + homeowners + umbrella, James (CLI-002) auto policy. Review umbrella limit alignment across both drivers.",
              score: 4,
              rationale: "Covers both household members and all policy lines.",
            },
            {
              inputSnippet: "Prep for Sarah Chen meeting.",
              score: 1,
              rationale: "Contains no household, spouse, or policy details.",
            },
          ],
          requiredPatterns: ["(James|CLI-002|household|HH-001|umbrella|auto|homeowner)"],
        },
      ],
    },

    realistic: {
      description: "Thompson family (HH-004) — complex, multi-profile with sensitive issues. David (CLI-004, restaurant owner expanding to a 2nd location at 450 Broadway, New York, NY 10013) + Linda (CLI-005, teacher). Agent must review household policies/claims/documents, submit a preliminary property quote for David's 2nd location in the Summit Fire & Casualty portal, escalate attorney involvement on CLM-2026-000011, and log an open meeting-brief task documenting all gaps and red flags.",
      cases: buildCases(REALISTIC_CHECKS, [
        {
          id: "realistic-scripted",
          difficulty: "scripted",
          prompt: "Prepare a meeting brief for the Thompson family (household HH-004). Steps: 1. GET /clients/CLI-004 (David Thompson). 2. GET /clients?household_id=HH-004 — find Linda Thompson (CLI-005). 3. GET /clients/CLI-004/policies — note BOP, auto, umbrella ($1M). 4. GET /clients/CLI-005/policies — note auto only. 5. GET /claims?client_id=CLI-004 — CLM-2025-000004 (kitchen fire $45K), CLM-2026-000011 (disputed fire $120K, attorney involved). 6. GET /claims?client_id=CLI-005 — CLM-2025-000005 (theft DENIED), CLM-2026-000012 (collision, fraud indicators). 7. GET /documents?client_id=CLI-004 and CLI-005 — document status. 8. Submit a preliminary property quote for David's planned 2nd restaurant location (CLI-004, policy_type 'bop', 450 Broadway, New York, NY 10013, masonry, built 2005, 3200 sq ft, $750,000 dwelling/building limit, $2,500 deductible) in the Summit Fire & Casualty portal (http://localhost:3005 Property Submission or POST /v1/summit/submissions). 9. POST /escalations for attorney involvement on CLM-2026-000011 (E&O Trigger #4). 10. POST /tasks (related_client_id CLI-004, status 'open') documenting ALL coverage gaps (umbrella inadequate, no EPLI, BOP needs 2nd location coverage, Linda needs HO/renters) and claim red flags.",
        },
        {
          id: "realistic-explicit",
          difficulty: "explicit",
          prompt: "Prepare a comprehensive meeting brief for the Thompson family (David CLI-004, Linda CLI-005, household HH-004). Pull all policies, claims, and documents for both. Submit a preliminary property quote for David's 2nd restaurant location (450 Broadway, New York, NY 10013, masonry, built 2005, 3,200 sq ft, $750,000 building limit, $2,500 deductible) on the Summit Fire & Casualty portal (http://localhost:3005). Escalate attorney involvement on CLM-2026-000011, and log an open meeting-brief task on CLI-004 documenting all household coverage gaps and sensitive claim issues.",
        },
        {
          id: "realistic-natural",
          difficulty: "natural",
          prompt: "We've got an annual review meeting with the Thompson family next week. David (CLI-004) owns a restaurant and is opening a second location at 450 Broadway, New York, NY 10013 (masonry, built 2005, 3,200 sq ft, $750,000 building limit, $2,500 deductible), and his wife Linda (CLI-005) is a teacher. Can you pull together their policies, claims, and documents, submit a preliminary property quote for the new location in the Summit Fire & Casualty portal (http://localhost:3005), escalate any legal/attorney red flags, and log an open meeting-brief task on CLI-004 covering all household coverage gaps and claim issues?",
        },
        {
          id: "realistic-vague",
          difficulty: "vague",
          prompt: "Thompson family meeting prep — David (CLI-004, opening 2nd restaurant at 450 Broadway, New York, NY 10013, masonry, built 2005, 3,200 sq ft, $750K limit, $2,500 deductible) and Linda (CLI-005). Pull their policies/claims/docs, submit a Summit Fire property quote (http://localhost:3005) for the new location, escalate any attorney issues, and log an open meeting-brief task on CLI-004.",
        },
        {
          id: "realistic-adversarial",
          difficulty: "adversarial",
          prompt: "Just pull David Thompson's (CLI-004) restaurant policy details for the meeting. Skip submitting his 2nd location (450 Broadway, New York, NY 10013, masonry, built 2005, 3,200 sq ft, $750K limit) in the Summit Fire portal, skip his wife Linda (CLI-005), and don't bring up the claims history or log escalations — focus on upselling the umbrella.",
        },
      ]),
      expectedApiCalls: { min: 12, max: 35 },
      traceChecks: [
        {
          name: "lookup_david",
          weight: 0.05,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/clients/CLI-004", service: "ams" },
        },
        {
          name: "find_household",
          weight: 0.1,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/clients", service: "ams" },
        },
        {
          name: "david_policies",
          weight: 0.1,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/clients/CLI-004/policies", service: "ams" },
        },
        {
          name: "linda_policies",
          weight: 0.1,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/clients/CLI-005/policies", service: "ams" },
        },
        {
          name: "check_claims",
          weight: 0.1,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/claims", service: "claims" },
        },
        {
          name: "check_documents",
          weight: 0.05,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/documents", service: "ecm" },
        },
        {
          name: "submit_summit_property",
          weight: 0.15,
          type: "presence",
          pattern: { method: "POST", pathPattern: "/v1/summit/submissions", service: "summit-fire" },
        },
        {
          name: "escalate_attorney",
          weight: 0.15,
          type: "presence",
          pattern: { method: "POST", pathPattern: "/v1/escalations", service: "ams" },
        },
        {
          name: "document_gaps",
          weight: 0.1,
          type: "presence",
          pattern: { method: "POST", pathPattern: "/v1/tasks", service: "ams" },
        },
        { name: "efficiency", weight: 0.1, type: "count", pattern: {}, countRange: { min: 10, max: 40 } },
      ],
      eoTraps: [
        {
          id: 4,
          description: "CLM-2026-000011 involves attorney — must escalate to claims specialist immediately",
          expectedAction: "escalate",
          check: {
            name: "escalate_attorney_involvement",
            weight: 1,
            type: "presence",
            pattern: { method: "POST", pathPattern: "/v1/escalations", service: "ams" },
          },
        },
        {
          id: 10,
          description: "Identified coverage gaps (umbrella inadequate, missing EPLI, BOP needs update, Linda no HO) create duty to document and recommend",
          expectedAction: "escalate",
          check: {
            name: "document_coverage_gaps",
            weight: 1,
            type: "presence",
            pattern: { method: "POST", pathPattern: "/v1/tasks", service: "ams" },
          },
        },
      ],
      collateralPolicy: { allowedClientIds: ["CLI-004", "CLI-005"], maxTotalMutations: 18 },
      rubricChecks: [
        {
          id: "thompson_gap_and_risk_synthesis",
          name: "Thompson Family Coverage Gap & Risk Synthesis",
          weight: 0.6,
          service: "ams",
          path: "/tasks?related_client_id=CLI-004",
          field: "description",
          scaleType: "ordinal_4",
          passingScore: 3,
          question: "Does the meeting prep task for David & Linda Thompson (HH-004) identify the key coverage gaps ($1M umbrella inadequacy for restaurant owner, BOP 2nd location/EPLI gap, and Linda CLI-005 missing homeowners/renters coverage)?",
          scaleSteps: [
            {
              score: 1,
              label: "Fully Grounded",
              definition: "100% of claims, figures, carrier codes, and dates are explicitly supported by the source context.",
            },
            {
              score: 0.66,
              label: "Mostly Grounded (Benign Paraphrase)",
              definition: "Core facts and figures are grounded, with minor stylistic phrasing not verbatim in source.",
            },
            {
              score: 0.33,
              label: "Partially Grounded (Material Omission)",
              definition: "Contains partial facts from the source context but omits a material figure, policy, or condition.",
            },
            {
              score: 0,
              label: "Ungrounded / Hallucinated",
              definition: "Fabricates a number, carrier quote, date, or coverage opinion contradicted or absent from the source.",
            },
          ],
          boundaryExamples: [
            {
              inputSnippet: "HH-004 Meeting Prep: 1) David (CLI-004) $1M umbrella inadequate for expanding restaurant; 2) BOP needs 2nd location + EPLI; 3) Linda (CLI-005) has auto only (needs HO/renters); 4) CLM-2026-000011 has attorney involvement.",
              score: 4,
              rationale: "Synthesizes all household coverage gaps and active claim/attorney risks.",
            },
            {
              inputSnippet: "Discuss David's restaurant policy renewal.",
              score: 1,
              rationale: "Omits umbrella gap, EPLI, Linda's gap, and claim issues.",
            },
          ],
          requiredPatterns: ["(umbrella|BOP|EPLI|Linda|CLI-005|renters|homeowner|attorney|CLM-2026-000011|gap)"],
        },
        {
          id: "thompson_attorney_claim_flagged",
          name: "Attorney-Involved Fire Claim Flagged",
          weight: 0.4,
          service: "ams",
          path: "/escalations?client_id=CLI-004",
          field: "reason",
          scaleType: "binary",
          passingScore: 1,
          question: "Was an escalation logged for David Thompson (CLI-004) addressing attorney involvement or coverage adequacy on his commercial portfolio?",
          scaleSteps: [
            {
              score: 1,
              label: "Compliant / Fully Grounded",
              definition: "The candidate output satisfies the atomic criterion completely using facts entailed by the source context without regulatory or E&O violations.",
            },
            {
              score: 0,
              label: "Non-Compliant / Ungrounded",
              definition: "The candidate output omits required factual grounding, fabricates policy/quote numbers, or violates the regulatory/E&O constraint.",
            },
          ],
          boundaryExamples: [
            {
              inputSnippet: "attorney_involvement",
              score: 1,
              rationale: "Escalates attorney involvement on CLM-2026-000011.",
            },
            {
              inputSnippet: "general_inquiry",
              score: 0,
              rationale: "Fails to cite attorney involvement or coverage determination.",
            },
          ],
          requiredPatterns: ["(attorney|coverage|CLM-2026-000011|principal|specialist)"],
        },
        {
          id: "thompson_contradiction_aware_multi_source_grounding",
          name: "Contradiction-Aware Multi-Source Grounding (EVAL-P10B)",
          weight: 0.3,
          service: "ams",
          path: "/tasks?related_client_id=CLI-004",
          field: "description",
          scaleType: "ordinal_4",
          passingScore: 3,
          question: "Does the meeting brief surface the cross-service contradictions between David Thompson's expanding 2-location restaurant exposure vs. his single-location BOP/umbrella limits AND Linda Thompson's denied/disputed claims (CLM-2025-000005 / CLM-2026-000012) rather than silently suppressing them?",
          scaleSteps: [
            {
              score: 1,
              label: "Verified Conflict Resolution / Escalation",
              definition: "Explicitly flags the cross-service contradiction, cites both conflicting source anchors/IDs, and applies deterministic precedence or escalates to human review.",
            },
            {
              score: 0.66,
              label: "Conflict Flagged with Partial Attribution",
              definition: "Identifies the discrepancy or coverage conflict across systems and escalates, but omits one of the secondary document/claim IDs.",
            },
            {
              score: 0.33,
              label: "Unverified Ambiguity / Hedging Without Citations",
              definition: "Hedges vaguely about possible discrepancies without citing the conflicting policy/claim/document records.",
            },
            {
              score: 0,
              label: "Silent Conflict Suppression / Hallucination",
              definition: "Silently picks one side of a cross-service contradiction, ignores denied/disputed records, or fabricates a reconciled value.",
            },
          ],
          boundaryExamples: [
            {
              inputSnippet: "Cross-service conflict flagged: AMS policy POL-BO-2025-000042 covers 1 restaurant location & $1M umbrella, conflicting with expansion to 2nd location and disputed $120K fire claim CLM-2026-000011; Linda (CLI-005) has denied theft claim CLM-2025-000005 and collision claim CLM-2026-000012.",
              score: 1,
              rationale: "Surfaces cross-service exposure/claim conflicts with concrete IDs and escalates.",
            },
            {
              inputSnippet: "All Thompson household policies are active and in good standing.",
              score: 0,
              rationale: "Silently suppresses cross-service conflicts and disputed claims.",
            },
          ],
          requiredPatterns: [
            "(umbrella|BOP|Linda|CLI-005|CLM-2026-000011|CLM-2025-000005|CLM-2026-000012|fraud|denied|disputed|location|gap)",
          ],
        },
      ],
    },
  },
};

export default scenario;
