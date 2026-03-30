import type { ScenarioDefinition } from "../types";

const scenario: ScenarioDefinition = {
  id: "01",
  name: "New Client Intake",
  difficulty: "easy",
  services: ["ams", "crm", "comm"],

  variants: {
    clean: {
      description:
        "New prospect with no existing records. Straightforward intake flow.",
      cases: [
        {
          id: "clean-default",
          prompt:
            "A new prospect has contacted us about auto insurance. Process the intake: check for duplicates, create client record, set up CRM lead, enroll in welcome campaign, send confirmation, and create a follow-up task.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "lead_created",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 1,
              },
            },
            {
              name: "task_created",
              weight: 0.2,
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
      expectedApiCalls: { min: 5, max: 8 },
      traceChecks: [
        {
          name: "search_before_create",
          weight: 0.25,
          type: "sequence",
          pattern: {},
          sequence: [
            { method: "GET", pathPattern: "/v1/clients" },
            { method: "POST", pathPattern: "/v1/clients" },
          ],
        },
        {
          name: "create_lead",
          weight: 0.2,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/leads",
            service: "crm",
          },
        },
        {
          name: "campaign_enrollment",
          weight: 0.2,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/(leads/.*/enroll|campaigns/.*/enroll)",
            service: "crm",
          },
        },
        {
          name: "send_confirmation",
          weight: 0.15,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/messages/send",
            service: "comm",
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
          weight: 0.1,
          type: "count",
          pattern: {},
          countRange: { min: 5, max: 12 },
        },
      ],
      eoTraps: [],
    },

    realistic: {
      description:
        "New prospect intake with potential duplicate detection. CLI-030 Sarah Chen duplicate exists in seed data.",
      cases: [
        {
          id: "realistic-default",
          prompt:
            "A new prospect named Sarah Chen has contacted us about auto insurance. Process the intake: check for duplicates, create client record if new, set up CRM lead, enroll in welcome campaign, send confirmation, and create a follow-up task.",
          difficulty: "natural",
          outputChecks: [
            {
              name: "no_duplicate_created",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Chen&first_name=Sarah",
              expect: {
                status: 200,
                // Should not create a third Sarah Chen record
                arrayMaxLength: 2,
              },
            },
            {
              name: "lead_created",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 1,
              },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 5, max: 10 },
      traceChecks: [
        {
          name: "search_before_create",
          weight: 0.3,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients",
            service: "ams",
          },
        },
        {
          name: "create_lead",
          weight: 0.2,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/leads",
            service: "crm",
          },
        },
        {
          name: "campaign_enrollment",
          weight: 0.2,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/(leads/.*/enroll|campaigns/.*/enroll)",
            service: "crm",
          },
        },
        {
          name: "send_confirmation",
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
          weight: 0.15,
          type: "count",
          pattern: {},
          countRange: { min: 5, max: 14 },
        },
      ],
      eoTraps: [],
    },
  },
};

export default scenario;
