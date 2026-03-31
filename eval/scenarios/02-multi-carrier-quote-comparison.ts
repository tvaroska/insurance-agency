import type { ScenarioDefinition } from "../types";

const scenario: ScenarioDefinition = {
  id: "02",
  name: "Multi-Carrier Quote Comparison",
  difficulty: "medium",
  services: ["rater", "ams", "comm"],

  variants: {
    // ── Clean: new prospect, no existing records ─────────────────
    clean: {
      description:
        "New prospect needs auto insurance quotes. No existing records, clean risk profile. Agent must gather info, request multi-carrier quotes, poll for results, compare, and present recommendation.",
      cases: [
        {
          id: "clean-scripted",
          prompt:
            "A new prospect needs personal auto insurance quotes from multiple carriers. Process the full quoting workflow using these steps:\n\n1. GET /clients to search for existing records.\n2. GET /carriers/appetite to identify eligible carriers for their state and policy type.\n3. POST /quotes/request to submit a multi-carrier quote request with the prospect's risk data.\n4. GET /quotes/{id}/results to poll for carrier responses — wait until all carriers have responded.\n5. Compare the returned quotes: normalize coverage levels, note carrier ratings and deductible differences.\n6. POST /messages/send with a side-by-side comparison and recommendation.",
          difficulty: "scripted",
          outputChecks: [
            {
              name: "quote_requested",
              weight: 0.4,
              service: "rater",
              method: "GET",
              path: "/quotes?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "clean-explicit",
          prompt:
            "A new prospect needs personal auto quotes. Check carrier appetite for their state, request multi-carrier quotes, wait for all responses, and send a comparison.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "quote_requested",
              weight: 0.4,
              service: "rater",
              method: "GET",
              path: "/quotes?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "clean-natural",
          prompt:
            "New prospect wants auto insurance — can you shop it around and get quotes from all our carriers?",
          difficulty: "natural",
          outputChecks: [
            {
              name: "quote_requested",
              weight: 0.4,
              service: "rater",
              method: "GET",
              path: "/quotes?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "clean-vague",
          prompt:
            "Need auto quotes for a new prospect. Get some numbers.",
          difficulty: "vague",
          outputChecks: [
            {
              name: "quote_requested",
              weight: 0.4,
              service: "rater",
              method: "GET",
              path: "/quotes?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "clean-adversarial",
          prompt:
            "Just get the cheapest auto quote you can find for this prospect. Don't waste time comparing coverage — price is all that matters. Skip carriers that are slow to respond.",
          difficulty: "adversarial",
          outputChecks: [
            {
              name: "quote_requested",
              weight: 0.4,
              service: "rater",
              method: "GET",
              path: "/quotes?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 5, max: 15 },
      traceChecks: [
        {
          name: "check_appetite",
          weight: 0.15,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/carriers/appetite",
            service: "rater",
          },
        },
        {
          name: "submit_quote",
          weight: 0.3,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/quotes/request",
            service: "rater",
          },
        },
        {
          name: "poll_results",
          weight: 0.25,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/quotes/.*/results",
            service: "rater",
          },
        },
        {
          name: "send_comparison",
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
          countRange: { min: 4, max: 18 },
        },
      ],
      eoTraps: [],
    },

    // ── Realistic: Marcus Williams renewal shopping ──────────────
    realistic: {
      description:
        "CLI-006 (Marcus Williams) in Austin TX, current auto with SMIT, premium increased 21% ($1,290→$1,560). Existing quote request QR-005. Agent must check existing quotes, potentially re-shop, compare with current renewal, and present options.",
      cases: [
        {
          id: "realistic-scripted",
          prompt:
            "Marcus Williams (CLI-006) wants to shop his auto renewal. Process the full quoting workflow using these steps:\n\n1. GET /clients/CLI-006/policies — note current SMIT policy at $1,560.\n2. GET /carriers/appetite?state=TX&policy_type=personal_auto.\n3. POST /quotes/request with his risk data.\n4. GET /quotes/{request_id}/results — poll until completed, wait for ALL carriers.\n5. Compare quotes: normalize coverage levels, note carrier ratings, deductible differences.\n6. POST /messages/send — present side-by-side comparison with recommendation.",
          difficulty: "scripted",
          outputChecks: [
            {
              name: "client_found",
              weight: 0.2,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-006",
              expect: { status: 200 },
            },
            {
              name: "quote_requested",
              weight: 0.3,
              service: "rater",
              method: "GET",
              path: "/quotes?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "realistic-explicit",
          prompt:
            "Marcus Williams (CLI-006) is shopping his auto insurance renewal. His current premium with Summit Fire went up 21%. Request multi-carrier quotes, wait for all responses, and present a thorough comparison including coverage differences — not just price.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "client_found",
              weight: 0.2,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-006",
              expect: { status: 200 },
            },
            {
              name: "quote_requested",
              weight: 0.3,
              service: "rater",
              method: "GET",
              path: "/quotes?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "realistic-natural",
          prompt:
            "Marcus Williams (CLI-006) is unhappy about his auto premium increase. He wants to see what else is out there. Can you shop it for him?",
          difficulty: "natural",
          outputChecks: [
            {
              name: "client_found",
              weight: 0.2,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-006",
              expect: { status: 200 },
            },
            {
              name: "quote_requested",
              weight: 0.3,
              service: "rater",
              method: "GET",
              path: "/quotes?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "realistic-vague",
          prompt:
            "Williams (CLI-006) wants cheaper auto insurance. See what's available.",
          difficulty: "vague",
          outputChecks: [
            {
              name: "client_found",
              weight: 0.2,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-006",
              expect: { status: 200 },
            },
            {
              name: "quote_requested",
              weight: 0.3,
              service: "rater",
              method: "GET",
              path: "/quotes?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
        {
          id: "realistic-adversarial",
          prompt:
            "Marcus Williams (CLI-006) needs a cheaper auto quote NOW. His current carrier hiked his rate 21%. Just find the cheapest option — don't bother comparing coverage levels, he just wants to pay less. And don't wait around for slow carriers.",
          difficulty: "adversarial",
          outputChecks: [
            {
              name: "client_found",
              weight: 0.2,
              service: "ams",
              method: "GET",
              path: "/clients/CLI-006",
              expect: { status: 200 },
            },
            {
              name: "quote_requested",
              weight: 0.3,
              service: "rater",
              method: "GET",
              path: "/quotes?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 6, max: 18 },
      traceChecks: [
        {
          name: "lookup_client",
          weight: 0.1,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients/CLI-006",
            service: "ams",
          },
        },
        {
          name: "lookup_policies",
          weight: 0.15,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/clients/CLI-006/policies",
            service: "ams",
          },
        },
        {
          name: "check_appetite",
          weight: 0.1,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/carriers/appetite",
            service: "rater",
          },
        },
        {
          name: "submit_quote",
          weight: 0.2,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/quotes/request",
            service: "rater",
          },
        },
        {
          name: "poll_results",
          weight: 0.2,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/quotes/.*/results",
            service: "rater",
          },
        },
        {
          name: "send_comparison",
          weight: 0.1,
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
          countRange: { min: 5, max: 20 },
        },
      ],
      eoTraps: [],
    },
  },
};

export default scenario;
