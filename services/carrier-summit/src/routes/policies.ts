import { Hono } from "hono";
import {
  requireScopes,
  notFoundError,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { prisma } from "../prisma";

type AppVariables = CorrelationVariables & AuthVariables;

const policiesRouter = new Hono<{ Variables: AppVariables }>();

// GET /policies/:policy_id/documents — Policy document download list
policiesRouter.get(
  "/:policy_id/documents",
  requireScopes("carrier:policies:read"),
  async (c) => {
    const policyId = c.req.param("policy_id");

    // Check policy exists
    const policy = await prisma.policy.findUnique({
      where: { policy_id: policyId },
    });

    if (!policy) {
      throw notFoundError("policy");
    }

    // Get documents for this policy
    const docs = await prisma.policyDocument.findMany({
      where: { policy_id: policyId },
    });

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
