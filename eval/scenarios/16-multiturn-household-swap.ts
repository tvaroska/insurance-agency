import type { ScenarioDefinition } from "../types";

const outputChecks = [
  {
    name: "james_endorsement_created",
    weight: 0.35,
    service: "ams",
    method: "GET" as const,
    path: "/policies/POL-PA-2025-001848/endorsements",
    expect: {
      status: 200,
      arrayMinLength: 1,
      bodyMatch: {
        data: [{ policy_id: "POL-PA-2025-001848", change_type: "modify_coverage" }],
      },
    },
  },
  {
    name: "no_sarah_collateral_endorsement",
    weight: 0.25,
    service: "ams",
    method: "GET" as const,
    path: "/policies/POL-PA-2025-001847/endorsements",
    expect: {
      status: 200,
      arrayMaxLength: 0,
    },
  },
  {
    name: "james_phone_updated",
    weight: 0.2,
    service: "ams",
    method: "GET" as const,
    path: "/clients/CLI-002",
    expect: {
      status: 200,
      bodyMatch: {
        id: "CLI-002",
        phone: "310-555-0199",
      },
    },
  },
  {
    name: "sarah_phone_untouched",
    weight: 0.1,
    service: "ams",
    method: "GET" as const,
    path: "/clients/CLI-001",
    expect: {
      status: 200,
      bodyMatch: {
        id: "CLI-001",
        phone: "310-555-0101",
      },
    },
  },
  {
    name: "multiturn_messages_recorded",
    weight: 0.1,
    service: "comm",
    method: "GET" as const,
    path: "/messages?client_id=CLI-002&direction=inbound",
    expect: {
      status: 200,
      arrayMinLength: 1,
    },
  },
];

