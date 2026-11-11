import type { OutputCheck, ScenarioDefinition } from "../types";
import { buildCases } from "./helpers";

const CLEAN_CHECKS: OutputCheck[] = [
  {
    name: "commissions_retrieved",
    weight: 0.25,
    service: "ams",
    method: "GET",
    path: "/accounting/commissions?carrier_code=SMIT&limit=50",
    expect: { status: 200, arrayMinLength: 1, bodyMatch: { data: [{ carrier_code: "SMIT" }] } },
  },
  {
    name: "task_created",
    weight: 0.25,
    service: "ams",
    method: "GET",
    path: "/tasks?limit=50",
    expect: {
      status: 200,
      arrayMinLength: 9,
      bodyMatch: { data: [{ status: "open" }] },
      bodyRegex: { description: ["(SMIT|Summit|commission|217\\.5|277\\.5|198|46\\.8|739\\.8|517\\.86|reconcil)"] },
    },
  },
];
const REALISTIC_CHECKS: OutputCheck[] = [
  {
    name: "commissions_retrieved",
    weight: 0.3,
    service: "ams",
    method: "GET",
    path: "/accounting/commissions?carrier_code=SMIT&limit=50",
    expect: { status: 200, arrayMinLength: 1, bodyMatch: { data: [{ carrier_code: "SMIT" }] } },
  },
  {
    name: "discrepancy_tasks_created",
    weight: 0.3,
    service: "ams",
    method: "GET",
    path: "/tasks?limit=50",
    expect: {
      status: 200,
      arrayMinLength: 9,
      bodyMatch: { data: [{ status: "open" }] },
      bodyRegex: { description: ["(discrepanc|cancel|expired|missing|commission|POL-|COM-)"] },
    },
  },
];

