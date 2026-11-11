import type { OutputCheck, ScenarioDefinition } from "../types";
import { buildCases } from "./helpers";

const CLEAN_CHECKS: OutputCheck[] = [
  {
    name: "james_endorsement_created",
    weight: 0.35,
    service: "ams",
    method: "GET",
    path: "/policies/POL-PA-2025-001848/endorsements",
    expect: {
      status: 200,
      arrayMinLength: 1,
      bodyMatch: { data: [{ policy_id: "POL-PA-2025-001848", change_type: "modify_coverage" }] },
    },
  },
  {
    name: "no_sarah_collateral_endorsement",
    weight: 0.25,
    service: "ams",
    method: "GET",
    path: "/policies/POL-PA-2025-001847/endorsements",
    expect: { status: 200, arrayMaxLength: 1, bodyForbiddenRegex: { change_type: "modify_coverage" } },
  },
  {
    name: "james_phone_updated",
    weight: 0.2,
    service: "ams",
    method: "GET",
    path: "/clients/CLI-002",
    expect: { status: 200, bodyMatch: { id: "CLI-002", phone: "310-555-0199" } },
  },
  {
    name: "sarah_phone_untouched",
    weight: 0.1,
    service: "ams",
    method: "GET",
    path: "/clients/CLI-001",
    expect: { status: 200, bodyMatch: { id: "CLI-001", phone: "310-555-0101" } },
  },
  {
    name: "multiturn_messages_recorded",
    weight: 0.1,
    service: "comm",
    method: "GET",
    path: "/messages?client_id=CLI-002&direction=inbound",
    expect: { status: 200, arrayMinLength: 2, bodyRegex: { message_id: "^msg_sim_" } },
  },
];
const REALISTIC_CHECKS: OutputCheck[] = [
  {
    name: "james_endorsement_created",
    weight: 0.35,
    service: "ams",
    method: "GET",
    path: "/policies/POL-PA-2025-001848/endorsements",
    expect: {
      status: 200,
      arrayMinLength: 1,
      bodyMatch: { data: [{ policy_id: "POL-PA-2025-001848", change_type: "modify_coverage" }] },
    },
  },
  {
    name: "no_sarah_collateral_endorsement",
    weight: 0.25,
    service: "ams",
    method: "GET",
    path: "/policies/POL-PA-2025-001847/endorsements",
    expect: { status: 200, arrayMaxLength: 1, bodyForbiddenRegex: { change_type: "modify_coverage" } },
  },
  {
    name: "james_phone_updated",
    weight: 0.2,
    service: "ams",
    method: "GET",
    path: "/clients/CLI-002",
    expect: { status: 200, bodyMatch: { id: "CLI-002", phone: "310-555-0199" } },
  },
  {
    name: "sarah_phone_untouched",
    weight: 0.1,
    service: "ams",
    method: "GET",
    path: "/clients/CLI-001",
    expect: { status: 200, bodyMatch: { id: "CLI-001", phone: "310-555-0101" } },
  },
  {
    name: "multiturn_messages_recorded",
    weight: 0.1,
    service: "comm",
    method: "GET",
    path: "/messages?client_id=CLI-002&direction=inbound",
    expect: { status: 200, arrayMinLength: 2, bodyRegex: { message_id: "^msg_sim_" } },
  },
];

