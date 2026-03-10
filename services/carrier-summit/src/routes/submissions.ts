import { Hono } from "hono";
import {
  requireScopes,
  checkRequired,
  throwIfErrors,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { quotes, underwritingConditions } from "../schema";

type AppVariables = CorrelationVariables & AuthVariables;

const submissionsRouter = new Hono<{ Variables: AppVariables }>();

// POST /submissions — Property submission (multi-step form)
submissionsRouter.post(
  "/",
  requireScopes("carrier:quotes:write"),
  async (c) => {
    const body = await c.req.json();

    throwIfErrors([
      checkRequired("client_id", body.client_id),
      checkRequired("policy_type", body.policy_type),
      checkRequired("property_address", body.property_address),
      checkRequired("property_details", body.property_details),
      checkRequired("coverages", body.coverages),
    ]);

    const now = new Date().toISOString();
    const quoteId = `QT-SMIT-${Date.now()}`;
    const requestId = `QR-${Date.now()}`;

    // Compute premium based on property details
    const details = body.property_details;
    const sqft = details.square_feet || 2000;
    const yearBuilt = details.year_built || 2000;
    const ageDiscount = Math.max(0, 1 - (2026 - yearBuilt) * 0.005);
    const basePremium = sqft * 0.85;
    const annualPremium = Math.round(basePremium * ageDiscount * 100) / 100;
    const monthlyPremium = Math.round((annualPremium / 12) * 100) / 100;

    // Schedule inspection automatically
    const inspectionDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.insert(quotes)
      .values({
        quote_id: quoteId,
        request_id: requestId,
        client_id: body.client_id,
        policy_type: body.policy_type,
        premium_annual: annualPremium,
        premium_monthly: monthlyPremium,
        coverages: JSON.stringify(body.coverages),
        deductibles: JSON.stringify(body.deductibles || {}),
        status: "submitted",
        submitted_at: now,
        underwriting_status: "pending_review",
        property_address: JSON.stringify(body.property_address),
        property_details: JSON.stringify(body.property_details),
        photo_checklist: JSON.stringify(body.photo_checklist || []),
        inspection_status: "scheduled",
        inspection_scheduled_at: inspectionDate,
      })
      .run();

    // Create default underwriting conditions
    const conditions = [
      { type: "inspection_required", desc: "4-point inspection report required (roof, electrical, plumbing, HVAC)" },
      { type: "document_required", desc: "Proof of prior insurance coverage required" },
      { type: "document_required", desc: "Property photos must be reviewed and verified" },
    ];

    let condCounter = 1;
    for (const cond of conditions) {
      db.insert(underwritingConditions)
        .values({
          condition_id: `COND-${quoteId}-${condCounter++}`,
          quote_id: quoteId,
          condition_type: cond.type,
          description: cond.desc,
          status: "pending",
          created_at: now,
        })
        .run();
    }

    return c.json(
      {
        quote_id: quoteId,
        request_id: requestId,
        client_id: body.client_id,
        policy_type: body.policy_type,
        premium_annual: annualPremium,
        premium_monthly: monthlyPremium,
        status: "submitted",
        inspection_status: "scheduled",
        inspection_scheduled_at: inspectionDate,
        conditions_count: conditions.length,
        submitted_at: now,
      },
      201,
    );
  },
);

export { submissionsRouter };
