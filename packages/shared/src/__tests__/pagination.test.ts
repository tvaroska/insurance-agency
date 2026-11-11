import { describe, expect, test } from "bun:test";
import { HTTPException } from "hono/http-exception";
import {
  applyPrismaCursorPagination,
  decodeCursor,
  encodeCursor,
  paginatedResponse,
  parsePaginationParams,
  requireValidCursor,
} from "../pagination";

describe("parsePaginationParams", () => {
  test("returns defaults when no params provided", () => {
    const result = parsePaginationParams({});
    expect(result).toEqual({ limit: 25, cursor: undefined });
  });

  test("parses valid limit", () => {
    const result = parsePaginationParams({ limit: "10" });
    expect(result.limit).toBe(10);
  });

  test("clamps limit to min 1", () => {
    const result = parsePaginationParams({ limit: "0" });
    expect(result.limit).toBe(1);
  });

  test("clamps limit to max 100", () => {
    const result = parsePaginationParams({ limit: "999" });
    expect(result.limit).toBe(100);
  });

  test("ignores non-numeric limit", () => {
    const result = parsePaginationParams({ limit: "abc" });
    expect(result.limit).toBe(25);
  });

  test("passes through cursor", () => {
    const result = parsePaginationParams({ cursor: "abc123" });
    expect(result.cursor).toBe("abc123");
  });
});

describe("encodeCursor / decodeCursor", () => {
  test("round-trips a single id (string overload)", () => {
    const id = "d8b2e3f4-1234-5678-abcd-ef0123456789";
    const cursor = encodeCursor(id);
    const decoded = decodeCursor(cursor);
    expect(decoded).toEqual({ id });
  });

  test("round-trips an object with single field", () => {
    const values = { id: "abc-123" };
    const cursor = encodeCursor(values);
    expect(decodeCursor(cursor)).toEqual(values);
  });

  test("round-trips compound cursor with string and number", () => {
    const values = { score: 74, id: "lead_c29e44d1" };
    const cursor = encodeCursor(values);
    expect(decodeCursor(cursor)).toEqual(values);
  });

  test("returns null for invalid base64", () => {
    expect(decodeCursor("not-valid-base64!!!")).toBeNull();
  });

  test("returns null for valid base64 but wrong shape", () => {
    expect(decodeCursor(btoa("not json"))).toBeNull();
  });

  test("returns null for array payload", () => {
    expect(decodeCursor(btoa(JSON.stringify([1, 2])))).toBeNull();
  });

  test("returns null for non-string/number values", () => {
    expect(decodeCursor(btoa(JSON.stringify({ id: true })))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify({ id: null })))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify({ id: { nested: 1 } })))).toBeNull();
  });
});

describe("requireValidCursor", () => {
  test("returns undefined when cursor is undefined", () => {
    expect(requireValidCursor(undefined, ["id"])).toBeUndefined();
  });

  test("returns decoded values for valid cursor", () => {
    const cursor = encodeCursor({ id: "abc", score: 42 });
    expect(requireValidCursor(cursor, ["id", "score"])).toEqual({ id: "abc", score: 42 });
  });

  test("throws validation error for malformed cursor", () => {
    expect(() => requireValidCursor("garbage!!!", ["id"])).toThrow(HTTPException);
    try {
      requireValidCursor("garbage!!!", ["id"]);
    } catch (err) {
      expect((err as HTTPException).status).toBe(400);
    }
  });

  test("throws validation error when required field is missing", () => {
    const cursor = encodeCursor({ id: "abc" });
    expect(() => requireValidCursor(cursor, ["id", "score"])).toThrow(HTTPException);
    try {
      requireValidCursor(cursor, ["id", "score"]);
    } catch (err) {
      expect((err as HTTPException).status).toBe(400);
    }
  });

  test("passes when cursor has extra fields beyond required", () => {
    const cursor = encodeCursor({ id: "abc", score: 42, extra: "ok" });
    const result = requireValidCursor(cursor, ["id"]);
    expect(result).toEqual({ id: "abc", score: 42, extra: "ok" });
  });
});

