import type { OutputCheck, ScenarioDefinition } from "../types";
import { buildCases } from "./helpers";

const CLEAN_CHECKS: OutputCheck[] = [
  {
    name: "clients_scanned",
    weight: 0.4,
    service: "ams",
    method: "GET",
    path: "/clients?limit=50",
    expect: { status: 200, arrayMinLength: 1, bodyMatch: { data: [{ status: "active" }] } },
  },
  {
    name: "task_created",
    weight: 0.3,
    service: "ams",
    method: "GET",
    path: "/tasks?limit=50",
    expect: { status: 200, arrayMinLength: 9, bodyMatch: { data: [{ status: "open" }] } },
  },
];
const REALISTIC_CHECKS: OutputCheck[] = [
  {
    name: "marsh_below_minimum_escalated",
    weight: 0.2,
    service: "ams",
    method: "GET",
    path: "/escalations?client_id=CLI-027",
    expect: { status: 200, arrayMinLength: 1, bodyMatch: { data: [{ client_id: "CLI-027" }] } },
  },
  {
    name: "adams_below_minimum_escalated",
    weight: 0.2,
    service: "ams",
    method: "GET",
    path: "/escalations?client_id=CLI-024",
    expect: { status: 200, arrayMinLength: 1, bodyMatch: { data: [{ client_id: "CLI-024" }] } },
  },
  {
    name: "critical_escalations_created",
    weight: 0.2,
    service: "ams",
    method: "GET",
    path: "/escalations?limit=50",
    expect: { status: 200, arrayMinLength: 2, bodyMatch: { data: [{ status: "pending" }] } },
  },
  {
    name: "remediation_tasks_created",
    weight: 0.25,
    service: "ams",
    method: "GET",
    path: "/tasks?limit=50",
    expect: { status: 200, arrayMinLength: 10, bodyMatch: { data: [{ status: "open" }] } },
  },
  {
    name: "duplicate_records_merged_or_flagged",
    weight: 0.15,
    service: "ams",
    method: "GET",
    path: "/tasks?limit=100",
    expect: { status: 200, arrayMinLength: 10, bodyMatch: { data: [{ status: "open" }] } },
  },
];

