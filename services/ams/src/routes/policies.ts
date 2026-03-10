import { Hono } from "hono";
import { eq, and, lte, gte } from "drizzle-orm";
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
  applyCursorPagination,
  paginatedResponse,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { clients, policies, coverages, endorsements } from "../schema";

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
  const { where: cursorWhere, orderBy, limit: queryLimit } = applyCursorPagination({
    cursor,
    limit: limit!,
    orderBy: [
      { column: policies.expiration_date, direction: "desc" },
      { column: policies.policy_id, direction: "desc" },
    ],
  });

  const filters: ReturnType<typeof eq>[] = [];
  if (query.status) filters.push(eq(policies.status, query.status));
  if (query.client_id) filters.push(eq(policies.client_id, query.client_id));
  if (query.policy_type) filters.push(eq(policies.policy_type, query.policy_type));
  if (query.expiration_before) filters.push(lte(policies.expiration_date, query.expiration_before));
  if (query.expiration_after) filters.push(gte(policies.expiration_date, query.expiration_after));
  if (cursorWhere) filters.push(cursorWhere);

  const rows = await db
    .select()
    .from(policies)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(...orderBy)
    .limit(queryLimit);

  return c.json(paginatedResponse(rows, limit!, ["expiration_date", "policy_id"], cursor));
});

// ── Get policy by ID ─────────────────────────────────────────────────

policiesRouter.get("/:id", requireScopes("ams:policies:read"), async (c) => {
  const policyId = c.req.param("id");
  const [policy] = await db.select().from(policies).where(eq(policies.policy_id, policyId)).limit(1);
  if (!policy) throw notFoundError("policy");
  const policyCoverages = await db.select().from(coverages).where(eq(coverages.policy_id, policyId));
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
  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, body.client_id))
    .limit(1);

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

  await db.insert(policies).values(record);

  // Insert coverages
  const coverageRecords = body.coverages.map((cov: { type: string; limit?: string; deductible?: number }) => ({
    policy_id: policyId,
    type: cov.type,
    limit: cov.limit ?? null,
    deductible: cov.deductible ?? null,
  }));

  await db.insert(coverages).values(coverageRecords);

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
    const [policy] = await db
      .select({ policy_id: policies.policy_id, status: policies.status })
      .from(policies)
      .where(eq(policies.policy_id, policyId))
      .limit(1);

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

    await db.insert(endorsements).values(record);

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