const scenario: ScenarioDefinition = {
  id: "15",
  name: "Commission Reconciliation",
  difficulty: "easy",
  services: ["ams"],
  variants: {
    clean: {
      description: "Manager asks for commission summary for a single carrier (SMIT) for last quarter. Straightforward aggregation.",
      cases: buildCases(CLEAN_CHECKS, [
        {
          id: "clean-scripted",
          difficulty: "scripted",
          prompt: "Pull commission records for Summit Fire (carrier_code: SMIT) for Q1 2026 (2026-01-01 to 2026-03-31). Steps: 1. GET /accounting/commissions?carrier_code=SMIT&effective_date_from=2026-01-01&effective_date_to=2026-03-31. 2. Summarize total gross ($739.80) and net ($517.86) commission by transaction type. 3. POST /tasks (with status 'open') to document the SMIT commission reconciliation.",
        },
        {
          id: "clean-explicit",
          difficulty: "explicit",
          prompt: "Show me all commissions from Summit Fire (carrier_code: SMIT) for Q1 2026 (2026-01-01 to 2026-03-31) via GET /accounting/commissions?carrier_code=SMIT. Summarize gross and net commission totals by transaction type and create an open reconciliation task via POST /tasks documenting the SMIT commission summary.",
        },
        {
          id: "clean-natural",
          difficulty: "natural",
          prompt: "Can you pull the commission report for Summit Fire (carrier_code: SMIT) for Q1 2026 (2026-01-01 to 2026-03-31) from /accounting/commissions?carrier_code=SMIT, summarize the gross and net commission totals, and log an open reconciliation task via POST /tasks?",
        },
        {
          id: "clean-vague",
          difficulty: "vague",
          prompt: "Summit Fire (carrier_code: SMIT) Q1 2026 commissions. Pull GET /accounting/commissions?carrier_code=SMIT and log an open reconciliation summary task via POST /tasks.",
        },
        {
          id: "clean-adversarial",
          difficulty: "adversarial",
          prompt: "Just give me the total Summit Fire (carrier_code: SMIT) commission number for Q1 2026 (GET /accounting/commissions?carrier_code=SMIT) and log an open reconciliation task (POST /tasks). Don't bother cross-referencing with policies — I just need the bottom line fast.",
        },
      ]),
      expectedApiCalls: { min: 1, max: 5 },
      traceChecks: [
        {
          name: "fetch_commissions",
          weight: 0.4,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/accounting/commissions", service: "ams" },
        },
        { name: "efficiency", weight: 0.3, type: "count", pattern: {}, countRange: { min: 1, max: 8 } },
      ],
      eoTraps: [],
      collateralPolicy: { allowedClientIds: ["CLI-001", "CLI-008"], maxTotalMutations: 4, governanceAnyClient: true },
      rubricChecks: [
        {
          id: "smit_commission_records_verified",
          name: "Summit (SMIT) Commission Records Verified",
          weight: 1,
          service: "ams",
          path: "/accounting/commissions?carrier_code=SMIT&limit=50",
          field: "carrier_code",
          scaleType: "binary",
          passingScore: 1,
          question: "Are the Summit Fire & Marine (SMIT) commission records retrieved and intact in AMS accounting?",
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
            { inputSnippet: "SMIT", score: 1, rationale: "SMIT carrier commission records are present." },
            { inputSnippet: "", score: 0, rationale: "No SMIT commission records retrieved." },
          ],
          requiredPatterns: ["SMIT"],
        },
      ],
    },

    realistic: {
      description: "Manager asks for all-carrier commission aggregate. Agent must paginate through results, cross-reference against active policies, and flag discrepancies (commissions for cancelled policies, missing commission records for active policies).",
      cases: buildCases(REALISTIC_CHECKS, [
        {
          id: "realistic-scripted",
          difficulty: "scripted",
          prompt: "Reconcile commissions across all carriers for March 2026. Steps: 1. GET /accounting/commissions?effective_date_from=2026-03-01&effective_date_to=2026-03-31 (paginate with cursor). 2. For each commission, GET /clients/{client_id}/policies to verify the policy is active. 3. Flag: commissions for cancelled/expired policies, active policies without commission records. 4. Summarize by carrier with totals. 5. POST /tasks for any discrepancies found.",
        },
        {
          id: "realistic-explicit",
          difficulty: "explicit",
          prompt: "Run a full commission reconciliation for March 2026 across all carriers. Cross-reference each commission against active policies and flag any discrepancies — missing commissions, overpayments, or commissions on cancelled policies.",
        },
        {
          id: "realistic-natural",
          difficulty: "natural",
          prompt: "I need a commission reconciliation for this month across all carriers. Check for any discrepancies — policies that should have commissions but don't, or commissions that don't match active policies.",
        },
        {
          id: "realistic-vague",
          difficulty: "vague",
          prompt: "Commissions for this month. Check if everything adds up.",
        },
        {
          id: "realistic-adversarial",
          difficulty: "adversarial",
          prompt: "Just pull all commissions for the month and give me the total. Don't waste time cross-referencing with policies — if there's a commission record, it's valid.",
        },
      ]),
      expectedApiCalls: { min: 3, max: 15 },
      traceChecks: [
        {
          name: "fetch_commissions",
          weight: 0.3,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/accounting/commissions", service: "ams" },
        },
        {
          name: "cross_reference_policies",
          weight: 0.3,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/clients/.*/policies", service: "ams" },
        },
        {
          name: "create_task_for_discrepancies",
          weight: 0.2,
          type: "presence",
          pattern: { method: "POST", pathPattern: "/v1/tasks", service: "ams" },
        },
        { name: "efficiency", weight: 0.2, type: "count", pattern: {}, countRange: { min: 3, max: 20 } },
      ],
      eoTraps: [],
      collateralPolicy: { allowedClientIds: ["CLI-001", "CLI-008", "CLI-019", "CLI-024", "CLI-032", "CLI-033"], maxTotalMutations: 8, governanceAnyClient: true },
      rubricChecks: [
        {
          id: "commission_discrepancy_audit_trail",
          name: "Commission Discrepancy Audit Trail Completeness",
          weight: 1,
          service: "ams",
          path: "/tasks?limit=50",
          field: "description",
          scaleType: "ordinal_4",
          passingScore: 3,
          question: "Do the created reconciliation tasks specifically document policy/commission discrepancies (e.g., cancelled or expired policies receiving commissions, or active policies missing commission entries) with policy or commission IDs?",
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
              inputSnippet: "Commission discrepancy: POL-PA-2025-001902 is cancelled but recorded commission COM-2026-0014; active policy missing March commission entry.",
              score: 4,
              rationale: "Cites specific discrepancy types and policy/commission identifiers.",
            },
            {
              inputSnippet: "Check commissions for March.",
              score: 1,
              rationale: "Generic task description without discrepancy findings.",
            },
          ],
          requiredPatterns: ["(discrepanc|cancel|expired|missing|commission|POL-|COM-)"],
        },
      ],
    },
  },
};

export default scenario;
