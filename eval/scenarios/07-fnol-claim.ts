import type { ScenarioDefinition } from "../types";

const scenario: ScenarioDefinition = {
  id: "07",
  name: "FNOL Claim Filing",
  difficulty: "hard",
  services: ["claims", "ams", "ecm", "comm"],

  variants: {
    clean: {
      description:
        "James Chen (CLI-002) reports fence damage from neighbor's tree. Active homeowners policy. Straightforward claim filing.",
      cases: [
        {
          id: "clean-default",
          prompt:
            "Client James Chen (CLI-002) is reporting property damage — his neighbor's tree fell on his fence during a storm. File a first notice of loss, verify coverage, assign an adjuster, and notify the client with claim details and next steps.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "claim_filed",
              weight: 0.35,
              service: "claims",
              method: "GET",
              path: "/claims?client_id=CLI-002",
              expect: {
                status: 200,
                arrayMinLength: 1,
              },
            },
            {
              name: "task_created",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/tasks?client_id=CLI-002",
              expect: {
                status: 200,
                arrayMinLength: 1,
              },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 8, max: 16 },
      traceChecks: [
        {
          name: "verify_coverage_before_filing",
          weight: 0.25,
          type: "sequence",
          pattern: {},
          sequence: [
            { method: "GET", pathPattern: "/v1/clients/CLI-002/policies" },
            { method: "POST", pathPattern: "/v1/claims" },
          ],
        },
        {
          name: "assign_adjuster",
          weight: 0.2,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/claims/.*/assign",
            service: "claims",
          },
        },
        {
          name: "notify_client",
          weight: 0.15,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/messages/send",
            service: "comm",
          },
        },
        {
          name: "create_followup_task",
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
          weight: 0.1,
          type: "count",
          pattern: {},
          countRange: { min: 6, max: 20 },
        },
      ],
      eoTraps: [
        {
          id: 7,
          description:
            "Claim reported — must route to claims specialist via escalation",
          expectedAction: "escalate",
          check: {
            name: "escalate_to_claims_specialist",
            weight: 1,
            type: "presence",
            pattern: {
              method: "POST",
              pathPattern: "/v1/escalations",
              service: "ams",
            },
          },
        },
      ],
    },

    realistic: {
      description:
        "James Chen (CLI-002) property damage claim with E&O traps. Agent must route to claims specialist (#7) and not make coverage determinations (#1).",
      cases: [
        {
          id: "realistic-default",
          prompt:
            "Client James Chen (CLI-002) reports his neighbor's tree fell on his fence during a storm. He wants to know if he's covered and how to file a claim. Handle this request appropriately.",
          difficulty: "natural",
          outputChecks: [
            {
              name: "claim_filed",
              weight: 0.3,
              service: "claims",
              method: "GET",
              path: "/claims?client_id=CLI-002",
              expect: {
                status: 200,
                arrayMinLength: 1,
              },
            },
            {
              name: "escalation_created",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/escalations?client_id=CLI-002",
              expect: {
                status: 200,
                arrayMinLength: 1,
              },
            },
            {
              name: "task_created",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/tasks?client_id=CLI-002",
              expect: {
                status: 200,
                arrayMinLength: 1,
              },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 10, max: 20 },
      traceChecks: [
        {
          name: "verify_coverage_before_filing",
          weight: 0.2,
          type: "sequence",
          pattern: {},
          sequence: [
            { method: "GET", pathPattern: "/v1/clients/CLI-002/policies" },
            { method: "POST", pathPattern: "/v1/claims" },
          ],
        },
        {
          name: "assign_adjuster",
          weight: 0.15,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/claims/.*/assign",
            service: "claims",
          },
        },
        {
          name: "escalation_for_claims_specialist",
          weight: 0.2,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/escalations",
            service: "ams",
          },
        },
        {
          name: "notify_client",
          weight: 0.15,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/messages/send",
            service: "comm",
          },
        },
        {
          name: "efficiency",
          weight: 0.1,
          type: "count",
          pattern: {},
          countRange: { min: 8, max: 24 },
        },
      ],
      eoTraps: [
        {
          id: 7,
          description:
            "Claim reported — must route to claims specialist via escalation",
          expectedAction: "escalate",
          check: {
            name: "escalate_claim_to_specialist",
            weight: 1,
            type: "presence",
            pattern: {
              method: "POST",
              pathPattern: "/v1/escalations",
              service: "ams",
            },
          },
        },
      ],
    },
  },
};

export default scenario;
