import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  requireScopes,
  notFoundError,
  conflictError,
  checkRequired,
  checkEnum,
  throwIfErrors,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { quotes } from "../schema";

type AppVariables = CorrelationVariables & AuthVariables;

const underwritingRouter = new Hono<{ Variables: AppVariables }>();

// POST /underwriting/:quote_id/decision — Underwriting decision simulation
underwritingRouter.post(
  "/:quote_id/decision",
  requireScopes("carrier:underwriting:write"),
  async (c) => {
    const quoteId = c.req.param("quote_id");
    const body = await c.req.json();

    // Validate request body
    throwIfErrors([
      checkRequired("decision", body.decision),
      checkEnum("decision", body.decision, [
        "approve",
        "decline",
        "refer",
      ]),
    ]);

    // Check quote exists
    const [quote] = await db
      .select()
      .from(quotes)
      .where(eq(quotes.quote_id, quoteId))
      .limit(1);

    if (!quote) {
      throw notFoundError("quote");
    }

    // Cannot make decisions on already-decided quotes
    if (quote.underwriting_status === "approved" || quote.underwriting_status === "declined") {
      throw conflictError(
        `Quote already has underwriting decision '${quote.underwriting_status}'.`,
      );
    }

    // Map decision to underwriting status
    const statusMap: Record<string, string> = {
      approve: "approved",
      decline: "declined",
      refer: "referred",
    };

    const newStatus = statusMap[body.decision];
    const now = new Date().toISOString();

    // Update quote
    await db
      .update(quotes)
      .set({
        underwriting_status: newStatus,
        underwriting_notes: body.notes ?? null,
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
        decline_reason: updated.decline_reason,
        valid_until: updated.valid_until,
        submitted_at: updated.submitted_at,
        underwriting_status: updated.underwriting_status,
        underwriting_notes: updated.underwriting_notes,
        decided_at: now,
      },
      200,
    );
  },
);

export { underwritingRouter };
