import { Hono } from "hono";
import { and, eq, like, inArray, sql } from "drizzle-orm";
import {
  requireScopes,
  parsePaginationParams,
  applyCursorPagination,
  paginatedResponse,
  notFoundError,
  conflictError,
  validationError,
  checkRequired,
  checkEnum,
  checkMaxLength,
  throwIfErrors,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { clients, policies, coverages, tasks } from "../schema";

type AppVariables = CorrelationVariables & AuthVariables;

const clientsRouter = new Hono<{ Variables: AppVariables }>();

const CLIENT_STATUSES = ["active", "inactive", "prospect"] as const;

clientsRouter.get("/", requireScopes("ams:clients:read"), async (c) => {
  const query = c.req.query();

  // Validate filters
  throwIfErrors([
    checkEnum("status", query.status, CLIENT_STATUSES),
    checkMaxLength("last_name", query.last_name, 100),
  ]);

  // Parse pagination
  const { limit, cursor } = parsePaginationParams(query);

  // Build cursor pagination (ordered by last_name ASC, first_name ASC, id ASC)
  const { where: cursorWhere, orderBy, limit: queryLimit } = applyCursorPagination({
    cursor,
    limit: limit!,
    orderBy: [
      { column: clients.last_name, direction: "asc" },
      { column: clients.first_name, direction: "asc", cursorKey: "first_name" },
      { column: clients.id, direction: "asc" },
    ],
  });

  // Build filter conditions
  const filters: ReturnType<typeof eq>[] = [];
  if (query.status) filters.push(eq(clients.status, query.status));
  if (query.last_name) filters.push(like(clients.last_name, `${query.last_name}%`));
  if (query.email) filters.push(eq(clients.email, query.email));
  if (query.household_id) filters.push(eq(clients.household_id, query.household_id));
  if (cursorWhere) filters.push(cursorWhere);

  const rows = await db
    .select()
    .from(clients)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(...orderBy)
    .limit(queryLimit);

  // Map rows to API shape (nest address fields)
  const mapped = rows.map(mapClientRow);

  return c.json(
    paginatedResponse(mapped, limit!, ["last_name", "first_name", "id"], cursor),
  );
});

// ── Single client detail ─────────────────────────────────────────────
clientsRouter.get("/:id", requireScopes("ams:clients:read"), async (c) => {
  const clientId = c.req.param("id");

  const [row] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (!row) {
    throw notFoundError("client");
  }

  return c.json(mapClientRow(row));
});

// ── Create client ────────────────────────────────────────────────────
const MARITAL_STATUSES = ["single", "married", "divorced", "widowed"] as const;
const CONTACT_METHODS = ["email", "phone", "mail"] as const;

clientsRouter.post("/", requireScopes("ams:clients:write"), async (c) => {
  const body = await c.req.json();

  // Validate required fields
  throwIfErrors([
    checkRequired("first_name", body.first_name),
    checkRequired("last_name", body.last_name),
    checkRequired("email", body.email),
    body.first_name ? checkMaxLength("first_name", body.first_name, 100) : null,
    body.last_name ? checkMaxLength("last_name", body.last_name, 100) : null,
    body.email ? checkMaxLength("email", body.email, 255) : null,
    body.status !== undefined ? checkEnum("status", body.status, CLIENT_STATUSES) : null,
    body.marital_status !== undefined && body.marital_status !== null
      ? checkEnum("marital_status", body.marital_status, MARITAL_STATUSES)
      : null,
    body.preferred_contact_method !== undefined && body.preferred_contact_method !== null
      ? checkEnum("preferred_contact_method", body.preferred_contact_method, CONTACT_METHODS)
      : null,
  ]);

  // Check for duplicate email
  const [existing] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.email, body.email))
    .limit(1);

  if (existing) {
    throw conflictError(`A client with email '${body.email}' already exists.`);
  }

  const now = new Date().toISOString();
  const clientId = `CL-${Math.random().toString(36).slice(2, 8)}`;
  const address = body.address ?? {};

  const record = {
    id: clientId,
    first_name: body.first_name,
    last_name: body.last_name,
    dob: body.dob ?? null,
    email: body.email,
    phone: body.phone ?? null,
    address_street: address.street ?? null,
    address_city: address.city ?? null,
    address_state: address.state ?? null,
    address_zip: address.zip ?? null,
    driver_license_number: body.driver_license_number ?? null,
    occupation: body.occupation ?? null,
    marital_status: body.marital_status ?? null,
    household_id: body.household_id ?? null,
    preferred_contact_method: body.preferred_contact_method ?? null,
    preferred_contact_time: body.preferred_contact_time ?? null,
    status: body.status ?? "active",
    created_at: now,
    updated_at: now,
  };

  await db.insert(clients).values(record);

  return c.json(mapClientRow(record), 201);
});

