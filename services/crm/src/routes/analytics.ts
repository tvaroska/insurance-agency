import { Hono } from "hono";
import { eq, and, gte } from "drizzle-orm";
import {
  requireScopes,
  parsePaginationParams,
  applyCursorPagination,
  paginatedResponse,
  checkRange,
  throwIfErrors,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { retentionRisks } from "../schema";

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
      limit: queryLimit,
    } = applyCursorPagination({
      cursor,
      limit: limit!,
      orderBy: [
        { column: retentionRisks.risk_score, direction: "desc" },
        { column: retentionRisks.client_id, direction: "desc" },
      ],
    });

    // Build filter conditions
    const filters: ReturnType<typeof eq>[] = [];

    filters.push(gte(retentionRisks.risk_score, minRiskScore) as ReturnType<typeof eq>);

    if (query.assigned_producer) {
      filters.push(eq(retentionRisks.assigned_producer, query.assigned_producer));
    }
    if (cursorWhere) filters.push(cursorWhere as ReturnType<typeof eq>);

    const rows = await db
      .select()
      .from(retentionRisks)
      .where(and(...filters))
      .orderBy(...orderBy)
      .limit(queryLimit);

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
