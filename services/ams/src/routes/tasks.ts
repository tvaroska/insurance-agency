import { Hono } from "hono";
import {
  requireScopes,
  parsePaginationParams,
  encodeCursor,
  requireValidCursor,
  notFoundError,
  validationError,
  checkRequired,
  checkFormat,
  checkEnum,
  checkMaxLength,
  throwIfErrors,
  getSimulatedNow,
  simRandomId,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { prisma } from "../prisma";
import type { Task } from "../generated/prisma/client";

type AppVariables = CorrelationVariables & AuthVariables;

const tasksRouter = new Hono<{ Variables: AppVariables }>();

const TASK_STATUSES = [
  "open",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
] as const;

const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const UPDATABLE_FIELDS = [
  "status",
  "priority",
  "assigned_to",
  "due_date",
  "description",
] as const;

// ── List tasks ──────────────────────────────────────────────────────

tasksRouter.get("/", requireScopes("ams:tasks:read"), async (c) => {
  const query = c.req.query();

  // Validate filters
  throwIfErrors([
    query.status ? checkEnum("status", query.status, TASK_STATUSES) : null,
    query.priority ? checkEnum("priority", query.priority, TASK_PRIORITIES) : null,
    query.due_date_before
      ? checkFormat("due_date_before", query.due_date_before, /^\d{4}-\d{2}-\d{2}$/, "due_date_before must be YYYY-MM-DD.")
      : null,
    query.due_date_after
      ? checkFormat("due_date_after", query.due_date_after, /^\d{4}-\d{2}-\d{2}$/, "due_date_after must be YYYY-MM-DD.")
      : null,
  ]);

  // Parse pagination (supports null due_date via "" sentinel in cursor)
  const { limit, cursor } = parsePaginationParams(query);
  const decodedCursor = requireValidCursor(cursor, ["due_date", "id"]);
  let cursorWhere: Record<string, unknown> | undefined;
  if (decodedCursor) {
    const due = String(decodedCursor.due_date);
    const id = String(decodedCursor.id);
    cursorWhere =
      due === ""
        ? { OR: [{ due_date: null, id: { gt: id } }, { due_date: { not: null } }] }
        : { OR: [{ due_date: { gt: due } }, { due_date: due, id: { gt: id } }] };
  }
  const orderBy = [{ due_date: "asc" as const }, { id: "asc" as const }];
  const take = limit! + 1;

  // Build filter conditions
  const filters: Record<string, unknown>[] = [];
  if (query.status) filters.push({ status: query.status });
  if (query.priority) filters.push({ priority: query.priority });
  if (query.assigned_to) filters.push({ assigned_to: query.assigned_to });
  const clientIdFilter = query.related_client_id ?? query.client_id;
  if (clientIdFilter) filters.push({ related_client_id: clientIdFilter });
  const policyIdFilter = query.related_policy_id ?? query.policy_id;
  if (policyIdFilter) filters.push({ related_policy_id: policyIdFilter });
  if (query.due_date_before) filters.push({ due_date: { lte: query.due_date_before } });
  if (query.due_date_after) filters.push({ due_date: { gte: query.due_date_after } });
  if (cursorWhere) filters.push(cursorWhere);

  const rows = await prisma.task.findMany({
    where: filters.length > 0 ? { AND: filters } : undefined,
    orderBy,
    take,
  });

  const hasMore = rows.length > limit!;
  const pageRows = hasMore ? rows.slice(0, limit!) : rows;
  const mapped = pageRows.map(mapTaskRow);
  const last = mapped[mapped.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ due_date: last.due_date ?? "", id: last.id })
      : null;

  return c.json({
    data: mapped,
    pagination: {
      limit: limit!,
      cursor: cursor ?? null,
      next_cursor: nextCursor,
      has_more: hasMore,
    },
  });
});

// ── Create task ─────────────────────────────────────────────────────

