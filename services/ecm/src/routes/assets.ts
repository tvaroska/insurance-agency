import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import {
  requireScopes,
  checkEnum,
  throwIfErrors,
  parsePaginationParams,
  applyCursorPagination,
  paginatedResponse,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { marketingAssets } from "../schema";

type AppVariables = CorrelationVariables & AuthVariables;

const ASSET_CATEGORIES = [
  "welcome_kit",
  "flyer",
  "comparison_template",
  "social_media",
] as const;

export const assetsRouter = new Hono<{ Variables: AppVariables }>();

// ── GET /marketing ──────────────────────────────────────────────────

assetsRouter.get(
  "/marketing",
  requireScopes("ecm:assets:read"),
  async (c) => {
    const query = c.req.query();
    const { limit, cursor } = parsePaginationParams(query);

    // Validate category if provided
    if (query.category) {
      throwIfErrors([
        checkEnum("category", query.category, ASSET_CATEGORIES),
      ]);
    }

    const { where: cursorWhere, orderBy, limit: queryLimit } =
      applyCursorPagination({
        cursor,
        limit: limit!,
        orderBy: [
          { column: marketingAssets.published_date, direction: "desc" },
          { column: marketingAssets.asset_id, direction: "desc" },
        ],
      });

    const filters: ReturnType<typeof eq>[] = [];
    if (query.category) {
      filters.push(eq(marketingAssets.category, query.category));
    }
    if (cursorWhere) {
      filters.push(cursorWhere);
    }

    const rows = await db
      .select()
      .from(marketingAssets)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(...orderBy)
      .limit(queryLimit);

    return c.json(
      paginatedResponse(
        rows,
        limit!,
        ["published_date", "asset_id"],
        cursor,
      ),
    );
  },
);