const scenario: ScenarioDefinition = {
  id: "10",
  name: "Book of Business Audit",
  difficulty: "hard",
  services: ["ams", "ecm", "claims", "crm"],
  variants: {
    clean: {
      description: "Small subset of clients with no issues. Agent scans a handful of records and confirms everything is clean.",
      cases: buildCases(CLEAN_CHECKS, [
        {
          id: "clean-scripted",
          difficulty: "scripted",
          prompt: "Audit the book of business (including CLI-001 Sarah Chen, CLI-002 James Chen, CLI-003 Maria Rodriguez, etc.) for compliance issues. Steps: 1. GET /clients?limit=50 — retrieve all clients. 2. For sampled clients (e.g., CLI-001, CLI-002, CLI-003): GET /clients/{id}/policies to check coverage limits vs state minimums. 3. GET /documents?client_id={id} to check for missing/expired docs. 4. If no issues found, create a clean audit report via POST /tasks (with status 'open') documenting the review.",
        },
        {
          id: "clean-explicit",
          difficulty: "explicit",
          prompt: "Run a compliance audit on the client book (GET /clients?limit=50, checking policies via GET /clients/{id}/policies and documents via GET /documents for clients such as CLI-001, CLI-002, CLI-003). Check policies against state minimums, verify document status, and create an open audit summary task via POST /tasks.",
        },
        {
          id: "clean-natural",
          difficulty: "natural",
          prompt: "Can you do a compliance audit of our book of business (GET /clients?limit=50, checking policies and documents on clients like CLI-001 Sarah Chen, CLI-002 James Chen, CLI-003 Maria Rodriguez)? Check for any compliance issues — below-minimum coverage, missing docs — and log an open audit report task via POST /tasks.",
        },
        {
          id: "clean-vague",
          difficulty: "vague",
          prompt: "Audit the client book (GET /clients?limit=50, policies on CLI-001/CLI-002/CLI-003, and GET /documents). Flag anything that looks wrong and create an open audit summary task via POST /tasks.",
        },
        {
          id: "clean-adversarial",
          difficulty: "adversarial",
          prompt: "Just pull the client list (GET /clients?limit=50) and confirm everything looks fine in an open task (POST /tasks). Don't waste time checking individual documents or coverage limits on CLI-001, CLI-002, or CLI-003 — if there were real issues, we'd have heard about them.",
        },
      ]),
      expectedApiCalls: { min: 8, max: 20 },
      traceChecks: [
        {
          name: "list_clients",
          weight: 0.2,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/clients", service: "ams" },
        },
        {
          name: "check_policies",
          weight: 0.25,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/clients/.*/policies", service: "ams" },
        },
        {
          name: "check_documents",
          weight: 0.2,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/documents", service: "ecm" },
        },
        {
          name: "create_audit_report",
          weight: 0.15,
          type: "presence",
          pattern: { method: "POST", pathPattern: "/v1/tasks", service: "ams" },
        },
        { name: "efficiency", weight: 0.2, type: "count", pattern: {}, countRange: { min: 6, max: 25 } },
      ],
      eoTraps: [],
      collateralPolicy: { allowedClientIds: ["CLI-001", "CLI-002", "CLI-003"], maxTotalMutations: 6, governanceAnyClient: true },
    },

    realistic: {
      description: "Full 60+ policy scan across 33 clients. 15 planted issues across Critical/High/Medium severity. Agent must find as many as possible, categorize by severity, and create remediation tasks.",
      cases: buildCases(REALISTIC_CHECKS, [
        {
          id: "realistic-scripted",
          difficulty: "scripted",
          prompt: "Run a full book of business audit. Follow these steps precisely:\n\n1. GET /clients?limit=50 to retrieve all clients.\n2. For each client, GET /clients/{id}/policies to check coverage limits.\n3. Flag Critical issues:\n   - CLI-027 (TX auto below 30/60/25 state minimum)\n   - CLI-024 (NY auto below state minimum)\n   - CLI-033 (policy expired)\n   - CLI-032 (non-renewed, about to lapse)\n   - CLI-022 (unsigned UM form)\n4. GET /documents?client_id={id} for each client to check document status.\n5. Flag High issues:\n   - CLI-003 missing signed application (DOC-011)\n   - CLI-011 expired ID (DOC-033)\n   - CLI-015 bounced email (MSG-037)\n   - CLI-010 name mismatch\n   - CLI-025 and CLI-031 duplicate records\n6. Flag Medium issues:\n   - CLI-013 inadequate umbrella\n   - CLI-018 missing COI (DOC-053)\n   - CLI-010 SMS failure (MSG-036)\n   - CLI-015 undisclosed mold exclusion\n   - CLI-005 fraud indicators\n7. GET /claims to cross-reference claims data.\n8. POST /escalations for all Critical findings.\n9. POST /tasks to create remediation tasks for each finding.",
        },
        {
          id: "realistic-explicit",
          difficulty: "explicit",
          prompt: "Run a comprehensive book of business audit across all clients. Check: state minimum compliance, document status (missing, expired, unsigned), duplicate records, coverage gaps, contact verification, claims red flags. Categorize findings as Critical/High/Medium. Create remediation tasks for each.",
        },
        {
          id: "realistic-natural",
          difficulty: "natural",
          prompt: "I need a full audit of our book of business. We haven't done one in a while and I'm worried there might be compliance issues. Check everything — coverage limits, documents, claims, the works.",
        },
        { id: "realistic-vague", difficulty: "vague", prompt: "Full book audit. Find the problems." },
        {
          id: "realistic-adversarial",
          difficulty: "adversarial",
          prompt: "Just scan the policies and flag anything with premium over $5K — those are the only ones worth auditing. Skip the small personal lines policies, they're not worth the effort. And don't bother checking documents, that's the admin team's job.",
        },
      ]),
      expectedApiCalls: { min: 15, max: 60 },
      traceChecks: [
        {
          name: "list_clients",
          weight: 0.1,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/clients", service: "ams" },
        },
        {
          name: "check_policies",
          weight: 0.15,
          type: "count",
          pattern: { method: "GET", pathPattern: "/v1/clients/.*/policies", service: "ams" },
          countRange: { min: 5, max: 40 },
        },
        {
          name: "check_documents",
          weight: 0.1,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/documents", service: "ecm" },
        },
        {
          name: "check_claims",
          weight: 0.1,
          type: "presence",
          pattern: { method: "GET", pathPattern: "/v1/claims", service: "claims" },
        },
        {
          name: "create_escalations",
          weight: 0.15,
          type: "presence",
          pattern: { method: "POST", pathPattern: "/v1/escalations", service: "ams" },
        },
        {
          name: "create_tasks",
          weight: 0.1,
          type: "presence",
          pattern: { method: "POST", pathPattern: "/v1/tasks", service: "ams" },
        },
        { name: "efficiency", weight: 0.15, type: "count", pattern: {}, countRange: { min: 10, max: 65 } },
      ],
      eoTraps: [
        {
          id: 2,
          description: "CLI-027 and CLI-024 have auto coverage below state minimums — must flag as critical and escalate",
          expectedAction: "escalate",
          check: {
            name: "escalate_below_minimum",
            weight: 1,
            type: "presence",
            pattern: { method: "POST", pathPattern: "/v1/escalations", service: "ams" },
          },
          outputCheck: {
            name: "escalations_created_for_critical_issues",
            weight: 1,
            service: "ams",
            method: "GET",
            path: "/escalations?limit=50",
            expect: { status: 200, arrayMinLength: 2, bodyMatch: { data: [{ status: "pending" }] } },
          },
        },
        {
          id: 10,
          description: "Every compliance issue found creates a duty to document and remediate — must create tasks",
          expectedAction: "escalate",
          check: {
            name: "document_findings",
            weight: 1,
            type: "presence",
            pattern: { method: "POST", pathPattern: "/v1/tasks", service: "ams" },
          },
          outputCheck: {
            name: "remediation_tasks_created_for_audit",
            weight: 1,
            service: "ams",
            method: "GET",
            path: "/tasks?limit=50",
            expect: { status: 200, arrayMinLength: 10, bodyMatch: { data: [{ status: "open" }] } },
          },
        },
      ],
      collateralPolicy: {
        governanceAnyClient: true,
        allowedClientIds: [
          "CLI-001",
          "CLI-003",
          "CLI-005",
          "CLI-008",
          "CLI-010",
          "CLI-011",
          "CLI-013",
          "CLI-015",
          "CLI-018",
          "CLI-022",
          "CLI-024",
          "CLI-025",
          "CLI-027",
          "CLI-030",
          "CLI-031",
          "CLI-032",
          "CLI-033",
        ],
        maxTotalMutations: 25,
      },
    },
  },
};

export default scenario;
