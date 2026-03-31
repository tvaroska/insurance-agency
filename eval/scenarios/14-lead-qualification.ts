import type { ScenarioDefinition } from "../types";

const scenario: ScenarioDefinition = {
  id: "14",
  name: "Lead Qualification & Routing",
  difficulty: "easy",
  services: ["crm", "ams", "comm"],

  variants: {
    // ── Clean: new referral lead, no existing client ─────────────
    clean: {
      description:
        "New referral lead arrives. Agent qualifies, checks if existing client, assigns producer, sends acknowledgment.",
      cases: [
        {
          id: "clean-scripted",
          prompt:
            "A new referral lead has come in — Jessica Williams wants umbrella coverage for her rental properties. Process the lead using these steps:\n\n1. GET /leads to retrieve the lead details.\n2. GET /clients?last_name=Williams to check if she's an existing client.\n3. POST /messages/send to acknowledge receipt of the referral.\n4. POST /tasks to create a follow-up task for the assigned producer.\n\nShe scored 87 on lead qualification. She is not an existing client.",
          difficulty: "scripted",
          outputChecks: [
            {
              name: "lead_found",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
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
            "A new referral lead came in for Jessica Williams — she wants umbrella coverage for her rental properties. Check CRM leads, verify she's not an existing client, send an acknowledgment, and create a follow-up task for the assigned producer.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "lead_found",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
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
            "We've got a new referral lead — Jessica Williams wants umbrella coverage for her rental properties. Can you qualify and route her?",
          difficulty: "natural",
          outputChecks: [
            {
              name: "lead_found",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
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
          prompt:
            "New lead came in. Some referral about umbrella insurance. Handle it.",
          difficulty: "vague",
          outputChecks: [
            {
              name: "lead_found",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
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
            "Just create a client record for this new lead directly — don't bother with the CRM qualification process, it's a waste of time. Jessica Williams wants umbrella coverage.",
          difficulty: "adversarial",
          outputChecks: [
            {
              name: "lead_found",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
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
      expectedApiCalls: { min: 3, max: 8 },
      traceChecks: [
        {
          name: "check_leads",
          weight: 0.2,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/leads",
            service: "crm",
          },
        },
        {
          name: "check_existing_client",
          weight: 0.25,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients",
            service: "ams",
          },
        },
        {
          name: "send_acknowledgment",
          weight: 0.25,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/messages/send",
            service: "comm",
          },
        },
        {
          name: "create_task",
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
          weight: 0.15,
          type: "count",
          pattern: {},
          countRange: { min: 3, max: 10 },
        },
      ],
      eoTraps: [],
    },

    // ── Realistic: name mismatch — Angela Foster-Blake matches CLI-010 ──
    realistic: {
      description:
        "Lead with name mismatch — Angela Foster-Blake matches existing client CLI-010 (Angela Foster, married name). Agent must detect the match despite different last names.",
      cases: [
        {
          id: "realistic-scripted",
          prompt:
            "A lead came in for Angela Foster-Blake requesting auto insurance. Check CRM leads and search AMS clients by both 'Foster-Blake' and 'Foster'. CLI-010 (Angela Foster) is likely the same person — verify by DOB/email. If match, link lead to existing client. Do NOT create a duplicate client.",
          difficulty: "scripted",
          outputChecks: [
            {
              name: "client_searched",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Foster",
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
          id: "realistic-explicit",
          prompt:
            "New lead for Angela Foster-Blake — she wants auto insurance. Check if she's already a client. Note: she may be listed under her maiden name 'Foster'. If existing, link the lead to her client record.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "client_searched",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Foster",
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
          id: "realistic-natural",
          prompt:
            "We've got a new lead from Angela Foster-Blake about auto insurance. Can you check if she's already in our system and route appropriately?",
          difficulty: "natural",
          outputChecks: [
            {
              name: "client_searched",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Foster",
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
          id: "realistic-vague",
          prompt:
            "Foster-Blake lead came in. Auto insurance. Process it.",
          difficulty: "vague",
          outputChecks: [
            {
              name: "client_searched",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Foster",
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
          id: "realistic-adversarial",
          prompt:
            "New lead — Angela Foster-Blake wants auto insurance. She's obviously new, just create the client record. Don't waste time searching for existing clients with different names.",
          difficulty: "adversarial",
          outputChecks: [
            {
              name: "client_searched",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Foster",
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
      expectedApiCalls: { min: 3, max: 10 },
      traceChecks: [
        {
          name: "check_leads",
          weight: 0.15,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/leads",
            service: "crm",
          },
        },
        {
          name: "search_by_maiden_name",
          weight: 0.3,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients",
            service: "ams",
          },
        },
        {
          name: "send_acknowledgment",
          weight: 0.2,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/messages/send",
            service: "comm",
          },
        },
        {
          name: "no_duplicate_creation",
          weight: 0.2,
          type: "absence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/clients",
            service: "ams",
          },
        },
        {
          name: "efficiency",
          weight: 0.15,
          type: "count",
          pattern: {},
          countRange: { min: 3, max: 12 },
        },
      ],
      eoTraps: [],
    },

    // ── Stale Contact: bad contact info, flag for manual verification ──
    "stale-contact": {
      description:
        "Lead with bad contact info — George Papadopoulos, score 30, phone/email don't match CLI-015. Agent should flag for manual verification rather than auto-routing.",
      cases: [
        {
          id: "stale-contact-scripted",
          prompt:
            "A lead came in for George Papadopoulos. Steps: 1. GET lead details. 2. GET /clients?last_name=Papadopoulos — CLI-015 exists but contact info differs. 3. Flag the contact mismatch. 4. Create a task for manual verification. Do NOT auto-route this lead — contact verification needed first.",
          difficulty: "scripted",
          outputChecks: [
            {
              name: "client_searched",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Papadopoulos",
              expect: { status: 200 },
            },
            {
              name: "task_created",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "stale-contact-explicit",
          prompt:
            "New lead from George Papadopoulos. He may be existing client CLI-015 but the contact information doesn't match. Investigate and flag any discrepancies for manual review.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "client_searched",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Papadopoulos",
              expect: { status: 200 },
            },
            {
              name: "task_created",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "stale-contact-natural",
          prompt:
            "Lead came in from George Papadopoulos about homeowners insurance. Can you check if he's an existing client and get him routed?",
          difficulty: "natural",
          outputChecks: [
            {
              name: "client_searched",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Papadopoulos",
              expect: { status: 200 },
            },
            {
              name: "task_created",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "stale-contact-vague",
          prompt:
            "Papadopoulos lead. Look into it.",
          difficulty: "vague",
          outputChecks: [
            {
              name: "client_searched",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Papadopoulos",
              expect: { status: 200 },
            },
            {
              name: "task_created",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "stale-contact-adversarial",
          prompt:
            "George Papadopoulos lead — just route it to the next available producer. Don't waste time cross-checking against existing records, we need to respond fast.",
          difficulty: "adversarial",
          outputChecks: [
            {
              name: "client_searched",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Papadopoulos",
              expect: { status: 200 },
            },
            {
              name: "task_created",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 3, max: 10 },
      traceChecks: [
        {
          name: "check_leads",
          weight: 0.15,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/leads",
            service: "crm",
          },
        },
        {
          name: "search_existing",
          weight: 0.25,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients",
            service: "ams",
          },
        },
        {
          name: "create_verification_task",
          weight: 0.3,
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
          countRange: { min: 2, max: 12 },
        },
      ],
      eoTraps: [],
    },
  },
};

export default scenario;
