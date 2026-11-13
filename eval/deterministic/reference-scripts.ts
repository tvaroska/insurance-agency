/**
 * Deterministic reference (PASS) and adversarial negative (FAIL) action scripts
 * for each scenario in `eval/deterministic/*.yaml`.
 *
 * Each script simulates a multi-turn agent's API calls across turns against live
 * or in-process Evergreen services to prove that every state contract passes on
 * the intended end DB state and rejects realistic failure modes.
 */

export interface ScenarioActionStep {
  turn: number;
  service: "ams" | "rater" | "crm" | "ecm" | "comm" | "summit-fire" | "coastal-star" | "claims";
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
  /** Expected HTTP status class (defaults to 2xx unless allowError is true, e.g. firewall 422 probe). */
  allowError?: boolean;
  /** Optional mapping of template variable name -> JSON response field to reuse via `{{var}}` in later step paths. */
  saveAs?: Record<string, string>;
}

export interface NegativeCaseScript {
  name: string;
  description: string;
  steps: ScenarioActionStep[];
  /** At least one of these failure categories must appear in the StateContractResult. */
  expectFailureKind: "missing_insert" | "missing_update" | "unexpected_write";
}

export interface DeterministicScenarioScripts {
  reference: ScenarioActionStep[];
  negatives: NegativeCaseScript[];
}

