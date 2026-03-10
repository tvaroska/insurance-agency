import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  requireScopes,
  notFoundError,
  conflictError,
  checkRequired,
  throwIfErrors,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { quotes } from "../schema";

type AppVariables = CorrelationVariables & AuthVariables;

const quotesRouter = new Hono<{ Variables: AppVariables }>();

// ── Risk assessment helpers ─────────────────────────────────────────

function computeRiskScore(quoteId: string): number {
  let hash = 0;
  for (let i = 0; i < quoteId.length; i++) {
    hash = (hash * 31 + quoteId.charCodeAt(i)) & 0x7fffffff;
  }
  return (hash % 60) + 30;
}

function riskTier(score: number): string {
  if (score >= 75) return "preferred";
  if (score >= 50) return "standard";
  return "non_standard";
}

function generateRiskFactors(score: number) {
  return [
    {
      factor: "driver_age",
      impact: score >= 60 ? "positive" : "neutral",
      detail: score >= 60 ? "Primary driver in preferred age range" : "Driver age within acceptable range",
    },
    {
      factor: "vehicle_value",
      impact: score >= 70 ? "positive" : "neutral",
      detail: score >= 70 ? "Vehicle value within low-risk tier" : "Vehicle value is moderate",
    },
    {
      factor: "claims_history",
      impact: score >= 50 ? "positive" : "negative",
      detail: score >= 50 ? "No claims in past 3 years" : "Recent claims on file",
    },
  ];
}

function recommendation(score: number): string {
  if (score >= 65) return "approve";
  if (score >= 45) return "review";
  return "decline";
}

// POST /quotes/submit — Quote submission with risk assessment
quotesRouter.post(
  "/submit",
  requireScopes("carrier:quotes:write"),
  async (c) => {
    const body = await c.req.json();

    // If no quote_id provided, create a new quote from submitted details
    if (!body.quote_id) {
      throwIfErrors([
        checkRequired("client_id", body.client_id),
        checkRequired("policy_type", body.policy_type),
        checkRequired("effective_date", body.effective_date),
      ]);

      const now = new Date().toISOString();
      const newQuoteId = `QT-CSTL-${Date.now()}`;
      const requestId = `QR-${Date.now()}`;

      const coverages = body.coverages || [];
      const score = computeRiskScore(newQuoteId);
      const tier = riskTier(score);
      const factors = generateRiskFactors(score);

      // Base premium from policy type
      let annual = body.policy_type === "bop" ? 2800 : 1400;
      annual = Math.round(annual * (1 + (score - 50) / 100) * 100) / 100;

      await db.insert(quotes).values({
        quote_id: newQuoteId,
        request_id: requestId,
        client_id: body.client_id,
        policy_type: body.policy_type,
        premium_annual: annual,
        premium_monthly: Math.round((annual / 12) * 100) / 100,
        coverages: JSON.stringify(coverages),
        deductibles: JSON.stringify({}),
        status: "assessed",
        submitted_at: now,
        risk_score: score,
        risk_tier: tier,
        risk_factors: JSON.stringify(factors),
        assessed_at: now,
      }).run();

      return c.json(
        {
          quote_id: newQuoteId,
          request_id: requestId,
          client_id: body.client_id,
          policy_type: body.policy_type,
          premium_annual: annual,
          premium_monthly: Math.round((annual / 12) * 100) / 100,
          coverages,
          status: "assessed",
          risk_score: score,
          risk_tier: tier,
          assessed_at: now,
        },
        201,
      );
    }

    const quoteId = body.quote_id;

    // Check quote exists
    const [quote] = await db
      .select()
      .from(quotes)
      .where(eq(quotes.quote_id, quoteId))
      .limit(1);

    if (!quote) {
      throw notFoundError("quote");
    }

    // Cannot submit already-submitted quotes
    if (quote.status !== "quoted") {
      throw conflictError(
        `Quote already has status '${quote.status}'. Only 'quoted' quotes can be submitted.`,
      );
    }

    // Generate risk assessment
    const score = computeRiskScore(quoteId);
    const tier = riskTier(score);
    const factors = generateRiskFactors(score);
    const now = new Date().toISOString();

    // Update quote with risk assessment
    await db
      .update(quotes)
      .set({
        status: "assessed",
        risk_score: score,
        risk_tier: tier,
        risk_factors: JSON.stringify(factors),
        assessed_at: now,
      })
      .where(eq(quotes.quote_id, quoteId))
      .run();

    // Fetch updated quote
    const [updated] = await db
      .select()
      .from(quotes)
      .where(eq(quotes.quote_id, quoteId))
      .limit(1);

    return c.json(
      {
        quote_id: updated.quote_id,
        request_id: updated.request_id,
        client_id: updated.client_id,
        policy_type: updated.policy_type,
        premium_annual: updated.premium_annual,
        premium_monthly: updated.premium_monthly,
        coverages: JSON.parse(updated.coverages),
        deductibles: JSON.parse(updated.deductibles),
        status: updated.status,
        risk_score: updated.risk_score,
        risk_tier: updated.risk_tier,
        assessed_at: updated.assessed_at,
        submitted_at: updated.submitted_at,
      },
      201,
    );
  },
);

// GET /quotes/:quote_id/risk-assessment — Risk assessment display
quotesRouter.get(
  "/:quote_id/risk-assessment",
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

    if (!quote.risk_score || !quote.assessed_at) {
      throw notFoundError("risk assessment");
    }

    return c.json({
      quote_id: quote.quote_id,
      risk_score: quote.risk_score,
      risk_tier: quote.risk_tier,
      factors: JSON.parse(quote.risk_factors!),
      recommendation: recommendation(quote.risk_score),
      assessed_at: quote.assessed_at,
    });
  },
);

export { quotesRouter };
