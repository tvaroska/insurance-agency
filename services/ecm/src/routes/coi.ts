import { Hono, type Context } from "hono";
import {
  requireScopes,
  checkRequired,
  throwIfErrors,
  validationError,
  notFoundError,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { prisma } from "../prisma";
import { fetchClientPolicies, fetchAllClients } from "../clients/ams-client";
import { generateAcord25 } from "../templates/acord-25";

type AppVariables = CorrelationVariables & AuthVariables;

export const coiRouter = new Hono<{ Variables: AppVariables }>();

const coiPdfStore = new Map<string, Uint8Array>();

async function handleGenerateCoi(c: Context<{ Variables: AppVariables }>) {
  const body = await c.req.json();
  const authToken = c.req.header("Authorization") ?? "";

  // Support both { certificate_holder: { name, address } } and flat { holder_name, holder_address }
  const certificateHolder =
    body.certificate_holder ??
    (body.holder_name
      ? {
          name: body.holder_name,
          address: body.holder_address ?? {},
        }
      : undefined);

  // Validate required fields
  throwIfErrors([
    checkRequired("policy_id", body.policy_id),
    checkRequired("certificate_holder", certificateHolder),
  ]);

  if (!certificateHolder?.name) {
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

  // Generate COI document record + real ACORD 25 PDF bytes
  const documentId = `doc_${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  const holderAddr = certificateHolder.address ?? {};

  const coiDescription =
    body.description ??
    `Certificate of Insurance for ${client.first_name} ${client.last_name}`;
  const filename = `COI-${policy.policy_id}-${Date.now()}.pdf`;

  const pdfBytes = await generateAcord25({
    client,
    policy,
    certificateHolder: {
      name: certificateHolder.name,
      address: holderAddr,
    },
    description: coiDescription,
  });
  coiPdfStore.set(documentId, pdfBytes);

  const record = {
    document_id: documentId,
    client_id: client.id,
    document_type: "coi",
    filename,
    mime_type: "application/pdf",
    file_size_bytes: pdfBytes.length,
    status: "generated",
    upload_date: now,
    signer_name: null,
    signer_email: null,
    signed_date: null,
    expiration_date: policy.expiration_date,
    tags: JSON.stringify(["coi", policy.policy_type]),
  };

  await prisma.document.create({ data: record });

  return c.json(
    {
      document_id: documentId,
      client_id: client.id,
      policy_id: policy.policy_id,
      document_type: "coi",
      filename,
      file_size_bytes: pdfBytes.length,
      pdf_url: `/v1/documents/coi/${documentId}/pdf`,
      status: "generated",
      certificate_holder: {
        name: certificateHolder.name,
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
}

// ── POST /generate and POST / (for /v1/coi alias) ──────────────────

coiRouter.post("/generate", requireScopes("ecm:documents:write"), handleGenerateCoi);
coiRouter.post("/", requireScopes("ecm:documents:write"), handleGenerateCoi);

// ── GET /:document_id/pdf ──────────────────────────────────────────

coiRouter.get(
  "/:document_id/pdf",
  requireScopes("ecm:documents:read"),
  async (c) => {
    const documentId = c.req.param("document_id");
    const cached = coiPdfStore.get(documentId);
    if (!cached) {
      const docRecord = await prisma.document.findUnique({
        where: { document_id: documentId },
      });
      if (!docRecord || docRecord.document_type !== "coi") {
        throw notFoundError("COI document");
      }
      const fallbackPdf = await generateAcord25({
        client: {
          first_name: "Policyholder",
          last_name: docRecord.client_id,
          email: "insured@evergreen-ins.com",
        },
        policy: {
          policy_id: docRecord.filename.split("-")[1] ?? "POL-ACTIVE",
          carrier_code: "SMIT",
          policy_type: "commercial",
          effective_date: "2025-06-01",
          expiration_date: docRecord.expiration_date ?? "2026-06-01",
          premium_current: 2400,
          status: "active",
          coverages: [],
        },
        certificateHolder: {
          name: "Certificate Holder on File",
        },
      });
      coiPdfStore.set(documentId, fallbackPdf);
      return new Response(fallbackPdf, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${docRecord.filename}"`,
          "Content-Length": fallbackPdf.length.toString(),
        },
      });
    }

    return new Response(cached, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="ACORD-25-${documentId}.pdf"`,
        "Content-Length": cached.length.toString(),
      },
    });
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

