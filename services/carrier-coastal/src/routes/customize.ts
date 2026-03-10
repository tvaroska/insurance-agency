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

const customizeRouter = new Hono<{ Variables: AppVariables }>();

// Coverage adjustment factors for premium recalculation
const LIMIT_FACTORS: Record<string, Record<string, number>> = {
  bodily_injury: { "25/50": 0.7, "50/100": 0.85, "100/300": 1.0, "250/500": 1.2, "500/500": 1.35 },
  property_damage: { "25000": 0.8, "50000": 1.0, "100000": 1.15, "250000": 1.3 },
  uninsured_motorist: { "25/50": 0.75, "50/100": 0.9, "100/300": 1.0, "250/500": 1.15 },
};

const DEDUCTIBLE_FACTORS: Record<string, Record<string, number>> = {
  collision: { "250": 1.15, "500": 1.0, "1000": 0.85, "2500": 0.7 },
  comprehensive: { "100": 1.2, "250": 1.0, "500": 0.85, "1000": 0.7 },
};

function recalcPremium(basePremium: number, coverages: Array<{ type: string; limit?: string | number; deductible?: number }>) {
  let factor = 1.0;

  for (const cov of coverages) {
    const limitKey = String(cov.limit || "");
    const dedKey = String(cov.deductible || "");

    if (LIMIT_FACTORS[cov.type]?.[limitKey]) {
      factor *= LIMIT_FACTORS[cov.type][limitKey];
    }
    if (DEDUCTIBLE_FACTORS[cov.type]?.[dedKey]) {
      factor *= DEDUCTIBLE_FACTORS[cov.type][dedKey];
    }
  }

  const annual = Math.round(basePremium * factor * 100) / 100;
  return {
    annual,
    semi_annual: Math.round(annual * 0.52 * 100) / 100,
    monthly: Math.round((annual / 12) * 100) / 100,
  };
}

// POST /quotes/:quote_id/recalculate — Real-time premium recalculation
customizeRouter.post(
  "/:quote_id/recalculate",
  requireScopes("carrier:quotes:read"),
  async (c) => {
    const quoteId = c.req.param("quote_id");
    const body = await c.req.json();

    const [quote] = await db
      .select()
      .from(quotes)
      .where(eq(quotes.quote_id, quoteId))
      .limit(1);

    if (!quote) {
      throw notFoundError("quote");
    }

    const coverages = body.coverages || JSON.parse(quote.coverages);
    const basePremium = quote.premium_annual || 1200;
    const premiums = recalcPremium(basePremium, coverages);

    return c.json({
      quote_id: quoteId,
      original_premium: { annual: quote.premium_annual, monthly: quote.premium_monthly },
      adjusted_premium: premiums,
      coverages,
    });
  },
);

export { customizeRouter };
