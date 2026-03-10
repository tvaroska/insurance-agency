import { Hono } from "hono";
import {
  requireScopes,
  checkRequired,
  throwIfErrors,
  validationError,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { documents } from "../schema";
import { fetchClient, fetchClientPolicies, fetchAllClients, type AmsPolicy } from "../clients/ams-client";

type AppVariables = CorrelationVariables & AuthVariables;

export const coiRouter = new Hono<{ Variables: AppVariables }>();

// ── POST /generate ──────────────────────────────────────────────────

coiRouter.post(
  "/generate",
  requireScopes("ecm:documents:write"),
  async (c) => {
    const body = await c.req.json();
    const authToken = c.req.header("Authorization") ?? "";

    // Validate required fields
    throwIfErrors([
      checkRequired("policy_id", body.policy_id),
      checkRequired("certificate_holder", body.certificate_holder),
    ]);

    if (!body.certificate_holder?.name) {
      throw validationError([
        {
          field: "certificate_holder.name",
          message: "certificate_holder.name is required.",
          code: "required",
        },
      ]);
    }

    // Find the policy by searching through clients
    const { client, policy } = await findPolicyWithClient(body.policy_id, authToken);

    // Validate policy is active
    if (policy.status !== "active") {
      throw validationError([
        {
          field: "policy_id",
          message: `Cannot generate COI: policy status is '${policy.status}'. Policy must be active.`,
          code: "invalid_status",
        },
      ]);
    }

    // Generate COI document record
    const documentId = `doc_${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    const holderAddr = body.certificate_holder.address ?? {};

    const coiDescription = body.description ?? `Certificate of Insurance for ${client.first_name} ${client.last_name}`;
    const filename = `COI-${policy.policy_id}-${Date.now()}.pdf`;

    const record = {
      document_id: documentId,
      client_id: client.id,
      document_type: "coi",
      filename,
      mime_type: "application/pdf",
      file_size_bytes: 0, // Generated document, no physical file
      status: "generated",
      upload_date: now,
      signer_name: null,
      signer_email: null,
      signed_date: null,
      expiration_date: policy.expiration_date,
      tags: JSON.stringify(["coi", policy.policy_type]),
    };

    db.insert(documents).values(record).run();

    return c.json(
      {
        document_id: documentId,
        client_id: client.id,
        policy_id: policy.policy_id,
        document_type: "coi",
        filename,
        status: "generated",
        certificate_holder: {
          name: body.certificate_holder.name,
          address: holderAddr,
        },
        description: coiDescription,
        coverage_summary: {
          policy_type: policy.policy_type,
          carrier_code: policy.carrier_code,
          effective_date: policy.effective_date,
          expiration_date: policy.expiration_date,
          coverages: policy.coverages ?? [],
        },
        created_at: now,
      },
      201,
    );
  },
);

// ── Helpers ─────────────────────────────────────────────────────────

async function findPolicyWithClient(policyId: string, authToken: string) {
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
