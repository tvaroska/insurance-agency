import { Hono } from "hono";
import {
  requireScopes,
  parsePaginationParams,
  applyPrismaCursorPagination,
  paginatedResponse,
  checkEnum,
  throwIfErrors,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { prisma } from "../prisma";

type AppVariables = CorrelationVariables & AuthVariables;

const carriersRouter = new Hono<{ Variables: AppVariables }>();

const RISK_CATEGORIES = ["preferred", "standard", "non_standard"] as const;

const listCarriers = async (c: any) => {
    const query = c.req.query();

    // Validate filters
    throwIfErrors([
      checkEnum("risk_category", query.risk_category, RISK_CATEGORIES),
    ]);

    const { limit, cursor } = parsePaginationParams(query);

    // Build cursor pagination ordered by carrier_code ASC
    const {
      where: cursorWhere,
      orderBy,
      take,
    } = applyPrismaCursorPagination({
      cursor,
      limit: limit!,
      orderBy: [{ field: "carrier_code", direction: "asc" }],
    });

    // Build filter conditions
    const filters: Record<string, unknown>[] = [];

    if (query.state) {
      // JSON containment: check if the state code is in the JSON array string
      filters.push({ states: { contains: query.state } });
    }
    if (query.policy_type) {
      filters.push({ policy_types: { contains: query.policy_type } });
    }
    if (query.risk_category) {
      filters.push({ risk_categories: { contains: query.risk_category } });
    }
    if (cursorWhere) filters.push(cursorWhere);

    const rows = await prisma.carrier.findMany({
      where: filters.length > 0 ? { AND: filters } : undefined,
      orderBy,
      take,
    });

    // Parse JSON fields for response
    const mapped = rows.map((row) => ({
      carrier_code: row.carrier_code,
      carrier_name: row.carrier_name,
      states: JSON.parse(row.states),
      policy_types: JSON.parse(row.policy_types),
      risk_categories: JSON.parse(row.risk_categories),
      appetite_level: row.appetite_level,
      min_driver_age: row.min_driver_age,
      max_vehicles: row.max_vehicles,
      accepts_sr22: row.accepts_sr22,
      surplus_lines_only: row.surplus_lines_only,
      sr22_available: row.sr22_available,
      citizens_eligible: row.citizens_eligible,
      state_restrictions: JSON.parse(row.state_restrictions),
    }));

    return c.json(
      paginatedResponse(mapped, limit!, ["carrier_code"], cursor),
    );
  };

carriersRouter.get("/appetite", requireScopes("rater:carriers:read"), listCarriers);
carriersRouter.get("/", requireScopes("rater:carriers:read"), listCarriers);

export { carriersRouter };
