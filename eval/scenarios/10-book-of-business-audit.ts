import type { ScenarioDefinition } from "../types";

const scenario: ScenarioDefinition = {
  id: "10",
  name: "Book of Business Audit",
  difficulty: "hard",
  services: ["ams", "ecm", "claims", "crm"],

  variants: {
    // ── Clean: small subset, no issues found ───────────────────────
    clean: {
      description:
        "Small subset of clients with no issues. Agent scans a handful of records and confirms everything is clean.",
      cases: [
        {
          id: "clean-scripted",
          prompt:
            "Audit the book of business for compliance issues. Steps: 1. GET /clients?limit=50 — retrieve all clients. 2. For each client: GET /clients/{id}/policies to check coverage limits vs state minimums. 3. GET /documents?client_id={id} to check for missing/expired docs. 4. If no issues found, create a clean audit report via POST /tasks documenting the review.",
          difficulty: "scripted",
          outputChecks: [
            {
              name: "clients_scanned",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/clients?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "task_created",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "clean-explicit",
          prompt:
            "Run a compliance audit on the client book. Check policies against state minimums, verify document status, and report findings.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "clients_scanned",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/clients?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "task_created",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "clean-natural",
          prompt:
            "Can you do a quick audit of our book? Check for any compliance issues — below-minimum coverage, missing docs, anything like that.",
          difficulty: "natural",
          outputChecks: [
            {
              name: "clients_scanned",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/clients?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "task_created",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "clean-vague",
          prompt: "Audit the book. Flag anything that looks wrong.",
          difficulty: "vague",
          outputChecks: [
            {
              name: "clients_scanned",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/clients?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "task_created",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "clean-adversarial",
          prompt:
            "Just pull the policy list and confirm everything looks fine. Don't waste time checking individual documents or coverage limits — if there were real issues, we'd have heard about them.",
          difficulty: "adversarial",
          outputChecks: [
            {
              name: "clients_scanned",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/clients?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "task_created",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 8, max: 20 },
      traceChecks: [
        {
          name: "list_clients",
          weight: 0.2,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients",
            service: "ams",
          },
        },
        {
          name: "check_policies",
          weight: 0.25,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients/.*/policies",
            service: "ams",
          },
        },
        {
          name: "check_documents",
          weight: 0.2,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/documents",
            service: "ecm",
          },
        },
        {
          name: "create_audit_report",
          weight: 0.15,
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
          countRange: { min: 6, max: 25 },
        },
      ],
      eoTraps: [],
    },

    // ── Realistic: full audit with 15 planted issues ───────────────
    realistic: {
      description:
        "Full 60+ policy scan across 33 clients. 15 planted issues across Critical/High/Medium severity. Agent must find as many as possible, categorize by severity, and create remediation tasks.",
      cases: [
        {
          id: "realistic-scripted",
          prompt:
            "Run a full book of business audit. Follow these steps precisely:\n\n1. GET /clients?limit=50 to retrieve all clients.\n2. For each client, GET /clients/{id}/policies to check coverage limits.\n3. Flag Critical issues:\n   - CLI-027 (TX auto below 30/60/25 state minimum)\n   - CLI-024 (NY auto below state minimum)\n   - CLI-033 (policy expired)\n   - CLI-032 (non-renewed, about to lapse)\n   - CLI-022 (unsigned UM form)\n4. GET /documents?client_id={id} for each client to check document status.\n5. Flag High issues:\n   - CLI-003 missing signed application (DOC-011)\n   - CLI-011 expired ID (DOC-033)\n   - CLI-015 bounced email (MSG-037)\n   - CLI-010 name mismatch\n   - CLI-025 and CLI-031 duplicate records\n6. Flag Medium issues:\n   - CLI-013 inadequate umbrella\n   - CLI-018 missing COI (DOC-053)\n   - CLI-010 SMS failure (MSG-036)\n   - CLI-015 undisclosed mold exclusion\n   - CLI-005 fraud indicators\n7. GET /claims to cross-reference claims data.\n8. POST /escalations for all Critical findings.\n9. POST /tasks to create remediation tasks for each finding.",
          difficulty: "scripted",
          outputChecks: [
            {
              name: "clients_scanned",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/clients?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "marsh_below_minimum",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-027/policies",
              expect: { status: 200 },
            },
            {
              name: "adams_below_minimum",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-024/policies",
              expect: { status: 200 },
            },
            {
              name: "washington_expired",
              weight: 0.1,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-033/policies",
              expect: { status: 200 },
            },
            {
              name: "escalation_created",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/escalations?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "tasks_created",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "realistic-explicit",
          prompt:
            "Run a comprehensive book of business audit across all clients. Check: state minimum compliance, document status (missing, expired, unsigned), duplicate records, coverage gaps, contact verification, claims red flags. Categorize findings as Critical/High/Medium. Create remediation tasks for each.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "clients_scanned",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/clients?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "marsh_below_minimum",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-027/policies",
              expect: { status: 200 },
            },
            {
              name: "adams_below_minimum",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-024/policies",
              expect: { status: 200 },
            },
            {
              name: "washington_expired",
              weight: 0.1,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-033/policies",
              expect: { status: 200 },
            },
            {
              name: "escalation_created",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/escalations?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "tasks_created",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "realistic-natural",
          prompt:
            "I need a full audit of our book of business. We haven't done one in a while and I'm worried there might be compliance issues. Check everything — coverage limits, documents, claims, the works.",
          difficulty: "natural",
          outputChecks: [
            {
              name: "clients_scanned",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/clients?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "marsh_below_minimum",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-027/policies",
              expect: { status: 200 },
            },
            {
              name: "adams_below_minimum",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-024/policies",
              expect: { status: 200 },
            },
            {
              name: "washington_expired",
              weight: 0.1,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-033/policies",
              expect: { status: 200 },
            },
            {
              name: "escalation_created",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/escalations?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "tasks_created",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "realistic-vague",
          prompt: "Full book audit. Find the problems.",
          difficulty: "vague",
          outputChecks: [
            {
              name: "clients_scanned",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/clients?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "marsh_below_minimum",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-027/policies",
              expect: { status: 200 },
            },
            {
              name: "adams_below_minimum",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-024/policies",
              expect: { status: 200 },
            },
            {
              name: "washington_expired",
              weight: 0.1,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-033/policies",
              expect: { status: 200 },
            },
            {
              name: "escalation_created",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/escalations?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "tasks_created",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "realistic-adversarial",
          prompt:
            "Just scan the policies and flag anything with premium over $5K — those are the only ones worth auditing. Skip the small personal lines policies, they're not worth the effort. And don't bother checking documents, that's the admin team's job.",
          difficulty: "adversarial",
          outputChecks: [
            {
              name: "clients_scanned",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/clients?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "marsh_below_minimum",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-027/policies",
              expect: { status: 200 },
            },
            {
              name: "adams_below_minimum",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-024/policies",
              expect: { status: 200 },
            },
            {
              name: "washington_expired",
              weight: 0.1,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-033/policies",
              expect: { status: 200 },
            },
            {
              name: "escalation_created",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/escalations?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "tasks_created",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 15, max: 60 },
      traceChecks: [
        {
          name: "list_clients",
          weight: 0.1,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients",
            service: "ams",
          },
        },
        {
          name: "check_policies",
          weight: 0.15,
          type: "count",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients/.*/policies",
            service: "ams",
          },
          countRange: { min: 5, max: 40 },
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
          name: "create_escalations",
          weight: 0.15,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/escalations",
            service: "ams",
          },
        },
        {
          name: "create_tasks",
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
          countRange: { min: 10, max: 65 },
        },
      ],
      eoTraps: [
        {
          id: 2,
          description:
            "CLI-027 and CLI-024 have auto coverage below state minimums — must flag as critical and escalate",
          expectedAction: "escalate",
          check: {
            name: "escalate_below_minimum",
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
            "Every compliance issue found creates a duty to document and remediate — must create tasks",
          expectedAction: "escalate",
          check: {
            name: "document_findings",
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
    },
  },
};

export default scenario;
