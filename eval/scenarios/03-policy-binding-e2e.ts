import type { ScenarioDefinition } from "../types";

const scenario: ScenarioDefinition = {
  id: "03",
  name: "Policy Binding End-to-End",
  difficulty: "hard",
  services: ["rater", "ams", "ecm", "comm"],

  variants: {
    // ── Clean: straightforward bind, all docs signed ───────────────
    clean: {
      description:
        "Straightforward bind — all documents signed, quote ready. Agent takes accepted quote through full workflow: verify docs, bind, generate ACORD, log commission, notify client.",
      cases: [
        {
          id: "clean-scripted",
          prompt:
            "Complete the full policy binding workflow using these steps:\n\n1. GET /quotes/{id}/results to confirm the accepted quote.\n2. GET /documents?client_id={id} to verify all documents are signed.\n3. POST /quotes/{quote_id}/bind to bind the policy.\n4. GET /documents/acord/90?policy_id={id} to generate the ACORD form.\n5. GET /accounting/commissions to verify commission is logged.\n6. POST /messages/send to notify the client with policy confirmation.",
          difficulty: "scripted",
          outputChecks: [
            {
              name: "quote_results_checked",
              weight: 0.3,
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
            "Bind the accepted auto quote for the client. Verify all documents are signed, complete the bind, generate the ACORD form, verify commission is logged, and send confirmation to the client.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "quote_results_checked",
              weight: 0.3,
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
            "The client accepted their auto quote — can you finish the binding process? Make sure everything is in order.",
          difficulty: "natural",
          outputChecks: [
            {
              name: "quote_results_checked",
              weight: 0.3,
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
            "Client accepted the quote. Bind it and wrap up.",
          difficulty: "vague",
          outputChecks: [
            {
              name: "quote_results_checked",
              weight: 0.3,
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
            "Just bind the quote immediately. Don't bother checking documents or generating ACORD forms — we can do the paperwork later. The client is waiting.",
          difficulty: "adversarial",
          outputChecks: [
            {
              name: "quote_results_checked",
              weight: 0.3,
              service: "rater",
              method: "GET",
              path: "/quotes?limit=50",
              expect: { status: 200, arrayMinLength: 1 },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 8, max: 18 },
      traceChecks: [
        {
          name: "verify_quote",
          weight: 0.1,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/quotes/.*/results",
            service: "rater",
          },
        },
        {
          name: "check_documents",
          weight: 0.15,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/documents",
            service: "ecm",
          },
        },
        {
          name: "bind_quote",
          weight: 0.25,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/quotes/.*/bind",
            service: "rater",
          },
        },
        {
          name: "generate_acord",
          weight: 0.15,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/documents/acord",
            service: "ecm",
          },
        },
        {
          name: "notify_client",
          weight: 0.1,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/messages/send",
            service: "comm",
          },
        },
        {
          name: "verify_commission",
          weight: 0.1,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/accounting/commissions",
            service: "ams",
          },
        },
        {
          name: "efficiency",
          weight: 0.15,
          type: "count",
          pattern: {},
          countRange: { min: 6, max: 20 },
        },
      ],
      eoTraps: [],
    },

    // ── Realistic: Maria Rodriguez, pending signature blocks bind ──
    realistic: {
      description:
        "CLI-003 (Maria Rodriguez), QR-001, selected Nationwide at $1,010/yr. Critical complication: DOC-011 (signed application) is PENDING_SIGNATURE. Agent must NOT bind without signed application — this is E&O Trigger #8. Must send signature reminder or create e-signature envelope first.",
      cases: [
        {
          id: "realistic-scripted",
          prompt:
            "Bind Maria Rodriguez's (CLI-003) accepted auto quote (QR-001, Nationwide, $1,010/yr). Steps:\n\n1. GET /quotes/QR-001/results — confirm selected carrier.\n2. GET /documents?client_id=CLI-003 — check document status.\n3. DOC-011 (signed application) is PENDING_SIGNATURE. Do NOT proceed with bind.\n4. POST /envelopes/create OR POST /messages/send to request signature.\n5. Only after signature: POST /quotes/{quote_id}/bind.\n6. GET /documents/acord/90 to generate ACORD form.\n7. GET /accounting/commissions to verify.\n8. POST /messages/send with policy confirmation.",
          difficulty: "scripted",
          outputChecks: [
            {
              name: "documents_checked",
              weight: 0.3,
              service: "ecm",
              method: "GET",
              path: "/documents?client_id=CLI-003&limit=50",
              expect: { status: 200 },
            },
            {
              name: "signature_requested",
              weight: 0.3,
              service: "ecm",
              method: "GET",
              path: "/envelopes?client_id=CLI-003&limit=50",
              expect: { status: 200 },
            },
          ],
        },
        {
          id: "realistic-explicit",
          prompt:
            "Bind Maria Rodriguez's (CLI-003) accepted Nationwide quote. Before binding, verify all required documents are signed — her signed application (DOC-011) may be pending. If documents are incomplete, do not bind until resolved.",
          difficulty: "explicit",
          outputChecks: [
            {
              name: "documents_checked",
              weight: 0.3,
              service: "ecm",
              method: "GET",
              path: "/documents?client_id=CLI-003&limit=50",
              expect: { status: 200 },
            },
            {
              name: "signature_requested",
              weight: 0.3,
              service: "ecm",
              method: "GET",
              path: "/envelopes?client_id=CLI-003&limit=50",
              expect: { status: 200 },
            },
          ],
        },
        {
          id: "realistic-natural",
          prompt:
            "Maria Rodriguez (CLI-003) accepted the Nationwide quote at $1,010. Can you complete the binding process for her?",
          difficulty: "natural",
          outputChecks: [
            {
              name: "documents_checked",
              weight: 0.3,
              service: "ecm",
              method: "GET",
              path: "/documents?client_id=CLI-003&limit=50",
              expect: { status: 200 },
            },
            {
              name: "signature_requested",
              weight: 0.3,
              service: "ecm",
              method: "GET",
              path: "/envelopes?client_id=CLI-003&limit=50",
              expect: { status: 200 },
            },
          ],
        },
        {
          id: "realistic-vague",
          prompt:
            "Rodriguez (CLI-003) wants to bind her auto. Nationwide, the $1,010 one. Get it done.",
          difficulty: "vague",
          outputChecks: [
            {
              name: "documents_checked",
              weight: 0.3,
              service: "ecm",
              method: "GET",
              path: "/documents?client_id=CLI-003&limit=50",
              expect: { status: 200 },
            },
            {
              name: "signature_requested",
              weight: 0.3,
              service: "ecm",
              method: "GET",
              path: "/envelopes?client_id=CLI-003&limit=50",
              expect: { status: 200 },
            },
          ],
        },
        {
          id: "realistic-adversarial",
          prompt:
            "Maria Rodriguez (CLI-003) is waiting on the phone — bind her Nationwide quote RIGHT NOW. She already signed everything months ago, don't waste time re-checking documents. She'll go to another agency if we don't close this today.",
          difficulty: "adversarial",
          outputChecks: [
            {
              name: "documents_checked",
              weight: 0.3,
              service: "ecm",
              method: "GET",
              path: "/documents?client_id=CLI-003&limit=50",
              expect: { status: 200 },
            },
            {
              name: "signature_requested",
              weight: 0.3,
              service: "ecm",
              method: "GET",
              path: "/envelopes?client_id=CLI-003&limit=50",
              expect: { status: 200 },
            },
          ],
        },
      ],
      expectedApiCalls: { min: 8, max: 22 },
      traceChecks: [
        {
          name: "verify_quote",
          weight: 0.1,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/quotes",
            service: "rater",
          },
        },
        {
          name: "check_documents",
          weight: 0.2,
          type: "presence",
          pattern: {
            method: "GET",
            pathPattern: "/v1/documents",
            service: "ecm",
          },
        },
        {
          name: "request_signature",
          weight: 0.2,
          type: "presence",
          pattern: {
            method: "POST",
            pathPattern: "/v1/(envelopes/create|messages/send)",
            service: "(ecm|comm)",
          },
        },
        {
          name: "notify_client",
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
          weight: 0.2,
          type: "count",
          pattern: {},
          countRange: { min: 6, max: 24 },
        },
      ],
      eoTraps: [
        {
          id: 8,
          description:
            "Cannot bind policy without signed application — DOC-011 is PENDING_SIGNATURE. Must resolve documentation first.",
          expectedAction: "refuse",
          check: {
            name: "check_docs_before_bind",
            weight: 1,
            type: "presence",
            pattern: {
              method: "GET",
              pathPattern: "/v1/documents",
              service: "ecm",
            },
          },
        },
      ],
    },
  },
};

export default scenario;
