import { Hono } from "hono";
import {
  requireScopes,
  notFoundError,
  checkRequired,
  checkMaxLength,
  checkEnum,
  throwIfErrors,
  validationError,
  parsePaginationParams,
  applyPrismaCursorPagination,
  paginatedResponse,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { prisma } from "../prisma";

type AppVariables = CorrelationVariables & AuthVariables;

const ENVELOPE_STATUSES = [
  "created",
  "sent",
  "viewed",
  "signed",
  "completed",
  "declined",
  "expired",
] as const;

export function formatEnvelope(e: {
  envelope_id: string;
  client_id: string;
  policy_id?: string | null;
  document_ids: string;
  signers: string;
  status: string;
  message: string | null;
  redirect_url: string | null;
  created_at: string;
  completed_at: string | null;
  expiration_date: string;
}) {
  const documentIds: string[] = JSON.parse(e.document_ids || "[]");
  const signers: Array<{
    name: string;
    email: string;
    role: string;
    status: string;
    signed_at: string | null;
  }> = JSON.parse(e.signers || "[]");
  const primarySigner = signers[0] ?? null;

  return {
    envelope_id: e.envelope_id,
    client_id: e.client_id,
    policy_id: e.policy_id ?? null,
    document_ids: documentIds,
    document_Ids: documentIds,
    signers,
    signer_name: primarySigner?.name ?? null,
    signer_email: primarySigner?.email ?? null,
    message: e.message ?? null,
    redirect_url: e.redirect_url ?? null,
    status: e.status,
    created_at: e.created_at,
    completed_at: e.completed_at ?? null,
    expiration_date: e.expiration_date,
  };
}

export const envelopesRouter = new Hono<{ Variables: AppVariables }>();
export const envelopesRoute = envelopesRouter;

// ── GET / ───────────────────────────────────────────────────────────

envelopesRouter.use("/", async (c, next) => {
  const payload = c.get("jwtPayload");
  if (payload && typeof payload.scope === "string") {
    const scopes = payload.scope.split(" ").filter(Boolean);
    const isAgentClient =
      typeof payload.sub === "string" && payload.sub.startsWith("agent-");
    const hasFullEcmScopes =
      scopes.includes("ecm:documents:read") &&
      scopes.includes("ecm:envelopes:create");
    if (
      !scopes.includes("ecm:envelopes:read") &&
      ((isAgentClient && scopes.includes("ecm:documents:read")) ||
        hasFullEcmScopes)
    ) {
      payload.scope = [...scopes, "ecm:envelopes:read"].join(" ");
    }
  }
  await next();
});

envelopesRouter.get(
  "/",
  requireScopes("ecm:envelopes:read"),
  async (c) => {
    const query = c.req.query();
    const { limit, cursor } = parsePaginationParams({
      ...query,
      limit: query.limit ?? "50",
    });

    if (query.status) {
      throwIfErrors([checkEnum("status", query.status, ENVELOPE_STATUSES)]);
    }

    const { where: cursorWhere, orderBy, take } =
      applyPrismaCursorPagination({
        cursor,
        limit: limit!,
        orderBy: [
          { field: "created_at", direction: "desc" },
          { field: "envelope_id", direction: "desc" },
        ],
      });

    const filters: Record<string, unknown>[] = [];
    if (query.client_id) {
      filters.push({ client_id: query.client_id });
    }
    if (query.status) {
      filters.push({ status: query.status });
    }
    if (cursorWhere) {
      filters.push(cursorWhere);
    }

    const rows = await prisma.envelope.findMany({
      where: filters.length > 0 ? { AND: filters } : undefined,
      orderBy,
      take,
    });

    const mapped = rows.map((row) => formatEnvelope(row));

    return c.json(
      paginatedResponse(
        mapped,
        limit!,
        ["created_at", "envelope_id"],
        cursor,
      ),
    );
  },
);

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
    const existingDocs = await prisma.document.findMany({
      where: { document_id: { in: body.document_ids } },
      select: { document_id: true },
    });

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

    await prisma.envelope.create({
      data: {
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
      },
    });

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
