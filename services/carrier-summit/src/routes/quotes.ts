import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  requireScopes,
  notFoundError,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { quotes } from "../schema";

type AppVariables = CorrelationVariables & AuthVariables;

const quotesRouter = new Hono<{ Variables: AppVariables }>();

// GET /quotes/:quote_id — Quote lookup from underwriting system
quotesRouter.get(
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
      request_id: quote.request_id,
      client_id: quote.client_id,
      policy_type: quote.policy_type,
      premium_annual: quote.premium_annual,
      premium_monthly: quote.premium_monthly,
      coverages: JSON.parse(quote.coverages),
      deductibles: JSON.parse(quote.deductibles),
      status: quote.status,
      decline_reason: quote.decline_reason,
      valid_until: quote.valid_until,
      submitted_at: quote.submitted_at,
      underwriting_status: quote.underwriting_status,
      underwriting_notes: quote.underwriting_notes,
    });
  },
);

export { quotesRouter };