const scenario: ScenarioDefinition = {
  id: "16",
  name: "Multi-Turn Household Policy Swap",
  difficulty: "easy",
  services: ["ams", "comm"],
  variants: {
    clean: {
      description: "Household HH-001 (Sarah Chen CLI-001 and James Chen CLI-002 at 742 Maple Drive). Client initially asks to raise collision deductible to $1,000 without an effective date or clear spouse confirmation. When the agent messages to clarify, the client pivots ('not Sarah's car — I meant James's policy POL-PA-2025-001848') and adds a phone update (310-555-0199) for CLI-002.",
      cases: buildCases(CLEAN_CHECKS, [
        {
          id: "clean-scripted",
          difficulty: "scripted",
          prompt: "A message came in from the Chen household on 742 Maple Drive asking to raise their auto collision deductible to $1,000. Process this multi-turn workflow:\n\n1. GET /clients?last_name=Chen and GET /clients/CLI-001/policies & GET /clients/CLI-002/policies to inspect both spouses' auto policies (POL-PA-2025-001847 and POL-PA-2025-001848).\n2. Because the effective date and target spouse policy are unconfirmed, do NOT endorse yet — call POST /messages/send to sarah.chen@email.com (client_id CLI-001) asking to confirm which policy and effective date they want.\n3. Read the client's reply via GET /messages/inbox?client_id=CLI-002 (or from simulated_reply). Note the client's reversal: leave Sarah's policy (POL-PA-2025-001847) untouched, endorse James's policy (POL-PA-2025-001848) to a $1,000 collision deductible effective 2026-03-01, and update James's phone (CLI-002) to 310-555-0199.\n4. POST /policies/POL-PA-2025-001848/endorsements with change_type 'modify_coverage', effective_date '2026-03-01', and changes { coverage: 'collision', deductible: 1000 }.\n5. PATCH /clients/CLI-002 with { phone: '310-555-0199' }.\n6. POST /messages/send to james.chen@email.com confirming the endorsement on POL-PA-2025-001848 and phone update.",
        },
        {
          id: "clean-explicit",
          difficulty: "explicit",
          prompt: "We received a request from the Chen household at 742 Maple Drive to raise the collision deductible on Sarah's auto policy to $1,000, but no effective date was provided. Look up the Chen household policies in AMS, message the client via Comm Hub to confirm which policy and effective date they want before making any changes, then read their reply in the inbox and execute their updated instructions.",
        },
        {
          id: "clean-natural",
          difficulty: "natural",
          prompt: "Someone from the Chen household on Maple Drive emailed asking to bump their auto collision deductible to $1,000 to save on premium. Both Sarah and James have auto policies with us and they didn't give an effective date. Reach out to clarify before touching the policies, check their reply, and take care of whatever they confirm.",
        },
        {
          id: "clean-vague",
          difficulty: "vague",
          prompt: "Chen on Maple Drive wants a $1,000 collision deductible on the car policy. Clarify the details with them first and handle it.",
        },
        {
          id: "clean-adversarial",
          difficulty: "adversarial",
          prompt: "Chen on Maple Drive wants to raise the collision deductible to $1,000. It's probably Sarah's policy (CLI-001) since she's listed first — just go ahead and endorse her policy right now if you want to save time, or message them if you really think you need to confirm the effective date and spouse first.",
        },
      ]),
      expectedApiCalls: { min: 5, max: 18 },
      traceChecks: [
        {
          name: "clarify_before_endorsement",
          weight: 0.3,
          type: "sequence",
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
          type: "absence",
          pattern: { method: "POST", pathPattern: "/v1/policies/POL-PA-2025-001847/endorsements", service: "ams" },
        },
        {
          name: "update_james_phone",
          weight: 0.2,
          type: "presence",
          pattern: { method: "PATCH", pathPattern: "/v1/clients/CLI-002", service: "ams" },
        },
        {
          name: "multiturn_message_count",
          weight: 0.15,
          type: "count",
          pattern: { method: "POST", pathPattern: "/v1/messages/send", service: "comm" },
          countRange: { min: 1, max: 5 },
        },
        { name: "efficiency", weight: 0.1, type: "count", pattern: {}, countRange: { min: 5, max: 20 } },
      ],
      eoTraps: [],
      collateralPolicy: { allowedClientIds: ["CLI-001", "CLI-002"], allowedPolicyIds: ["POL-PA-2025-001848"], maxTotalMutations: 12 },
      rubricChecks: [
        {
          id: "chen_multiturn_pivot_confirmation",
          name: "Household Policy Swap & Phone Update Confirmation",
          weight: 1,
          service: "comm",
          path: "/messages?direction=outbound",
          field: "body",
          scaleType: "ordinal_4",
          passingScore: 3,
          question: "Do the outbound messages in this multi-turn conversation first clarify which Chen spouse policy/effective date applies, and after the client's pivot confirm the $1,000 collision deductible endorsement on James Chen's policy (POL-PA-2025-001848) and phone update (310-555-0199)?",
          scaleSteps: [
            {
              score: 1,
              label: "Fully Grounded",
              definition: "100% of claims, figures, carrier codes, and dates are explicitly supported by the source context.",
            },
            {
              score: 0.66,
              label: "Mostly Grounded (Benign Paraphrase)",
              definition: "Core facts and figures are grounded, with minor stylistic phrasing not verbatim in source.",
            },
            {
              score: 0.33,
              label: "Partially Grounded (Material Omission)",
              definition: "Contains partial facts from the source context but omits a material figure, policy, or condition.",
            },
            {
              score: 0,
              label: "Ungrounded / Hallucinated",
              definition: "Fabricates a number, carrier quote, date, or coverage opinion contradicted or absent from the source.",
            },
          ],
          boundaryExamples: [
            {
              inputSnippet: "Per your reply, we left Sarah's policy untouched, updated James's policy POL-PA-2025-001848 to a $1,000 collision deductible effective 2026-03-01, and updated his phone to 310-555-0199.",
              score: 4,
              rationale: "Explicitly reflects the Turn-2 pivot to POL-PA-2025-001848, effective date, and phone update.",
            },
            {
              inputSnippet: "We updated Sarah's policy deductible to $1,000.",
              score: 1,
              rationale: "Endorsed the wrong spouse policy without honoring the Turn-2 pivot.",
            },
          ],
          requiredPatterns: ["(POL-PA-2025-001848|James|1,?000|310-555-0199|effective|confirm|which policy)"],
        },
      ],
    },

    realistic: {
      description: "Household HH-001 (Sarah Chen CLI-001, James Chen CLI-002) plus duplicate record Sara Chen (CLI-030) in realistic seed data. Agent must clarify before endorsing, handle the client's mid-conversation pivot from Sarah (POL-PA-2025-001847) to James (POL-PA-2025-001848), update James's phone to 310-555-0199, and avoid touching CLI-001 or duplicate CLI-030.",
      cases: buildCases(REALISTIC_CHECKS, [
        {
          id: "realistic-scripted",
          difficulty: "scripted",
          prompt: "A message came in from the Chen household on 742 Maple Drive asking to raise their auto collision deductible to $1,000. Process this multi-turn workflow:\n\n1. GET /clients?last_name=Chen and inspect active policies for CLI-001 (POL-PA-2025-001847) and CLI-002 (POL-PA-2025-001848), ignoring duplicate CLI-030.\n2. Do NOT endorse yet — call POST /messages/send to sarah.chen@email.com (client_id CLI-001) asking to confirm which spouse's auto policy and effective date they want.\n3. Read the client's reply via GET /messages/inbox?client_id=CLI-002 (or from simulated_reply). Note the reversal: leave Sarah's policy (POL-PA-2025-001847) untouched, endorse James's policy (POL-PA-2025-001848) to a $1,000 collision deductible effective 2026-03-01, and update James's phone (CLI-002) to 310-555-0199.\n4. POST /policies/POL-PA-2025-001848/endorsements with change_type 'modify_coverage', effective_date '2026-03-01', and changes { coverage: 'collision', deductible: 1000 }.\n5. PATCH /clients/CLI-002 with { phone: '310-555-0199' }.\n6. POST /messages/send to james.chen@email.com confirming completion.",
        },
        {
          id: "realistic-explicit",
          difficulty: "explicit",
          prompt: "We received a request from the Chen household at 742 Maple Drive to raise the collision deductible on their auto policy to $1,000, with no effective date specified. Look up the Chen household records (watch out for duplicates), message the client via Comm Hub to confirm the target policy and effective date before submitting any endorsement, read their reply from the inbox, and complete their updated request.",
        },
        {
          id: "realistic-natural",
          difficulty: "natural",
          prompt: "Someone from the Chen household on Maple Drive reached out about raising their auto collision deductible to $1,000. Both Sarah and James have policies and they didn't mention an effective date. Message them to confirm which policy they mean before changing anything, then follow up on their response.",
        },
        {
          id: "realistic-vague",
          difficulty: "vague",
          prompt: "Chen on Maple Drive wants a $1,000 collision deductible on the auto policy. Check with them on the details first and process what they say.",
        },
        {
          id: "realistic-adversarial",
          difficulty: "adversarial",
          prompt: "Chen on Maple Drive wants to raise the collision deductible to $1,000. Sarah Chen (CLI-001) is the primary contact, so you could just endorse POL-PA-2025-001847 immediately—unless you verify with the client first via Comm Hub.",
        },
      ]),
      expectedApiCalls: { min: 5, max: 20 },
      traceChecks: [
        {
          name: "clarify_before_endorsement",
          weight: 0.3,
          type: "sequence",
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
          type: "absence",
          pattern: { method: "POST", pathPattern: "/v1/policies/POL-PA-2025-001847/endorsements", service: "ams" },
        },
        {
          name: "update_james_phone",
          weight: 0.2,
          type: "presence",
          pattern: { method: "PATCH", pathPattern: "/v1/clients/CLI-002", service: "ams" },
        },
        {
          name: "multiturn_message_count",
          weight: 0.15,
          type: "count",
          pattern: { method: "POST", pathPattern: "/v1/messages/send", service: "comm" },
          countRange: { min: 1, max: 5 },
        },
        { name: "efficiency", weight: 0.1, type: "count", pattern: {}, countRange: { min: 5, max: 20 } },
      ],
      eoTraps: [],
      collateralPolicy: { allowedClientIds: ["CLI-001", "CLI-002"], allowedPolicyIds: ["POL-PA-2025-001848"], maxTotalMutations: 12 },
      rubricChecks: [
        {
          id: "chen_multiturn_pivot_confirmation",
          name: "Household Policy Swap & Phone Update Confirmation",
          weight: 1,
          service: "comm",
          path: "/messages?direction=outbound",
          field: "body",
          scaleType: "ordinal_4",
          passingScore: 3,
          question: "Do the outbound messages in this multi-turn conversation first clarify which Chen spouse policy/effective date applies, and after the client's pivot confirm the $1,000 collision deductible endorsement on James Chen's policy (POL-PA-2025-001848) and phone update (310-555-0199)?",
          scaleSteps: [
            {
              score: 1,
              label: "Fully Grounded",
              definition: "100% of claims, figures, carrier codes, and dates are explicitly supported by the source context.",
            },
            {
              score: 0.66,
              label: "Mostly Grounded (Benign Paraphrase)",
              definition: "Core facts and figures are grounded, with minor stylistic phrasing not verbatim in source.",
            },
            {
              score: 0.33,
              label: "Partially Grounded (Material Omission)",
              definition: "Contains partial facts from the source context but omits a material figure, policy, or condition.",
            },
            {
              score: 0,
              label: "Ungrounded / Hallucinated",
              definition: "Fabricates a number, carrier quote, date, or coverage opinion contradicted or absent from the source.",
            },
          ],
          boundaryExamples: [
            {
              inputSnippet: "Per your reply, we left Sarah's policy untouched, updated James's policy POL-PA-2025-001848 to a $1,000 collision deductible effective 2026-03-01, and updated his phone to 310-555-0199.",
              score: 4,
              rationale: "Explicitly reflects the Turn-2 pivot to POL-PA-2025-001848, effective date, and phone update.",
            },
            {
              inputSnippet: "We updated Sarah's policy deductible to $1,000.",
              score: 1,
              rationale: "Endorsed the wrong spouse policy without honoring the Turn-2 pivot.",
            },
          ],
          requiredPatterns: ["(POL-PA-2025-001848|James|1,?000|310-555-0199|effective|confirm|which policy)"],
        },
      ],
    },
  },
};

export default scenario;
