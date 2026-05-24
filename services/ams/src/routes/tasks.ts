import { Hono } from "hono";
import {
  requireScopes,
  parsePaginationParams,
  applyPrismaCursorPagination,
  paginatedResponse,
  notFoundError,
  validationError,
  checkRequired,
  checkFormat,
  checkEnum,
  checkMaxLength,
  throwIfErrors,
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

  // Parse pagination
  const { limit, cursor } = parsePaginationParams(query);

  const { where: cursorWhere, orderBy, take } = applyPrismaCursorPagination({
    cursor,
    limit: limit!,
    orderBy: [
      { field: "due_date", direction: "asc" },
      { field: "id", direction: "asc" },
    ],
  });

  // Build filter conditions
  const filters: Record<string, unknown>[] = [];
  if (query.status) filters.push({ status: query.status });
  if (query.priority) filters.push({ priority: query.priority });
  if (query.assigned_to) filters.push({ assigned_to: query.assigned_to });
  if (query.client_id) filters.push({ related_client_id: query.client_id });
  if (query.due_date_before) filters.push({ due_date: { lte: query.due_date_before } });
  if (query.due_date_after) filters.push({ due_date: { gte: query.due_date_after } });
  if (cursorWhere) filters.push(cursorWhere);

  const rows = await prisma.task.findMany({
    where: filters.length > 0 ? { AND: filters } : undefined,
    orderBy,
    take,
  });

  const mapped = rows.map(mapTaskRow);

  return c.json(
    paginatedResponse(mapped, limit!, ["due_date", "id"], cursor),
  );
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

  const now = new Date().toISOString();
  const taskId = `TASK-${Math.random().toString(36).slice(2, 8)}`;

  const record = {
    id: taskId,
    title: body.title,
    description: body.description ?? null,
    status: "open",
    priority: body.priority ?? "medium",
    task_type: body.task_type ?? null,
    assigned_to: body.assigned_to ?? null,
    related_client_id: body.client_id ?? null,
    related_policy_id: body.policy_id ?? null,
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
      body.status !== undefined
        ? checkEnum("status", body.status, TASK_STATUSES)
        : null,
      body.priority !== undefined
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
      updated_at: new Date().toISOString(),
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
    due_date: row.due_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export { tasksRouter };
