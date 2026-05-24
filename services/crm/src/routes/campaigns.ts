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
  checkMaxLength,
  throwIfErrors,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { prisma } from "../prisma";

type AppVariables = CorrelationVariables & AuthVariables;

const campaignsRouter = new Hono<{ Variables: AppVariables }>();

const CAMPAIGN_STATUSES = ["active", "paused", "completed"] as const;
const CAMPAIGN_TYPES = ["nurture", "retention", "cross_sell", "welcome"] as const;

// ── GET / ─────────────────────────────────────────────────────────────

campaignsRouter.get(
  "/",
  requireScopes("crm:campaigns:read"),
  async (c) => {
    const query = c.req.query();

    throwIfErrors([
      checkEnum("status", query.status, CAMPAIGN_STATUSES),
      checkEnum("type", query.type, CAMPAIGN_TYPES),
    ]);

    const { limit, cursor } = parsePaginationParams(query);

    const {
      where: cursorWhere,
      orderBy,
      take,
    } = applyPrismaCursorPagination({
      cursor,
      limit: limit!,
      orderBy: [{ field: "campaign_id", direction: "asc" }],
    });

    const filters: Record<string, unknown>[] = [];
    if (query.status) filters.push({ status: query.status });
    if (query.type) filters.push({ type: query.type });
    if (cursorWhere) filters.push(cursorWhere);

    const rows = await prisma.campaign.findMany({
      where: filters.length > 0 ? { AND: filters } : undefined,
      orderBy,
      take,
    });

    return c.json(
      paginatedResponse(rows, limit!, ["campaign_id"], cursor),
    );
  },
);

// ── POST /:id/enroll ─────────────────────────────────────────────────

campaignsRouter.post(
  "/:id/enroll",
  requireScopes("crm:campaigns:enroll"),
  async (c) => {
    const campaignId = c.req.param("id");
    const body = await c.req.json();

    // Validate required fields
    throwIfErrors([
      checkRequired("client_id", body.client_id),
      body.trigger_reason !== undefined && body.trigger_reason !== null
        ? checkMaxLength("trigger_reason", body.trigger_reason, 500)
        : null,
    ]);

    // Verify campaign exists
    const campaign = await prisma.campaign.findUnique({
      where: { campaign_id: campaignId },
    });

    if (!campaign) {
      throw notFoundError("campaign");
    }

    // Verify campaign is active
    if (campaign.status !== "active") {
      throw conflictError(
        `Campaign ${campaignId} is not active (status: ${campaign.status}).`,
      );
    }

    // Check for duplicate enrollment
    const existingEnrollment = await prisma.campaignEnrollment.findFirst({
      where: {
        campaign_id: campaignId,
        client_id: body.client_id,
      },
      select: { enrollment_id: true },
    });

    if (existingEnrollment) {
      throw conflictError(
        `Client ${body.client_id} is already enrolled in campaign ${campaignId}.`,
      );
    }

    // Create enrollment
    const enrollmentId = `enr_${Math.random().toString(36).slice(2, 10)}`;
    const enrolledAt = new Date().toISOString();

    await prisma.campaignEnrollment.create({
      data: {
        enrollment_id: enrollmentId,
        campaign_id: campaignId,
        client_id: body.client_id,
        trigger_reason: body.trigger_reason ?? null,
        metadata: body.metadata ? JSON.stringify(body.metadata) : null,
        enrolled_at: enrolledAt,
        sequence_step: 1,
      },
    });

    // Increment enrolled_count
    await prisma.campaign.update({
      where: { campaign_id: campaignId },
      data: { enrolled_count: campaign.enrolled_count + 1 },
    });

    return c.json(
      {
        enrollment_id: enrollmentId,
        campaign_id: campaignId,
        client_id: body.client_id,
        enrolled_at: enrolledAt,
        sequence_step: 1,
      },
      201,
    );
  },
);

export { campaignsRouter };
