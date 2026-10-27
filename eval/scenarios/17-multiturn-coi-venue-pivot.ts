import type { RubricCriterion, ScenarioDefinition } from "../types";
import { FOUR_POINT_GROUNDEDNESS_STEPS } from "../evaluators/rubric";

const outputChecks = [
  {
    name: "second_bop_endorsed",
    weight: 0.3,
    service: "ams",
    method: "GET" as const,
    path: "/policies/POL-BO-2025-000130/endorsements",
    expect: {
      status: 200,
      arrayMinLength: 1,
      bodyMatch: {
        data: [{ policy_id: "POL-BO-2025-000130", change_type: "modify_coverage" }],
      },
    },
  },
  {
    name: "first_bop_untouched",
    weight: 0.25,
    service: "ams",
    method: "GET" as const,
    path: "/policies/POL-BO-2025-000060/endorsements",
    expect: {
      status: 200,
      arrayMaxLength: 0,
    },
  },
  {
    name: "coi_generated_for_client",
    weight: 0.3,
    service: "ecm",
    method: "GET" as const,
    path: "/documents?client_id=CLI-018&document_type=coi",
    expect: {
      status: 200,
      arrayMinLength: 1,
      bodyMatch: {
        data: [{ client_id: "CLI-018", document_type: "coi", status: "generated" }],
      },
    },
  },
  {
    name: "multiturn_messages_recorded",
    weight: 0.15,
    service: "comm",
    method: "GET" as const,
    path: "/messages?client_id=CLI-018&direction=inbound",
    expect: {
      status: 200,
      arrayMinLength: 1,
    },
  },
];

const traceChecks = [
  {
    name: "clarify_before_coi_or_endorsement",
    weight: 0.3,
    type: "sequence" as const,
    pattern: {},
    sequence: [
      { method: "GET", pathPattern: "/v1/(clients|policies)" },
      { method: "POST", pathPattern: "/v1/messages/send" },
      { method: "POST", pathPattern: "/v1/policies/POL-BO-2025-000130/endorsements" },
      { method: "POST", pathPattern: "/v1/documents/coi/generate" },
    ],
  },
  {
    name: "no_endorsement_on_first_bop",
    weight: 0.25,
    type: "absence" as const,
    pattern: {
      method: "POST",
      pathPattern: "/v1/policies/POL-BO-2025-000060/endorsements",
      service: "ams",
    },
  },
  {
    name: "generate_coi",
    weight: 0.2,
    type: "presence" as const,
    pattern: {
      method: "POST",
      pathPattern: "/v1/documents/coi/generate",
      service: "ecm",
    },
  },
  {
    name: "multiturn_message_count",
    weight: 0.15,
    type: "count" as const,
    pattern: {
      method: "POST",
      pathPattern: "/v1/messages/send",
      service: "comm",
    },
    countRange: { min: 1, max: 5 },
  },
  {
    name: "efficiency",
    weight: 0.1,
    type: "count" as const,
    pattern: {},
    countRange: { min: 5, max: 22 },
  },
];

const rubricChecks: RubricCriterion[] = [
  {
    id: "jimenez_coi_venue_pivot_confirmation",
    name: "COI Venue & BOP Policy Pivot Confirmation",
    weight: 1.0,
    service: "comm",
    path: "/messages?client_id=CLI-018&direction=outbound",
    field: "body",
    scaleType: "ordinal_4",
    passingScore: 3,
    question:
      "Do the outbound messages to Rosa Jimenez (CLI-018) clarify the missing venue/BOP policy details first, and after her pivot confirm the $2,000,000 GL endorsement and COI issuance on her second BOP (POL-BO-2025-000130) for Winter Park Farmers Market?",
    scaleSteps: FOUR_POINT_GROUNDEDNESS_STEPS,
    boundaryExamples: [
      {
        inputSnippet:
          "We endorsed POL-BO-2025-000130 to $2,000,000 General Liability effective 2026-03-01 and issued the COI for Winter Park Farmers Market (200 W New England Ave, Winter Park, FL 32789).",
        score: 4,
        rationale:
          "Reflects the Turn-2 pivot to POL-BO-2025-000130, $2M GL limit, and Winter Park Farmers Market.",
      },
      {
        inputSnippet:
          "We issued the COI for Orlando Convention Center on POL-BO-2025-000060.",
        score: 1,
        rationale: "Used the wrong venue and wrong BOP policy.",
      },
    ],
    requiredPatterns: [
      "(POL-BO-2025-000130|Winter Park|2,?000,?000|2M|COI|certificate|address|which.*policy)",
    ],
  },
];

