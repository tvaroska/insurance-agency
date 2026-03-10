import { and, asc, desc, gt, lt, eq, or, sql, type Column, type SQL } from "drizzle-orm";
import type { PaginatedResponse, PaginationMeta, PaginationParams } from "./types";
import { validationError } from "./errors";

const DEFAULT_LIMIT = 25;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

export type CursorValues = Record<string, string | number>;

export function parsePaginationParams(query: Record<string, string>): PaginationParams {
  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    const parsed = parseInt(query.limit, 10);
    if (!Number.isNaN(parsed)) {
      limit = Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, parsed));
    }
  }
  const cursor = query.cursor || undefined;
  return { limit, cursor };
}

/**
 * Encode cursor values into an opaque base64 string.
 * Supports single-field (`{ id: "abc" }`) and compound cursors (`{ score: 74, id: "lead_1" }`).
 */
export function encodeCursor(values: CursorValues): string;
/** @deprecated Use the object form: `encodeCursor({ id })` */
export function encodeCursor(id: string): string;
export function encodeCursor(valuesOrId: CursorValues | string): string {
  const obj = typeof valuesOrId === "string" ? { id: valuesOrId } : valuesOrId;
  return btoa(JSON.stringify(obj));
}

/**
 * Decode an opaque cursor string back into its key/value pairs.
 * Returns null for invalid or malformed cursors.
 */
export function decodeCursor(cursor: string): CursorValues | null {
  try {
    const parsed = JSON.parse(atob(cursor));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    for (const val of Object.values(parsed)) {
      if (typeof val !== "string" && typeof val !== "number") return null;
    }
    return parsed as CursorValues;
  } catch {
    return null;
  }
}

/**
 * Decode and validate a cursor, throwing a 400 validation error if it is
 * present but malformed or missing expected fields.
 *
 * Returns `undefined` when no cursor is provided (first page).
 */
export function requireValidCursor(
  cursor: string | undefined,
  fields: string[],
): CursorValues | undefined {
  if (cursor === undefined) return undefined;

  const decoded = decodeCursor(cursor);
  if (!decoded) {
    throw validationError([
      { field: "cursor", message: "Invalid cursor format.", code: "invalid_format" },
    ]);
  }

  for (const field of fields) {
    if (!(field in decoded)) {
      throw validationError([
        { field: "cursor", message: `Cursor missing required field: ${field}.`, code: "invalid_format" },
      ]);
    }
  }

  return decoded;
}

// ── Drizzle cursor-pagination helper ────────────────────────────────

export interface CursorOrderSpec {
  column: Column;
  direction: "asc" | "desc";
  /** Key name used in the cursor object. Defaults to the column name. */
  cursorKey?: string;
}

export interface CursorPaginationResult {
  /** WHERE condition to apply (undefined on first page). */
  where: SQL | undefined;
  /** ORDER BY columns to apply. */
  orderBy: SQL[];
  /** Limit to use in the query (limit + 1 for has_more detection). */
  limit: number;
}

/**
 * Build Drizzle WHERE + ORDER BY clauses for cursor-based pagination.
 *
 * Uses tuple comparison semantics for multi-column cursors:
 * `(a, b) > (cursor_a, cursor_b)` is equivalent to
 * `a > cursor_a OR (a = cursor_a AND b > cursor_b)`.
 */
export function applyCursorPagination(opts: {
  cursor: string | undefined;
  limit: number;
  orderBy: CursorOrderSpec[];
}): CursorPaginationResult {
  const { cursor, limit, orderBy } = opts;

  // Build ORDER BY
  const orderBySql = orderBy.map((spec) =>
    spec.direction === "asc" ? asc(spec.column) : desc(spec.column),
  );

  // No cursor → first page
  if (!cursor) {
    return { where: undefined, orderBy: orderBySql, limit: limit + 1 };
  }

  // Decode & validate cursor
  const cursorKeys = orderBy.map((spec) => spec.cursorKey ?? spec.column.name);
  const values = requireValidCursor(cursor, cursorKeys);

  // Build tuple comparison: (a > v_a) OR (a = v_a AND b > v_b) OR ...
  const conditions: SQL[] = [];
  for (let i = 0; i < orderBy.length; i++) {
    const eqParts: SQL[] = [];
    for (let j = 0; j < i; j++) {
      const key = cursorKeys[j];
      eqParts.push(eq(orderBy[j].column, values![key]));
    }
    const key = cursorKeys[i];
    const cmp = orderBy[i].direction === "asc"
      ? gt(orderBy[i].column, values![key])
      : lt(orderBy[i].column, values![key]);

    conditions.push(eqParts.length > 0 ? and(...eqParts, cmp)! : cmp);
  }

  const where = conditions.length === 1 ? conditions[0] : or(...conditions);

  return { where, orderBy: orderBySql, limit: limit + 1 };
}

// ── Response builder ────────────────────────────────────────────────

/**
 * Build a paginated response from an array of items.
 *
 * Pass `limit + 1` items from the data source. If the array length exceeds
 * `limit`, `has_more` is true and the last item's key becomes `next_cursor`.
 */
export function paginatedResponse<T extends Record<string, unknown>>(
  items: T[],
  limit: number,
  cursorField: keyof T = "id" as keyof T,
  currentCursor?: string,
): PaginatedResponse<T>;

/**
 * Build a paginated response with compound cursors.
 *
 * Pass `limit + 1` items from the data source. Cursor fields are extracted
 * from each item using `cursorFields` keys.
 */
export function paginatedResponse<T extends Record<string, unknown>>(
  items: T[],
  limit: number,
  cursorFields: (keyof T)[],
  currentCursor?: string,
): PaginatedResponse<T>;

export function paginatedResponse<T extends Record<string, unknown>>(
  items: T[],
  limit: number,
  cursorFieldOrFields: keyof T | (keyof T)[] = "id" as keyof T,
  currentCursor?: string,
): PaginatedResponse<T> {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  const lastItem = data[data.length - 1];
  let nextCursor: string | null = null;

  if (hasMore && lastItem) {
    if (Array.isArray(cursorFieldOrFields)) {
      const values: CursorValues = {};
      for (const field of cursorFieldOrFields) {
        values[String(field)] = lastItem[field] as string | number;
      }
      nextCursor = encodeCursor(values);
    } else {
      nextCursor = encodeCursor(String(lastItem[cursorFieldOrFields]));
    }
  }

  const pagination: PaginationMeta = {
    limit,
    cursor: currentCursor ?? null,
    next_cursor: nextCursor,
    has_more: hasMore,
  };

  return { data, pagination };
}
