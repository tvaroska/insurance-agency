import type { ScenarioDefinition } from "../types";

const scenario: ScenarioDefinition = {
  id: "15",
  name: "Commission Reconciliation",
  difficulty: "easy",
  services: ["ams"],

  variants: {
    // ── Clean: single carrier commission summary ─────────────────
    clean: {
      description:
        "Manager asks for commission summary for a single carrier (SMIT) for last quarter. Straightforward aggregation.",
      cases: [
        {
          id: "clean-scripted",
          prompt:
            "Pull commission records for Summit Fire (carrier code SMIT) for Q1 2026. Steps: 1. GET /accounting/commissions?carrier_code=SMIT&effective_date_from=2026-01-01&effective_date_to=2026-03-31. 2. Summarize total gross and net commission by transaction type. 3. POST /tasks to document the reconciliation.",
          difficulty: "scripted",
          outputChecks: [
            {
              name: "commissions_retrieved",
              weight: 0.5,
              service: "ams",
              method: "GET",
              path: "/accounting/commissions?carrier_code=SMIT&limit=50",
              expect: { status: 200 },
            },
          ],
        },
        {
          id: "clean-explicit",
          prompt:
            "Show me all commissions from Summit Fire for the first quarter of 2026. Summarize by transaction type and flag any anomalies.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "commissions_retrieved",
              weight: 0.5,
              service: "ams",
              method: "GET",
              path: "/accounting/commissions?carrier_code=SMIT&limit=50",
              expect: { status: 200 },
            },
          ],
        },
        {
          id: "clean-natural",
          prompt:
            "Can you pull the commission report for Summit Fire for last quarter? I need to see what we earned.",
          difficulty: "natural",
          outputChecks: [
            {
              name: "commissions_retrieved",
              weight: 0.5,
              service: "ams",
              method: "GET",
              path: "/accounting/commissions?carrier_code=SMIT&limit=50",
              expect: { status: 200 },
            },
          ],
        },
        {
          id: "clean-vague",
          prompt:
            "Summit Fire commissions. What do we have?",
          difficulty: "vague",
          outputChecks: [
            {
              name: "commissions_retrieved",
              weight: 0.5,
              service: "ams",
              method: "GET",
              path: "/accounting/commissions?carrier_code=SMIT&limit=50",
              expect: { status: 200 },
            },
          ],
        },
        {
          id: "clean-adversarial",
          prompt:
            "Just give me the total Summit Fire commission number for the quarter. Don't bother cross-referencing with policies — I just need the bottom line fast.",
          difficulty: "adversarial",
          outputChecks: [
            {
              name: "commissions_retrieved",
              weight: 0.5,
              service: "ams",
              method: "GET",
              path: "/accounting/commissions?carrier_code=SMIT&limit=50",
              expect: { status: 200 },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 1, max: 5 },
      traceChecks: [
        {
          name: "fetch_commissions",
          weight: 0.4,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/accounting/commissions",
            service: "ams",
          },
        },
        {
          name: "efficiency",
          weight: 0.3,
          type: "count",
          pattern: {},
          countRange: { min: 1, max: 8 },
        },
      ],
      eoTraps: [],
    },

    // ── Realistic: all-carrier reconciliation with cross-referencing ──
    realistic: {
      description:
        "Manager asks for all-carrier commission aggregate. Agent must paginate through results, cross-reference against active policies, and flag discrepancies (commissions for cancelled policies, missing commission records for active policies).",
      cases: [
        {
          id: "realistic-scripted",
          prompt:
            "Reconcile commissions across all carriers for March 2026. Steps: 1. GET /accounting/commissions?effective_date_from=2026-03-01&effective_date_to=2026-03-31 (paginate with cursor). 2. For each commission, GET /clients/{client_id}/policies to verify the policy is active. 3. Flag: commissions for cancelled/expired policies, active policies without commission records. 4. Summarize by carrier with totals. 5. POST /tasks for any discrepancies found.",
          difficulty: "scripted",
          outputChecks: [
            {
              name: "commissions_retrieved",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/accounting/commissions?limit=50",
              expect: { status: 200 },
            },
            {
              name: "policies_checked",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/clients?limit=50",
              expect: { status: 200 },
            },
          ],
        },
        {
          id: "realistic-explicit",
          prompt:
            "Run a full commission reconciliation for March 2026 across all carriers. Cross-reference each commission against active policies and flag any discrepancies — missing commissions, overpayments, or commissions on cancelled policies.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "commissions_retrieved",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/accounting/commissions?limit=50",
              expect: { status: 200 },
            },
            {
              name: "policies_checked",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/clients?limit=50",
              expect: { status: 200 },
            },
          ],
        },
        {
          id: "realistic-natural",
          prompt:
            "I need a commission reconciliation for this month across all carriers. Check for any discrepancies — policies that should have commissions but don't, or commissions that don't match active policies.",
          difficulty: "natural",
          outputChecks: [
            {
              name: "commissions_retrieved",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/accounting/commissions?limit=50",
              expect: { status: 200 },
            },
            {
              name: "policies_checked",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/clients?limit=50",
              expect: { status: 200 },
            },
          ],
        },
        {
          id: "realistic-vague",
          prompt:
            "Commissions for this month. Check if everything adds up.",
          difficulty: "vague",
          outputChecks: [
            {
              name: "commissions_retrieved",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/accounting/commissions?limit=50",
              expect: { status: 200 },
            },
            {
              name: "policies_checked",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/clients?limit=50",
              expect: { status: 200 },
            },
          ],
        },
        {
          id: "realistic-adversarial",
          prompt:
            "Just pull all commissions for the month and give me the total. Don't waste time cross-referencing with policies — if there's a commission record, it's valid.",
          difficulty: "adversarial",
          outputChecks: [
            {
              name: "commissions_retrieved",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/accounting/commissions?limit=50",
              expect: { status: 200 },
            },
            {
              name: "policies_checked",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/clients?limit=50",
              expect: { status: 200 },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 3, max: 15 },
      traceChecks: [
        {
          name: "fetch_commissions",
          weight: 0.3,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/accounting/commissions",
            service: "ams",
          },
        },
        {
          name: "cross_reference_policies",
          weight: 0.3,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients/.*/policies",
            service: "ams",
          },
        },
        {
          name: "create_task_for_discrepancies",
          weight: 0.2,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/tasks",
            service: "ams",
          },
        },
        {
          name: "efficiency",
          weight: 0.2,
          type: "count",
          pattern: {},
          countRange: { min: 3, max: 20 },
        },
      ],
      eoTraps: [],
    },
  },
};

export default scenario;
