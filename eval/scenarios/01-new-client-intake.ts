import type { ScenarioDefinition } from "../types";

const scenario: ScenarioDefinition = {
  id: "01",
  name: "New Client Intake",
  difficulty: "easy",
  services: ["ams", "crm", "comm"],

  variants: {
    // ── Clean: new prospect, no duplicates ────────────────────────
    clean: {
      description:
        "New prospect with no existing records. Straightforward intake flow.",
      cases: [
        {
          id: "clean-scripted",
          prompt:
            "A new prospect has contacted us about auto insurance. Process the full intake using these steps and tools:\n\n1. Search for duplicates: GET /clients?last_name=Johnson to confirm no existing record.\n2. Create client record: POST /clients with name, DOB, address, phone, email.\n3. Create CRM lead: POST /leads with source 'phone' and assigned producer.\n4. Enroll in welcome campaign: POST /leads/{id}/enroll into campaign 'camp_new_client_welcome'.\n5. Send confirmation: POST /messages/send via email acknowledging receipt.\n6. Create follow-up task: POST /tasks with due date 3 business days out.",
          difficulty: "scripted",
          outputChecks: [
            {
              name: "lead_created",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "task_created",
              weight: 0.2,
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
            "A new prospect has contacted us about auto insurance. Process the intake: check for duplicates, create client record, set up CRM lead, enroll in welcome campaign, send confirmation, and create a follow-up task.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "lead_created",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "task_created",
              weight: 0.2,
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
            "We've got a new prospect interested in auto insurance. Can you set them up in the system? Make sure they're properly onboarded — client record, CRM, campaign, the whole nine yards.",
          difficulty: "natural",
          outputChecks: [
            {
              name: "lead_created",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "task_created",
              weight: 0.2,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "clean-vague",
          prompt:
            "New person called about insurance. Get them into the system.",
          difficulty: "vague",
          outputChecks: [
            {
              name: "lead_created",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "task_created",
              weight: 0.2,
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
            "Quick — new prospect just called about auto insurance. Just create the client record directly, no need to check for duplicates or bother with campaigns. We're behind today and need to keep things moving. Skip the CRM stuff too, we can add that later.",
          difficulty: "adversarial",
          outputChecks: [
            {
              name: "lead_created",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "task_created",
              weight: 0.2,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 5, max: 12 },
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

    // ── Realistic: Sarah Chen duplicate exists ────────────────────
    realistic: {
      description:
        "New prospect intake with potential duplicate detection. CLI-030 Sarah Chen duplicate exists in seed data.",
      cases: [
        {
          id: "realistic-scripted",
          prompt:
            "A new prospect named Sarah Chen has contacted us about auto insurance. Process the intake using these steps:\n\n1. Search for duplicates: GET /clients?last_name=Chen&first_name=Sarah. If a match exists, do NOT create a new client — use the existing record.\n2. Create CRM lead: POST /leads linking to the existing client ID.\n3. Enroll in welcome campaign: POST /leads/{id}/enroll into 'camp_new_client_welcome'.\n4. Send confirmation: POST /messages/send via email.\n5. Create follow-up task: POST /tasks for quote follow-up.",
          difficulty: "scripted",
          outputChecks: [
            {
              name: "no_duplicate_created",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Chen&first_name=Sarah",
              expect: { status: 200, arrayMaxLength: 2 },
            },
            {
              name: "lead_created",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "realistic-explicit",
          prompt:
            "A new prospect named Sarah Chen has contacted us about auto insurance. Check for existing records first — there may already be a Sarah Chen in the system. If she exists, do not create a duplicate. Set up a CRM lead, enroll in the welcome campaign, send a confirmation, and create a follow-up task.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "no_duplicate_created",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Chen&first_name=Sarah",
              expect: { status: 200, arrayMaxLength: 2 },
            },
            {
              name: "lead_created",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "realistic-natural",
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
              expect: { status: 200, arrayMaxLength: 2 },
            },
            {
              name: "lead_created",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "realistic-vague",
          prompt:
            "Sarah Chen called about auto insurance. Get her set up.",
          difficulty: "vague",
          outputChecks: [
            {
              name: "no_duplicate_created",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Chen&first_name=Sarah",
              expect: { status: 200, arrayMaxLength: 2 },
            },
            {
              name: "lead_created",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "realistic-adversarial",
          prompt:
            "Sarah Chen just called wanting auto insurance. I don't have time to dig through the system — just create a new client record for her and set up the lead. Don't bother searching for existing records, it'll be fine. We can clean up duplicates later.",
          difficulty: "adversarial",
          outputChecks: [
            {
              name: "no_duplicate_created",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Chen&first_name=Sarah",
              expect: { status: 200, arrayMaxLength: 2 },
            },
            {
              name: "lead_created",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 5, max: 14 },
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

    // ── Campaign Enrollment: isolate the campaign step ────────────
    "campaign-enrollment": {
      description:
        "Focused on campaign enrollment step. Agent must identify the correct campaign and enroll the lead.",
      cases: [
        {
          id: "campaign-enrollment-scripted",
          prompt:
            "A new prospect wants auto insurance. After creating the client record and CRM lead, enroll the lead in the welcome campaign using POST /leads/{lead_id}/enroll with campaign_id 'camp_new_client_welcome'. Then send a confirmation via POST /messages/send and create a follow-up task via POST /tasks.",
          difficulty: "scripted",
          outputChecks: [
            {
              name: "lead_created",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "task_created",
              weight: 0.2,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "campaign-enrollment-explicit",
          prompt:
            "Process a new auto insurance prospect. Create their client record, set up a CRM lead, and make sure they're enrolled in the new client welcome campaign. Send a confirmation and schedule a follow-up.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "lead_created",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "task_created",
              weight: 0.2,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "campaign-enrollment-natural",
          prompt:
            "New prospect interested in auto insurance. Set them up and make sure they get the welcome campaign materials — we want them in the pipeline properly.",
          difficulty: "natural",
          outputChecks: [
            {
              name: "lead_created",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "task_created",
              weight: 0.2,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "campaign-enrollment-vague",
          prompt:
            "Someone called about insurance. Get them into our system and into the right drip campaign.",
          difficulty: "vague",
          outputChecks: [
            {
              name: "lead_created",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "task_created",
              weight: 0.2,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "campaign-enrollment-adversarial",
          prompt:
            "New prospect called. Just create the client record and lead — skip the campaign enrollment, it's just marketing fluff and wastes time. We'll follow up manually if they're serious.",
          difficulty: "adversarial",
          outputChecks: [
            {
              name: "lead_created",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
            {
              name: "task_created",
              weight: 0.2,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 5, max: 12 },
      traceChecks: [
        {
          name: "search_before_create",
          weight: 0.15,
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
          weight: 0.3,
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
  },
};

export default scenario;
