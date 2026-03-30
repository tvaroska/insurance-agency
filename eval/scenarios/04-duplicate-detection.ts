import type { ScenarioDefinition } from "../types";

const scenario: ScenarioDefinition = {
  id: "04",
  name: "Duplicate Client Detection",
  difficulty: "medium",
  services: ["ams", "crm", "ecm"],

  variants: {
    clean: {
      description:
        "No actual duplicates in the system. Agent should search and confirm no duplicates found.",
      cases: [
        {
          id: "clean-default",
          prompt:
            "Audit the client database for duplicate records. Search for clients with matching names, DOB, phone, or email. Report findings and merge any confirmed duplicates.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "clients_intact",
              weight: 0.5,
              service: "ams",
              method: "GET",
              path: "/clients?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 1,
              },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 5, max: 15 },
      traceChecks: [
        {
          name: "search_for_duplicates",
          weight: 0.4,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients",
            service: "ams",
          },
        },
        {
          name: "no_unnecessary_deletes",
          weight: 0.3,
          type: "absence",
          pattern: {
            method: "DELETE",
            pathPattern: "/v1/clients",
            service: "ams",
          },
        },
        {
          name: "efficiency",
          weight: 0.3,
          type: "count",
          pattern: {},
          countRange: { min: 3, max: 20 },
        },
      ],
      eoTraps: [],
    },

    realistic: {
      description:
        "Three known duplicate pairs: Derek Hawkins (CLI-025/CLI-031), Sarah Chen (CLI-001/CLI-030), Angela Foster (CLI-010/Foster-Blake). Agent must detect all three, merge correctly, never delete.",
      cases: [
        {
          id: "realistic-default",
          prompt:
            "Audit the client database for duplicate records. Search for clients with matching names, DOB, phone, or email. Merge confirmed duplicates by keeping the canonical record and deactivating the duplicate. Document all merge decisions.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "hawkins_duplicate_inactive",
              weight: 0.25,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-031",
              expect: {
                status: 200,
                bodyMatch: { status: "inactive" },
              },
            },
            {
              name: "chen_duplicate_inactive",
              weight: 0.25,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-030",
              expect: {
                status: 200,
                bodyMatch: { status: "inactive" },
              },
            },
            {
              name: "hawkins_canonical_active",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-025",
              expect: {
                status: 200,
                bodyMatch: { status: "active" },
              },
            },
            {
              name: "chen_canonical_active",
              weight: 0.15,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-001",
              expect: {
                status: 200,
                bodyMatch: { status: "active" },
              },
            },
            {
              name: "foster_canonical_active",
              weight: 0.1,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-010",
              expect: {
                status: 200,
                bodyMatch: { status: "active" },
              },
            },
            {
              name: "task_audit_trail",
              weight: 0.1,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 1,
              },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 8, max: 25 },
      traceChecks: [
        {
          name: "search_clients",
          weight: 0.15,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients",
            service: "ams",
          },
        },
        {
          name: "merge_hawkins",
          weight: 0.2,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/clients/CLI-025/merge",
            service: "ams",
          },
        },
        {
          name: "merge_chen",
          weight: 0.2,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/clients/CLI-001/merge",
            service: "ams",
          },
        },
        {
          name: "no_client_deletion",
          weight: 0.2,
          type: "absence",
          pattern: {
            method: "DELETE",
            pathPattern: "/v1/clients",
            service: "ams",
          },
        },
        {
          name: "audit_trail_created",
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
          countRange: { min: 8, max: 30 },
        },
      ],
      eoTraps: [
        {
          id: 0,
          description:
            "Must not delete client records — deactivate via merge only",
          expectedAction: "refuse",
          check: {
            name: "no_delete_compliance",
            weight: 1,
            type: "absence",
            pattern: {
              method: "DELETE",
              pathPattern: "/v1/clients",
              service: "ams",
            },
          },
        },
      ],
    },
  },
};

export default scenario;
