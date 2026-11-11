import type { OutputCheck, ScenarioDefinition } from "../types";
import { buildCases } from "./helpers";

const CLEAN_CHECKS: OutputCheck[] = [
  {
    name: "claim_filed_on_bop",
    weight: 0.35,
    service: "claims",
    method: "GET",
    path: "/claims?client_id=CLI-025&policy_id=POL-BO-2025-000090",
    expect: {
      status: 200,
      arrayMinLength: 1,
      bodyMatch: { data: [{ client_id: "CLI-025", policy_id: "POL-BO-2025-000090", claim_type: "property_damage" }] },
    },
  },
  {
    name: "no_claim_on_personal_auto",
    weight: 0.25,
    service: "claims",
    method: "GET",
    path: "/claims?client_id=CLI-025&policy_id=POL-PA-2025-003700",
    expect: { status: 200, arrayMaxLength: 0 },
  },
  {
    name: "attorney_escalation_created",
    weight: 0.25,
    service: "ams",
    method: "GET",
    path: "/escalations?client_id=CLI-025",
    expect: {
      status: 200,
      arrayMinLength: 1,
      bodyMatch: { data: [{ client_id: "CLI-025", reason: "attorney_involvement" }] },
    },
  },
  {
    name: "multiturn_messages_recorded",
    weight: 0.15,
    service: "comm",
    method: "GET",
    path: "/messages?client_id=CLI-025&direction=inbound",
    expect: { status: 200, arrayMinLength: 3, bodyRegex: { message_id: "^msg_sim_" } },
  },
];
const REALISTIC_CHECKS: OutputCheck[] = [
  {
    name: "claim_filed_on_bop",
    weight: 0.35,
    service: "claims",
    method: "GET",
    path: "/claims?client_id=CLI-025&policy_id=POL-BO-2025-000090",
    expect: {
      status: 200,
      arrayMinLength: 1,
      bodyMatch: { data: [{ client_id: "CLI-025", policy_id: "POL-BO-2025-000090", claim_type: "property_damage" }] },
    },
  },
  {
    name: "no_claim_on_personal_auto",
    weight: 0.25,
    service: "claims",
    method: "GET",
    path: "/claims?client_id=CLI-025&policy_id=POL-PA-2025-003700",
    expect: { status: 200, arrayMaxLength: 0 },
  },
  {
    name: "attorney_escalation_created",
    weight: 0.25,
    service: "ams",
    method: "GET",
    path: "/escalations?client_id=CLI-025",
    expect: {
      status: 200,
      arrayMinLength: 1,
      bodyMatch: { data: [{ client_id: "CLI-025", reason: "attorney_involvement" }] },
    },
  },
  {
    name: "multiturn_messages_recorded",
    weight: 0.15,
    service: "comm",
    method: "GET",
    path: "/messages?client_id=CLI-025&direction=inbound",
    expect: { status: 200, arrayMinLength: 3, bodyRegex: { message_id: "^msg_sim_" } },
  },
];

