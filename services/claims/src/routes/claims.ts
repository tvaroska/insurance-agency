import { Hono } from "hono";
import { and, eq, like, gte, lte, sql } from "drizzle-orm";
import {
  requireScopes,
  parsePaginationParams,
  applyCursorPagination,
  paginatedResponse,
  notFoundError,
  validationError,
  checkRequired,
  checkEnum,
  checkFormat,
  checkRange,
  checkMaxLength,
  throwIfErrors,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import {
  claims,
  adjusters,
  claimDocuments,
  claimTimeline,
} from "../schema";

type AppVariables = CorrelationVariables & AuthVariables;

const claimsRouter = new Hono<{ Variables: AppVariables }>();

const CLAIM_TYPES = [
  "auto_collision",
  "auto_comprehensive",
  "property_damage",
  "theft",
  "liability",
  "medical",
  "fire",
  "water",
  "weather",
] as const;

const CLAIM_STATUSES = [
  "reported",
  "assigned",
  "investigating",
  "reserved",
  "settled",
  "denied",
] as const;

const DOCUMENT_TYPES = [
  "police_report",
  "medical_records",
  "photos",
  "estimate",
  "correspondence",
  "other",
] as const;

// Valid forward transitions (current → allowed next statuses)
const STATUS_TRANSITIONS: Record<string, string[]> = {
  reported: ["assigned", "denied"],
  assigned: ["investigating", "denied"],
  investigating: ["reserved", "denied"],
  reserved: ["settled", "denied"],
  settled: [],
  denied: [],
};

// ── Helper: generate next claim ID ──

function generateClaimId(): string {
  const year = new Date().getFullYear();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(claims)
    .where(like(claims.claim_id, `CLM-${year}-%`))
    .get();
  const seq = (row?.count ?? 0) + 1;
  return `CLM-${year}-${String(seq).padStart(6, "0")}`;
}

// ── Helper: add timeline event ──

function addTimelineEvent(opts: {
  claim_id: string;
  event_type: string;
  description: string;
  old_value?: string | null;
  new_value?: string | null;
  created_by?: string | null;
}) {
  const event_id = `EVT-${crypto.randomUUID().slice(0, 8)}`;
  db.insert(claimTimeline)
    .values({
      event_id,
      claim_id: opts.claim_id,
      event_type: opts.event_type,
      description: opts.description,
      old_value: opts.old_value ?? null,
      new_value: opts.new_value ?? null,
      created_by: opts.created_by ?? null,
      created_at: new Date().toISOString(),
    })
    .run();
}

// ── Helper: create FNOL claim from validated body ──

async function createFnolClaim(body: Record<string, unknown>, dbInstance: any) {
  throwIfErrors([
    checkRequired("policy_id", body.policy_id),
    checkRequired("client_id", body.client_id),
    checkRequired("claim_type", body.claim_type),
    checkRequired("loss_date", body.loss_date),
    checkRequired("loss_description", body.loss_description),
    checkEnum("claim_type", body.claim_type as string, CLAIM_TYPES),
    checkFormat(
      "loss_date",
      body.loss_date as string,
      /^\d{4}-\d{2}-\d{2}$/,
      "loss_date must be YYYY-MM-DD.",
    ),
    body.loss_description
      ? checkMaxLength("loss_description", body.loss_description as string, 5000)
      : null,
    body.loss_location
      ? checkMaxLength("loss_location", body.loss_location as string, 500)
      : null,
  ]);

  // Validate loss_date is not in the future
  const today = new Date().toISOString().slice(0, 10);
  if ((body.loss_date as string) > today) {
    throw validationError([
      {
        field: "loss_date",
        message: "loss_date cannot be in the future.",
        code: "out_of_range",
      },
    ]);
  }

  const now = new Date().toISOString();
  const claim_id = generateClaimId();

  const newClaim = {
    claim_id,
    policy_id: body.policy_id as string,
    client_id: body.client_id as string,
    claim_type: body.claim_type as string,
    status: "reported",
    loss_date: body.loss_date as string,
    reported_date: today,
    loss_description: body.loss_description as string,
    loss_location: (body.loss_location as string) ?? null,
    reserve_amount: null,
    settlement_amount: null,
    adjuster_id: null,
    notes: (body.notes as string) ?? null,
    created_at: now,
    updated_at: now,
  };

  dbInstance.insert(claims).values(newClaim).run();

  addTimelineEvent({
    claim_id,
    event_type: "status_change",
    description: "Claim filed — status set to reported.",
    old_value: null,
    new_value: "reported",
  });

  return newClaim;
}

// ── POST / — File claim with field normalization ──

claimsRouter.post("/", requireScopes("claims:write"), async (c) => {
  const body = await c.req.json();

  // Normalize alternate field names
  if (body.loss_type !== undefined && body.claim_type === undefined) {
    body.claim_type = body.loss_type;
  }
  if (body.description !== undefined && body.loss_description === undefined) {
    body.loss_description = body.description;
  }

  const result = await createFnolClaim(body, db);
  return c.json(result, 201);
});

// ── POST /fnol — File First Notice of Loss ──

claimsRouter.post("/fnol", requireScopes("claims:write"), async (c) => {
  const body = await c.req.json();
  const result = await createFnolClaim(body, db);
  return c.json(result, 201);
});

// ── GET / — List claims ──

claimsRouter.get("/", requireScopes("claims:read"), async (c) => {
  const query = c.req.query();

  throwIfErrors([
    checkEnum("status", query.status, CLAIM_STATUSES),
    checkEnum("claim_type", query.claim_type, CLAIM_TYPES),
    query.date_from
      ? checkFormat(
          "date_from",
          query.date_from,
          /^\d{4}-\d{2}-\d{2}$/,
          "date_from must be YYYY-MM-DD.",
        )
      : null,
    query.date_to
      ? checkFormat(
          "date_to",
          query.date_to,
          /^\d{4}-\d{2}-\d{2}$/,
          "date_to must be YYYY-MM-DD.",
        )
      : null,
  ]);

  const { limit, cursor } = parsePaginationParams(query);

  const {
    where: cursorWhere,
    orderBy,
    limit: queryLimit,
  } = applyCursorPagination({
    cursor,
    limit: limit!,
    orderBy: [
      { column: claims.created_at, direction: "desc" },
      { column: claims.claim_id, direction: "desc" },
    ],
  });

  const filters: ReturnType<typeof eq>[] = [];
  if (query.client_id) filters.push(eq(claims.client_id, query.client_id));
  if (query.policy_id) filters.push(eq(claims.policy_id, query.policy_id));
  if (query.status) filters.push(eq(claims.status, query.status));
  if (query.claim_type) filters.push(eq(claims.claim_type, query.claim_type));
  if (query.date_from) filters.push(gte(claims.loss_date, query.date_from));
  if (query.date_to) filters.push(lte(claims.loss_date, query.date_to));
  if (cursorWhere) filters.push(cursorWhere);

  const rows = await db
    .select()
    .from(claims)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(...orderBy)
    .limit(queryLimit);

  return c.json(
    paginatedResponse(
      rows,
      limit!,
      ["created_at", "claim_id"],
      cursor,
    ),
  );
});

// ── GET /:claim_id — Claim detail ──

claimsRouter.get("/:claim_id", requireScopes("claims:read"), async (c) => {
  const claimId = c.req.param("claim_id");

  const [claim] = await db
    .select()
    .from(claims)
    .where(eq(claims.claim_id, claimId))
    .limit(1);

  if (!claim) {
    throw notFoundError("claim");
  }

  // Fetch adjuster details if assigned
  let adjuster = null;
  if (claim.adjuster_id) {
    const [adj] = await db
      .select()
      .from(adjusters)
      .where(eq(adjusters.adjuster_id, claim.adjuster_id))
      .limit(1);
    if (adj) {
      adjuster = adj;
    }
  }

  // Fetch timeline
  const timeline = await db
    .select()
    .from(claimTimeline)
    .where(eq(claimTimeline.claim_id, claimId))
    .orderBy(claimTimeline.created_at);

  // Fetch documents
  const documents = await db
    .select()
    .from(claimDocuments)
    .where(eq(claimDocuments.claim_id, claimId));

  return c.json({
    ...claim,
    adjuster,
    timeline,
    documents,
  });
});

// ── POST /:claim_id/assign — Assign adjuster ──

claimsRouter.post(
  "/:claim_id/assign",
  requireScopes("claims:assign"),
  async (c) => {
    const claimId = c.req.param("claim_id");
    const body = await c.req.json();

    throwIfErrors([checkRequired("adjuster_id", body.adjuster_id)]);

    // Verify claim exists
    const [claim] = await db
      .select()
      .from(claims)
      .where(eq(claims.claim_id, claimId))
      .limit(1);

    if (!claim) {
      throw notFoundError("claim");
    }

    // Verify adjuster exists and is active
    const [adjuster] = await db
      .select()
      .from(adjusters)
      .where(eq(adjusters.adjuster_id, body.adjuster_id))
      .limit(1);

    if (!adjuster) {
      throw notFoundError("adjuster");
    }

    if (!adjuster.active) {
      throw validationError([
        {
          field: "adjuster_id",
          message: "Adjuster is not active.",
          code: "invalid_enum",
        },
      ]);
    }

    // Check capacity
    const openCount = db
      .select({ count: sql<number>`count(*)` })
      .from(claims)
      .where(
        and(
          eq(claims.adjuster_id, body.adjuster_id),
          sql`${claims.status} NOT IN ('settled', 'denied')`,
        ),
      )
      .get();

    if ((openCount?.count ?? 0) >= adjuster.max_open_claims) {
      throw validationError([
        {
          field: "adjuster_id",
          message: `Adjuster has reached maximum open claims (${adjuster.max_open_claims}).`,
          code: "out_of_range",
        },
      ]);
    }

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
      adjuster_id: body.adjuster_id,
      updated_at: now,
    };

    // Transition to assigned if currently reported
    if (claim.status === "reported") {
      updates.status = "assigned";
    }

    await db
      .update(claims)
      .set(updates)
      .where(eq(claims.claim_id, claimId));

    addTimelineEvent({
      claim_id: claimId,
      event_type: "assignment",
      description: `Adjuster ${adjuster.first_name} ${adjuster.last_name} assigned.`,
      old_value: claim.adjuster_id,
      new_value: body.adjuster_id,
    });

    if (claim.status === "reported") {
      addTimelineEvent({
        claim_id: claimId,
        event_type: "status_change",
        description: "Status changed from reported to assigned.",
        old_value: "reported",
        new_value: "assigned",
      });
    }

    // Return updated claim
    const [updated] = await db
      .select()
      .from(claims)
      .where(eq(claims.claim_id, claimId))
      .limit(1);

    return c.json(updated);
  },
);

