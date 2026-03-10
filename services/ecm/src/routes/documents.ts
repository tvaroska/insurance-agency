import { Hono } from "hono";
import { eq, and, gte, lte } from "drizzle-orm";
import {
  requireScopes,
  notFoundError,
  checkRequired,
  checkEnum,
  throwIfErrors,
  parsePaginationParams,
  applyCursorPagination,
  paginatedResponse,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { documents } from "../schema";

type AppVariables = CorrelationVariables & AuthVariables;

const DOCUMENT_TYPES = [
  "signed_application",
  "id_verification",
  "coi",
  "dec_page",
  "endorsement",
  "cancellation_notice",
  "welcome_kit",
] as const;

const DOCUMENT_STATUSES = [
  "uploaded",
  "pending_signature",
  "signed",
  "expired",
  "generated",
] as const;

const REQUIRED_DOCUMENT_TYPES = ["signed_application", "id_verification"] as const;

const MISSING_REASONS: Record<string, string> = {
  signed_application:
    "A signed application is required to bind or renew any policy.",
  id_verification:
    "State law requires a government-issued photo ID on file before binding coverage.",
};

export const documentsRouter = new Hono<{ Variables: AppVariables }>();

// ── POST /upload ────────────────────────────────────────────────────

documentsRouter.post(
  "/upload",
  requireScopes("ecm:documents:upload"),
  async (c) => {
    const formData = await c.req.formData();

    const file = formData.get("file") as File | null;
    const clientId = formData.get("client_id") as string | null;
    const documentType = formData.get("document_type") as string | null;
    const tags = formData.getAll("tags") as string[];

    throwIfErrors([
      checkRequired("file", file),
      checkRequired("client_id", clientId),
      checkRequired("document_type", documentType),
      checkEnum("document_type", documentType, DOCUMENT_TYPES),
    ]);

    const documentId = `doc_${Math.random().toString(36).slice(2, 10)}`;
    const uploadDate = new Date().toISOString();

    db.insert(documents)
      .values({
        document_id: documentId,
        client_id: clientId!,
        document_type: documentType!,
        filename: file!.name,
        mime_type: file!.type || "application/octet-stream",
        file_size_bytes: file!.size,
        status: "uploaded",
        upload_date: uploadDate,
        tags: JSON.stringify(tags.length > 0 ? tags : []),
      })
      .run();

    return c.json(
      {
        document_id: documentId,
        filename: file!.name,
        mime_type: file!.type || "application/octet-stream",
        upload_date: uploadDate,
        status: "uploaded",
      },
      201,
    );
  },
);

// ── GET /:client_id/audit ───────────────────────────────────────────

documentsRouter.get(
  "/:client_id/audit",
  requireScopes("ecm:documents:read"),
  async (c) => {
    const clientId = c.req.param("client_id");
    const query = c.req.query();
    const { limit, cursor } = parsePaginationParams(query);

    // Validate optional status filter
    if (query.status) {
      throwIfErrors([
        checkEnum("status", query.status, DOCUMENT_STATUSES),
      ]);
    }

    const { where: cursorWhere, orderBy, limit: queryLimit } =
      applyCursorPagination({
        cursor,
        limit: limit!,
        orderBy: [
          { column: documents.upload_date, direction: "desc" },
          { column: documents.document_id, direction: "desc" },
        ],
      });

    const filters: ReturnType<typeof eq>[] = [
      eq(documents.client_id, clientId),
    ];
    if (query.status) {
      filters.push(eq(documents.status, query.status));
    }
    if (cursorWhere) {
      filters.push(cursorWhere);
    }
    const where = and(...filters);

    const rows = await db
      .select()
      .from(documents)
      .where(where)
      .orderBy(...orderBy)
      .limit(queryLimit);

    if (rows.length === 0 && !cursor) {
      throw notFoundError("client documents");
    }

    // Parse tags and build document list
    const mapped = rows.map((row) => ({
      ...row,
      tags: JSON.parse(row.tags),
    }));

    const paginated = paginatedResponse(
      mapped,
      limit!,
      ["upload_date", "document_id"],
      cursor,
    );

    // Determine compliance status from ALL client documents (not just this page)
    const allDocs = await db
      .select({
        document_type: documents.document_type,
        expiration_date: documents.expiration_date,
      })
      .from(documents)
      .where(eq(documents.client_id, clientId));

    const presentTypes = new Set(allDocs.map((d) => d.document_type));
    const now = new Date().toISOString();

    const expiredDocs = allDocs.filter(
      (d) => d.expiration_date && d.expiration_date < now,
    );

    const missingDocuments: {
      document_type: string;
      required_by: string;
      reason: string;
    }[] = [];

    for (const reqType of REQUIRED_DOCUMENT_TYPES) {
      if (!presentTypes.has(reqType)) {
        const requiredBy = new Date();
        requiredBy.setDate(requiredBy.getDate() + 30);
        missingDocuments.push({
          document_type: reqType,
          required_by: requiredBy.toISOString(),
          reason: MISSING_REASONS[reqType],
        });
      }
    }

    let complianceStatus: string;
    if (missingDocuments.length > 0) {
      complianceStatus = "missing_documents";
    } else if (expiredDocs.length > 0) {
      complianceStatus = "expired_documents";
    } else {
      complianceStatus = "compliant";
    }

    return c.json({
      client_id: clientId,
      documents: paginated.data,
      compliance_status: complianceStatus,
      missing_documents: missingDocuments,
      pagination: paginated.pagination,
    });
  },
);

// ── GET / ─────────────────────────────────────────────────────────────

documentsRouter.get(
  "/",
  requireScopes("ecm:documents:read"),
  async (c) => {
    const query = c.req.query();
    const { limit, cursor } = parsePaginationParams(query);

    // Validate optional filters
    const errors = [];
    if (query.status) {
      errors.push(checkEnum("status", query.status, DOCUMENT_STATUSES));
    }
    if (query.document_type) {
      errors.push(checkEnum("document_type", query.document_type, DOCUMENT_TYPES));
    }
    throwIfErrors(errors);

    const { where: cursorWhere, orderBy, limit: queryLimit } =
      applyCursorPagination({
        cursor,
        limit: limit!,
        orderBy: [
          { column: documents.upload_date, direction: "desc" },
          { column: documents.document_id, direction: "desc" },
        ],
      });

    const filters: ReturnType<typeof eq>[] = [];
    if (query.status) {
      filters.push(eq(documents.status, query.status));
    }
    if (query.document_type) {
      filters.push(eq(documents.document_type, query.document_type));
    }
    if (query.client_id) {
      filters.push(eq(documents.client_id, query.client_id));
    }
    if (query.date_from) {
      filters.push(gte(documents.upload_date, query.date_from));
    }
    if (query.date_to) {
      filters.push(lte(documents.upload_date, query.date_to));
    }
    if (cursorWhere) {
      filters.push(cursorWhere);
    }

    const rows = await db
      .select()
      .from(documents)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(...orderBy)
      .limit(queryLimit);

    const mapped = rows.map((row) => ({
      ...row,
      tags: JSON.parse(row.tags),
    }));

    return c.json(
      paginatedResponse(
        mapped,
        limit!,
        ["upload_date", "document_id"],
        cursor,
      ),
    );
  },
);