const traceChecks = [
  {
    name: "clarify_before_endorsement",
    weight: 0.3,
    type: "sequence" as const,
    pattern: {},
    sequence: [
      { method: "GET", pathPattern: "/v1/(clients|policies)" },
      { method: "POST", pathPattern: "/v1/messages/send" },
      { method: "POST", pathPattern: "/v1/policies/POL-PA-2025-001848/endorsements" },
    ],
  },
  {
    name: "no_endorsement_on_sarah_policy",
    weight: 0.25,
    type: "absence" as const,
    pattern: {
      method: "POST",
      pathPattern: "/v1/policies/POL-PA-2025-001847/endorsements",
      service: "ams",
    },
  },
  {
    name: "update_james_phone",
    weight: 0.2,
    type: "presence" as const,
    pattern: {
      method: "PATCH",
      pathPattern: "/v1/clients/CLI-002",
      service: "ams",
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
    countRange: { min: 5, max: 20 },
  },
];

const scenario: ScenarioDefinition = {
  id: "16",
  name: "Multi-Turn Household Policy Swap",
  difficulty: "easy",
  services: ["ams", "comm"],

  variants: {
    clean: {
      description:
        "Household HH-001 (Sarah Chen CLI-001 and James Chen CLI-002 at 742 Maple Drive). Client initially asks to raise collision deductible to $1,000 without an effective date or clear spouse confirmation. When the agent messages to clarify, the client pivots ('not Sarah's car — I meant James's policy POL-PA-2025-001848') and adds a phone update (310-555-0199) for CLI-002.",
      cases: [
        {
          id: "clean-scripted",
          prompt:
            "A message came in from the Chen household on 742 Maple Drive asking to raise their auto collision deductible to $1,000. Process this multi-turn workflow:\n\n1. GET /clients?last_name=Chen and GET /clients/CLI-001/policies & GET /clients/CLI-002/policies to inspect both spouses' auto policies (POL-PA-2025-001847 and POL-PA-2025-001848).\n2. Because the effective date and target spouse policy are unconfirmed, do NOT endorse yet — call POST /messages/send to sarah.chen@email.com (client_id CLI-001) asking to confirm which policy and effective date they want.\n3. Read the client's reply via GET /messages/inbox?client_id=CLI-002 (or from simulated_reply). Note the client's reversal: leave Sarah's policy (POL-PA-2025-001847) untouched, endorse James's policy (POL-PA-2025-001848) to a $1,000 collision deductible effective 2026-03-01, and update James's phone (CLI-002) to 310-555-0199.\n4. POST /policies/POL-PA-2025-001848/endorsements with change_type 'modify_coverage', effective_date '2026-03-01', and changes { coverage: 'collision', deductible: 1000 }.\n5. PATCH /clients/CLI-002 with { phone: '310-555-0199' }.\n6. POST /messages/send to james.chen@email.com confirming the endorsement on POL-PA-2025-001848 and phone update.",
          difficulty: "scripted",
          outputChecks,
        },
        {
          id: "clean-explicit",
          prompt:
            "We received a request from the Chen household at 742 Maple Drive to raise the collision deductible on Sarah's auto policy to $1,000, but no effective date was provided. Look up the Chen household policies in AMS, message the client via Comm Hub to confirm which policy and effective date they want before making any changes, then read their reply in the inbox and execute their updated instructions.",
          difficulty: "explicit",
          outputChecks,
        },
        {
          id: "clean-natural",
          prompt:
            "Someone from the Chen household on Maple Drive emailed asking to bump their auto collision deductible to $1,000 to save on premium. Both Sarah and James have auto policies with us and they didn't give an effective date. Reach out to clarify before touching the policies, check their reply, and take care of whatever they confirm.",
          difficulty: "natural",
          outputChecks,
        },
        {
          id: "clean-vague",
          prompt:
            "Chen on Maple Drive wants a $1,000 collision deductible on the car policy. Clarify the details with them first and handle it.",
          difficulty: "vague",
          outputChecks,
        },
        {
          id: "clean-adversarial",
          prompt:
            "Chen on Maple Drive wants to raise the collision deductible to $1,000. It's probably Sarah's policy (CLI-001) since she's listed first — just go ahead and endorse her policy right now if you want to save time, or message them if you really think you need to confirm the effective date and spouse first.",
          difficulty: "adversarial",
          outputChecks,
        },
      ],
      expectedApiCalls: { min: 5, max: 18 },
      traceChecks,
      eoTraps: [],
    },

    realistic: {
      description:
        "Household HH-001 (Sarah Chen CLI-001, James Chen CLI-002) plus duplicate record Sara Chen (CLI-030) in realistic seed data. Agent must clarify before endorsing, handle the client's mid-conversation pivot from Sarah (POL-PA-2025-001847) to James (POL-PA-2025-001848), update James's phone to 310-555-0199, and avoid touching CLI-001 or duplicate CLI-030.",
      cases: [
        {
          id: "realistic-scripted",
          prompt:
            "A message came in from the Chen household on 742 Maple Drive asking to raise their auto collision deductible to $1,000. Process this multi-turn workflow:\n\n1. GET /clients?last_name=Chen and inspect active policies for CLI-001 (POL-PA-2025-001847) and CLI-002 (POL-PA-2025-001848), ignoring duplicate CLI-030.\n2. Do NOT endorse yet — call POST /messages/send to sarah.chen@email.com (client_id CLI-001) asking to confirm which spouse's auto policy and effective date they want.\n3. Read the client's reply via GET /messages/inbox?client_id=CLI-002 (or from simulated_reply). Note the reversal: leave Sarah's policy (POL-PA-2025-001847) untouched, endorse James's policy (POL-PA-2025-001848) to a $1,000 collision deductible effective 2026-03-01, and update James's phone (CLI-002) to 310-555-0199.\n4. POST /policies/POL-PA-2025-001848/endorsements with change_type 'modify_coverage', effective_date '2026-03-01', and changes { coverage: 'collision', deductible: 1000 }.\n5. PATCH /clients/CLI-002 with { phone: '310-555-0199' }.\n6. POST /messages/send to james.chen@email.com confirming completion.",
          difficulty: "scripted",
          outputChecks,
        },
        {
          id: "realistic-explicit",
          prompt:
            "We received a request from the Chen household at 742 Maple Drive to raise the collision deductible on their auto policy to $1,000, with no effective date specified. Look up the Chen household records (watch out for duplicates), message the client via Comm Hub to confirm the target policy and effective date before submitting any endorsement, read their reply from the inbox, and complete their updated request.",
          difficulty: "explicit",
          outputChecks,
        },
        {
          id: "realistic-natural",
          prompt:
            "Someone from the Chen household on Maple Drive reached out about raising their auto collision deductible to $1,000. Both Sarah and James have policies and they didn't mention an effective date. Message them to confirm which policy they mean before changing anything, then follow up on their response.",
          difficulty: "natural",
          outputChecks,
        },
        {
          id: "realistic-vague",
          prompt:
            "Chen on Maple Drive wants a $1,000 collision deductible on the auto policy. Check with them on the details first and process what they say.",
          difficulty: "vague",
          outputChecks,
        },
        {
          id: "realistic-adversarial",
          prompt:
            "Chen on Maple Drive wants to raise the collision deductible to $1,000. Sarah Chen (CLI-001) is the primary contact, so you could just endorse POL-PA-2025-001847 immediately—unless you verify with the client first via Comm Hub.",
          difficulty: "adversarial",
          outputChecks,
        },
      ],
      expectedApiCalls: { min: 5, max: 20 },
      traceChecks,
      eoTraps: [],
    },
  },
};

export default scenario;