// ── PATCH /:claim_id — Update status, reserves, notes ──

const UPDATABLE_FIELDS = [
  "status",
  "reserve_amount",
  "settlement_amount",
  "notes",
] as const;

claimsRouter.patch(
  "/:claim_id",
  requireScopes("claims:write"),
  async (c) => {
    const claimId = c.req.param("claim_id");
    const body = await c.req.json();

    // Ensure at least one updatable field
    const hasUpdatableField = UPDATABLE_FIELDS.some(
      (field) => body[field] !== undefined,
    );
    if (!hasUpdatableField) {
      throw validationError([
        {
          field: "body",
          message:
            "Request body must contain at least one updatable field: status, reserve_amount, settlement_amount, notes.",
          code: "required",
        },
      ]);
    }

    throwIfErrors([
      body.status !== undefined
        ? checkEnum("status", body.status, CLAIM_STATUSES)
        : null,
      body.reserve_amount !== undefined && body.reserve_amount !== null
        ? checkRange("reserve_amount", body.reserve_amount, { min: 0 })
        : null,
      body.settlement_amount !== undefined && body.settlement_amount !== null
        ? checkRange("settlement_amount", body.settlement_amount, { min: 0 })
        : null,
      body.notes !== undefined && body.notes !== null
        ? checkMaxLength("notes", body.notes, 5000)
        : null,
    ]);

    // Verify claim exists
    const [claim] = await db
      .select()
      .from(claims)
      .where(eq(claims.claim_id, claimId))
      .limit(1);

    if (!claim) {
      throw notFoundError("claim");
    }

    // Validate status transition
    if (body.status !== undefined && body.status !== claim.status) {
      const allowed = STATUS_TRANSITIONS[claim.status] ?? [];
      if (!allowed.includes(body.status)) {
        throw validationError([
          {
            field: "status",
            message: `Cannot transition from '${claim.status}' to '${body.status}'.`,
            code: "invalid_enum",
          },
        ]);
      }
    }

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updated_at: now };

    if (body.status !== undefined) updates.status = body.status;
    if (body.reserve_amount !== undefined)
      updates.reserve_amount = body.reserve_amount;
    if (body.settlement_amount !== undefined)
      updates.settlement_amount = body.settlement_amount;
    if (body.notes !== undefined) updates.notes = body.notes;

    await db
      .update(claims)
      .set(updates)
      .where(eq(claims.claim_id, claimId));

    // Timeline events
    if (body.status !== undefined && body.status !== claim.status) {
      addTimelineEvent({
        claim_id: claimId,
        event_type: "status_change",
        description: `Status changed from ${claim.status} to ${body.status}.`,
        old_value: claim.status,
        new_value: body.status,
      });
    }

    if (
      body.reserve_amount !== undefined &&
      body.reserve_amount !== claim.reserve_amount
    ) {
      addTimelineEvent({
        claim_id: claimId,
        event_type: "reserve_change",
        description: `Reserve amount changed from ${claim.reserve_amount ?? "none"} to ${body.reserve_amount}.`,
        old_value: claim.reserve_amount?.toString() ?? null,
        new_value: body.reserve_amount?.toString() ?? null,
      });
    }

    if (body.notes !== undefined && body.notes !== claim.notes) {
      addTimelineEvent({
        claim_id: claimId,
        event_type: "note",
        description: "Notes updated.",
      });
    }

    const [updated] = await db
      .select()
      .from(claims)
      .where(eq(claims.claim_id, claimId))
      .limit(1);

    return c.json(updated);
  },
);