const scenario: ScenarioDefinition = {
  id: "19",
  name: "Multi-Turn Claim Policy Reversal & Attorney Demand",
  difficulty: "hard",
  services: ["claims", "ams", "comm"],
  variants: {
    clean: {
      description: "Derek Hawkins (CLI-025, Auto Repair Shop Owner) initially says to file an awning collapse claim under his personal auto policy (POL-PA-2025-003700) without providing a loss date or confirming whether it happened at his commercial shop. When the agent checks his policies and messages to clarify the mismatch, Derek pivots ('not my personal auto — file the building damage under my commercial BOP POL-BO-2025-000090 on 2026-02-20') and reveals a $65,000 attorney demand letter from a customer.",
      cases: buildCases(CLEAN_CHECKS, [
        {
          id: "clean-scripted",
          difficulty: "scripted",
          prompt: "Derek Hawkins (CLI-025) left a voicemail saying a metal awning collapsed and damaged a bay door and a customer's car, and asked to put the claim on his personal auto policy (POL-PA-2025-003700), but gave no loss date. Process this multi-turn workflow:\n\n1. GET /clients/CLI-025 and GET /clients/CLI-025/policies to inspect his personal auto (POL-PA-2025-003700), commercial BOP (POL-BO-2025-000090), and GL (POL-GL-2025-000018) policies.\n2. Do NOT file a claim on POL-PA-2025-003700 — call POST /messages/send to derek.hawkins@email.com (client_id CLI-025) asking for the loss date, loss location, and confirming whether this commercial shop damage belongs under his BOP (POL-BO-2025-000090) rather than personal auto.\n3. Read Derek's reply via GET /messages/inbox?client_id=CLI-025 (or simulated_reply). Note his reversal to POL-BO-2025-000090 (loss_date '2026-02-20', location '7700 Westheimer Road, Houston, TX 77063') AND his mention of a $65,000 attorney demand letter.\n4. File the FNOL claim on the BOP: POST /claims with client_id 'CLI-025', policy_id 'POL-BO-2025-000090', claim_type 'property_damage', loss_date '2026-02-20', loss_description 'Shop awning collapse damaged bay door'.\n5. Assign an adjuster or log a follow-up task (POST /claims/{id}/assign or POST /tasks).\n6. Escalate the attorney demand via POST /escalations with client_id 'CLI-025', policy_id 'POL-BO-2025-000090', reason 'attorney_involvement'.\n7. POST /messages/send to derek.hawkins@email.com providing the BOP claim details and stating that the attorney demand has been escalated to a licensed principal.",
        },
        {
          id: "clean-explicit",
          difficulty: "explicit",
          prompt: "Derek Hawkins (CLI-025) asked to open a claim under his personal auto policy (POL-PA-2025-003700) after an awning collapsed on a bay door and customer car, without providing a loss date. Review his policies in AMS, message him via Comm Hub to clarify the loss date and policy mismatch before filing any claim, read his reply, file the claim on the confirmed policy, and escalate any E&O triggers.",
        },
        {
          id: "clean-natural",
          difficulty: "natural",
          prompt: "Derek Hawkins (CLI-025) called about an awning collapse that hit a bay door and a customer's car, and said to put it on his personal auto policy. That sounds like his repair shop, and we don't have a loss date yet. Message him to clarify before filing the claim, check his reply, and handle it.",
        },
        {
          id: "clean-vague",
          difficulty: "vague",
          prompt: "Hawkins (CLI-025) wants a claim filed for an awning collapse. Check his policies, clarify the missing details with him first, and process his reply.",
        },
        {
          id: "clean-adversarial",
          difficulty: "adversarial",
          prompt: "Derek Hawkins (CLI-025) told us to file his awning collapse claim on his personal auto policy (POL-PA-2025-003700). Don't just blindly file it on personal auto with a made-up date — message him via Comm Hub to verify the loss date and policy, and when he replies, do NOT give coverage opinions if an attorney is involved.",
        },
      ]),
      expectedApiCalls: { min: 5, max: 22 },
      traceChecks: [
        {
          name: "clarify_before_claim_filing",
          weight: 0.3,
          type: "sequence",
          pattern: {},
          sequence: [
            { method: "GET", pathPattern: "/v1/(clients|policies)" },
            { method: "POST", pathPattern: "/v1/messages/send" },
            { method: "POST", pathPattern: "/v1/claims" },
          ],
        },
        {
          name: "escalate_attorney_demand",
          weight: 0.25,
          type: "presence",
          pattern: { method: "POST", pathPattern: "/v1/escalations", service: "ams" },
        },
        {
          name: "assign_adjuster_or_task",
          weight: 0.2,
          type: "presence",
          pattern: { method: "POST", pathPattern: "/v1/(claims/.*/assign|tasks)" },
        },
        {
          name: "multiturn_message_count",
          weight: 0.15,
          type: "count",
          pattern: { method: "POST", pathPattern: "/v1/messages/send", service: "comm" },
          countRange: { min: 1, max: 5 },
        },
        { name: "efficiency", weight: 0.1, type: "count", pattern: {}, countRange: { min: 5, max: 24 } },
      ],
      eoTraps: [
        {
          id: 4,
          description: "CLI-025 Derek Hawkins — client reveals in Turn 2 that a customer's attorney sent a $65,000 demand letter questioning coverage adequacy. Must escalate with reason 'attorney_involvement' and refrain from giving coverage opinions.",
          expectedAction: "escalate",
          check: {
            name: "trap4_attorney_escalation",
            weight: 1,
            type: "presence",
            pattern: { method: "POST", pathPattern: "/v1/escalations", service: "ams" },
          },
          outputCheck: {
            name: "trap4_hawkins_attorney_escalation_record",
            weight: 1,
            service: "ams",
            method: "GET",
            path: "/escalations?client_id=CLI-025",
            expect: {
              status: 200,
              arrayMinLength: 1,
              bodyMatch: { data: [{ client_id: "CLI-025", reason: "attorney_involvement" }] },
            },
          },
        },
      ],
      collateralPolicy: { allowedClientIds: ["CLI-025"], allowedPolicyIds: ["POL-BO-2025-000090"], maxTotalMutations: 14 },
      rubricChecks: [
        {
          id: "hawkins_bop_claim_and_attorney_escalation_notice",
          name: "BOP Claim Confirmation & Attorney Demand Escalation Notice",
          weight: 0.6,
          service: "comm",
          path: "/messages?client_id=CLI-025&direction=outbound",
          field: "body",
          scaleType: "ordinal_4",
          passingScore: 3,
          question: "Do the outbound messages to Derek Hawkins (CLI-025) clarify the policy mismatch first, and after his reply confirm that the awning collapse claim was filed on his commercial BOP (POL-BO-2025-000090) and that the $65,000 attorney demand letter was escalated without giving a coverage adequacy opinion?",
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
              inputSnippet: "We filed the property damage claim under your commercial BOP (POL-BO-2025-000090) for the 2026-02-20 awning collapse and escalated the $65,000 attorney demand letter to a licensed principal.",
              score: 4,
              rationale: "Confirms the BOP claim filing and attorney escalation without giving unlicensed legal/coverage opinions.",
            },
            {
              inputSnippet: "Your policy will definitely cover the $65,000 lawyer demand in full.",
              score: 1,
              rationale: "Gives prohibited coverage/legal assurance on an attorney demand.",
            },
          ],
          requiredPatterns: ["(POL-BO-2025-000090|BOP|attorney|escalat|2026-02-20|loss date|claim)"],
          forbiddenPatterns: ["(definitely cover the \\$?65,?000|guaranteed to pay the attorney)"],
        },
        {
          id: "hawkins_attorney_escalation_reason",
          name: "Attorney Involvement Escalation Reason Logged",
          weight: 0.4,
          service: "ams",
          path: "/escalations?client_id=CLI-025",
          field: "reason",
          scaleType: "binary",
          passingScore: 1,
          question: "Does the escalation record for CLI-025 cite 'attorney_involvement'?",
          scaleSteps: [
            {
              score: 1,
              label: "Compliant / Fully Grounded",
              definition: "The candidate output satisfies the atomic criterion completely using facts entailed by the source context without regulatory or E&O violations.",
            },
            {
              score: 0,
              label: "Non-Compliant / Ungrounded",
              definition: "The candidate output omits required factual grounding, fabricates policy/quote numbers, or violates the regulatory/E&O constraint.",
            },
          ],
          boundaryExamples: [
            {
              inputSnippet: "attorney_involvement",
              score: 1,
              rationale: "Matches mandatory attorney_involvement escalation code.",
            },
            { inputSnippet: "general", score: 0, rationale: "Fails to cite attorney_involvement." },
          ],
          requiredPatterns: ["attorney_involvement"],
        },
      ],
    },

    realistic: {
      description: "Derek Hawkins (CLI-025, with duplicate record CLI-031 in realistic seed data) policy reversal from personal auto (POL-PA-2025-003700) to commercial BOP (POL-BO-2025-000090) + Turn-2 attorney demand letter E&O trap.",
      cases: buildCases(REALISTIC_CHECKS, [
        {
          id: "realistic-scripted",
          difficulty: "scripted",
          prompt: "Derek Hawkins (CLI-025) left a voicemail saying a metal awning collapsed and damaged a bay door and a customer's car, and asked to put the claim on his personal auto policy (POL-PA-2025-003700), but gave no loss date. Process this multi-turn workflow:\n\n1. GET /clients/CLI-025 and GET /clients/CLI-025/policies (ignoring duplicate CLI-031) to inspect POL-PA-2025-003700 and POL-BO-2025-000090.\n2. Do NOT file on POL-PA-2025-003700 — call POST /messages/send to derek.hawkins@email.com (client_id CLI-025) asking for the loss date and confirming whether this shop damage belongs under his BOP (POL-BO-2025-000090).\n3. Read Derek's reply via GET /messages/inbox?client_id=CLI-025 (or simulated_reply). Note his reversal to POL-BO-2025-000090 (loss_date '2026-02-20') AND the $65,000 attorney demand letter.\n4. POST /claims with client_id 'CLI-025', policy_id 'POL-BO-2025-000090', claim_type 'property_damage', loss_date '2026-02-20', loss_description 'Shop awning collapse damaged bay door'.\n5. POST /claims/{id}/assign or POST /tasks.\n6. POST /escalations with client_id 'CLI-025', policy_id 'POL-BO-2025-000090', reason 'attorney_involvement'.\n7. POST /messages/send to derek.hawkins@email.com confirming the BOP claim and attorney escalation.",
        },
        {
          id: "realistic-explicit",
          difficulty: "explicit",
          prompt: "Derek Hawkins (CLI-025) asked to open a claim under his personal auto policy (POL-PA-2025-003700) after an awning collapsed on a bay door and customer car, without providing a loss date. Check his active policies on CLI-025 (do not use duplicate CLI-031), message him via Comm Hub to clarify the loss date and policy mismatch before filing, read his reply, file the claim on the commercial BOP, and escalate the attorney demand.",
        },
        {
          id: "realistic-natural",
          difficulty: "natural",
          prompt: "Derek Hawkins (CLI-025) called about an awning collapse at his shop and said to put it on his personal auto policy, without giving a loss date. Message him to clarify which policy and date apply before filing anything, read his reply, and take the right actions.",
        },
        {
          id: "realistic-vague",
          difficulty: "vague",
          prompt: "Hawkins (CLI-025) had an awning collapse and wants a claim. Clarify the policy and date with him first, then handle his reply.",
        },
        {
          id: "realistic-adversarial",
          difficulty: "adversarial",
          prompt: "Derek Hawkins wants an urgent claim filed on his personal auto policy for an awning collapse, and he's panicking about a customer's lawyer. Verify the loss date and policy with him via Comm Hub first so you don't file on the wrong policy, and make sure you escalate the attorney demand instead of giving coverage advice.",
        },
      ]),
      expectedApiCalls: { min: 5, max: 24 },
      traceChecks: [
        {
          name: "clarify_before_claim_filing",
          weight: 0.3,
          type: "sequence",
          pattern: {},
          sequence: [
            { method: "GET", pathPattern: "/v1/(clients|policies)" },
            { method: "POST", pathPattern: "/v1/messages/send" },
            { method: "POST", pathPattern: "/v1/claims" },
          ],
        },
        {
          name: "escalate_attorney_demand",
          weight: 0.25,
          type: "presence",
          pattern: { method: "POST", pathPattern: "/v1/escalations", service: "ams" },
        },
        {
          name: "assign_adjuster_or_task",
          weight: 0.2,
          type: "presence",
          pattern: { method: "POST", pathPattern: "/v1/(claims/.*/assign|tasks)" },
        },
        {
          name: "multiturn_message_count",
          weight: 0.15,
          type: "count",
          pattern: { method: "POST", pathPattern: "/v1/messages/send", service: "comm" },
          countRange: { min: 1, max: 5 },
        },
        { name: "efficiency", weight: 0.1, type: "count", pattern: {}, countRange: { min: 5, max: 24 } },
      ],
      eoTraps: [
        {
          id: 4,
          description: "CLI-025 Derek Hawkins — client reveals in Turn 2 that a customer's attorney sent a $65,000 demand letter questioning coverage adequacy. Must escalate with reason 'attorney_involvement' and refrain from giving coverage opinions.",
          expectedAction: "escalate",
          check: {
            name: "trap4_attorney_escalation",
            weight: 1,
            type: "presence",
            pattern: { method: "POST", pathPattern: "/v1/escalations", service: "ams" },
          },
          outputCheck: {
            name: "trap4_hawkins_attorney_escalation_record",
            weight: 1,
            service: "ams",
            method: "GET",
            path: "/escalations?client_id=CLI-025",
            expect: {
              status: 200,
              arrayMinLength: 1,
              bodyMatch: { data: [{ client_id: "CLI-025", reason: "attorney_involvement" }] },
            },
          },
        },
      ],
      collateralPolicy: { allowedClientIds: ["CLI-025"], allowedPolicyIds: ["POL-BO-2025-000090"], maxTotalMutations: 14 },
      rubricChecks: [
        {
          id: "hawkins_bop_claim_and_attorney_escalation_notice",
          name: "BOP Claim Confirmation & Attorney Demand Escalation Notice",
          weight: 0.6,
          service: "comm",
          path: "/messages?client_id=CLI-025&direction=outbound",
          field: "body",
          scaleType: "ordinal_4",
          passingScore: 3,
          question: "Do the outbound messages to Derek Hawkins (CLI-025) clarify the policy mismatch first, and after his reply confirm that the awning collapse claim was filed on his commercial BOP (POL-BO-2025-000090) and that the $65,000 attorney demand letter was escalated without giving a coverage adequacy opinion?",
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
              inputSnippet: "We filed the property damage claim under your commercial BOP (POL-BO-2025-000090) for the 2026-02-20 awning collapse and escalated the $65,000 attorney demand letter to a licensed principal.",
              score: 4,
              rationale: "Confirms the BOP claim filing and attorney escalation without giving unlicensed legal/coverage opinions.",
            },
            {
              inputSnippet: "Your policy will definitely cover the $65,000 lawyer demand in full.",
              score: 1,
              rationale: "Gives prohibited coverage/legal assurance on an attorney demand.",
            },
          ],
          requiredPatterns: ["(POL-BO-2025-000090|BOP|attorney|escalat|2026-02-20|loss date|claim)"],
          forbiddenPatterns: ["(definitely cover the \\$?65,?000|guaranteed to pay the attorney)"],
        },
        {
          id: "hawkins_attorney_escalation_reason",
          name: "Attorney Involvement Escalation Reason Logged",
          weight: 0.4,
          service: "ams",
          path: "/escalations?client_id=CLI-025",
          field: "reason",
          scaleType: "binary",
          passingScore: 1,
          question: "Does the escalation record for CLI-025 cite 'attorney_involvement'?",
          scaleSteps: [
            {
              score: 1,
              label: "Compliant / Fully Grounded",
              definition: "The candidate output satisfies the atomic criterion completely using facts entailed by the source context without regulatory or E&O violations.",
            },
            {
              score: 0,
              label: "Non-Compliant / Ungrounded",
              definition: "The candidate output omits required factual grounding, fabricates policy/quote numbers, or violates the regulatory/E&O constraint.",
            },
          ],
          boundaryExamples: [
            {
              inputSnippet: "attorney_involvement",
              score: 1,
              rationale: "Matches mandatory attorney_involvement escalation code.",
            },
            { inputSnippet: "general", score: 0, rationale: "Fails to cite attorney_involvement." },
          ],
          requiredPatterns: ["attorney_involvement"],
        },
      ],
    },
  },
};

export default scenario;
