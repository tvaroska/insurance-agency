import { Hono } from "hono";
import { eq, and, like } from "drizzle-orm";
import {
  requireScopes,
  notFoundError,
  conflictError,
  checkRequired,
  checkFormat,
  checkEnum,
  throwIfErrors,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { quoteRequests, carrierQuotes, carriers } from "../schema";

type AppVariables = CorrelationVariables & AuthVariables;

const quotesRouter = new Hono<{ Variables: AppVariables }>();

const POLICY_TYPES = [
  "personal_auto",
  "homeowners",
  "umbrella",
  "bop",
  "workers_comp",
  "general_liability",
  "professional_liability",
  "renters",
] as const;

const PAYMENT_METHODS = [
  "eft",
  "credit_card",
  "check",
  "mortgagee_billed",
] as const;

// ── POST /quotes/request ─────────────────────────────────────────────

quotesRouter.post(
  "/request",
  requireScopes("rater:quotes:create"),
  async (c) => {
    const body = await c.req.json();

    // Basic field validation
    const errors = [
      checkRequired("policy_type", body.policy_type),
      checkEnum("policy_type", body.policy_type, POLICY_TYPES),
      checkRequired("effective_date", body.effective_date),
      checkFormat(
        "effective_date",
        body.effective_date,
        /^\d{4}-\d{2}-\d{2}$/,
        "effective_date must be YYYY-MM-DD.",
      ),
      checkRequired("client", body.client),
      checkRequired("requested_coverages", body.requested_coverages),
    ];

    // Client sub-field validation
    if (body.client) {
      errors.push(
        checkRequired("client.first_name", body.client.first_name),
        checkRequired("client.last_name", body.client.last_name),
        checkRequired("client.address", body.client.address),
      );
      if (body.client.address) {
        errors.push(
          checkRequired("client.address.state", body.client.address.state),
          checkFormat(
            "client.address.state",
            body.client.address.state,
            /^[A-Z]{2}$/,
            "client.address.state must be a 2-letter state code.",
          ),
        );
      }
    }

    // Conditional requirements based on policy_type
    if (body.policy_type === "personal_auto") {
      errors.push(
        checkRequired("drivers", body.drivers),
        checkRequired("vehicles", body.vehicles),
      );
    }
    if (body.policy_type === "homeowners") {
      errors.push(checkRequired("property", body.property));
    }

    // Validate requested_coverages is an array with items
    if (
      body.requested_coverages !== undefined &&
      body.requested_coverages !== null
    ) {
      if (
        !Array.isArray(body.requested_coverages) ||
        body.requested_coverages.length === 0
      ) {
        errors.push({
          field: "requested_coverages",
          message: "requested_coverages must be a non-empty array.",
          code: "invalid_format" as const,
        });
      }
    }

    throwIfErrors(errors);

    // Find eligible carriers by state and policy_type
    const state = body.client.address.state;
    const allCarriers = await db.select().from(carriers);

    const eligible = allCarriers.filter((carrier) => {
      const states: string[] = JSON.parse(carrier.states);
      const policyTypes: string[] = JSON.parse(carrier.policy_types);
      return states.includes(state) && policyTypes.includes(body.policy_type);
    });

    // Generate request ID matching spec pattern: qr_[a-z0-9]{8}
    const requestId = `qr_${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();

    // Build risk_data JSON
    const riskData: Record<string, unknown> = {
      requested_coverages: body.requested_coverages,
    };
    if (body.drivers) riskData.drivers = body.drivers;
    if (body.vehicles) riskData.vehicles = body.vehicles;
    if (body.property) riskData.property = body.property;
    if (body.business) riskData.business = body.business;

    // Insert quote request
    await db.insert(quoteRequests).values({
      request_id: requestId,
      client_id: `${body.client.first_name}-${body.client.last_name}`.toLowerCase(),
      policy_type: body.policy_type,
      effective_date: body.effective_date,
      status: eligible.length > 0 ? "completed" : "pending",
      submitted_at: now,
      completed_at: eligible.length > 0 ? now : null,
      expires_at: null,
      risk_data: JSON.stringify(riskData),
      created_at: now,
    });

    // Simulate carrier quotes for each eligible carrier
    for (const carrier of eligible) {
      // Generate quote ID matching spec pattern: qt_[a-z0-9]{8}
      const quoteId = `qt_${Math.random().toString(36).slice(2, 10)}`;

      // Simulate a premium (random between 800 and 5000)
      const premiumAnnual =
        Math.round((800 + Math.random() * 4200) * 100) / 100;
      const premiumMonthly = Math.round((premiumAnnual / 12) * 100) / 100;

      await db.insert(carrierQuotes).values({
        quote_id: quoteId,
        request_id: requestId,
        carrier_code: carrier.carrier_code,
        carrier_name: carrier.carrier_name,
        status: "quoted",
        premium_annual: premiumAnnual,
        premium_monthly: premiumMonthly,
        coverages: JSON.stringify(body.requested_coverages),
        deductibles: "{}",
        decline_reason: null,
        valid_until: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        bound_at: null,
        created_at: now,
      });
    }

    // Estimated completion: 2 minutes from now
    const estimatedCompletion = new Date(
      Date.now() + 2 * 60 * 1000,
    ).toISOString();

    return c.json(
      {
        request_id: requestId,
        status: eligible.length > 0 ? "completed" : "pending",
        created_at: now,
        estimated_completion: estimatedCompletion,
        carriers_queried: eligible.length,
      },
      202,
    );
  },
);

// ── GET /quotes/:request_id/results ──────────────────────────────────

quotesRouter.get(
  "/:request_id/results",
  requireScopes("rater:quotes:read"),
  async (c) => {
    const requestId = c.req.param("request_id");

    // Fetch the quote request
    const [request] = await db
      .select()
      .from(quoteRequests)
      .where(eq(quoteRequests.request_id, requestId))
      .limit(1);

    if (!request) {
      throw notFoundError("quote request");
    }

    // Fetch all carrier quotes for this request
    const quotes = await db
      .select()
      .from(carrierQuotes)
      .where(eq(carrierQuotes.request_id, requestId));

    // Determine overall status
    let status = request.status;
    if (quotes.length > 0 && status !== "completed" && status !== "requires_info") {
      const allResolved = quotes.every(
        (q) => q.status !== "pending",
      );
      const someResolved = quotes.some(
        (q) => q.status !== "pending",
      );
      if (allResolved) status = "completed";
      else if (someResolved) status = "partial";
    }

    return c.json({
      request_id: request.request_id,
      status,
      policy_type: request.policy_type,
      effective_date: request.effective_date,
      created_at: request.created_at,
      completed_at: request.completed_at,
      carriers: quotes.map((q) => ({
        carrier_code: q.carrier_code,
        carrier_name: q.carrier_name,
        quote_id: q.status === "declined" ? null : q.quote_id,
        status: q.status,
        premium_annual: q.premium_annual,
        premium_monthly: q.premium_monthly,
        coverages: JSON.parse(q.coverages),
        deductibles: JSON.parse(q.deductibles),
        decline_reason: q.decline_reason,
        valid_until: q.valid_until,
      })),
    });
  },
);

// ── POST /quotes/:quote_id/bind ──────────────────────────────────────

quotesRouter.post(
  "/:quote_id/bind",
  requireScopes("rater:quotes:bind"),
  async (c) => {
    const quoteId = c.req.param("quote_id");
    const body = await c.req.json();

    // Validate request body
    throwIfErrors([
      checkRequired("payment_method", body.payment_method),
      checkEnum("payment_method", body.payment_method, PAYMENT_METHODS),
      checkRequired("producer_id", body.producer_id),
      checkRequired(
        "insured_signature_collected",
        body.insured_signature_collected,
      ),
      checkRequired(
        "insured_signature_date",
        body.insured_signature_date,
      ),
      checkFormat(
        "insured_signature_date",
        body.insured_signature_date,
        /^\d{4}-\d{2}-\d{2}$/,
        "insured_signature_date must be YYYY-MM-DD.",
      ),
    ]);

    if (body.insured_signature_collected !== true) {
      throwIfErrors([
        {
          field: "insured_signature_collected",
          message: "insured_signature_collected must be true to bind.",
          code: "invalid_format" as const,
        },
      ]);
    }

    // Look up the quote
    const [quote] = await db
      .select()
      .from(carrierQuotes)
      .where(eq(carrierQuotes.quote_id, quoteId))
      .limit(1);

    if (!quote) {
      throw notFoundError("quote");
    }

    // Check if already bound
    if (quote.status === "bound") {
      throw conflictError(
        `Quote ${quoteId} is already bound.`,
      );
    }

    // Check if declined
    if (quote.status === "declined") {
      throw conflictError(
        `Cannot bind declined quote ${quoteId}.`,
      );
    }

    // ── E&O Enforcement ──────────────────────────────────────────────
    const eoRules: { rule: string; message: string }[] = [];

    // Check premium threshold
    if (quote.premium_annual != null && quote.premium_annual > 10000) {
      eoRules.push({
        rule: "premium_threshold",
        message: `Premium of $${quote.premium_annual.toFixed(2)} exceeds the $10,000 threshold requiring manager approval.`,
      });
    }

    // Check state minimum violations for auto policies
    const [quoteRequest] = await db
      .select()
      .from(quoteRequests)
      .where(eq(quoteRequests.request_id, quote.request_id))
      .limit(1);

    if (quoteRequest && quoteRequest.policy_type === "personal_auto") {
      const riskData = JSON.parse(quoteRequest.risk_data);
      const coverages = riskData.requested_coverages ?? [];
      const biCoverage = coverages.find(
        (cov: any) => cov.coverage_type === "bodily_injury",
      );
      if (biCoverage && biCoverage.per_person_limit < 25000) {
        eoRules.push({
          rule: "state_minimum_violation",
          message: "Bodily injury per-person limit is below the state minimum of $25,000.",
        });
      }
    }

    if (eoRules.length > 0) {
      const escalationId = body.escalation_id;
      if (!escalationId) {
        return c.json(
          {
            error: "E&O_RULES_TRIGGERED",
            message: "This bind request triggers E&O rules that require manager escalation.",
            eo_rules: eoRules,
          },
          409,
        );
      }

      // Verify escalation approval via AMS
      const amsBase = process.env.AMS_BASE_URL ?? "http://localhost:3000";
      const authHeaderValue = c.req.header("Authorization") ?? "";
      const escRes = await fetch(`${amsBase}/v1/escalations/${escalationId}`, {
        headers: { Authorization: authHeaderValue },
      });

      if (!escRes.ok) {
        return c.json(
          {
            error: "ESCALATION_VERIFICATION_FAILED",
            message: `Could not verify escalation ${escalationId}: ${escRes.status}`,
            eo_rules: eoRules,
          },
          409,
        );
      }

      const escData = await escRes.json();
      if (escData.status !== "approved") {
        return c.json(
          {
            error: "ESCALATION_NOT_APPROVED",
            message: `Escalation ${escalationId} has status '${escData.status}', but 'approved' is required.`,
            eo_rules: eoRules,
          },
          409,
        );
      }
    }

    // Bind the quote
    const now = new Date().toISOString();
    await db
      .update(carrierQuotes)
      .set({ status: "bound", bound_at: now })
      .where(eq(carrierQuotes.quote_id, quoteId));

    // Get the associated quote request for effective_date
    const [request] = await db
      .select({ effective_date: quoteRequests.effective_date })
      .from(quoteRequests)
      .where(eq(quoteRequests.request_id, quote.request_id))
      .limit(1);

    // Generate policy ID
    const year = new Date().getFullYear();
    const policySeq = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    const policyId = `POL-${quote.carrier_code}-${year}-${policySeq}`;

    // Calculate expiration date (1 year from effective date)
    const effectiveDate = request?.effective_date ?? null;
    let expirationDate: string | null = null;
    if (effectiveDate) {
      const expDate = new Date(effectiveDate);
      expDate.setFullYear(expDate.getFullYear() + 1);
      expirationDate = expDate.toISOString().split("T")[0];
    }

    return c.json(
      {
        policy_id: policyId,
        quote_id: quoteId,
        carrier_code: quote.carrier_code,
        carrier_name: quote.carrier_name,
        effective_date: effectiveDate,
        expiration_date: expirationDate,
        premium_annual: quote.premium_annual,
        premium_monthly: quote.premium_monthly,
        bind_status: "bound",
        bound_at: now,
        policy_documents_url: `http://localhost:3001/v1/policies/${policyId}/documents`,
      },
      201,
    );
  },
);

export { quotesRouter };
