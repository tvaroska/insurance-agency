import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  requireScopes,
  notFoundError,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { policies, idCards } from "../schema";

type AppVariables = CorrelationVariables & AuthVariables;

const idCardsRouter = new Hono<{ Variables: AppVariables }>();

// GET /policies/:policy_id/id-card — Digital insurance ID card
idCardsRouter.get(
  "/:policy_id/id-card",
  requireScopes("carrier:policies:read"),
  async (c) => {
    const policyId = c.req.param("policy_id");

    const [policy] = await db
      .select()
      .from(policies)
      .where(eq(policies.policy_id, policyId))
      .limit(1);

    if (!policy) {
      throw notFoundError("policy");
    }

    // Check for existing ID card
    const [existingCard] = await db
      .select()
      .from(idCards)
      .where(eq(idCards.policy_id, policyId))
      .limit(1);

    if (existingCard) {
      return c.json({
        card_id: existingCard.card_id,
        policy_id: policyId,
        card_data: JSON.parse(existingCard.card_data),
        issued_at: existingCard.issued_at,
      });
    }

    // Generate ID card on the fly
    const now = new Date().toISOString();
    const cardId = `IDC-${policyId.replace(/[^A-Z0-9]/g, "").substring(0, 8)}-${Date.now()}`;
    const coverages = JSON.parse(policy.coverages);

    const cardData = {
      carrier: "Coastal Star Insurance",
      carrier_code: "CSTL",
      policy_number: policyId,
      insured_name: policy.client_id,
      policy_type: policy.policy_type,
      effective_date: policy.effective_date,
      expiration_date: policy.expiration_date,
      coverages_summary: coverages.map((c: { type: string; limit?: string | number }) => ({
        type: c.type,
        limit: c.limit,
      })),
    };

    db.insert(idCards)
      .values({
        card_id: cardId,
        policy_id: policyId,
        card_data: JSON.stringify(cardData),
        issued_at: now,
      })
      .run();

    return c.json({
      card_id: cardId,
      policy_id: policyId,
      card_data: cardData,
      issued_at: now,
    });
  },
);

export { idCardsRouter };