describe("paginatedResponse", () => {
  const makeItems = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `item-${i}`, name: `Item ${i}` }));

  test("returns all items when count <= limit", () => {
    const items = makeItems(3);
    const result = paginatedResponse(items, 5);
    expect(result.data).toHaveLength(3);
    expect(result.pagination.has_more).toBe(false);
    expect(result.pagination.next_cursor).toBeNull();
  });

  test("sets has_more when items exceed limit", () => {
    const items = makeItems(6); // limit+1 pattern
    const result = paginatedResponse(items, 5);
    expect(result.data).toHaveLength(5);
    expect(result.pagination.has_more).toBe(true);
    expect(result.pagination.next_cursor).not.toBeNull();
  });

  test("next_cursor decodes to last item id", () => {
    const items = makeItems(4);
    const result = paginatedResponse(items, 3);
    const decoded = decodeCursor(result.pagination.next_cursor!);
    expect(decoded).toEqual({ id: "item-2" });
  });

  test("passes current cursor through", () => {
    const items = makeItems(2);
    const cursor = encodeCursor("item-0");
    const result = paginatedResponse(items, 5, "id", cursor);
    expect(result.pagination.cursor).toBe(cursor);
  });

  test("cursor is null when no current cursor", () => {
    const items = makeItems(2);
    const result = paginatedResponse(items, 5);
    expect(result.pagination.cursor).toBeNull();
  });

  test("handles empty array", () => {
    const result = paginatedResponse([], 25);
    expect(result.data).toHaveLength(0);
    expect(result.pagination.has_more).toBe(false);
    expect(result.pagination.next_cursor).toBeNull();
  });

  test("compound cursor fields produce correct next_cursor", () => {
    const items = [
      { id: "a", score: 90, name: "A" },
      { id: "b", score: 80, name: "B" },
      { id: "c", score: 70, name: "C" }, // limit+1 triggers has_more
    ];
    const result = paginatedResponse(items, 2, ["score", "id"] as (keyof typeof items[0])[]);
    expect(result.data).toHaveLength(2);
    expect(result.pagination.has_more).toBe(true);
    const decoded = decodeCursor(result.pagination.next_cursor!);
    expect(decoded).toEqual({ score: 80, id: "b" });
  });
});

// ── applyPrismaCursorPagination ─────────────────────────────────────

describe("applyPrismaCursorPagination", () => {
  test("returns take=limit+1 and no WHERE on first page", () => {
    const result = applyPrismaCursorPagination({
      cursor: undefined,
      limit: 25,
      orderBy: [{ field: "id", direction: "asc" }],
    });
    expect(result.where).toBeUndefined();
    expect(result.take).toBe(26);
    expect(result.orderBy).toEqual([{ id: "asc" }]);
  });

  test("returns WHERE condition for single-field asc cursor", () => {
    const cursor = encodeCursor({ id: "item-5" });
    const result = applyPrismaCursorPagination({
      cursor,
      limit: 10,
      orderBy: [{ field: "id", direction: "asc" }],
    });
    expect(result.where).toEqual({ id: { gt: "item-5" } });
    expect(result.take).toBe(11);
  });

  test("returns WHERE condition for single-field desc cursor", () => {
    const cursor = encodeCursor({ score: 80 });
    const result = applyPrismaCursorPagination({
      cursor,
      limit: 10,
      orderBy: [{ field: "score", direction: "desc", cursorKey: "score" }],
    });
    expect(result.where).toEqual({ score: { lt: 80 } });
    expect(result.take).toBe(11);
  });

  test("builds compound WHERE for multi-field cursor", () => {
    const cursor = encodeCursor({ score: 74, id: "lead_1" });
    const result = applyPrismaCursorPagination({
      cursor,
      limit: 25,
      orderBy: [
        { field: "score", direction: "desc", cursorKey: "score" },
        { field: "id", direction: "asc", cursorKey: "id" },
      ],
    });
    expect(result.where).toEqual({
      OR: [
        { score: { lt: 74 } },
        { AND: [{ score: 74 }, { id: { gt: "lead_1" } }] },
      ],
    });
    expect(result.orderBy).toHaveLength(2);
    expect(result.take).toBe(26);
  });

  test("throws on invalid cursor", () => {
    expect(() =>
      applyPrismaCursorPagination({
        cursor: "bad!!!",
        limit: 10,
        orderBy: [{ field: "id", direction: "asc" }],
      }),
    ).toThrow(HTTPException);
  });

  test("throws when cursor is missing expected field", () => {
    const cursor = encodeCursor({ id: "abc" });
    expect(() =>
      applyPrismaCursorPagination({
        cursor,
        limit: 10,
        orderBy: [
          { field: "score", direction: "desc", cursorKey: "score" },
          { field: "id", direction: "asc", cursorKey: "id" },
        ],
      }),
    ).toThrow(HTTPException);
  });

  test("uses cursorKey override instead of field name", () => {
    const cursor = encodeCursor({ s: 74 });
    const result = applyPrismaCursorPagination({
      cursor,
      limit: 10,
      orderBy: [{ field: "score", direction: "desc", cursorKey: "s" }],
    });
    expect(result.where).toEqual({ score: { lt: 74 } });
  });
});
