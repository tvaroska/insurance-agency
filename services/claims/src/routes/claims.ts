import { Hono } from "hono";
import {
  requireScopes,
  parsePaginationParams,
  applyPrismaCursorPagination,
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
import { prisma } from "../prisma";

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

async function generateClaimId(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.claim.count({
    where: { claim_id: { startsWith: `CLM-${year}-` } },
  });
  const seq = count + 1;
  return `CLM-${year}-${String(seq).padStart(6, "0")}`;
}

// ── Helper: add timeline event ──

async function addTimelineEvent(opts: {
  claim_id: string;
  event_type: string;
  description: string;
  old_value?: string | null;
  new_value?: string | null;
  created_by?: string | null;
}) {
  const event_id = `EVT-${crypto.randomUUID().slice(0, 8)}`;
  await prisma.claimTimeline.create({
    data: {
      event_id,
      claim_id: opts.claim_id,
      event_type: opts.event_type,
      description: opts.description,
      old_value: opts.old_value ?? null,
      new_value: opts.new_value ?? null,
      created_by: opts.created_by ?? null,
      created_at: new Date().toISOString(),
    },
  });
}

// ── Helper: create FNOL claim from validated body ──

async function createFnolClaim(body: Record<string, unknown>) {
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
  const claim_id = await generateClaimId();

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

  await prisma.claim.create({ data: newClaim });

  await addTimelineEvent({
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

  const result = await createFnolClaim(body);
  return c.json(result, 201);
});

// ── POST /fnol — File First Notice of Loss ──

claimsRouter.post("/fnol", requireScopes("claims:write"), async (c) => {
  const body = await c.req.json();
  const result = await createFnolClaim(body);
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
    take,
  } = applyPrismaCursorPagination({
    cursor,
    limit: limit!,
    orderBy: [
      { field: "created_at", direction: "desc" },
      { field: "claim_id", direction: "desc" },
    ],
  });

  const filters: Record<string, unknown>[] = [];
  if (query.client_id) filters.push({ client_id: query.client_id });
  if (query.policy_id) filters.push({ policy_id: query.policy_id });
  if (query.status) filters.push({ status: query.status });
  if (query.claim_type) filters.push({ claim_type: query.claim_type });
  if (query.date_from) filters.push({ loss_date: { gte: query.date_from } });
  if (query.date_to) filters.push({ loss_date: { lte: query.date_to } });
  if (cursorWhere) filters.push(cursorWhere);

  const rows = await prisma.claim.findMany({
    where: filters.length > 0 ? { AND: filters } : undefined,
    orderBy,
    take,
  });

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

  const claim = await prisma.claim.findUnique({
    where: { claim_id: claimId },
  });

  if (!claim) {
    throw notFoundError("claim");
  }

  // Fetch adjuster details if assigned
  let adjuster = null;
  if (claim.adjuster_id) {
    adjuster = await prisma.adjuster.findUnique({
      where: { adjuster_id: claim.adjuster_id },
    });
  }

  // Fetch timeline
  const timeline = await prisma.claimTimeline.findMany({
    where: { claim_id: claimId },
    orderBy: { created_at: "asc" },
  });

  // Fetch documents
  const documents = await prisma.claimDocument.findMany({
    where: { claim_id: claimId },
  });

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
    const claim = await prisma.claim.findUnique({
      where: { claim_id: claimId },
    });

    if (!claim) {
      throw notFoundError("claim");
    }

    // Verify adjuster exists and is active
    const adjuster = await prisma.adjuster.findUnique({
      where: { adjuster_id: body.adjuster_id },
    });

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
    const openCount = await prisma.claim.count({
      where: {
        adjuster_id: body.adjuster_id,
        status: { notIn: ["settled", "denied"] },
      },
    });

    if (openCount >= adjuster.max_open_claims) {
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

    await prisma.claim.update({
      where: { claim_id: claimId },
      data: updates,
    });

    await addTimelineEvent({
      claim_id: claimId,
      event_type: "assignment",
      description: `Adjuster ${adjuster.first_name} ${adjuster.last_name} assigned.`,
      old_value: claim.adjuster_id,
      new_value: body.adjuster_id,
    });

    if (claim.status === "reported") {
      await addTimelineEvent({
        claim_id: claimId,
        event_type: "status_change",
        description: "Status changed from reported to assigned.",
        old_value: "reported",
        new_value: "assigned",
      });
    }

    // Return updated claim
    const updated = await prisma.claim.findUnique({
      where: { claim_id: claimId },
    });

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
    const claim = await prisma.claim.findUnique({
      where: { claim_id: claimId },
    });

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

    await prisma.claim.update({
      where: { claim_id: claimId },
      data: updates,
    });

    // Timeline events
    if (body.status !== undefined && body.status !== claim.status) {
      await addTimelineEvent({
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
      await addTimelineEvent({
        claim_id: claimId,
        event_type: "reserve_change",
        description: `Reserve amount changed from ${claim.reserve_amount ?? "none"} to ${body.reserve_amount}.`,
        old_value: claim.reserve_amount?.toString() ?? null,
        new_value: body.reserve_amount?.toString() ?? null,
      });
    }

    if (body.notes !== undefined && body.notes !== claim.notes) {
      await addTimelineEvent({
        claim_id: claimId,
        event_type: "note",
        description: "Notes updated.",
      });
    }

    const updated = await prisma.claim.findUnique({
      where: { claim_id: claimId },
    });

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
    const claim = await prisma.claim.findUnique({
      where: { claim_id: claimId },
      select: { claim_id: true },
    });

    if (!claim) {
      throw notFoundError("claim");
    }

    const events = await prisma.claimTimeline.findMany({
      where: { claim_id: claimId },
      orderBy: { created_at: "asc" },
    });

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
    const claim = await prisma.claim.findUnique({
      where: { claim_id: claimId },
      select: { claim_id: true },
    });

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

    await prisma.claimDocument.create({ data: newDoc });

    await addTimelineEvent({
      claim_id: claimId,
      event_type: "document_upload",
      description: `Document uploaded: ${body.file_name} (${body.document_type}).`,
      new_value: document_id,
    });

    return c.json(newDoc, 201);
  },
);

export { claimsRouter };
