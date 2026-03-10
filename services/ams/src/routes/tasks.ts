import { Hono } from "hono";
import { and, eq, lte, gte } from "drizzle-orm";
import {
  requireScopes,
  parsePaginationParams,
  applyCursorPagination,
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
import { db } from "../db";
import { tasks } from "../schema";

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

  const { where: cursorWhere, orderBy, limit: queryLimit } = applyCursorPagination({
    cursor,
    limit: limit!,
    orderBy: [
      { column: tasks.due_date, direction: "asc" },
      { column: tasks.id, direction: "asc" },
    ],
  });

  // Build filter conditions
  const filters: ReturnType<typeof eq>[] = [];
  if (query.status) filters.push(eq(tasks.status, query.status));
  if (query.priority) filters.push(eq(tasks.priority, query.priority));
  if (query.assigned_to) filters.push(eq(tasks.assigned_to, query.assigned_to));
  if (query.client_id) filters.push(eq(tasks.related_client_id, query.client_id));
  if (query.due_date_before) filters.push(lte(tasks.due_date, query.due_date_before));
  if (query.due_date_after) filters.push(gte(tasks.due_date, query.due_date_after));
  if (cursorWhere) filters.push(cursorWhere);

  const rows = await db
    .select()
    .from(tasks)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(...orderBy)
    .limit(queryLimit);

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

  await db.insert(tasks).values(record);

  return c.json(mapTaskRow(record), 201);
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
    const [existing] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

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

    await db.update(tasks).set(updates).where(eq(tasks.id, taskId));

    // Re-select the full updated record
    const [updated] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    return c.json(mapTaskRow(updated));
  },
);

// ── Helpers ─────────────────────────────────────────────────────────

function mapTaskRow(row: typeof tasks.$inferSelect) {
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
