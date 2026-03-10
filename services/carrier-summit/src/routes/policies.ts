import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  requireScopes,
  notFoundError,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { policies, policyDocuments } from "../schema";

type AppVariables = CorrelationVariables & AuthVariables;

const policiesRouter = new Hono<{ Variables: AppVariables }>();

// GET /policies/:policy_id/documents — Policy document download list
policiesRouter.get(
  "/:policy_id/documents",
  requireScopes("carrier:policies:read"),
  async (c) => {
    const policyId = c.req.param("policy_id");

    // Check policy exists
    const [policy] = await db
      .select()
      .from(policies)
      .where(eq(policies.policy_id, policyId))
      .limit(1);

    if (!policy) {
      throw notFoundError("policy");
    }

    // Get documents for this policy
    const docs = await db
      .select()
      .from(policyDocuments)
      .where(eq(policyDocuments.policy_id, policyId));

    return c.json({
      policy_id: policyId,
      document_count: docs.length,
      documents: docs.map((d) => ({
        document_id: d.document_id,
        document_type: d.document_type,
        filename: d.filename,
        file_size_bytes: d.file_size_bytes,
        created_at: d.created_at,
      })),
    });
  },
);

export { policiesRouter };
