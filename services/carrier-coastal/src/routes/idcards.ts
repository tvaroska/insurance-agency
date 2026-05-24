import { Hono } from "hono";
import {
  requireScopes,
  notFoundError,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { prisma } from "../prisma";

type AppVariables = CorrelationVariables & AuthVariables;

const idCardsRouter = new Hono<{ Variables: AppVariables }>();

// GET /policies/:policy_id/id-card — Digital insurance ID card
idCardsRouter.get(
  "/:policy_id/id-card",
  requireScopes("carrier:policies:read"),
  async (c) => {
    const policyId = c.req.param("policy_id");

    const policy = await prisma.policy.findUnique({
      where: { policy_id: policyId },
    });

    if (!policy) {
      throw notFoundError("policy");
    }

    // Check for existing ID card
    const existingCard = await prisma.idCard.findFirst({
      where: { policy_id: policyId },
    });

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

    await prisma.idCard.create({
      data: {
        card_id: cardId,
        policy_id: policyId,
        card_data: JSON.stringify(cardData),
        issued_at: now,
      },
    });

    return c.json({
      card_id: cardId,
      policy_id: policyId,
      card_data: cardData,
      issued_at: now,
    });
  },
);

export { idCardsRouter };
