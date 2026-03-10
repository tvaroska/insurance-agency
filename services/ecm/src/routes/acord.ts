import { Hono } from "hono";
import {
  requireScopes,
  checkRequired,
  checkEnum,
  throwIfErrors,
  validationError,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { fetchClient, fetchClientPolicies, fetchAllClients } from "../clients/ams-client";
import { fetchClaim } from "../clients/claims-client";
import { generateAcord90 } from "../templates/acord-90";
import { generateAcord80 } from "../templates/acord-80";
import { generateAcord35 } from "../templates/acord-35";

type AppVariables = CorrelationVariables & AuthVariables;

const FORM_TYPES = ["90", "80", "35"] as const;

export const acordRouter = new Hono<{ Variables: AppVariables }>();

acordRouter.get(
  "/:form_type",
  requireScopes("ecm:acord:read"),
  async (c) => {
    const formType = c.req.param("form_type");
    const policyId = c.req.query("policy_id");
    const claimId = c.req.query("claim_id");
    const authToken = c.req.header("Authorization") ?? "";

    // Validate form_type
    throwIfErrors([checkEnum("form_type", formType, FORM_TYPES)]);

    let pdfBytes: Uint8Array;

    if (formType === "35") {
      // ── ACORD 35: Loss Notice ────────────────────────────────────
      throwIfErrors([checkRequired("claim_id", claimId)]);

      const claim = await fetchClaim(claimId!, authToken);
      const [client, policies] = await Promise.all([
        fetchClient(claim.client_id, authToken),
        fetchClientPolicies(claim.client_id, authToken),
      ]);

      const policy = policies.find((p) => p.policy_id === claim.policy_id);
      if (!policy) {
        throw validationError([
          { field: "claim_id", message: "Policy referenced by claim not found in AMS.", code: "not_found" },
        ]);
      }

      pdfBytes = await generateAcord35({ client, policy, claim });
    } else {
      // ── ACORD 90 / 80: Auto or Homeowners ────────────────────────
      throwIfErrors([checkRequired("policy_id", policyId)]);

      const { client, policy } = await findPolicyWithClient(policyId!, authToken);

      if (formType === "90") {
        if (policy.policy_type !== "personal_auto") {
          throw validationError([
            { field: "policy_id", message: "ACORD 90 requires a personal_auto policy.", code: "invalid_type" },
          ]);
        }
        pdfBytes = await generateAcord90({ client, policy });
      } else {
        if (policy.policy_type !== "homeowners") {
          throw validationError([
            { field: "policy_id", message: "ACORD 80 requires a homeowners policy.", code: "invalid_type" },
          ]);
        }
        pdfBytes = await generateAcord80({ client, policy });
      }
    }

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="ACORD-${formType}.pdf"`,
        "Content-Length": pdfBytes.length.toString(),
      },
    });
  },
);

// ── Helpers ──────────────────────────────────────────────────────────

async function findPolicyWithClient(policyId: string, authToken: string) {
  // Fetch all clients, then search their policies for the given policy_id.
  // In a production system this would be a direct DB query or a dedicated
  // endpoint. For this demo, the client list is small (~10 records).
  const clients = await fetchAllClients(authToken);

  for (const client of clients) {
    const policies = await fetchClientPolicies(client.id, authToken);
    const match = policies.find((p) => p.policy_id === policyId);
    if (match) {
      return { client, policy: match };
    }
  }

  throw validationError([
    { field: "policy_id", message: `Policy ${policyId} not found.`, code: "not_found" },
  ]);
}
