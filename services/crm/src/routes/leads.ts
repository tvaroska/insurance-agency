import { Hono } from "hono";
import {
  requireScopes,
  parsePaginationParams,
  applyPrismaCursorPagination,
  paginatedResponse,
  notFoundError,
  conflictError,
  validationError,
  checkRequired,
  checkEnum,
  checkRange,
  checkMaxLength,
  throwIfErrors,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { prisma } from "../prisma";
import type { Lead } from "../generated/prisma/client";

type AppVariables = CorrelationVariables & AuthVariables;

const leadsRouter = new Hono<{ Variables: AppVariables }>();

const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "proposal_sent",
  "closed_won",
  "closed_lost",
] as const;

const LEAD_SOURCES = [
  "referral",
  "web",
  "cold_call",
  "partner",
  "event",
] as const;

// ── GET / ────────────────────────────────────────────────────────────

leadsRouter.get(
  "/",
  requireScopes("crm:leads:read"),
  async (c) => {
    const query = c.req.query();

    // Validate filters
    throwIfErrors([
      checkEnum("status", query.status, LEAD_STATUSES),
      checkEnum("source", query.source, LEAD_SOURCES),
      query.min_score !== undefined
        ? checkRange("min_score", Number(query.min_score), { min: 0, max: 100 })
        : null,
    ]);

    const { limit, cursor } = parsePaginationParams(query);

    // Cursor pagination: score DESC, lead_id DESC
    const {
      where: cursorWhere,
      orderBy,
      take,
    } = applyPrismaCursorPagination({
      cursor,
      limit: limit!,
      orderBy: [
        { field: "score", direction: "desc" },
        { field: "lead_id", direction: "desc" },
      ],
    });

    // Build filter conditions
    const filters: Record<string, unknown>[] = [];

    if (query.client_id) {
      filters.push({ client_id: query.client_id });
    }
    if (query.status) {
      filters.push({ status: query.status });
    }
    if (query.source) {
      filters.push({ source: query.source });
    }
    if (query.assigned_producer) {
      filters.push({ assigned_producer: query.assigned_producer });
    }
    if (query.min_score !== undefined) {
      filters.push({ score: { gte: Number(query.min_score) } });
    }
    if (cursorWhere) filters.push(cursorWhere);

    const rows = await prisma.lead.findMany({
      where: filters.length > 0 ? { AND: filters } : undefined,
      orderBy,
      take,
    });

    // Parse JSON fields
    const mapped = rows.map(mapLeadRow);

    return c.json(
      paginatedResponse(mapped, limit!, ["score", "lead_id"], cursor),
    );
  },
);

// ── GET /scoring ─────────────────────────────────────────────────────

leadsRouter.get(
  "/scoring",
  requireScopes("crm:leads:read"),
  async (c) => {
    const query = c.req.query();

    // Validate filters
    throwIfErrors([
      checkEnum("status", query.status, LEAD_STATUSES),
      checkEnum("source", query.source, LEAD_SOURCES),
      query.min_score !== undefined
        ? checkRange("min_score", Number(query.min_score), { min: 0, max: 100 })
        : null,
    ]);

    const { limit, cursor } = parsePaginationParams(query);

    // Cursor pagination: score DESC, lead_id DESC
    const {
      where: cursorWhere,
      orderBy,
      take,
    } = applyPrismaCursorPagination({
      cursor,
      limit: limit!,
      orderBy: [
        { field: "score", direction: "desc" },
        { field: "lead_id", direction: "desc" },
      ],
    });

    // Build filter conditions
    const filters: Record<string, unknown>[] = [];

    if (query.status) {
      filters.push({ status: query.status });
    }
    if (query.source) {
      filters.push({ source: query.source });
    }
    if (query.assigned_producer) {
      filters.push({ assigned_producer: query.assigned_producer });
    }
    if (query.min_score !== undefined) {
      filters.push({ score: { gte: Number(query.min_score) } });
    }
    if (cursorWhere) filters.push(cursorWhere);

    const rows = await prisma.lead.findMany({
      where: filters.length > 0 ? { AND: filters } : undefined,
      orderBy,
      take,
    });

    // Parse JSON fields
    const mapped = rows.map(mapLeadRow);

    return c.json(
      paginatedResponse(mapped, limit!, ["score", "lead_id"], cursor),
    );
  },
);

// ── GET /:id ──────────────────────────────────────────────────────────

leadsRouter.get(
  "/:id",
  requireScopes("crm:leads:read"),
  async (c) => {
    const leadId = c.req.param("id");

    const lead = await prisma.lead.findUnique({
      where: { lead_id: leadId },
    });

    if (!lead) {
      throw notFoundError("lead");
    }

    return c.json(mapLeadRow(lead));
  },
);

// ── POST / ──────────────────────────────────────────────────────────

