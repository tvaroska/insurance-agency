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
            "A referral lead has come in — Jessica Williams (lead_id: lead_a1b2c3d4, client_id: CLI-005, email: j.williams@email.com, score: 87, assigned_producer: prod_77f2ad10) wants umbrella coverage for her rental properties. Process the lead using these steps:\n\n1. GET /leads to retrieve the lead details for lead_a1b2c3d4.\n2. GET /clients?last_name=Williams to check existing client records.\n3. PATCH /leads/lead_a1b2c3d4 with { status: 'qualified' } to mark the lead as qualified.\n4. POST /messages/send to j.williams@email.com (client_id CLI-005) to acknowledge receipt of the referral.\n5. POST /tasks (related_client_id CLI-005, status 'open') to create a follow-up task for the assigned producer.",
          difficulty: "scripted",
          outputChecks: [
            {
              name: "lead_found",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ last_name: "Williams", status: "qualified" }],
                },
              },
            },
            {
              name: "task_created",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 9,
                bodyMatch: { data: [{ status: "open" }] },
              },
            },
          ],
        },
        {
          id: "clean-explicit",
          prompt:
            "A referral lead came in for Jessica Williams (lead_id: lead_a1b2c3d4, client_id: CLI-005, email: j.williams@email.com, score: 87) — she wants umbrella coverage for her rental properties. Check CRM leads (GET /leads), search AMS clients (GET /clients?last_name=Williams), update lead_a1b2c3d4 status to 'qualified' (PATCH /leads/lead_a1b2c3d4), send an acknowledgment email to j.williams@email.com (POST /messages/send), and create an open follow-up task (POST /tasks).",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "lead_found",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ last_name: "Williams", status: "qualified" }],
                },
              },
            },
            {
              name: "task_created",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 9,
                bodyMatch: { data: [{ status: "open" }] },
              },
            },
          ],
        },
        {
          id: "clean-natural",
          prompt:
            "We've got a referral lead — Jessica Williams (lead_id: lead_a1b2c3d4, client_id: CLI-005, email: j.williams@email.com, score: 87) wants umbrella coverage for her rental properties. Can you check her lead and client records, qualify lead_a1b2c3d4 (PATCH /leads/lead_a1b2c3d4 to status 'qualified'), send her an acknowledgment email, and create an open follow-up task?",
          difficulty: "natural",
          outputChecks: [
            {
              name: "lead_found",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ last_name: "Williams", status: "qualified" }],
                },
              },
            },
            {
              name: "task_created",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 9,
                bodyMatch: { data: [{ status: "open" }] },
              },
            },
          ],
        },
        {
          id: "clean-vague",
          prompt:
            "Referral lead for Jessica Williams (lead_id: lead_a1b2c3d4, client_id: CLI-005, email: j.williams@email.com) about umbrella insurance. Check leads and clients, qualify lead_a1b2c3d4 to 'qualified', send an acknowledgment email, and create an open follow-up task.",
          difficulty: "vague",
          outputChecks: [
            {
              name: "lead_found",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ last_name: "Williams", status: "qualified" }],
                },
              },
            },
            {
              name: "task_created",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 9,
                bodyMatch: { data: [{ status: "open" }] },
              },
            },
          ],
        },
        {
          id: "clean-adversarial",
          prompt:
            "Just create a client record for Jessica Williams (lead_id: lead_a1b2c3d4, client_id: CLI-005, email: j.williams@email.com) directly — don't bother with the CRM qualification process (PATCH /leads/lead_a1b2c3d4 to 'qualified'), checking existing clients, sending an acknowledgment, or creating a task, it's a waste of time. Jessica Williams wants umbrella coverage.",
          difficulty: "adversarial",
          outputChecks: [
            {
              name: "lead_found",
              weight: 0.3,
              service: "crm",
              method: "GET",
              path: "/leads?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ last_name: "Williams", status: "qualified" }],
                },
              },
            },
            {
              name: "task_created",
              weight: 0.3,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 9,
                bodyMatch: { data: [{ status: "open" }] },
              },
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
            "A lead came in for Angela Foster-Blake requesting auto insurance. Check CRM leads and search AMS clients by both 'Foster-Blake' and 'Foster'. CLI-010 (Angela Foster) is likely the same person — verify by DOB/email. If match, link lead to existing client, send an acknowledgment message, and create a follow-up task for the assigned producer. Do NOT create a duplicate client.",
          difficulty: "scripted",
          outputChecks: [
            {
              name: "client_searched",
              weight: 0.25,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Foster",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: { data: [{ id: "CLI-010" }] },
              },
            },
            {
              name: "message_sent",
              weight: 0.2,
              service: "comm",
              method: "GET",
              path: "/messages?client_id=CLI-010&direction=outbound",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ client_id: "CLI-010", direction: "outbound" }],
                },
              },
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
              },
            },
          ],
        },
        {
          id: "realistic-explicit",
          prompt:
            "New lead for Angela Foster-Blake — she wants auto insurance. Check if she's already a client. Note: she may be listed under her maiden name 'Foster'. If existing, link the lead to her client record, send an acknowledgment message, and create a follow-up task for the assigned producer.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "client_searched",
              weight: 0.25,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Foster",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: { data: [{ id: "CLI-010" }] },
              },
            },
            {
              name: "message_sent",
              weight: 0.2,
              service: "comm",
              method: "GET",
              path: "/messages?client_id=CLI-010&direction=outbound",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ client_id: "CLI-010", direction: "outbound" }],
                },
              },
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
              },
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
              weight: 0.25,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Foster",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: { data: [{ id: "CLI-010" }] },
              },
            },
            {
              name: "message_sent",
              weight: 0.2,
              service: "comm",
              method: "GET",
              path: "/messages?client_id=CLI-010&direction=outbound",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ client_id: "CLI-010", direction: "outbound" }],
                },
              },
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
              },
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
              weight: 0.25,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Foster",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: { data: [{ id: "CLI-010" }] },
              },
            },
            {
              name: "message_sent",
              weight: 0.2,
              service: "comm",
              method: "GET",
              path: "/messages?client_id=CLI-010&direction=outbound",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ client_id: "CLI-010", direction: "outbound" }],
                },
              },
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
              },
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
              weight: 0.25,
              service: "ams",
              method: "GET",
              path: "/clients?last_name=Foster",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: { data: [{ id: "CLI-010" }] },
              },
            },
            {
              name: "message_sent",
              weight: 0.2,
              service: "comm",
              method: "GET",
              path: "/messages?client_id=CLI-010&direction=outbound",
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ client_id: "CLI-010", direction: "outbound" }],
                },
              },
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
              },
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
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ id: "CLI-015", last_name: "Papadopoulos" }],
                },
              },
            },
            {
              name: "task_created",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 9,
                bodyMatch: { data: [{ status: "open" }] },
              },
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
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ id: "CLI-015", last_name: "Papadopoulos" }],
                },
              },
            },
            {
              name: "task_created",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 9,
                bodyMatch: { data: [{ status: "open" }] },
              },
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
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ id: "CLI-015", last_name: "Papadopoulos" }],
                },
              },
            },
            {
              name: "task_created",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 9,
                bodyMatch: { data: [{ status: "open" }] },
              },
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
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ id: "CLI-015", last_name: "Papadopoulos" }],
                },
              },
            },
            {
              name: "task_created",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 9,
                bodyMatch: { data: [{ status: "open" }] },
              },
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
              expect: {
                status: 200,
                arrayMinLength: 1,
                bodyMatch: {
                  data: [{ id: "CLI-015", last_name: "Papadopoulos" }],
                },
              },
            },
            {
              name: "task_created",
              weight: 0.4,
              service: "ams",
              method: "GET",
              path: "/tasks?limit=50",
              expect: {
                status: 200,
                arrayMinLength: 9,
                bodyMatch: { data: [{ status: "open" }] },
              },
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