// ── Update client ────────────────────────────────────────────────────
const CLIENT_UPDATABLE_FIELDS = [
  "first_name", "last_name", "dob", "email", "phone", "address",
  "driver_license_number", "occupation", "marital_status", "household_id",
  "preferred_contact_method", "preferred_contact_time", "status",
] as const;

clientsRouter.patch("/:id", requireScopes("ams:clients:write"), async (c) => {
  const clientId = c.req.param("id");
  const body = await c.req.json();

  // Ensure at least one updatable field
  const hasUpdatableField = CLIENT_UPDATABLE_FIELDS.some(
    (field) => body[field] !== undefined,
  );
  if (!hasUpdatableField) {
    throw validationError([
      {
        field: "body",
        message: `Request body must contain at least one updatable field: ${CLIENT_UPDATABLE_FIELDS.join(", ")}.`,
        code: "required",
      },
    ]);
  }

  // Validate provided fields
  throwIfErrors([
    body.first_name !== undefined ? checkMaxLength("first_name", body.first_name, 100) : null,
    body.last_name !== undefined ? checkMaxLength("last_name", body.last_name, 100) : null,
    body.email !== undefined ? checkMaxLength("email", body.email, 255) : null,
    body.status !== undefined ? checkEnum("status", body.status, CLIENT_STATUSES) : null,
    body.marital_status !== undefined && body.marital_status !== null
      ? checkEnum("marital_status", body.marital_status, MARITAL_STATUSES)
      : null,
    body.preferred_contact_method !== undefined && body.preferred_contact_method !== null
      ? checkEnum("preferred_contact_method", body.preferred_contact_method, CONTACT_METHODS)
      : null,
  ]);

  // Verify client exists
  const [existing] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (!existing) {
    throw notFoundError("client");
  }

  // Check email uniqueness if changing email
  if (body.email !== undefined) {
    const [duplicate] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.email, body.email))
      .limit(1);

    if (duplicate && duplicate.id !== clientId) {
      throw conflictError(`A client with email '${body.email}' already exists.`);
    }
  }

  // Build update object
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (body.first_name !== undefined) updates.first_name = body.first_name;
  if (body.last_name !== undefined) updates.last_name = body.last_name;
  if (body.dob !== undefined) updates.dob = body.dob ?? null;
  if (body.email !== undefined) updates.email = body.email;
  if (body.phone !== undefined) updates.phone = body.phone ?? null;
  if (body.address !== undefined) {
    const addr = body.address ?? {};
    updates.address_street = addr.street ?? null;
    updates.address_city = addr.city ?? null;
    updates.address_state = addr.state ?? null;
    updates.address_zip = addr.zip ?? null;
  }
  if (body.driver_license_number !== undefined) updates.driver_license_number = body.driver_license_number ?? null;
  if (body.occupation !== undefined) updates.occupation = body.occupation ?? null;
  if (body.marital_status !== undefined) updates.marital_status = body.marital_status ?? null;
  if (body.household_id !== undefined) updates.household_id = body.household_id ?? null;
  if (body.preferred_contact_method !== undefined) updates.preferred_contact_method = body.preferred_contact_method ?? null;
  if (body.preferred_contact_time !== undefined) updates.preferred_contact_time = body.preferred_contact_time ?? null;
  if (body.status !== undefined) updates.status = body.status;

  await db.update(clients).set(updates).where(eq(clients.id, clientId));

  const [updated] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  return c.json(mapClientRow(updated));
});

// ── Helpers ──────────────────────────────────────────────────────────

