import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import {
  requireScopes,
  notFoundError,
  checkRequired,
  checkMaxLength,
  throwIfErrors,
  validationError,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { envelopes, documents } from "../schema";

type AppVariables = CorrelationVariables & AuthVariables;

export const envelopesRouter = new Hono<{ Variables: AppVariables }>();

// ── POST /create ────────────────────────────────────────────────────

envelopesRouter.post(
  "/create",
  requireScopes("ecm:envelopes:create"),
  async (c) => {
    const body = await c.req.json();

    // Validate required fields
    throwIfErrors([
      checkRequired("client_id", body.client_id),
      checkRequired("document_ids", body.document_ids),
      checkRequired("signers", body.signers),
      body.message !== undefined && body.message !== null
        ? checkMaxLength("message", body.message, 1000)
        : null,
    ]);

    // Validate document_ids is a non-empty array
    if (!Array.isArray(body.document_ids) || body.document_ids.length === 0) {
      throw validationError([
        {
          field: "document_ids",
          message: "document_ids must be a non-empty array.",
          code: "invalid_format",
        },
      ]);
    }

    // Validate signers is a non-empty array with required fields
    if (!Array.isArray(body.signers) || body.signers.length === 0) {
      throw validationError([
        {
          field: "signers",
          message: "signers must be a non-empty array.",
          code: "invalid_format",
        },
      ]);
    }

    for (const [i, signer] of body.signers.entries()) {
      throwIfErrors([
        checkRequired(`signers[${i}].name`, signer?.name),
        checkRequired(`signers[${i}].email`, signer?.email),
        checkRequired(`signers[${i}].role`, signer?.role),
      ]);
    }

    // Verify all documents exist
    const existingDocs = await db
      .select({ document_id: documents.document_id })
      .from(documents)
      .where(inArray(documents.document_id, body.document_ids));

    const existingIds = new Set(existingDocs.map((d) => d.document_id));
    const missingIds = body.document_ids.filter(
      (id: string) => !existingIds.has(id),
    );

    if (missingIds.length > 0) {
      throw notFoundError(`documents: ${missingIds.join(", ")}`);
    }

    // Create envelope
    const envelopeId = `env_${Math.random().toString(36).slice(2, 10)}`;
    const createdAt = new Date().toISOString();
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + 30);

    const signers = body.signers.map(
      (s: { name: string; email: string; role: string }) => ({
        name: s.name,
        email: s.email,
        role: s.role,
        status: "pending",
        signed_at: null,
      }),
    );

    db.insert(envelopes)
      .values({
        envelope_id: envelopeId,
        client_id: body.client_id,
        document_ids: JSON.stringify(body.document_ids),
        signers: JSON.stringify(signers),
        status: "created",
        message: body.message ?? null,
        redirect_url: body.redirect_url ?? null,
        created_at: createdAt,
        completed_at: null,
        expiration_date: expirationDate.toISOString(),
      })
      .run();

    return c.json(
      {
        envelope_id: envelopeId,
        client_id: body.client_id,
        document_ids: body.document_ids,
        signers,
        status: "created",
        created_at: createdAt,
        completed_at: null,
        expiration_date: expirationDate.toISOString(),
      },
      201,
    );
  },
);
