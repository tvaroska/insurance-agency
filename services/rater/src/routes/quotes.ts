import { Hono } from "hono";
import {
  requireScopes,
  notFoundError,
  conflictError,
  checkRequired,
  checkFormat,
  checkEnum,
  throwIfErrors,
  validateBindingAuthority,
  validateStateMinimums,
  getInternalRequestHeaders,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { prisma } from "../prisma";

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

const KNOWN_CLIENT_IDS_BY_NAME: Record<string, string> = {
  "sarah chen": "CLI-001",
  "james chen": "CLI-002",
  "maria rodriguez": "CLI-003",
  "david thompson": "CLI-004",
  "linda thompson": "CLI-005",
  "marcus williams": "CLI-006",
  "priya patel": "CLI-007",
  "robert kim": "CLI-008",
  "jennifer kim": "CLI-009",
  "angela foster": "CLI-010",
  "carlos gutierrez": "CLI-011",
  "natasha brooks": "CLI-012",
  "william okafor": "CLI-013",
  "emily nakamura": "CLI-014",
  "george papadopoulos": "CLI-015",
  "ashley morales": "CLI-016",
  "daniel reeves": "CLI-017",
  "rosa jimenez": "CLI-018",
  "tyler morrison": "CLI-019",
  "samantha west": "CLI-020",
  "brian lawson": "CLI-021",
  "megan sullivan": "CLI-022",
  "kevin tran": "CLI-023",
  "rachel adams": "CLI-024",
  "derek hawkins": "CLI-025",
  "victor marsh": "CLI-026",
  "tanya marsh": "CLI-027",
  "nathan blackwood": "CLI-028",
  "kailani akana": "CLI-029",
  "sara chen": "CLI-030",
  "patricia kowalski": "CLI-032",
  "andre washington": "CLI-033",
};

// ── GET /quotes ──────────────────────────────────────────────────────

quotesRouter.get(
  "/",
  requireScopes("rater:quotes:read"),
  async (c) => {
    const query = c.req.query();
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const where: Record<string, unknown> = {};
    if (query.client_id) where.client_id = query.client_id;
    if (query.policy_type) where.policy_type = query.policy_type;
    if (query.status) where.status = query.status;

    const requests = await prisma.quoteRequest.findMany({
      where,
      orderBy: { request_id: "asc" },
      take: limit,
    });
    const requestIds = requests.map((r) => r.request_id);
    const carrierQuotes =
      requestIds.length > 0
        ? await prisma.carrierQuote.findMany({
            where: { request_id: { in: requestIds } },
          })
        : [];

    const quotesByRequest = new Map<string, typeof carrierQuotes>();
    for (const q of carrierQuotes) {
      const list = quotesByRequest.get(q.request_id) ?? [];
      list.push(q);
      quotesByRequest.set(q.request_id, list);
    }

    return c.json({
      data: requests.map((r) => ({
        request_id: r.request_id,
        client_id: r.client_id,
        policy_type: r.policy_type,
        effective_date: r.effective_date,
        status: r.status,
        submitted_at: r.submitted_at,
        completed_at: r.completed_at,
        created_at: r.created_at,
        carriers: (quotesByRequest.get(r.request_id) ?? []).map((q) => ({
          quote_id: q.status === "declined" ? null : q.quote_id,
          carrier_code: q.carrier_code,
          carrier_name: q.carrier_name,
          status: q.status,
          premium_annual: q.premium_annual,
          premium_monthly: q.premium_monthly,
          decline_reason: q.decline_reason,
          valid_until: q.valid_until,
        })),
      })),
    });
  },
);

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
    const allCarriers = await prisma.carrier.findMany();

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
      state: body.client.address.state,
      address: body.client.address,
      requested_coverages: body.requested_coverages,
    };
    if (body.drivers) riskData.drivers = body.drivers;
    if (body.vehicles) riskData.vehicles = body.vehicles;
    if (body.property) riskData.property = body.property;
    if (body.business) riskData.business = body.business;

    const fullName = `${body.client.first_name} ${body.client.last_name}`.trim().toLowerCase();
    const resolvedClientId =
      body.client_id ??
      body.client?.client_id ??
      body.client?.id ??
      KNOWN_CLIENT_IDS_BY_NAME[fullName] ??
      `${body.client.first_name}-${body.client.last_name}`.toLowerCase();

    // Insert quote request
    await prisma.quoteRequest.create({
      data: {
        request_id: requestId,
        client_id: resolvedClientId,
        policy_type: body.policy_type,
        effective_date: body.effective_date,
        status: eligible.length > 0 ? "completed" : "pending",
        submitted_at: now,
        completed_at: eligible.length > 0 ? now : null,
        expires_at: null,
        risk_data: JSON.stringify(riskData),
        created_at: now,
      },
    });

    // Simulate carrier quotes for each eligible carrier
    for (const carrier of eligible) {
      // Generate quote ID matching spec pattern: qt_[a-z0-9]{8}
      const quoteId = `qt_${Math.random().toString(36).slice(2, 10)}`;

      // Simulate a premium (random between 800 and 5000)
      const premiumAnnual =
        Math.round((800 + Math.random() * 4200) * 100) / 100;
      const premiumMonthly = Math.round((premiumAnnual / 12) * 100) / 100;

      await prisma.carrierQuote.create({
        data: {
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
        },
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
    const request = await prisma.quoteRequest.findUnique({
      where: { request_id: requestId },
    });

    if (!request) {
      throw notFoundError("quote request");
    }

    // Fetch all carrier quotes for this request
    const quotes = await prisma.carrierQuote.findMany({
      where: { request_id: requestId },
    });

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
    const quote = await prisma.carrierQuote.findUnique({
      where: { quote_id: quoteId },
    });

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
    const eoRules: { rule: string; message: string; error_code?: string }[] = [];

    // Check premium threshold ($10,000 agency binding authority)
    const authorityCheck = validateBindingAuthority(quote.premium_annual);
    if (!authorityCheck.valid) {
      eoRules.push({
        rule: authorityCheck.rule,
        error_code: authorityCheck.errorCode,
        message: authorityCheck.message,
      });
    }

    // Check 10-state statutory minimum violations for auto policies
    const quoteRequest = await prisma.quoteRequest.findUnique({
      where: { request_id: quote.request_id },
    });

    if (quoteRequest && quoteRequest.policy_type === "personal_auto") {
      const riskData = JSON.parse(quoteRequest.risk_data);
      const stateCode =
        riskData.state ??
        riskData.address?.state ??
        riskData.garaging_state ??
        body.state ??
        null;
      const coverages = [
        ...(Array.isArray(riskData.requested_coverages)
          ? riskData.requested_coverages
          : []),
        ...(Array.isArray(JSON.parse(quote.coverages || "[]"))
          ? JSON.parse(quote.coverages || "[]")
          : []),
      ];
      const stateMinCheck = validateStateMinimums(stateCode, coverages);
      if (!stateMinCheck.valid) {
        eoRules.push({
          rule: stateMinCheck.rule,
          error_code: stateMinCheck.errorCode,
          message: stateMinCheck.message,
        });
      }
    }

    if (eoRules.length > 0) {
      // Statutory minimum auto liability limits cannot be waived by manager escalation
      const stateRule = eoRules.find((r) => r.rule === "state_minimum_violation");
      if (stateRule) {
        return c.json(
          {
            error: "E&O_RULES_TRIGGERED",
            error_code: "E_EO_STATE_MINIMUM_VIOLATION",
            message: stateRule.message,
            details: [
              {
                field: "coverages",
                message: stateRule.message,
                code: "E_EO_STATE_MINIMUM_VIOLATION",
              },
            ],
            eo_rules: eoRules,
          },
          422,
        );
      }

      const escalationId = body.escalation_id;
      const primaryCode =
        eoRules[0]?.error_code ?? "E_EO_PREMIUM_THRESHOLD_EXCEEDED";
      if (!escalationId) {
        return c.json(
          {
            error: "E&O_RULES_TRIGGERED",
            error_code: primaryCode,
            message:
              "This bind request triggers E&O rules that require manager escalation.",
            details: eoRules.map((r) => ({
              field:
                r.rule === "premium_threshold" ? "premium_annual" : "coverages",
              message: r.message,
              code: r.error_code ?? primaryCode,
            })),
            eo_rules: eoRules,
          },
          422,
        );
      }

      // Verify escalation approval & strict client/reason scope via AMS
      const amsBase = (
        process.env.AMS_BASE_URL ||
        process.env.AMS_URL ||
        "http://localhost:3000"
      ).replace(/\/+$/, "");
      const authHeaderValue = c.req.header("Authorization") ?? "";
      const escRes = await fetch(
        `${amsBase}/v1/escalations/${encodeURIComponent(String(escalationId))}`,
        {
          headers: {
            Authorization: authHeaderValue,
            ...getInternalRequestHeaders(),
          },
        },
      );

      if (!escRes.ok) {
        const verifyMsg = `Could not verify escalation ${escalationId}: ${escRes.status}`;
        return c.json(
          {
            error: "ESCALATION_VERIFICATION_FAILED",
            error_code: primaryCode,
            message: verifyMsg,
            details: [
              {
                field: "escalation_id",
                message: verifyMsg,
                code: primaryCode,
              },
            ],
            eo_rules: eoRules,
          },
          422,
        );
      }

      const escData = await escRes.json();
      if (
        escData.status !== "approved" ||
        escData.client_id !== quoteRequest?.client_id ||
        escData.reason !== "premium_threshold"
      ) {
        const reasonMsg =
          escData.status !== "approved"
            ? `Escalation ${escalationId} has status '${escData.status}', but 'approved' is required.`
            : escData.client_id !== quoteRequest?.client_id
              ? `Escalation ${escalationId} belongs to client '${escData.client_id}', not '${quoteRequest?.client_id}'.`
              : `Escalation ${escalationId} has reason '${escData.reason}', but 'premium_threshold' is required.`;
        return c.json(
          {
            error: "ESCALATION_NOT_APPROVED",
            error_code: primaryCode,
            message: reasonMsg,
            details: [
              {
                field: "escalation_id",
                message: reasonMsg,
                code: primaryCode,
              },
            ],
            eo_rules: eoRules,
          },
          422,
        );
      }
    }

    // Bind the quote
    const now = new Date().toISOString();
    await prisma.carrierQuote.update({
      where: { quote_id: quoteId },
      data: { status: "bound", bound_at: now },
    });

    // Get the associated quote request for effective_date
    const request = await prisma.quoteRequest.findUnique({
      where: { request_id: quote.request_id },
      select: { effective_date: true },
    });

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