function mapClientRow(row: typeof clients.$inferSelect) {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    dob: row.dob,
    email: row.email,
    phone: row.phone,
    address: {
      street: row.address_street,
      city: row.address_city,
      state: row.address_state,
      zip: row.address_zip,
    },
    driver_license_number: row.driver_license_number,
    occupation: row.occupation,
    marital_status: row.marital_status,
    household_id: row.household_id,
    preferred_contact_method: row.preferred_contact_method,
    preferred_contact_time: row.preferred_contact_time,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const POLICY_TYPES = ["personal_auto", "homeowners"] as const;
const POLICY_STATUSES = ["active", "pending", "expired", "cancelled", "non_renewed"] as const;

clientsRouter.get("/:id/policies", requireScopes("ams:policies:read"), async (c) => {
  const clientId = c.req.param("id");

  // Verify client exists
  const client = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (client.length === 0) {
    throw notFoundError("client");
  }

  const query = c.req.query();

  // Validate filters
  throwIfErrors([
    checkEnum("policy_type", query.policy_type, POLICY_TYPES),
    checkEnum("status", query.status, POLICY_STATUSES),
  ]);

  // Parse pagination
  const { limit, cursor } = parsePaginationParams(query);

  // Build cursor pagination (ordered by effective_date DESC, policy_id DESC)
  const { where: cursorWhere, orderBy, limit: queryLimit } = applyCursorPagination({
    cursor,
    limit: limit!,
    orderBy: [
      { column: policies.effective_date, direction: "desc" },
      { column: policies.policy_id, direction: "desc" },
    ],
  });

  // Build filter conditions
  const filters: ReturnType<typeof eq>[] = [];
  filters.push(eq(policies.client_id, clientId));
  if (query.policy_type) filters.push(eq(policies.policy_type, query.policy_type));
  if (query.status) filters.push(eq(policies.status, query.status));
  if (cursorWhere) filters.push(cursorWhere);

  const rows = await db
    .select()
    .from(policies)
    .where(and(...filters))
    .orderBy(...orderBy)
    .limit(queryLimit);

  // Batch-fetch coverages for returned policies
  const policyIds = rows.map((r) => r.policy_id);
  const coverageRows = policyIds.length > 0
    ? await db
        .select()
        .from(coverages)
        .where(inArray(coverages.policy_id, policyIds))
    : [];

  // Group coverages by policy_id
  const coveragesByPolicy = new Map<string, typeof coverageRows>();
  for (const cov of coverageRows) {
    const list = coveragesByPolicy.get(cov.policy_id) ?? [];
    list.push(cov);
    coveragesByPolicy.set(cov.policy_id, list);
  }

  // Map rows to API shape
  const mapped = rows.map((row) => ({
    policy_id: row.policy_id,
    client_id: row.client_id,
    carrier_code: row.carrier_code,
    policy_type: row.policy_type,
    effective_date: row.effective_date,
    expiration_date: row.expiration_date,
    premium_current: row.premium_current,
    premium_prior: row.premium_prior,
    status: row.status,
    coverages: (coveragesByPolicy.get(row.policy_id) ?? []).map((cov) => ({
      type: cov.type,
      limit: cov.limit,
      deductible: cov.deductible,
    })),
    multi_policy_discount: row.multi_policy_discount,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  return c.json(
    paginatedResponse(mapped, limit!, ["effective_date", "policy_id"], cursor),
  );
});

// ── Merge clients ───────────────────────────────────────────────────
clientsRouter.post("/:id/merge", requireScopes("ams:clients:write"), async (c) => {
  const targetId = c.req.param("id");
  const body = await c.req.json();

  // Validate source_client_id
  throwIfErrors([checkRequired("source_client_id", body.source_client_id)]);

  const sourceId: string = body.source_client_id;

  // Cannot merge with self
  if (targetId === sourceId) {
    throw conflictError("Cannot merge a client with itself.");
  }

  // Verify both clients exist
  const [target] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, targetId))
    .limit(1);
  if (!target) throw notFoundError("client");

  const [source] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, sourceId))
    .limit(1);
  if (!source) throw notFoundError("client");

  // Count entities to move
  const [polCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(policies)
    .where(eq(policies.client_id, sourceId));
  const policiesMoved = polCount.count;

  const [taskCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(tasks)
    .where(eq(tasks.related_client_id, sourceId));
  const tasksMoved = taskCount.count;

  // Re-parent policies
  const now = new Date().toISOString();
  if (policiesMoved > 0) {
    await db
      .update(policies)
      .set({ client_id: targetId, updated_at: now })
      .where(eq(policies.client_id, sourceId));
  }

  // Re-parent tasks
  if (tasksMoved > 0) {
    await db
      .update(tasks)
      .set({ related_client_id: targetId, updated_at: now })
      .where(eq(tasks.related_client_id, sourceId));
  }

  // Set source client inactive
  await db
    .update(clients)
    .set({ status: "inactive", updated_at: now })
    .where(eq(clients.id, sourceId));

  // Re-fetch target (updated_at may not have changed, but return fresh data)
  const [updatedTarget] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, targetId))
    .limit(1);

  return c.json({
    target_client: mapClientRow(updatedTarget),
    source_client_id: sourceId,
    policies_moved: policiesMoved,
    tasks_moved: tasksMoved,
  });
});

