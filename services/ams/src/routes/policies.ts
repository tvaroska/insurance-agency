import { Hono } from "hono";
import {
  requireScopes,
  notFoundError,
  conflictError,
  validationError,
  checkRequired,
  checkFormat,
  checkEnum,
  checkMaxLength,
  throwIfErrors,
  parsePaginationParams,
  applyPrismaCursorPagination,
  paginatedResponse,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { prisma } from "../prisma";

type AppVariables = CorrelationVariables & AuthVariables;

const policiesRouter = new Hono<{ Variables: AppVariables }>();

const POLICY_TYPES = [
  "personal_auto",
  "homeowners",
  "renters",
  "umbrella",
  "bop",
  "workers_comp",
  "general_liability",
  "professional_liability",
] as const;

const POLICY_STATUSES = [
  "active",
  "pending",
  "cancelled",
  "expired",
  "non_renewed",
] as const;

// ── List policies ────────────────────────────────────────────────────

policiesRouter.get("/", requireScopes("ams:policies:read"), async (c) => {
  const query = c.req.query();

  // Validate enum filters
  if (query.status) {
    throwIfErrors([checkEnum("status", query.status, POLICY_STATUSES)]);
  }
  if (query.policy_type) {
    throwIfErrors([checkEnum("policy_type", query.policy_type, POLICY_TYPES)]);
  }

  const { limit, cursor } = parsePaginationParams(query);
  const { where: cursorWhere, orderBy, take } = applyPrismaCursorPagination({
    cursor,
    limit: limit!,
    orderBy: [
      { field: "expiration_date", direction: "desc" },
      { field: "policy_id", direction: "desc" },
    ],
  });

  const filters: Record<string, unknown>[] = [];
  if (query.status) filters.push({ status: query.status });
  if (query.client_id) filters.push({ client_id: query.client_id });
  if (query.policy_type) filters.push({ policy_type: query.policy_type });
  if (query.expiration_before) filters.push({ expiration_date: { lte: query.expiration_before } });
  if (query.expiration_after) filters.push({ expiration_date: { gte: query.expiration_after } });
  if (cursorWhere) filters.push(cursorWhere);

  const rows = await prisma.policy.findMany({
    where: filters.length > 0 ? { AND: filters } : undefined,
    orderBy,
    take,
  });

  return c.json(paginatedResponse(rows, limit!, ["expiration_date", "policy_id"], cursor));
});

// ── Get policy by ID ─────────────────────────────────────────────────

policiesRouter.get("/:id", requireScopes("ams:policies:read"), async (c) => {
  const policyId = c.req.param("id");
  const policy = await prisma.policy.findUnique({ where: { policy_id: policyId } });
  if (!policy) throw notFoundError("policy");
  const policyCoverages = await prisma.coverage.findMany({ where: { policy_id: policyId } });
  return c.json({ ...policy, coverages: policyCoverages });
});

// ── Create policy ─────────────────────────────────────────────────────

policiesRouter.post("/", requireScopes("ams:policies:write"), async (c) => {
  const body = await c.req.json();

  // Validate required fields
  throwIfErrors([
    checkRequired("client_id", body.client_id),
    checkRequired("policy_type", body.policy_type),
    checkRequired("carrier_code", body.carrier_code),
    checkRequired("effective_date", body.effective_date),
    checkRequired("expiration_date", body.expiration_date),
    checkRequired("annual_premium", body.annual_premium),
    body.policy_type ? checkEnum("policy_type", body.policy_type, POLICY_TYPES) : null,
    body.status !== undefined ? checkEnum("status", body.status, POLICY_STATUSES) : null,
    body.effective_date
      ? checkFormat("effective_date", body.effective_date, /^\d{4}-\d{2}-\d{2}$/, "effective_date must be YYYY-MM-DD.")
      : null,
    body.expiration_date
      ? checkFormat("expiration_date", body.expiration_date, /^\d{4}-\d{2}-\d{2}$/, "expiration_date must be YYYY-MM-DD.")
      : null,
  ]);

  // Validate annual_premium is a non-negative number
  if (body.annual_premium !== undefined && (typeof body.annual_premium !== "number" || body.annual_premium < 0)) {
    throw validationError([
      { field: "annual_premium", message: "annual_premium must be a non-negative number.", code: "invalid" },
    ]);
  }

  // Validate coverages
  if (!Array.isArray(body.coverages) || body.coverages.length === 0) {
    throw validationError([
      { field: "coverages", message: "coverages must be a non-empty array.", code: "required" },
    ]);
  }

  for (let i = 0; i < body.coverages.length; i++) {
    const cov = body.coverages[i];
    if (!cov.type || typeof cov.type !== "string") {
      throw validationError([
        { field: `coverages[${i}].type`, message: "Each coverage must have a type.", code: "required" },
      ]);
    }
  }

  // Verify client exists
  const client = await prisma.client.findUnique({
    where: { id: body.client_id },
    select: { id: true },
  });

  if (!client) {
    throw notFoundError("client");
  }

  const now = new Date().toISOString();
  const policyId = `POL-${Math.random().toString(36).slice(2, 8)}`;

  const record = {
    policy_id: policyId,
    client_id: body.client_id,
    carrier_code: body.carrier_code,
    policy_type: body.policy_type,
    effective_date: body.effective_date,
    expiration_date: body.expiration_date,
    premium_current: body.annual_premium,
    premium_prior: null,
    status: body.status ?? "pending",
    multi_policy_discount: body.multi_policy_discount ?? false,
    created_at: now,
    updated_at: now,
  };

  await prisma.policy.create({ data: record });

  // Insert coverages
  const coverageRecords = body.coverages.map((cov: { type: string; limit?: string; deductible?: number }) => ({
    policy_id: policyId,
    type: cov.type,
    limit: cov.limit ?? null,
    deductible: cov.deductible ?? null,
  }));

  for (const covRecord of coverageRecords) {
    await prisma.coverage.create({ data: covRecord });
  }

  return c.json(
    {
      policy_id: record.policy_id,
      client_id: record.client_id,
      carrier_code: record.carrier_code,
      policy_type: record.policy_type,
      effective_date: record.effective_date,
      expiration_date: record.expiration_date,
      annual_premium: record.premium_current,
      status: record.status,
      multi_policy_discount: record.multi_policy_discount,
      coverages: body.coverages,
      created_at: record.created_at,
      updated_at: record.updated_at,
    },
    201,
  );
});

// ── List endorsements for a policy ────────────────────────────────────

policiesRouter.get(
  "/:id/endorsements",
  requireScopes("ams:policies:read"),
  async (c) => {
    const policyId = c.req.param("id");

    const policy = await prisma.policy.findUnique({
      where: { policy_id: policyId },
      select: { policy_id: true },
    });

    if (!policy) {
      throw notFoundError("policy");
    }

    const rows = await prisma.endorsement.findMany({
      where: { policy_id: policyId },
      orderBy: { created_at: "asc" },
    });

    const data = rows.map((row) => {
      let parsedChanges: unknown = row.changes;
      try {
        parsedChanges = JSON.parse(row.changes);
      } catch {
        // Keep raw string if not JSON
      }
      return {
        endorsement_id: row.endorsement_id,
        policy_id: row.policy_id,
        effective_date: row.effective_date,
        change_type: row.change_type,
        changes: parsedChanges,
        premium_delta: row.premium_delta,
        status: row.status,
        notes: row.notes,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });

    return c.json({ data });
  },
);

// ── Create endorsement ────────────────────────────────────────────────

const CHANGE_TYPES = [
  "add_coverage",
  "remove_coverage",
  "modify_coverage",
  "add_vehicle",
  "remove_vehicle",
  "add_driver",
  "remove_driver",
  "address_change",
  "other",
] as const;

const NON_ENDORSABLE_STATUSES = ["cancelled", "expired", "non_renewed"];

policiesRouter.post(
  "/:id/endorsements",
  requireScopes("ams:policies:endorsements"),
  async (c) => {
    const policyId = c.req.param("id");
    const body = await c.req.json();

    // Validate request body
    throwIfErrors([
      checkRequired("effective_date", body.effective_date),
      checkFormat(
        "effective_date",
        body.effective_date,
        /^\d{4}-\d{2}-\d{2}$/,
        "effective_date must be YYYY-MM-DD.",
      ),
      checkRequired("change_type", body.change_type),
      checkEnum("change_type", body.change_type, CHANGE_TYPES),
      checkRequired("changes", body.changes),
      checkMaxLength("notes", body.notes, 2000),
    ]);

    // Verify policy exists
    const policy = await prisma.policy.findUnique({
      where: { policy_id: policyId },
      select: { policy_id: true, status: true },
    });

    if (!policy) {
      throw notFoundError("policy");
    }

    // Check policy status allows endorsement
    if (NON_ENDORSABLE_STATUSES.includes(policy.status)) {
      throw conflictError(
        `Cannot endorse policy ${policyId}: policy status is '${policy.status}'.`,
      );
    }

    // Generate endorsement ID
    const year = new Date().getFullYear();
    const seq = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    const endorsementId = `END-${year}-${seq}`;

    const now = new Date().toISOString();

    const record = {
      endorsement_id: endorsementId,
      policy_id: policyId,
      effective_date: body.effective_date,
      change_type: body.change_type,
      changes: JSON.stringify(body.changes),
      premium_delta: 0,
      status: "pending_review",
      notes: body.notes ?? null,
      created_at: now,
      updated_at: now,
    };

    await prisma.endorsement.create({ data: record });

    return c.json(
      {
        endorsement_id: record.endorsement_id,
        policy_id: record.policy_id,
        effective_date: record.effective_date,
        change_type: record.change_type,
        changes: body.changes,
        premium_delta: record.premium_delta,
        status: record.status,
        notes: record.notes,
        created_at: record.created_at,
        updated_at: record.updated_at,
      },
      201,
    );
  },
);

export { policiesRouter };
