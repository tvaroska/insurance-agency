import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  requireScopes,
  notFoundError,
  conflictError,
  validationError,
  checkRequired,
  checkEnum,
  throwIfErrors,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { quotes, policies } from "../schema";

type AppVariables = CorrelationVariables & AuthVariables;

const bindingRouter = new Hono<{ Variables: AppVariables }>();

// POST /quotes/:quote_id/bind — Bind confirmation
bindingRouter.post(
  "/:quote_id/bind",
  requireScopes("carrier:underwriting:write"),
  async (c) => {
    const quoteId = c.req.param("quote_id");
    const body = await c.req.json();

    throwIfErrors([
      checkRequired("effective_date", body.effective_date),
      checkEnum("payment_plan", body.payment_plan, [
        "annual",
        "monthly",
        "semi_annual",
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

    // Cannot bind already-bound quotes
    if (quote.bind_status === "bound") {
      throw conflictError("Quote has already been bound.");
    }

    // Must be assessed before binding
    if (quote.status !== "assessed") {
      throw validationError([
        {
          field: "quote_id",
          message: `Quote must be assessed before binding. Current status: '${quote.status}'.`,
        },
      ]);
    }

    const now = new Date().toISOString();
    const effectiveDate = body.effective_date;
    const [year, month, day] = effectiveDate.split("-").map(Number);
    const expirationDate = `${year + 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const policyId = `POL-CSTL-${Date.now()}`;

    // Create policy
    db.insert(policies)
      .values({
        policy_id: policyId,
        client_id: quote.client_id,
        policy_type: quote.policy_type,
        effective_date: effectiveDate,
        expiration_date: expirationDate,
        premium_current: quote.premium_annual ?? 0,
        status: "active",
        coverages: quote.coverages,
        created_at: now,
        updated_at: now,
      })
      .run();

    // Update quote
    await db
      .update(quotes)
      .set({
        status: "bound",
        bind_status: "bound",
        bound_at: now,
        policy_id: policyId,
      })
      .where(eq(quotes.quote_id, quoteId))
      .run();

    return c.json({
      quote_id: quoteId,
      policy_id: policyId,
      bind_status: "bound",
      effective_date: effectiveDate,
      expiration_date: expirationDate,
      premium_current: quote.premium_annual ?? 0,
      bound_at: now,
    });
  },
);

export { bindingRouter };