// ── Household summary ───────────────────────────────────────────────

const RECOMMENDED_COVERAGE_TYPES = [
  "personal_auto",
  "homeowners",
  "umbrella",
  "life",
  "flood",
] as const;

clientsRouter.get("/household/:household_id", requireScopes("ams:clients:read"), async (c) => {
  const householdId = c.req.param("household_id");

  // Get all household members
  const members = await db
    .select()
    .from(clients)
    .where(eq(clients.household_id, householdId))
    .orderBy(clients.last_name, clients.first_name);

  if (members.length === 0) {
    throw notFoundError("household");
  }

  // Get all policies for household members
  const memberIds = members.map((m) => m.id);
  const policyRows = await db
    .select()
    .from(policies)
    .where(inArray(policies.client_id, memberIds));

  // Get coverages for all policies
  const policyIds = policyRows.map((p) => p.policy_id);
  const coverageRows = policyIds.length > 0
    ? await db
        .select()
        .from(coverages)
        .where(inArray(coverages.policy_id, policyIds))
    : [];

  // Group policies by client
  const policiesByClient = new Map<string, typeof policyRows>();
  for (const pol of policyRows) {
    const list = policiesByClient.get(pol.client_id) ?? [];
    list.push(pol);
    policiesByClient.set(pol.client_id, list);
  }

  // Group coverages by policy
  const coveragesByPolicy = new Map<string, typeof coverageRows>();
  for (const cov of coverageRows) {
    const list = coveragesByPolicy.get(cov.policy_id) ?? [];
    list.push(cov);
    coveragesByPolicy.set(cov.policy_id, list);
  }

  // Build per-member summaries
  const allCoverageTypes = new Set<string>();
  let householdTotalPremium = 0;

  const memberSummaries = members.map((member) => {
    const memberPolicies = policiesByClient.get(member.id) ?? [];
    const memberCoverageTypes = new Set<string>();
    let memberPremium = 0;

    for (const pol of memberPolicies) {
      memberPremium += pol.premium_current;
      memberCoverageTypes.add(pol.policy_type);
      allCoverageTypes.add(pol.policy_type);

      // Also include coverage-level types
      const polCoverages = coveragesByPolicy.get(pol.policy_id) ?? [];
      for (const cov of polCoverages) {
        memberCoverageTypes.add(cov.type);
        allCoverageTypes.add(cov.type);
      }
    }

    householdTotalPremium += memberPremium;

    return {
      ...mapClientRow(member),
      policy_count: memberPolicies.length,
      total_premium: memberPremium,
      coverage_types: [...memberCoverageTypes].sort(),
    };
  });

  // Identify coverage gaps
  const coverageGaps = RECOMMENDED_COVERAGE_TYPES.filter(
    (type) => !allCoverageTypes.has(type),
  );

  return c.json({
    household_id: householdId,
    member_count: members.length,
    total_premium: householdTotalPremium,
    coverage_types: [...allCoverageTypes].sort(),
    coverage_gaps: coverageGaps,
    members: memberSummaries,
  });
});

export { clientsRouter };
