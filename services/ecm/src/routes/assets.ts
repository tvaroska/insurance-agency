import { Hono } from "hono";
import {
  requireScopes,
  checkEnum,
  throwIfErrors,
  parsePaginationParams,
  applyPrismaCursorPagination,
  paginatedResponse,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { prisma } from "../prisma";

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

    const { where: cursorWhere, orderBy, take } =
      applyPrismaCursorPagination({
        cursor,
        limit: limit!,
        orderBy: [
          { field: "published_date", direction: "desc" },
          { field: "asset_id", direction: "desc" },
        ],
      });

    const filters: Record<string, unknown>[] = [];
    if (query.category) {
      filters.push({ category: query.category });
    }
    if (cursorWhere) {
      filters.push(cursorWhere);
    }

    const rows = await prisma.marketingAsset.findMany({
      where: filters.length > 0 ? { AND: filters } : undefined,
      orderBy,
      take,
    });

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