leadsRouter.post(
  "/",
  requireScopes("crm:leads:write"),
  async (c) => {
    const body = await c.req.json();

    // Validate required fields
    throwIfErrors([
      checkRequired("first_name", body.first_name),
      checkRequired("last_name", body.last_name),
      checkRequired("email", body.email),
      checkRequired("source", body.source),
      body.first_name ? checkMaxLength("first_name", body.first_name, 100) : null,
      body.last_name ? checkMaxLength("last_name", body.last_name, 100) : null,
      body.email ? checkMaxLength("email", body.email, 255) : null,
      body.source ? checkEnum("source", body.source, LEAD_SOURCES) : null,
      body.notes !== undefined && body.notes !== null
        ? checkMaxLength("notes", body.notes, 2000)
        : null,
    ]);

    const now = new Date().toISOString();
    const leadId = `lead_${Math.random().toString(36).slice(2, 10)}`;

    const record = {
      lead_id: leadId,
      client_id: body.client_id ?? "",
      first_name: body.first_name,
      last_name: body.last_name,
      email: body.email,
      phone: body.phone ?? null,
      source: body.source,
      status: "new",
      score: 50,
      assigned_producer: body.assigned_producer ?? null,
      tags: JSON.stringify(body.tags ?? []),
      notes: body.notes ?? null,
      last_activity_date: now.split("T")[0],
      created_at: now,
      updated_at: now,
    };

    await prisma.lead.create({ data: record });

    return c.json(mapLeadRow(record as Lead), 201);
  },
);

// ── PATCH /:id ───────────────────────────────────────────────────────

const UPDATABLE_FIELDS = [
  "status",
  "score",
  "tags",
  "notes",
  "assigned_producer",
] as const;

leadsRouter.patch(
  "/:id",
  requireScopes("crm:leads:write"),
  async (c) => {
    const leadId = c.req.param("id");
    const body = await c.req.json();

    // Ensure at least one updatable field is present
    const hasUpdatableField = UPDATABLE_FIELDS.some(
      (field) => body[field] !== undefined,
    );
    if (!hasUpdatableField) {
      throw validationError([
        {
          field: "body",
          message:
            "Request body must contain at least one updatable field: status, score, tags, notes, assigned_producer.",
          code: "required",
        },
      ]);
    }

    // Validate provided fields
    throwIfErrors([
      body.status !== undefined
        ? checkEnum("status", body.status, LEAD_STATUSES)
        : null,
      body.score !== undefined
        ? checkRange("score", body.score, { min: 0, max: 100 })
        : null,
      body.notes !== undefined && body.notes !== null
        ? checkMaxLength("notes", body.notes, 2000)
        : null,
    ]);

    // Verify lead exists
    const existing = await prisma.lead.findUnique({
      where: { lead_id: leadId },
      select: { lead_id: true },
    });

    if (!existing) {
      throw notFoundError("lead");
    }

    // Build update object
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
      updated_at: now,
      last_activity_date: now.split("T")[0],
    };

    if (body.status !== undefined) updates.status = body.status;
    if (body.score !== undefined) updates.score = body.score;
    if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags);
    if (body.notes !== undefined) updates.notes = body.notes ?? null;
    if (body.assigned_producer !== undefined)
      updates.assigned_producer = body.assigned_producer ?? null;

    const updated = await prisma.lead.update({
      where: { lead_id: leadId },
      data: updates,
    });

    return c.json(mapLeadRow(updated));
  },
);

// ── POST /:id/enroll ──────────────────────────────────────────────────

leadsRouter.post(
  "/:id/enroll",
  requireScopes("crm:campaigns:enroll"),
  async (c) => {
    const leadId = c.req.param("id");
    const body = await c.req.json();

    throwIfErrors([
      checkRequired("campaign_id", body.campaign_id),
    ]);

    // Verify lead exists
    const lead = await prisma.lead.findUnique({
      where: { lead_id: leadId },
    });

    if (!lead) {
      throw notFoundError("lead");
    }

    // Verify campaign exists and is active
    const campaign = await prisma.campaign.findUnique({
      where: { campaign_id: body.campaign_id },
    });

    if (!campaign) {
      throw notFoundError("campaign");
    }

    if (campaign.status !== "active") {
      throw conflictError(
        `Campaign ${body.campaign_id} is not active (status: ${campaign.status}).`,
      );
    }

    // Check for duplicate enrollment
    const clientId = lead.client_id;
    const existingEnrollment = await prisma.campaignEnrollment.findFirst({
      where: {
        campaign_id: body.campaign_id,
        client_id: clientId,
      },
      select: { enrollment_id: true },
    });

    if (existingEnrollment) {
      throw conflictError(
        `Client ${clientId} is already enrolled in campaign ${body.campaign_id}.`,
      );
    }

    // Create enrollment
    const enrollmentId = `enr_${Math.random().toString(36).slice(2, 10)}`;
    const enrolledAt = new Date().toISOString();

    await prisma.campaignEnrollment.create({
      data: {
        enrollment_id: enrollmentId,
        campaign_id: body.campaign_id,
        client_id: clientId,
        trigger_reason: body.trigger_reason ?? null,
        metadata: body.metadata ? JSON.stringify(body.metadata) : null,
        enrolled_at: enrolledAt,
        sequence_step: 1,
      },
    });

    // Increment enrolled_count
    await prisma.campaign.update({
      where: { campaign_id: body.campaign_id },
      data: { enrolled_count: campaign.enrolled_count + 1 },
    });

    return c.json(
      {
        enrollment_id: enrollmentId,
        campaign_id: body.campaign_id,
        client_id: clientId,
        enrolled_at: enrolledAt,
        sequence_step: 1,
      },
      201,
    );
  },
);

// ── Helpers ─────────────────────────────────────────────────────────

function mapLeadRow(row: Lead) {
  return {
    lead_id: row.lead_id,
    client_id: row.client_id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    phone: row.phone,
    source: row.source,
    status: row.status,
    score: row.score,
    assigned_producer: row.assigned_producer,
    tags: JSON.parse(row.tags),
    notes: row.notes,
    last_activity_date: row.last_activity_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export { leadsRouter };