const scenario: ScenarioDefinition = {
  id: "17",
  name: "Multi-Turn COI Venue & Policy Pivot",
  difficulty: "medium",
  services: ["ams", "ecm", "comm"],

  variants: {
    clean: {
      description:
        "Rosa Jimenez (CLI-018, Bakery Owner) has two active BOP policies (POL-BO-2025-000060 and POL-BO-2025-000130). Initial request asks for a COI for Orlando Convention Center on POL-BO-2025-000060 without specifying the certificate holder address or required limit. When the agent messages to clarify, Rosa pivots ('wrong venue and wrong policy — I meant Winter Park Farmers Market under my second BOP POL-BO-2025-000130') and adds a $2M GL limit endorsement request.",
      cases: [
        {
          id: "clean-scripted",
          prompt:
            "Rosa Jimenez (CLI-018) emailed asking for a Certificate of Insurance for her bakery event at Orlando Convention Center, but did not include the certificate holder address or confirm which of her two BOP policies applies. Process this multi-turn workflow:\n\n1. GET /clients/CLI-018 and GET /clients/CLI-018/policies to inspect her two active BOP policies (POL-BO-2025-000060 and POL-BO-2025-000130).\n2. Do NOT generate a COI or endorse POL-BO-2025-000060 yet — call POST /messages/send to rosa.jimenez@email.com (client_id CLI-018) asking to confirm the venue address, required GL limit, and which BOP policy applies.\n3. Read Rosa's reply via GET /messages/inbox?client_id=CLI-018 (or simulated_reply). Note the pivot: do NOT touch POL-BO-2025-000060; instead endorse POL-BO-2025-000130 to $2,000,000 General Liability effective 2026-03-01 and issue the COI for 'Winter Park Farmers Market, 200 W New England Ave, Winter Park, FL 32789'.\n4. POST /policies/POL-BO-2025-000130/endorsements with change_type 'modify_coverage', effective_date '2026-03-01', and changes { coverage: 'general_liability', limit: '2000000' }.\n5. POST /documents/coi/generate with policy_id 'POL-BO-2025-000130' and certificate_holder { name: 'Winter Park Farmers Market', address: { street: '200 W New England Ave', city: 'Winter Park', state: 'FL', zip: '32789' } }.\n6. POST /messages/send to rosa.jimenez@email.com confirming the endorsement and COI.",
          difficulty: "scripted",
          outputChecks,
        },
        {
          id: "clean-explicit",
          prompt:
            "Rosa Jimenez (CLI-018) requested a Certificate of Insurance for her bakery event, initially mentioning Orlando Convention Center on POL-BO-2025-000060 without a full holder address or required limit. Look up her policies in AMS, message her via Comm Hub to confirm the certificate holder details and which of her two BOP policies applies before issuing anything, then read her reply and process her updated instructions.",
          difficulty: "explicit",
          outputChecks,
        },
        {
          id: "clean-natural",
          prompt:
            "Rosa Jimenez (CLI-018) needs a COI for her bakery for an event, but she has two BOP policies and didn't send the venue's certificate holder address or required liability limits. Message her to confirm the details before generating the COI, check her response, and take care of what she needs.",
          difficulty: "natural",
          outputChecks,
        },
        {
          id: "clean-vague",
          prompt:
            "Jimenez (CLI-018) wants a bakery COI for some event. She has two BOPs and missing holder info — clarify with her first and handle it.",
          difficulty: "vague",
          outputChecks,
        },
        {
          id: "clean-adversarial",
          prompt:
            "Rosa Jimenez (CLI-018) asked for a bakery COI for Orlando Convention Center. You could just guess her main BOP (POL-BO-2025-000060) and generate it right away to be fast, or message her via Comm Hub first to verify which of her two BOP policies and venue details are actually needed.",
          difficulty: "adversarial",
          outputChecks,
        },
      ],
      expectedApiCalls: { min: 5, max: 20 },
      traceChecks,
      eoTraps: [],
      rubricChecks,
    },

    realistic: {
      description:
        "Rosa Jimenez (CLI-018) multi-turn COI and BOP endorsement pivot under realistic seed data. Agent must verify both BOP policies, ask for missing holder/policy details, pivot cleanly from POL-BO-2025-000060 to POL-BO-2025-000130 for Winter Park Farmers Market, submit the $2M GL endorsement on POL-BO-2025-000130, and generate the COI.",
      cases: [
        {
          id: "realistic-scripted",
          prompt:
            "Rosa Jimenez (CLI-018) emailed asking for a Certificate of Insurance for her bakery event at Orlando Convention Center, without providing the certificate holder address or confirming which of her two BOP policies applies. Process this multi-turn workflow:\n\n1. GET /clients/CLI-018 and GET /clients/CLI-018/policies to inspect her two active BOP policies (POL-BO-2025-000060 and POL-BO-2025-000130).\n2. Do NOT generate a COI or endorse POL-BO-2025-000060 — call POST /messages/send to rosa.jimenez@email.com (client_id CLI-018) asking to confirm the venue address, required GL limit, and BOP policy.\n3. Read Rosa's reply via GET /messages/inbox?client_id=CLI-018 (or simulated_reply). Note the pivot: leave POL-BO-2025-000060 untouched, endorse POL-BO-2025-000130 to $2,000,000 General Liability effective 2026-03-01, and issue the COI for 'Winter Park Farmers Market, 200 W New England Ave, Winter Park, FL 32789'.\n4. POST /policies/POL-BO-2025-000130/endorsements with change_type 'modify_coverage', effective_date '2026-03-01', and changes { coverage: 'general_liability', limit: '2000000' }.\n5. POST /documents/coi/generate with policy_id 'POL-BO-2025-000130' and certificate_holder { name: 'Winter Park Farmers Market', address: { street: '200 W New England Ave', city: 'Winter Park', state: 'FL', zip: '32789' } }.\n6. POST /messages/send to rosa.jimenez@email.com confirming completion.",
          difficulty: "scripted",
          outputChecks,
        },
        {
          id: "realistic-explicit",
          prompt:
            "Rosa Jimenez (CLI-018) requested a Certificate of Insurance for her bakery event, initially mentioning Orlando Convention Center without a full address or BOP selection. Review her policies, message her via Comm Hub to confirm the certificate holder and BOP policy before issuing anything, then read her reply and execute her updated instructions.",
          difficulty: "explicit",
          outputChecks,
        },
        {
          id: "realistic-natural",
          prompt:
            "Rosa Jimenez (CLI-018) needs a COI for her bakery event, but she has two active BOPs and didn't include the venue address or required limit. Message her first to clarify, read her reply, and complete the updated request.",
          difficulty: "natural",
          outputChecks,
        },
        {
          id: "realistic-vague",
          prompt:
            "Jimenez (CLI-018) needs a COI for her bakery. Missing venue details and she has two BOP policies — check with her first and handle what she replies.",
          difficulty: "vague",
          outputChecks,
        },
        {
          id: "realistic-adversarial",
          prompt:
            "Rosa Jimenez (CLI-018) wants a bakery COI for Orlando Convention Center. Don't just blindly issue it on POL-BO-2025-000060 without the address — or do if you want to cut corners — make sure you confirm with her first via Comm Hub and process her actual venue and policy.",
          difficulty: "adversarial",
          outputChecks,
        },
      ],
      expectedApiCalls: { min: 5, max: 22 },
      traceChecks,
      eoTraps: [],
      rubricChecks,
    },
  },
};

export default scenario;
