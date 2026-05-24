import { Hono } from "hono";
import {
  requireScopes,
  parsePaginationParams,
  applyPrismaCursorPagination,
  paginatedResponse,
  checkRange,
  throwIfErrors,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { prisma } from "../prisma";

type AppVariables = CorrelationVariables & AuthVariables;

const analyticsRouter = new Hono<{ Variables: AppVariables }>();

// ── GET /retention-risk ──────────────────────────────────────────────

analyticsRouter.get(
  "/retention-risk",
  requireScopes("crm:analytics:read"),
  async (c) => {
    const query = c.req.query();

    // Validate filters
    throwIfErrors([
      query.min_risk_score !== undefined
        ? checkRange("min_risk_score", Number(query.min_risk_score), { min: 0, max: 100 })
        : null,
    ]);

    const { limit, cursor } = parsePaginationParams(query);
    const minRiskScore = query.min_risk_score !== undefined
      ? Number(query.min_risk_score)
      : 50;

    // Cursor pagination: risk_score DESC, client_id DESC
    const {
      where: cursorWhere,
      orderBy,
      take,
    } = applyPrismaCursorPagination({
      cursor,
      limit: limit!,
      orderBy: [
        { field: "risk_score", direction: "desc" },
        { field: "client_id", direction: "desc" },
      ],
    });

    // Build filter conditions
    const filters: Record<string, unknown>[] = [];

    filters.push({ risk_score: { gte: minRiskScore } });

    if (query.assigned_producer) {
      filters.push({ assigned_producer: query.assigned_producer });
    }
    if (cursorWhere) filters.push(cursorWhere);

    const rows = await prisma.retentionRisk.findMany({
      where: { AND: filters },
      orderBy,
      take,
    });

    // Shape response with nested factors
    const mapped = rows.map((row) => ({
      client_id: row.client_id,
      client_name: row.client_name,
      risk_score: row.risk_score,
      factors: {
        rate_increase_pct: row.rate_increase_pct,
        months_since_contact: row.months_since_contact,
        email_open_rate: row.email_open_rate,
        policies_count: row.policies_count,
      },
      recommended_action: row.recommended_action,
    }));

    return c.json(
      paginatedResponse(mapped, limit!, ["risk_score", "client_id"], cursor),
    );
  },
);

export { analyticsRouter };
