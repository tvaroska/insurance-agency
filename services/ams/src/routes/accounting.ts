import { Hono } from "hono";
import { and, eq, gte, lte } from "drizzle-orm";
import {
  requireScopes,
  parsePaginationParams,
  applyCursorPagination,
  paginatedResponse,
  checkEnum,
  checkFormat,
  throwIfErrors,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { commissions } from "../schema";

type AppVariables = CorrelationVariables & AuthVariables;

const accountingRouter = new Hono<{ Variables: AppVariables }>();

const CARRIER_CODES = ["SMIT", "CSTL", "HRTF", "ERIE", "NTNW", "SAFECO", "LIBT"] as const;
const TRANSACTION_TYPES = ["new_business", "renewal", "endorsement", "cancellation", "reinstatement", "audit"] as const;
const COMMISSION_STATUSES = ["earned", "paid", "reversed", "pending"] as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

accountingRouter.get("/commissions", requireScopes("ams:accounting:read"), async (c) => {
  const query = c.req.query();

  // Validate filters
  throwIfErrors([
    checkEnum("carrier_code", query.carrier_code, CARRIER_CODES),
    checkEnum("transaction_type", query.transaction_type, TRANSACTION_TYPES),
    checkEnum("status", query.status, COMMISSION_STATUSES),
    checkFormat("effective_date_from", query.effective_date_from, DATE_PATTERN, "Must be YYYY-MM-DD"),
    checkFormat("effective_date_to", query.effective_date_to, DATE_PATTERN, "Must be YYYY-MM-DD"),
  ]);

  // Parse pagination
  const { limit, cursor } = parsePaginationParams(query);

  // Build cursor pagination (ordered by effective_date DESC, commission_id DESC)
  const { where: cursorWhere, orderBy, limit: queryLimit } = applyCursorPagination({
    cursor,
    limit: limit!,
    orderBy: [
      { column: commissions.effective_date, direction: "desc" },
      { column: commissions.commission_id, direction: "desc" },
    ],
  });

  // Build filter conditions
  const filters: ReturnType<typeof eq>[] = [];
  if (query.carrier_code) filters.push(eq(commissions.carrier_code, query.carrier_code));
  if (query.transaction_type) filters.push(eq(commissions.transaction_type, query.transaction_type));
  if (query.status) filters.push(eq(commissions.status, query.status));
  if (query.effective_date_from) filters.push(gte(commissions.effective_date, query.effective_date_from));
  if (query.effective_date_to) filters.push(lte(commissions.effective_date, query.effective_date_to));
  if (query.producer_id) filters.push(eq(commissions.producer_id, query.producer_id));
  if (cursorWhere) filters.push(cursorWhere);

  const rows = await db
    .select()
    .from(commissions)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(...orderBy)
    .limit(queryLimit);

  // Map rows to API shape
  const mapped = rows.map((row) => ({
    commission_id: row.commission_id,
    policy_id: row.policy_id,
    carrier_code: row.carrier_code,
    transaction_type: row.transaction_type,
    gross_amount: row.gross_amount,
    net_amount: row.net_amount,
    commission_rate: row.commission_rate,
    effective_date: row.effective_date,
    payment_date: row.payment_date,
    status: row.status,
    producer_id: row.producer_id,
    created_at: row.created_at,
  }));

  return c.json(
    paginatedResponse(mapped, limit!, ["effective_date", "commission_id"], cursor),
  );
});

export { accountingRouter };
