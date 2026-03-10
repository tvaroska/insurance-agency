import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  requireScopes,
  notFoundError,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { quotes, underwritingConditions } from "../schema";

type AppVariables = CorrelationVariables & AuthVariables;

const inspectionsRouter = new Hono<{ Variables: AppVariables }>();

// GET /inspections/:quote_id — Inspection status
inspectionsRouter.get(
  "/:quote_id",
  requireScopes("carrier:quotes:read"),
  async (c) => {
    const quoteId = c.req.param("quote_id");

    const [quote] = await db
      .select()
      .from(quotes)
      .where(eq(quotes.quote_id, quoteId))
      .limit(1);

    if (!quote) {
      throw notFoundError("quote");
    }

    return c.json({
      quote_id: quote.quote_id,
      inspection_status: quote.inspection_status,
      inspection_scheduled_at: quote.inspection_scheduled_at,
      inspection_completed_at: quote.inspection_completed_at,
      inspection_notes: quote.inspection_notes,
      property_address: quote.property_address ? JSON.parse(quote.property_address) : null,
      property_details: quote.property_details ? JSON.parse(quote.property_details) : null,
    });
  },
);

// GET /inspections/:quote_id/conditions — Underwriting conditions
inspectionsRouter.get(
  "/:quote_id/conditions",
  requireScopes("carrier:quotes:read"),
  async (c) => {
    const quoteId = c.req.param("quote_id");

    const [quote] = await db
      .select()
      .from(quotes)
      .where(eq(quotes.quote_id, quoteId))
      .limit(1);

    if (!quote) {
      throw notFoundError("quote");
    }

    const conditions = await db
      .select()
      .from(underwritingConditions)
      .where(eq(underwritingConditions.quote_id, quoteId));

    return c.json({
      quote_id: quoteId,
      conditions_count: conditions.length,
      conditions: conditions.map((c) => ({
        condition_id: c.condition_id,
        condition_type: c.condition_type,
        description: c.description,
        status: c.status,
        created_at: c.created_at,
        resolved_at: c.resolved_at,
      })),
    });
  },
);

export { inspectionsRouter };