tasksRouter.post("/", requireScopes("ams:tasks:write"), async (c) => {
  const body = await c.req.json();

  // Validate required and optional fields
  throwIfErrors([
    checkRequired("title", body.title),
    body.title ? checkMaxLength("title", body.title, 500) : null,
    body.description !== undefined && body.description !== null
      ? checkMaxLength("description", body.description, 5000)
      : null,
    body.priority !== undefined
      ? checkEnum("priority", body.priority, TASK_PRIORITIES)
      : null,
    body.due_date !== undefined && body.due_date !== null
      ? checkFormat("due_date", body.due_date, /^\d{4}-\d{2}-\d{2}$/, "due_date must be YYYY-MM-DD.")
      : null,
  ]);

  const now = getSimulatedNow().toISOString();
  const taskId = `TASK-${simRandomId(6)}`;

  const record = {
    id: taskId,
    title: body.title,
    description: body.description ?? null,
    status: "open",
    priority: body.priority ?? "medium",
    task_type: body.task_type ?? null,
    assigned_to: body.assigned_to ?? null,
    related_client_id: body.related_client_id ?? body.client_id ?? null,
    related_policy_id: body.related_policy_id ?? body.policy_id ?? null,
    due_date: body.due_date ?? null,
    created_at: now,
    updated_at: now,
  };

  await prisma.task.create({ data: record });

  return c.json(mapTaskRow(record as Task), 201);
});

// ── Update task ─────────────────────────────────────────────────────

tasksRouter.patch(
  "/:id",
  requireScopes("ams:tasks:write"),
  async (c) => {
    const taskId = c.req.param("id");
    const body = await c.req.json();

    // Ensure at least one updatable field is present
    const hasUpdatableField = UPDATABLE_FIELDS.some(
      (field) => body[field] !== undefined,
    );
    if (!hasUpdatableField) {
      throw validationError([
        {
          field: "body",
          message:
            "Request body must contain at least one updatable field: status, priority, assigned_to, due_date, description.",
          code: "required",
        },
      ]);
    }

    // Validate provided fields
    throwIfErrors([
      body.status === null
        ? {
            field: "status",
            message: `status must be one of: ${TASK_STATUSES.join(", ")}.`,
            code: "invalid_enum",
          }
        : body.status !== undefined
          ? checkEnum("status", body.status, TASK_STATUSES)
          : null,
      body.priority === null
        ? {
            field: "priority",
            message: `priority must be one of: ${TASK_PRIORITIES.join(", ")}.`,
            code: "invalid_enum",
          }
        : body.priority !== undefined
          ? checkEnum("priority", body.priority, TASK_PRIORITIES)
          : null,
      body.due_date !== undefined && body.due_date !== null
        ? checkFormat(
            "due_date",
            body.due_date,
            /^\d{4}-\d{2}-\d{2}$/,
            "due_date must be YYYY-MM-DD.",
          )
        : null,
      body.description !== undefined && body.description !== null
        ? checkMaxLength("description", body.description, 5000)
        : null,
    ]);

    // Verify task exists
    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true },
    });

    if (!existing) {
      throw notFoundError("task");
    }

    // Build update object from provided fields only
    const updates: Record<string, unknown> = {
      updated_at: getSimulatedNow().toISOString(),
    };

    if (body.status !== undefined) updates.status = body.status;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.assigned_to !== undefined)
      updates.assigned_to = body.assigned_to ?? null;
    if (body.due_date !== undefined) updates.due_date = body.due_date ?? null;
    if (body.description !== undefined)
      updates.description = body.description ?? null;

    const updated = await prisma.task.update({
      where: { id: taskId },
      data: updates,
    });

    return c.json(mapTaskRow(updated));
  },
);

// ── Helpers ─────────────────────────────────────────────────────────

function mapTaskRow(row: Task) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    task_type: row.task_type,
    assigned_to: row.assigned_to,
    client_id: row.related_client_id,
    policy_id: row.related_policy_id,
    related_client_id: row.related_client_id,
    related_policy_id: row.related_policy_id,
    due_date: row.due_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export { tasksRouter };
