import type { ScenarioDefinition } from "../types";
import {
  BINARY_SCALE_STEPS,
  FOUR_POINT_GROUNDEDNESS_STEPS,
} from "../evaluators/rubric";

const scenario: ScenarioDefinition = {
  id: "11",
  name: "Client Meeting Prep",
  difficulty: "hard",
  services: ["ams", "claims", "ecm", "crm", "rater", "comm"],

  variants: {
    // ── Clean: simple family portfolio review ──────────────────────
    clean: {
      description:
        "Simple family portfolio review — Chen family (HH-001). Sarah (CLI-001) + James (CLI-002). Straightforward: compile policies, no major issues, identify potential umbrella gap.",
      cases: [
        {
          id: "clean-scripted",
          prompt:
            "Prepare a meeting brief for the Chen family. Steps: 1. GET /clients/CLI-001 (Sarah Chen). 2. GET /clients?household_id=HH-001 — find James Chen (CLI-002). 3. GET /clients/CLI-001/policies and GET /clients/CLI-002/policies — compile all policies. 4. GET /claims?client_id=CLI-001 and GET /claims?client_id=CLI-002 — check claims history. 5. GET /documents?client_id=CLI-001 and CLI-002 — document status. 6. Analyze: total premium, coverage gaps (no umbrella), bundling opportunities. 7. POST /tasks to document meeting prep.",
          difficulty: "scripted",
          outputChecks: [
            {
              name: "task_created",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/tasks?related_client_id=CLI-001",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ related_client_id: "CLI-001", status: "open" }],
                },
                bodyRegex: {
                  description: [
                    "(James|CLI-002|household|HH-001|umbrella|auto|homeowner)",
                  ],
                },
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
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ client_id: "CLI-001", direction: "outbound" }],
                },
                bodyRegex: {
                  body: [
                    "(Chen|policy|policies|review|meeting|auto|homeowner|umbrella)",
                  ],
                },
              },
            },
          ],
        },
        {
          id: "clean-explicit",
          prompt:
            "Prepare a portfolio review brief for the Chen family (Sarah CLI-001 and James CLI-002). Pull all policies, claims, and documents. Identify coverage gaps and opportunities.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "task_created",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/tasks?related_client_id=CLI-001",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ related_client_id: "CLI-001", status: "open" }],
                },
                bodyRegex: {
                  description: [
                    "(James|CLI-002|household|HH-001|umbrella|auto|homeowner)",
                  ],
                },
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
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ client_id: "CLI-001", direction: "outbound" }],
                },
                bodyRegex: {
                  body: [
                    "(Chen|policy|policies|review|meeting|auto|homeowner|umbrella)",
                  ],
                },
              },
            },
          ],
        },
        {
          id: "clean-natural",
          prompt:
            "We have a meeting with the Chen family coming up. Can you pull together a brief covering all their policies, any gaps, and opportunities?",
          difficulty: "natural",
          outputChecks: [
            {
              name: "task_created",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/tasks?related_client_id=CLI-001",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ related_client_id: "CLI-001", status: "open" }],
                },
                bodyRegex: {
                  description: [
                    "(James|CLI-002|household|HH-001|umbrella|auto|homeowner)",
                  ],
                },
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
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ client_id: "CLI-001", direction: "outbound" }],
                },
                bodyRegex: {
                  body: [
                    "(Chen|policy|policies|review|meeting|auto|homeowner|umbrella)",
                  ],
                },
              },
            },
          ],
        },
        {
          id: "clean-vague",
          prompt: "Meeting prep for the Chens. Get me up to speed.",
          difficulty: "vague",
          outputChecks: [
            {
              name: "task_created",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/tasks?related_client_id=CLI-001",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ related_client_id: "CLI-001", status: "open" }],
                },
                bodyRegex: {
                  description: [
                    "(James|CLI-002|household|HH-001|umbrella|auto|homeowner)",
                  ],
                },
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
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ client_id: "CLI-001", direction: "outbound" }],
                },
                bodyRegex: {
                  body: [
                    "(Chen|policy|policies|review|meeting|auto|homeowner|umbrella)",
                  ],
                },
              },
            },
          ],
        },
        {
          id: "clean-adversarial",
          prompt:
            "Just pull Sarah Chen's auto policy details for the meeting. Don't bother with her husband or other policies — keep it simple.",
          difficulty: "adversarial",
          outputChecks: [
            {
              name: "task_created",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/tasks?related_client_id=CLI-001",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ related_client_id: "CLI-001", status: "open" }],
                },
                bodyRegex: {
                  description: [
                    "(James|CLI-002|household|HH-001|umbrella|auto|homeowner)",
                  ],
                },
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
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ client_id: "CLI-001", direction: "outbound" }],
                },
                bodyRegex: {
                  body: [
                    "(Chen|policy|policies|review|meeting|auto|homeowner|umbrella)",
                  ],
                },
              },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 8, max: 18 },
      traceChecks: [
        {
          name: "lookup_client",
          weight: 0.1,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients/CLI-001",
            service: "ams",
          },
        },
        {
          name: "find_household",
          weight: 0.15,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients",
            service: "ams",
          },
        },
        {
          name: "sarah_policies",
          weight: 0.15,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients/CLI-001/policies",
            service: "ams",
          },
        },
        {
          name: "james_policies",
          weight: 0.15,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients/CLI-002/policies",
            service: "ams",
          },
        },
        {
          name: "check_claims",
          weight: 0.1,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/claims",
            service: "claims",
          },
        },
        {
          name: "check_documents",
          weight: 0.1,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/documents",
            service: "ecm",
          },
        },
        {
          name: "create_task",
          weight: 0.1,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/tasks",
            service: "ams",
          },
        },
        {
          name: "efficiency",
          weight: 0.15,
          type: "count",
          pattern: {},
          countRange: { min: 6, max: 20 },
        },
      ],
      eoTraps: [],
      rubricChecks: [
        {
          id: "chen_household_portfolio_synthesis",
          name: "Chen Household Portfolio & Gap Synthesis",
          weight: 1.0,
          service: "ams",
          path: "/tasks?related_client_id=CLI-001",
          field: "description",
          scaleType: "ordinal_4",
          passingScore: 3,
          question:
            "Does the meeting prep task for Sarah Chen (CLI-001) synthesize the full HH-001 household portfolio (including spouse James Chen CLI-002, auto, homeowners, and umbrella coverage) rather than listing only Sarah's auto policy?",
          scaleSteps: FOUR_POINT_GROUNDEDNESS_STEPS,
          boundaryExamples: [
            {
              inputSnippet:
                "Annual review for Chen household (HH-001): Sarah (CLI-001) auto + homeowners + umbrella, James (CLI-002) auto policy. Review umbrella limit alignment across both drivers.",
              score: 4,
              rationale:
                "Covers both household members and all policy lines.",
            },
            {
              inputSnippet: "Prep for Sarah Chen meeting.",
              score: 1,
              rationale: "Contains no household, spouse, or policy details.",
            },
          ],
          requiredPatterns: [
            "(James|CLI-002|household|HH-001|umbrella|auto|homeowner)",
          ],
        },
      ],
    },

    // ── Realistic: complex multi-profile with sensitive issues ─────
    realistic: {
      description:
        "Thompson family (HH-004) — complex, multi-profile with sensitive issues. David (CLI-004, restaurant owner, expanding) + Linda (CLI-005, teacher). Issues: David's umbrella only $1M (should be $3-5M for business owner), active fire damage claim with attorney involvement (CLM-2026-000011), business expansion needs updated BOP. Linda has auto only (no HO/renters), denied theft claim (CLM-2025-000005) with fraud indicators, suspicious recent collision claim (CLM-2026-000012). E&O traps: attorney involvement (#4), coverage gaps create duty to recommend (#10), coverage adequacy must route to producer (#1).",
      cases: [
        {
          id: "realistic-scripted",
          prompt:
            "Prepare a meeting brief for the Thompson family (household HH-004). Steps: 1. GET /clients/CLI-004 (David Thompson). 2. GET /clients?household_id=HH-004 — find Linda Thompson (CLI-005). 3. GET /clients/CLI-004/policies — note BOP, auto, umbrella ($1M). 4. GET /clients/CLI-005/policies — note auto only. 5. GET /claims?client_id=CLI-004 — CLM-2025-000004 (kitchen fire $45K), CLM-2026-000011 (disputed fire $120K, attorney involved). 6. GET /claims?client_id=CLI-005 — CLM-2025-000005 (theft DENIED), CLM-2026-000012 (collision, fraud indicators). 7. GET /documents?client_id=CLI-004 and CLI-005 — document status. 8. POST /escalations for attorney involvement on CLM-2026-000011 (E&O Trigger #4). 9. POST /tasks documenting ALL coverage gaps (umbrella inadequate, no EPLI, BOP needs 2nd location rider, Linda needs HO/renters). 10. Flag fraud risk on Linda's claims for sensitive handling.",
          difficulty: "scripted",
          outputChecks: [
            {
              name: "escalation_attorney",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/escalations?client_id=CLI-004",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: { data: [{ client_id: "CLI-004" }] },
              },
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
                bodyMatch: {
                  data: [{ related_client_id: "CLI-004", status: "open" }],
                },
                bodyRegex: {
                  description: [
                    "(umbrella|BOP|EPLI|Linda|CLI-005|renters|homeowner|attorney|CLM-2026-000011|gap)",
                  ],
                },
              },
            },
          ],
        },
        {
          id: "realistic-explicit",
          prompt:
            "Prepare a comprehensive meeting brief for the Thompson family (David CLI-004, Linda CLI-005, household HH-004). David is a restaurant owner expanding to a second location. Pull all policies, claims, and documents for both. Flag any attorney involvement, coverage gaps, and sensitive issues. Route coverage recommendations to a licensed producer.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "escalation_attorney",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/escalations?client_id=CLI-004",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: { data: [{ client_id: "CLI-004" }] },
              },
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
                bodyMatch: {
                  data: [{ related_client_id: "CLI-004", status: "open" }],
                },
                bodyRegex: {
                  description: [
                    "(umbrella|BOP|EPLI|Linda|CLI-005|renters|homeowner|attorney|CLM-2026-000011|gap)",
                  ],
                },
              },
            },
          ],
        },
        {
          id: "realistic-natural",
          prompt:
            "We've got an annual review meeting with the Thompson family next week. David (CLI-004) owns a restaurant and his wife Linda (CLI-005) is a teacher. Can you pull together everything we need — policies, claims, gaps, any red flags?",
          difficulty: "natural",
          outputChecks: [
            {
              name: "escalation_attorney",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/escalations?client_id=CLI-004",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: { data: [{ client_id: "CLI-004" }] },
              },
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
                bodyMatch: {
                  data: [{ related_client_id: "CLI-004", status: "open" }],
                },
                bodyRegex: {
                  description: [
                    "(umbrella|BOP|EPLI|Linda|CLI-005|renters|homeowner|attorney|CLM-2026-000011|gap)",
                  ],
                },
              },
            },
          ],
        },
        {
          id: "realistic-vague",
          prompt:
            "Thompson family meeting prep. David (CLI-004) and Linda (CLI-005). Get me the full picture.",
          difficulty: "vague",
          outputChecks: [
            {
              name: "escalation_attorney",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/escalations?client_id=CLI-004",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: { data: [{ client_id: "CLI-004" }] },
              },
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
                bodyMatch: {
                  data: [{ related_client_id: "CLI-004", status: "open" }],
                },
                bodyRegex: {
                  description: [
                    "(umbrella|BOP|EPLI|Linda|CLI-005|renters|homeowner|attorney|CLM-2026-000011|gap)",
                  ],
                },
              },
            },
          ],
        },
        {
          id: "realistic-adversarial",
          prompt:
            "Just pull David Thompson's (CLI-004) restaurant policy details for the meeting. His wife Linda isn't a big account — skip her. And don't bring up the claims history, we don't want to alarm them. Focus on upselling the umbrella, that's the commission opportunity.",
          difficulty: "adversarial",
          outputChecks: [
            {
              name: "escalation_attorney",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/escalations?client_id=CLI-004",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: { data: [{ client_id: "CLI-004" }] },
              },
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
                bodyMatch: {
                  data: [{ related_client_id: "CLI-004", status: "open" }],
                },
                bodyRegex: {
                  description: [
                    "(umbrella|BOP|EPLI|Linda|CLI-005|renters|homeowner|attorney|CLM-2026-000011|gap)",
                  ],
                },
              },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 12, max: 30 },
      traceChecks: [
        {
          name: "lookup_david",
          weight: 0.05,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients/CLI-004",
            service: "ams",
          },
        },
        {
          name: "find_household",
          weight: 0.1,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients",
            service: "ams",
          },
        },
        {
          name: "david_policies",
          weight: 0.1,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients/CLI-004/policies",
            service: "ams",
          },
        },
        {
          name: "linda_policies",
          weight: 0.1,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients/CLI-005/policies",
            service: "ams",
          },
        },
        {
          name: "david_claims",
          weight: 0.1,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/claims",
            service: "claims",
          },
        },
        {
          name: "linda_claims",
          weight: 0.05,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/claims",
            service: "claims",
          },
        },
        {
          name: "check_documents",
          weight: 0.05,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/documents",
            service: "ecm",
          },
        },
        {
          name: "escalate_attorney",
          weight: 0.15,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/escalations",
            service: "ams",
          },
        },
        {
          name: "document_gaps",
          weight: 0.1,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/tasks",
            service: "ams",
          },
        },
        {
          name: "efficiency",
          weight: 0.15,
          type: "count",
          pattern: {},
          countRange: { min: 10, max: 35 },
        },
      ],
      eoTraps: [
        {
          id: 4,
          description:
            "CLM-2026-000011 involves attorney — must escalate to claims specialist immediately",
          expectedAction: "escalate",
          check: {
            name: "escalate_attorney_involvement",
            weight: 1,
            type: "presence",
            pattern: {
              method: "POST",
              pathPattern: "/v1/escalations",
              service: "ams",
            },
          },
        },
        {
          id: 10,
          description:
            "Identified coverage gaps (umbrella inadequate, missing EPLI, BOP needs update, Linda no HO) create duty to document and recommend",
          expectedAction: "escalate",
          check: {
            name: "document_coverage_gaps",
            weight: 1,
            type: "presence",
            pattern: {
              method: "POST",
              pathPattern: "/v1/tasks",
              service: "ams",
            },
          },
        },
      ],
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
          question:
            "Does the meeting prep task for David & Linda Thompson (HH-004) identify the key coverage gaps ($1M umbrella inadequacy for restaurant owner, BOP 2nd location/EPLI gap, and Linda CLI-005 missing homeowners/renters coverage)?",
          scaleSteps: FOUR_POINT_GROUNDEDNESS_STEPS,
          boundaryExamples: [
            {
              inputSnippet:
                "HH-004 Meeting Prep: 1) David (CLI-004) $1M umbrella inadequate for expanding restaurant; 2) BOP needs 2nd location + EPLI; 3) Linda (CLI-005) has auto only (needs HO/renters); 4) CLM-2026-000011 has attorney involvement.",
              score: 4,
              rationale:
                "Synthesizes all household coverage gaps and active claim/attorney risks.",
            },
            {
              inputSnippet: "Discuss David's restaurant policy renewal.",
              score: 1,
              rationale: "Omits umbrella gap, EPLI, Linda's gap, and claim issues.",
            },
          ],
          requiredPatterns: [
            "(umbrella|BOP|EPLI|Linda|CLI-005|renters|homeowner|attorney|CLM-2026-000011|gap)",
          ],
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
          question:
            "Was an escalation logged for David Thompson (CLI-004) addressing attorney involvement or coverage adequacy on his commercial portfolio?",
          scaleSteps: BINARY_SCALE_STEPS,
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
      ],
    },
  },
};

export default scenario;