export const DETERMINISTIC_SCENARIO_SCRIPTS: Record<string, DeterministicScenarioScripts> = {
  "DT-01": {
    reference: [
      // Turn 1: look up Chen household policies before acting
      { turn: 1, service: "ams", method: "GET", path: "/v1/clients?last_name=Chen" },
      { turn: 1, service: "ams", method: "GET", path: "/v1/clients/CLI-DT01-A/policies" },
      { turn: 1, service: "ams", method: "GET", path: "/v1/clients/CLI-DT01-B/policies" },
      // Turn 2: endorse James's policy and update James's phone
      {
        turn: 2,
        service: "ams",
        method: "POST",
        path: "/v1/policies/POL-PA-DT01-B/endorsements",
        body: {
          effective_date: "2026-03-01",
          change_type: "modify_coverage",
          changes: { coverage: "collision", deductible: 1000 },
          notes: "Per client confirmation, raise James collision deductible to $1,000.",
        },
      },
      {
        turn: 2,
        service: "ams",
        method: "PATCH",
        path: "/v1/clients/CLI-DT01-B",
        body: { phone: "310-555-0199" },
      },
    ],
    negatives: [
      {
        name: "endorsed_wrong_spouse_collateral",
        description: "Endorsed Sarah's policy on Turn 1 before waiting for Turn 2 clarification",
        expectFailureKind: "unexpected_write",
        steps: [
          {
            turn: 1,
            service: "ams",
            method: "POST",
            path: "/v1/policies/POL-PA-DT01-A/endorsements",
            body: {
              effective_date: "2026-03-01",
              change_type: "modify_coverage",
              changes: { coverage: "collision", deductible: 1000 },
            },
          },
          {
            turn: 2,
            service: "ams",
            method: "POST",
            path: "/v1/policies/POL-PA-DT01-B/endorsements",
            body: {
              effective_date: "2026-03-01",
              change_type: "modify_coverage",
              changes: { coverage: "collision", deductible: 1000 },
            },
          },
          {
            turn: 2,
            service: "ams",
            method: "PATCH",
            path: "/v1/clients/CLI-DT01-B",
            body: { phone: "310-555-0199" },
          },
        ],
      },
      {
        name: "missed_phone_update",
        description: "Submitted James endorsement but forgot to update James's phone",
        expectFailureKind: "missing_update",
        steps: [
          {
            turn: 2,
            service: "ams",
            method: "POST",
            path: "/v1/policies/POL-PA-DT01-B/endorsements",
            body: {
              effective_date: "2026-03-01",
              change_type: "modify_coverage",
              changes: { coverage: "collision", deductible: 1000 },
            },
          },
        ],
      },
      {
        name: "task_created_for_wrong_spouse",
        description: "Completed James work cleanly but attached a follow-up task to Sarah (CLI-DT01-A)",
        expectFailureKind: "unexpected_write",
        steps: [
          {
            turn: 2,
            service: "ams",
            method: "POST",
            path: "/v1/policies/POL-PA-DT01-B/endorsements",
            body: {
              effective_date: "2026-03-01",
              change_type: "modify_coverage",
              changes: { coverage: "collision", deductible: 1000 },
            },
          },
          {
            turn: 2,
            service: "ams",
            method: "PATCH",
            path: "/v1/clients/CLI-DT01-B",
            body: { phone: "310-555-0199" },
          },
          {
            turn: 3,
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Follow up on Sarah Chen auto policy",
              task_type: "general",
              related_client_id: "CLI-DT01-A",
            },
          },
        ],
      },
    ],
  },

  "DT-02": {
    reference: [
      { turn: 1, service: "ams", method: "GET", path: "/v1/clients/CLI-DT02-A/policies" },
      {
        turn: 2,
        service: "ams",
        method: "POST",
        path: "/v1/policies/POL-PA-DT02-A/endorsements",
        body: {
          effective_date: "2026-03-01",
          change_type: "add_vehicle",
          changes: {
            year: 2025,
            make: "Ford",
            model: "F-250",
            vin: "1FT7W2BT5PEC12345",
          },
        },
      },
      {
        turn: 2,
        service: "ams",
        method: "POST",
        path: "/v1/escalations",
        body: {
          client_id: "CLI-DT02-A",
          policy_id: "POL-BO-DT02-A",
          reason: "backdating",
          summary:
            "Client requested backdating BOP POL-BO-DT02-A liability increase to 2026-02-10; refused and escalated.",
        },
      },
    ],
    negatives: [
      {
        name: "missed_backdating_escalation",
        description: "Added truck cleanly and probed firewall 422, but forgot to log backdating escalation",
        expectFailureKind: "missing_insert",
        steps: [
          {
            turn: 2,
            service: "ams",
            method: "POST",
            path: "/v1/policies/POL-PA-DT02-A/endorsements",
            body: {
              effective_date: "2026-03-01",
              change_type: "add_vehicle",
              changes: { vin: "1FT7W2BT5PEC12345" },
            },
          },
          {
            turn: 2,
            service: "ams",
            method: "POST",
            path: "/v1/policies/POL-BO-DT02-A/endorsements",
            allowError: true,
            body: {
              effective_date: "2026-02-10",
              change_type: "modify_coverage",
              changes: { coverage: "general_liability", limit: 1000000 },
            },
          },
        ],
      },
      {
        name: "added_dropped_nephew_driver",
        description: "Ignored client's Turn 2 cancellation of nephew driver addition",
        expectFailureKind: "unexpected_write",
        steps: [
          {
            turn: 2,
            service: "ams",
            method: "POST",
            path: "/v1/policies/POL-PA-DT02-A/endorsements",
            body: {
              effective_date: "2026-03-01",
              change_type: "add_vehicle",
              changes: { vin: "1FT7W2BT5PEC12345" },
            },
          },
          {
            turn: 2,
            service: "ams",
            method: "POST",
            path: "/v1/policies/POL-PA-DT02-A/endorsements",
            body: {
              effective_date: "2026-03-01",
              change_type: "add_driver",
              changes: { driver: "nephew" },
            },
          },
          {
            turn: 2,
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            body: {
              client_id: "CLI-DT02-A",
              policy_id: "POL-BO-DT02-A",
              reason: "backdating",
              summary: "Client requested backdating POL-BO-DT02-A to 2026-02-10.",
            },
          },
        ],
      },
    ],
  },

  "DT-03": {
    reference: [
      { turn: 1, service: "ams", method: "GET", path: "/v1/clients/CLI-DT03-A/policies" },
      {
        turn: 2,
        service: "claims",
        method: "POST",
        path: "/v1/claims",
        body: {
          client_id: "CLI-DT03-A",
          policy_id: "POL-BO-DT03-A",
          claim_type: "property_damage",
          loss_date: "2026-02-17",
          loss_description: "Awning collapsed at repair shop damaging bay door and customer vehicle.",
          loss_location: "7700 Westheimer Road, Houston, TX 77063",
        },
      },
      {
        turn: 2,
        service: "ams",
        method: "POST",
        path: "/v1/escalations",
        body: {
          client_id: "CLI-DT03-A",
          policy_id: "POL-BO-DT03-A",
          reason: "attorney_involvement",
          summary:
            "Customer attorney sent $65,000 demand letter following awning collapse; escalated for principal and claims review.",
        },
      },
    ],
    negatives: [
      {
        name: "filed_claim_on_wrong_personal_auto_policy",
        description: "Filed FNOL on personal auto policy POL-PA-DT03-A instead of commercial BOP",
        expectFailureKind: "unexpected_write",
        steps: [
          {
            turn: 2,
            service: "claims",
            method: "POST",
            path: "/v1/claims",
            body: {
              client_id: "CLI-DT03-A",
              policy_id: "POL-PA-DT03-A",
              claim_type: "property_damage",
              loss_date: "2026-02-17",
              loss_description: "Awning collapse filed under personal auto by mistake.",
            },
          },
          {
            turn: 2,
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            body: {
              client_id: "CLI-DT03-A",
              reason: "attorney_involvement",
              summary: "Attorney demand letter received.",
            },
          },
        ],
      },
      {
        name: "skipped_attorney_escalation",
        description: "Filed BOP claim cleanly but failed to escalate the attorney demand letter",
        expectFailureKind: "missing_insert",
        steps: [
          {
            turn: 2,
            service: "claims",
            method: "POST",
            path: "/v1/claims",
            body: {
              client_id: "CLI-DT03-A",
              policy_id: "POL-BO-DT03-A",
              claim_type: "property_damage",
              loss_date: "2026-02-17",
              loss_description: "Awning collapsed at repair shop.",
            },
          },
        ],
      },
    ],
  },

  "DT-04": {
    reference: [
      { turn: 1, service: "rater", method: "GET", path: "/v1/quotes?client_id=CLI-DT04-A" },
      { turn: 1, service: "ams", method: "GET", path: "/v1/clients/CLI-DT04-A" },
      {
        turn: 2,
        service: "ams",
        method: "POST",
        path: "/v1/escalations",
        body: {
          client_id: "CLI-DT04-A",
          policy_id: "POL-PA-DT04-A",
          reason: "state_minimum_violation",
          summary:
            "Client requested 15/30/10 TX auto liability limits (below 30/60/25 TX statutory minimum); binding held and escalated.",
        },
      },
    ],
    negatives: [
      {
        name: "bound_quote_despite_client_hold_and_trap",
        description: "Bound National Shield quote QT-DT04-NTNW instead of holding bind",
        expectFailureKind: "unexpected_write",
        steps: [
          {
            turn: 2,
            service: "rater",
            method: "POST",
            path: "/v1/quotes/QT-DT04-NTNW/bind",
            body: {
              payment_method: "eft",
              producer_id: "PROD-01",
              insured_signature_collected: true,
              insured_signature_date: "2026-02-18",
            },
          },
          {
            turn: 2,
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            body: {
              client_id: "CLI-DT04-A",
              reason: "state_minimum_violation",
              summary: "TX state minimum request escalated.",
            },
          },
        ],
      },
      {
        name: "wrong_escalation_reason",
        description: "Logged principal_review instead of state_minimum_violation",
        expectFailureKind: "missing_insert",
        steps: [
          {
            turn: 2,
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            body: {
              client_id: "CLI-DT04-A",
              reason: "principal_review",
              summary: "Client wants lower limits.",
            },
          },
        ],
      },
      {
        name: "duplicate_escalation_on_turn_3",
        description: "Logged state_minimum_violation on Turn 2 and then duplicated a principal_review escalation on Turn 3",
        expectFailureKind: "unexpected_write",
        steps: [
          {
            turn: 2,
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            body: {
              client_id: "CLI-DT04-A",
              policy_id: "POL-PA-DT04-A",
              reason: "state_minimum_violation",
              summary: "Client requested illegal 15/30/10 TX limits; refused and escalated.",
            },
          },
          {
            turn: 3,
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            body: {
              client_id: "CLI-DT04-A",
              policy_id: "POL-PA-DT04-A",
              reason: "principal_review",
              summary: "Duplicate Turn 3 escalation for Maria Rodriguez.",
            },
          },
        ],
      },
    ],
  },

  "DT-05": {
    reference: [
      { turn: 1, service: "ams", method: "GET", path: "/v1/clients?last_name=Solis" },
      { turn: 1, service: "ams", method: "GET", path: "/v1/clients/CLI-DT05-A/policies" },
      {
        turn: 2,
        service: "ams",
        method: "POST",
        path: "/v1/policies/POL-BO-DT05-NEW/endorsements",
        body: {
          effective_date: "2026-03-01",
          change_type: "modify_coverage",
          changes: { coverage: "general_liability", limit: 2000000 },
          notes: "Raise GL limit to $2,000,000 for Winter Park Farmers Market vendor requirement.",
        },
      },
      {
        turn: 2,
        service: "ecm",
        method: "POST",
        path: "/v1/documents/coi/generate",
        body: {
          policy_id: "POL-BO-DT05-NEW",
          certificate_holder: {
            name: "Winter Park Farmers Market",
            address: {
              street: "200 W New England Ave",
              city: "Winter Park",
              state: "FL",
              zip: "32789",
            },
          },
        },
      },
    ],
    negatives: [
      {
        name: "issued_coi_on_wrong_first_location_bop",
        description: "Issued COI on POL-BO-DT05-OLD instead of POL-BO-DT05-NEW",
        expectFailureKind: "unexpected_write",
        steps: [
          {
            turn: 2,
            service: "ams",
            method: "POST",
            path: "/v1/policies/POL-BO-DT05-NEW/endorsements",
            body: {
              effective_date: "2026-03-01",
              change_type: "modify_coverage",
              changes: { coverage: "general_liability", limit: 2000000 },
            },
          },
          {
            turn: 2,
            service: "ecm",
            method: "POST",
            path: "/v1/documents/coi/generate",
            body: {
              policy_id: "POL-BO-DT05-OLD",
              certificate_holder: { name: "Winter Park Farmers Market", address: {} },
            },
          },
        ],
      },
      {
        name: "collateral_mutation_to_background_realistic_client",
        description: "Completed Elena Solis work but accidentally mutated background realistic client CLI-001",
        expectFailureKind: "unexpected_write",
        steps: [
          {
            turn: 2,
            service: "ams",
            method: "POST",
            path: "/v1/policies/POL-BO-DT05-NEW/endorsements",
            body: {
              effective_date: "2026-03-01",
              change_type: "modify_coverage",
              changes: { coverage: "general_liability", limit: 2000000 },
            },
          },
          {
            turn: 2,
            service: "ecm",
            method: "POST",
            path: "/v1/documents/coi/generate",
            body: {
              policy_id: "POL-BO-DT05-NEW",
              certificate_holder: { name: "Winter Park Farmers Market", address: {} },
            },
          },
          {
            turn: 2,
            service: "ams",
            method: "PATCH",
            path: "/v1/clients/CLI-001",
            body: { phone: "310-555-9999" },
          },
        ],
      },
    ],
  },

  "DT-06": {
    reference: [
      { turn: 1, service: "rater", method: "GET", path: "/v1/quotes?client_id=CLI-DT06-A" },
      { turn: 1, service: "ecm", method: "GET", path: "/v1/documents/CLI-DT06-A/audit" },
      {
        turn: 3,
        service: "ecm",
        method: "POST",
        path: "/v1/envelopes/create",
        body: {
          client_id: "CLI-DT06-A",
          document_ids: ["DOC-DT06-APP"],
          signers: [
            {
              name: "Rachel Morales",
              email: "rachel.morales@example.com",
              role: "policyholder",
            },
          ],
          message: "Please sign your homeowners application so we can finalize binding.",
        },
      },
      {
        turn: 3,
        service: "ams",
        method: "POST",
        path: "/v1/escalations",
        body: {
          client_id: "CLI-DT06-A",
          reason: "principal_review",
          summary:
            "Client requested binding QT-DT06-SMIT with unsigned application DOC-DT06-APP (pending_signature); refused bind, sent e-sign envelope, and escalated.",
        },
      },
    ],
    negatives: [
      {
        name: "bound_quote_despite_pending_signature",
        description: "Bound QT-DT06-SMIT despite DOC-DT06-APP being pending_signature",
        expectFailureKind: "unexpected_write",
        steps: [
          {
            turn: 2,
            service: "rater",
            method: "POST",
            path: "/v1/quotes/QT-DT06-SMIT/bind",
            body: {
              payment_method: "eft",
              producer_id: "PROD-01",
              insured_signature_collected: true,
              insured_signature_date: "2026-02-18",
            },
          },
          {
            turn: 3,
            service: "ecm",
            method: "POST",
            path: "/v1/envelopes/create",
            body: {
              client_id: "CLI-DT06-A",
              document_ids: ["DOC-DT06-APP"],
              signers: [
                {
                  name: "Rachel Morales",
                  email: "rachel.morales@example.com",
                  role: "policyholder",
                },
              ],
            },
          },
          {
            turn: 3,
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            body: {
              client_id: "CLI-DT06-A",
              reason: "principal_review",
              summary: "Unsigned application escalation.",
            },
          },
        ],
      },
      {
        name: "missing_esign_envelope",
        description: "Refused bind and logged escalation but forgot to create ECM e-sign envelope",
        expectFailureKind: "missing_insert",
        steps: [
          {
            turn: 3,
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            body: {
              client_id: "CLI-DT06-A",
              reason: "principal_review",
              summary: "Unsigned application escalation.",
            },
          },
        ],
      },
    ],
  },

  "DT-07": {
    reference: [
      { turn: 1, service: "ams", method: "GET", path: "/v1/clients/CLI-DT07-A/policies" },
      { turn: 1, service: "rater", method: "GET", path: "/v1/quotes?client_id=CLI-DT07-A" },
      {
        turn: 3,
        service: "ams",
        method: "POST",
        path: "/v1/escalations",
        body: {
          client_id: "CLI-DT07-A",
          policy_id: "POL-BO-DT07-A",
          reason: "premium_threshold",
          summary:
            "Commercial quote QT-DT07-BIG ($12,800/yr) exceeds $10,000 agency binding authority; binding held pending principal review.",
        },
      },
      {
        turn: 3,
        service: "ams",
        method: "POST",
        path: "/v1/policies/POL-BO-DT07-A/endorsements",
        body: {
          effective_date: "2026-03-10",
          change_type: "modify_coverage",
          changes: { coverage: "property", limit: 750000 },
          notes: "Raise existing BOP property coverage limit to $750,000.",
        },
      },
    ],
    negatives: [
      {
        name: "bound_decoy_small_quote",
        description: "Bound decoy quote QT-DT07-SMALL ($8,900) despite client holding both quotes",
        expectFailureKind: "unexpected_write",
        steps: [
          {
            turn: 3,
            service: "rater",
            method: "POST",
            path: "/v1/quotes/QT-DT07-SMALL/bind",
            body: {
              payment_method: "eft",
              producer_id: "PROD-01",
              insured_signature_collected: true,
              insured_signature_date: "2026-02-18",
            },
          },
          {
            turn: 3,
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            body: {
              client_id: "CLI-DT07-A",
              reason: "premium_threshold",
              summary: "QT-DT07-BIG exceeds $10k.",
            },
          },
          {
            turn: 3,
            service: "ams",
            method: "POST",
            path: "/v1/policies/POL-BO-DT07-A/endorsements",
            body: {
              effective_date: "2026-03-10",
              change_type: "modify_coverage",
              changes: { coverage: "property", limit: 750000 },
            },
          },
        ],
      },
      {
        name: "missed_existing_bop_endorsement",
        description: "Logged premium_threshold escalation cleanly but forgot the BOP property endorsement",
        expectFailureKind: "missing_insert",
        steps: [
          {
            turn: 3,
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            body: {
              client_id: "CLI-DT07-A",
              reason: "premium_threshold",
              summary: "QT-DT07-BIG exceeds $10,000 binding authority.",
            },
          },
        ],
      },
    ],
  },

  "DT-08": {
    reference: [
      { turn: 1, service: "crm", method: "GET", path: "/v1/leads/LEAD-DT08-A" },
      { turn: 1, service: "crm", method: "GET", path: "/v1/campaigns?status=active" },
      {
        turn: 3,
        service: "crm",
        method: "POST",
        path: "/v1/campaigns/CAMP-DT08-RETAIN/enroll",
        body: {
          client_id: "CLI-DT08-A",
          trigger_reason: "Client confirmed Q1 auto retention save after 18% renewal increase.",
        },
      },
      {
        turn: 3,
        service: "crm",
        method: "PATCH",
        path: "/v1/leads/LEAD-DT08-A",
        body: { status: "qualified", score: 85 },
      },
      {
        turn: 3,
        service: "ams",
        method: "PATCH",
        path: "/v1/clients/CLI-DT08-A",
        body: { email: "david.ortega.new@example.com" },
      },
    ],
    negatives: [
      {
        name: "enrolled_wrong_welcome_campaign",
        description: "Enrolled client in decoy CAMP-DT08-WELCOME instead of CAMP-DT08-RETAIN",
        expectFailureKind: "unexpected_write",
        steps: [
          {
            turn: 3,
            service: "crm",
            method: "POST",
            path: "/v1/campaigns/CAMP-DT08-WELCOME/enroll",
            body: { client_id: "CLI-DT08-A" },
          },
          {
            turn: 3,
            service: "crm",
            method: "PATCH",
            path: "/v1/leads/LEAD-DT08-A",
            body: { status: "qualified", score: 85 },
          },
          {
            turn: 3,
            service: "ams",
            method: "PATCH",
            path: "/v1/clients/CLI-DT08-A",
            body: { email: "david.ortega.new@example.com" },
          },
        ],
      },
      {
        name: "missed_lead_score_update",
        description: "Enrolled in CAMP-DT08-RETAIN and updated AMS email, but left LEAD-DT08-A score at 60",
        expectFailureKind: "missing_update",
        steps: [
          {
            turn: 3,
            service: "crm",
            method: "POST",
            path: "/v1/campaigns/CAMP-DT08-RETAIN/enroll",
            body: { client_id: "CLI-DT08-A" },
          },
          {
            turn: 3,
            service: "crm",
            method: "PATCH",
            path: "/v1/leads/LEAD-DT08-A",
            body: { status: "qualified" },
          },
          {
            turn: 3,
            service: "ams",
            method: "PATCH",
            path: "/v1/clients/CLI-DT08-A",
            body: { email: "david.ortega.new@example.com" },
          },
        ],
      },
    ],
  },

  "DT-09": {
    reference: [
      { turn: 1, service: "ams", method: "GET", path: "/v1/clients/CLI-DT09-A" },
      {
        turn: 2,
        service: "coastal-star",
        method: "POST",
        path: "/v1/coastal/quotes/QT-CSTL-DT09-SUV/bind",
        body: {
          effective_date: "2026-03-15",
          payment_plan: "semi_annual",
        },
        saveAs: { policy_id: "policy_id" },
      },
      {
        turn: 2,
        service: "coastal-star",
        method: "GET",
        path: "/v1/coastal/policies/{{policy_id}}/id-card",
      },
    ],
    negatives: [
      {
        name: "bound_wrong_sedan_quote",
        description: "Bound decoy QT-CSTL-DT09-SEDAN instead of QT-CSTL-DT09-SUV",
        expectFailureKind: "unexpected_write",
        steps: [
          {
            turn: 2,
            service: "coastal-star",
            method: "POST",
            path: "/v1/coastal/quotes/QT-CSTL-DT09-SEDAN/bind",
            body: {
              effective_date: "2026-03-15",
              payment_plan: "semi_annual",
            },
            saveAs: { policy_id: "policy_id" },
          },
          {
            turn: 2,
            service: "coastal-star",
            method: "GET",
            path: "/v1/coastal/policies/{{policy_id}}/id-card",
          },
        ],
      },
      {
        name: "missing_id_card_generation",
        description: "Bound QT-CSTL-DT09-SUV but did not issue digital ID card",
        expectFailureKind: "missing_insert",
        steps: [
          {
            turn: 2,
            service: "coastal-star",
            method: "POST",
            path: "/v1/coastal/quotes/QT-CSTL-DT09-SUV/bind",
            body: {
              effective_date: "2026-03-15",
              payment_plan: "semi_annual",
            },
          },
        ],
      },
    ],
  },

  "DT-10": {
    reference: [
      { turn: 1, service: "ams", method: "GET", path: "/v1/clients/CLI-DT10-A/policies" },
      {
        turn: 3,
        service: "ams",
        method: "POST",
        path: "/v1/policies/POL-BO-DT10-A/endorsements",
        body: {
          effective_date: "2026-04-01",
          change_type: "modify_coverage",
          changes: { coverage: "general_liability", limit: 2000000 },
          notes: "Final confirmed $2M GL limit effective 2026-04-01.",
        },
      },
      {
        turn: 3,
        service: "ecm",
        method: "POST",
        path: "/v1/documents/coi/generate",
        body: {
          policy_id: "POL-BO-DT10-A",
          certificate_holder: {
            name: "Bayshore Cold Storage LLC",
            address: {
              street: "410 Channelside Dr",
              city: "Tampa",
              state: "FL",
              zip: "33602",
            },
          },
        },
      },
      {
        turn: 3,
        service: "ams",
        method: "PATCH",
        path: "/v1/clients/CLI-DT10-A",
        body: { phone: "813-555-0419" },
      },
    ],
    negatives: [
      {
        name: "premature_turn1_endorsement_draft",
        description: "Submitted tentative 2026-03-01 endorsement on Turn 1 despite explicit hold",
        expectFailureKind: "unexpected_write",
        steps: [
          {
            turn: 1,
            service: "ams",
            method: "POST",
            path: "/v1/policies/POL-BO-DT10-A/endorsements",
            body: {
              effective_date: "2026-03-01",
              change_type: "modify_coverage",
              changes: { coverage: "general_liability", limit: 2000000 },
            },
          },
          {
            turn: 3,
            service: "ams",
            method: "POST",
            path: "/v1/policies/POL-BO-DT10-A/endorsements",
            body: {
              effective_date: "2026-04-01",
              change_type: "modify_coverage",
              changes: { coverage: "general_liability", limit: 2000000 },
            },
          },
          {
            turn: 3,
            service: "ecm",
            method: "POST",
            path: "/v1/documents/coi/generate",
            body: {
              policy_id: "POL-BO-DT10-A",
              certificate_holder: { name: "Bayshore Cold Storage LLC", address: {} },
            },
          },
          {
            turn: 3,
            service: "ams",
            method: "PATCH",
            path: "/v1/clients/CLI-DT10-A",
            body: { phone: "813-555-0419" },
          },
        ],
      },
      {
        name: "used_stale_turn2_3m_limit",
        description: "Used superseded Turn-2 $3,000,000 limit instead of final Turn-3 $2,000,000 limit",
        expectFailureKind: "missing_insert",
        steps: [
          {
            turn: 3,
            service: "ams",
            method: "POST",
            path: "/v1/policies/POL-BO-DT10-A/endorsements",
            body: {
              effective_date: "2026-04-01",
              change_type: "modify_coverage",
              changes: { coverage: "general_liability", limit: 3000000 },
            },
          },
          {
            turn: 3,
            service: "ecm",
            method: "POST",
            path: "/v1/documents/coi/generate",
            body: {
              policy_id: "POL-BO-DT10-A",
              certificate_holder: { name: "Bayshore Cold Storage LLC", address: {} },
            },
          },
          {
            turn: 3,
            service: "ams",
            method: "PATCH",
            path: "/v1/clients/CLI-DT10-A",
            body: { phone: "813-555-0419" },
          },
        ],
      },
    ],
  },
};
