import { Hono } from "hono";
import { like, and } from "drizzle-orm";
import {
  requireScopes,
  parsePaginationParams,
  applyCursorPagination,
  paginatedResponse,
  checkEnum,
  throwIfErrors,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { carriers } from "../schema";

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
      limit: queryLimit,
    } = applyCursorPagination({
      cursor,
      limit: limit!,
      orderBy: [{ column: carriers.carrier_code, direction: "asc" }],
    });

    // Build filter conditions
    const filters: ReturnType<typeof like>[] = [];

    if (query.state) {
      // SQLite JSON containment: check if the state code is in the JSON array
      filters.push(like(carriers.states, `%"${query.state}"%`));
    }
    if (query.policy_type) {
      filters.push(like(carriers.policy_types, `%"${query.policy_type}"%`));
    }
    if (query.risk_category) {
      filters.push(
        like(carriers.risk_categories, `%"${query.risk_category}"%`),
      );
    }
    if (cursorWhere) filters.push(cursorWhere as ReturnType<typeof like>);

    const rows = await db
      .select()
      .from(carriers)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(...orderBy)
      .limit(queryLimit);

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