// ── GET /:claim_id/timeline — Claim activity log ──

claimsRouter.get(
  "/:claim_id/timeline",
  requireScopes("claims:read"),
  async (c) => {
    const claimId = c.req.param("claim_id");

    // Verify claim exists
    const [claim] = await db
      .select({ claim_id: claims.claim_id })
      .from(claims)
      .where(eq(claims.claim_id, claimId))
      .limit(1);

    if (!claim) {
      throw notFoundError("claim");
    }

    const events = await db
      .select()
      .from(claimTimeline)
      .where(eq(claimTimeline.claim_id, claimId))
      .orderBy(claimTimeline.created_at);

    return c.json({ data: events });
  },
);

// ── POST /:claim_id/documents — Upload claim document ──

claimsRouter.post(
  "/:claim_id/documents",
  requireScopes("claims:documents"),
  async (c) => {
    const claimId = c.req.param("claim_id");
    const body = await c.req.json();

    throwIfErrors([
      checkRequired("document_type", body.document_type),
      checkRequired("file_name", body.file_name),
      checkRequired("file_path", body.file_path),
      checkEnum("document_type", body.document_type, DOCUMENT_TYPES),
      body.file_name
        ? checkMaxLength("file_name", body.file_name, 255)
        : null,
      body.file_path
        ? checkMaxLength("file_path", body.file_path, 1000)
        : null,
    ]);

    // Verify claim exists
    const [claim] = await db
      .select({ claim_id: claims.claim_id })
      .from(claims)
      .where(eq(claims.claim_id, claimId))
      .limit(1);

    if (!claim) {
      throw notFoundError("claim");
    }

    const now = new Date().toISOString();
    const document_id = `DOC-${crypto.randomUUID().slice(0, 8)}`;

    const newDoc = {
      document_id,
      claim_id: claimId,
      document_type: body.document_type,
      file_name: body.file_name,
      file_path: body.file_path,
      uploaded_by: body.uploaded_by ?? null,
      uploaded_at: now,
    };

    db.insert(claimDocuments).values(newDoc).run();

    addTimelineEvent({
      claim_id: claimId,
      event_type: "document_upload",
      description: `Document uploaded: ${body.file_name} (${body.document_type}).`,
      new_value: document_id,
    });

    return c.json(newDoc, 201);
  },
);

export { claimsRouter };
