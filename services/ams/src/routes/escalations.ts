import { Hono } from "hono";
import {
  requireScopes,
  parsePaginationParams,
  applyPrismaCursorPagination,
  paginatedResponse,
  notFoundError,
  checkRequired,
  checkEnum,
  checkMaxLength,
  throwIfErrors,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { prisma } from "../prisma";
import type { Escalation, EscalationEvent } from "../generated/prisma/client";
import { processEscalation } from "../manager/engine";

type AppVariables = CorrelationVariables & AuthVariables;

const escalationsRouter = new Hono<{ Variables: AppVariables }>();

const ESCALATION_REASONS = [
  "premium_threshold",
  "state_minimum_violation",
  "coverage_adequacy",
  "surplus_lines",
  "principal_review",
  "backdating",
] as const;

// ── POST / ──────────────────────────────────────────────────────────

escalationsRouter.post(
  "/",
  requireScopes("ams:escalations:write"),
  async (c) => {
    const body = await c.req.json();

    throwIfErrors([
      checkRequired("client_id", body.client_id),
      checkRequired("reason", body.reason),
      checkEnum("reason", body.reason, ESCALATION_REASONS),
      checkRequired("summary", body.summary),
      body.summary ? checkMaxLength("summary", body.summary, 2000) : null,
    ]);

    const now = new Date().toISOString();
    const escalationId = `esc_${Math.random().toString(36).slice(2, 10)}`;

    const record = {
      escalation_id: escalationId,
      client_id: body.client_id,
      policy_id: body.policy_id ?? null,
      reason: body.reason,
      summary: body.summary,
      context: body.context ? JSON.stringify(body.context) : null,
      status: "pending",
      manager_response: null,
      poll_count: 0,
      created_at: now,
      updated_at: now,
    };

    await prisma.escalation.create({ data: record });

    await prisma.escalationEvent.create({
      data: {
        escalation_id: escalationId,
        event_type: "created",
        from_status: null,
        to_status: "pending",
        details: null,
        created_at: now,
      },
    });

    return c.json(mapEscalationRow(record as Escalation), 201);
  },
);

// ── GET /:id ────────────────────────────────────────────────────────

escalationsRouter.get(
  "/:id",
  requireScopes("ams:escalations:read"),
  async (c) => {
    const id = c.req.param("id");

    const row = await prisma.escalation.findUnique({
      where: { escalation_id: id },
    });

    if (!row) {
      throw notFoundError("escalation");
    }

    const now = new Date().toISOString();
    const newPollCount = row.poll_count + 1;

    // Always increment poll_count
    await prisma.escalation.update({
      where: { escalation_id: id },
      data: { poll_count: newPollCount, updated_at: now },
    });

    // If pending and poll_count reaches 2, process via manager engine
    if (row.status === "pending" && newPollCount >= 2) {
      const decision = processEscalation({
        reason: row.reason,
        summary: row.summary,
        context: row.context ? JSON.parse(row.context) : null,
      });

      const managerResponse = {
        decision: decision.decision,
        template_id: decision.template_id,
        response_text: decision.response_text,
        resolved_at: now,
      };

      await prisma.escalation.update({
        where: { escalation_id: id },
        data: {
          status: decision.decision,
          manager_response: JSON.stringify(managerResponse),
          updated_at: now,
        },
      });

      // Audit events
      await prisma.escalationEvent.create({
        data: {
          escalation_id: id,
          event_type: "manager_reviewed",
          from_status: "pending",
          to_status: decision.decision,
          details: JSON.stringify({ template_id: decision.template_id }),
          created_at: now,
        },
      });

      await prisma.escalationEvent.create({
        data: {
          escalation_id: id,
          event_type: "status_changed",
          from_status: "pending",
          to_status: decision.decision,
          details: null,
          created_at: now,
        },
      });

      // Re-read for response
      const updated = await prisma.escalation.findUnique({
        where: { escalation_id: id },
      });

      // Fetch audit trail
      const events = await prisma.escalationEvent.findMany({
        where: { escalation_id: id },
      });

      return c.json({
        ...mapEscalationRow(updated!),
        events: events.map(mapEventRow),
      });
    }

    // Return current state (still pending or already resolved)
    const events = await prisma.escalationEvent.findMany({
      where: { escalation_id: id },
    });

    return c.json({
      ...mapEscalationRow({ ...row, poll_count: newPollCount, updated_at: now }),
      events: events.map(mapEventRow),
    });
  },
);

// ── GET / ───────────────────────────────────────────────────────────

escalationsRouter.get(
  "/",
  requireScopes("ams:escalations:read"),
  async (c) => {
    const query = c.req.query();

    throwIfErrors([
      query.status
        ? checkEnum("status", query.status, ["pending", "approved", "denied", "needs_info"])
        : null,
      query.created_after
        ? (() => {
            const d = new Date(query.created_after);
            return isNaN(d.getTime())
              ? { field: "created_after", message: "created_after must be a valid ISO date.", code: "invalid_format" as const }
              : null;
          })()
        : null,
      query.created_before
        ? (() => {
            const d = new Date(query.created_before);
            return isNaN(d.getTime())
              ? { field: "created_before", message: "created_before must be a valid ISO date.", code: "invalid_format" as const }
              : null;
          })()
        : null,
    ]);

    const { limit, cursor } = parsePaginationParams(query);

    const { where: cursorWhere, orderBy, take } = applyPrismaCursorPagination({
      cursor,
      limit: limit!,
      orderBy: [
        { field: "created_at", direction: "desc" },
        { field: "escalation_id", direction: "desc" },
      ],
    });

    const filters: Record<string, unknown>[] = [];
    if (query.status) filters.push({ status: query.status });
    if (query.client_id) filters.push({ client_id: query.client_id });
    if (query.created_after) filters.push({ created_at: { gte: query.created_after } });
    if (query.created_before) filters.push({ created_at: { lte: query.created_before } });
    if (cursorWhere) filters.push(cursorWhere);

    const rows = await prisma.escalation.findMany({
      where: filters.length > 0 ? { AND: filters } : undefined,
      orderBy,
      take,
    });

    const mapped = rows.map(mapEscalationRow);

    return c.json(
      paginatedResponse(mapped, limit!, ["created_at", "escalation_id"], cursor),
    );
  },
);

// ── Helpers ─────────────────────────────────────────────────────────

function mapEscalationRow(row: Escalation) {
  return {
    escalation_id: row.escalation_id,
    client_id: row.client_id,
    policy_id: row.policy_id,
    reason: row.reason,
    summary: row.summary,
    context: row.context ? JSON.parse(row.context) : null,
    status: row.status,
    manager_response: row.manager_response ? JSON.parse(row.manager_response) : null,
    poll_count: row.poll_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapEventRow(row: EscalationEvent) {
  return {
    id: row.id,
    escalation_id: row.escalation_id,
    event_type: row.event_type,
    from_status: row.from_status,
    to_status: row.to_status,
    details: row.details ? JSON.parse(row.details) : null,
    created_at: row.created_at,
  };
}

export { escalationsRouter };
