import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import {
  requireScopes,
  parsePaginationParams,
  applyCursorPagination,
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
import { db } from "../db";
import { campaigns, campaignEnrollments } from "../schema";

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
      limit: queryLimit,
    } = applyCursorPagination({
      cursor,
      limit: limit!,
      orderBy: [{ column: campaigns.campaign_id, direction: "asc" }],
    });

    const filters: ReturnType<typeof eq>[] = [];
    if (query.status) filters.push(eq(campaigns.status, query.status));
    if (query.type) filters.push(eq(campaigns.type, query.type));
    if (cursorWhere) filters.push(cursorWhere as ReturnType<typeof eq>);

    const rows = await db
      .select()
      .from(campaigns)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(...orderBy)
      .limit(queryLimit);

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
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.campaign_id, campaignId))
      .limit(1);

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
    const [existingEnrollment] = await db
      .select({ enrollment_id: campaignEnrollments.enrollment_id })
      .from(campaignEnrollments)
      .where(
        and(
          eq(campaignEnrollments.campaign_id, campaignId),
          eq(campaignEnrollments.client_id, body.client_id),
        ),
      )
      .limit(1);

    if (existingEnrollment) {
      throw conflictError(
        `Client ${body.client_id} is already enrolled in campaign ${campaignId}.`,
      );
    }

    // Create enrollment
    const enrollmentId = `enr_${Math.random().toString(36).slice(2, 10)}`;
    const enrolledAt = new Date().toISOString();

    await db.insert(campaignEnrollments)
      .values({
        enrollment_id: enrollmentId,
        campaign_id: campaignId,
        client_id: body.client_id,
        trigger_reason: body.trigger_reason ?? null,
        metadata: body.metadata ? JSON.stringify(body.metadata) : null,
        enrolled_at: enrolledAt,
        sequence_step: 1,
      })
      .run();

    // Increment enrolled_count
    await db.update(campaigns)
      .set({ enrolled_count: campaign.enrolled_count + 1 })
      .where(eq(campaigns.campaign_id, campaignId))
      .run();

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
