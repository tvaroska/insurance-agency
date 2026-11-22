import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { book, commission, escalation, readAll, start, task, type Ctx } from "./support";

const contract = loadContract("ams");
let ctx: Ctx;

interface ListCase {
  name: string;
  path: string;
  /** Sort fields in order, with direction (AMS-R22, R41, R42, R60, R63, R80). */
  sort: [string, "asc" | "desc"][];
  total: number;
}

// Row counts follow from the seed in beforeEach.
const LISTS: ListCase[] = [
  { name: "listClients", path: "/v1/clients", sort: [["last_name", "asc"], ["first_name", "asc"], ["id", "asc"]], total: 4 },
  { name: "listClientPolicies", path: "/v1/clients/CLI-C/policies", sort: [["effective_date", "desc"], ["policy_id", "desc"]], total: 4 },
  { name: "listPolicies", path: "/v1/policies", sort: [["expiration_date", "desc"], ["policy_id", "desc"]], total: 8 },
  { name: "listCommissions", path: "/v1/accounting/commissions", sort: [["effective_date", "desc"], ["commission_id", "desc"]], total: 5 },
  { name: "listTasks", path: "/v1/tasks", sort: [["due_date", "asc"], ["id", "asc"]], total: 5 },
  { name: "listEscalations", path: "/v1/escalations", sort: [["created_at", "desc"], ["escalation_id", "desc"]], total: 5 },
];

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({
    tables: book({
      commissions: [
        commission("COM-1", { effective_date: "2025-06-01" }),
        commission("COM-2", { effective_date: "2025-06-01" }),
        commission("COM-3", { effective_date: "2025-09-01" }),
        commission("COM-4", { effective_date: "2025-03-01" }),
        commission("COM-5", { effective_date: "2025-12-01" }),
      ],
      tasks: [
        task("T-1", { due_date: "2026-03-01" }),
        task("T-2", { due_date: "2026-01-15" }),
        task("T-3", { due_date: "2026-03-01" }),
        task("T-4", { due_date: "2025-12-01" }),
        task("T-5", { due_date: "2026-06-30" }),
      ],
      escalations: [
        escalation("esc_1", { created_at: "2026-01-01T00:00:00.000Z" }),
        escalation("esc_2", { created_at: "2026-01-02T00:00:00.000Z" }),
        escalation("esc_3", { created_at: "2026-01-02T00:00:00.000Z" }),
        escalation("esc_4", { created_at: "2025-12-31T00:00:00.000Z" }),
        escalation("esc_5", { created_at: "2026-01-03T00:00:00.000Z" }),
      ],
    }),
  });
});

function sortKey(item: any, c: ListCase): string[] {
  return c.sort.map(([field]) => String(item[field]));
}

function inOrder(items: any[], c: ListCase): boolean {
  for (let i = 1; i < items.length; i++) {
    const a = sortKey(items[i - 1], c);
    const b = sortKey(items[i], c);
    for (let k = 0; k < c.sort.length; k++) {
      if (a[k] === b[k]) continue;
      const ascending = a[k] < b[k];
      if (ascending !== (c.sort[k][1] === "asc")) return false;
      break;
    }
  }
  return true;
}

for (const c of LISTS) {
  describe(`pagination of ${c.name}`, () => {
    test("AMS-R18: limit defaults to 25, is clamped to 1..100 and ignores a non-number", async () => {
      const limitOf = async (limit?: string) => (await ctx.api.get(c.path, { query: { limit } })).body.pagination.limit;
      expect(await limitOf()).toBe(25);
      expect(await limitOf("3")).toBe(3);
      expect(await limitOf("0")).toBe(1);
      expect(await limitOf("-5")).toBe(1);
      expect(await limitOf("1000")).toBe(100);
      expect(await limitOf("many")).toBe(25);
      expect((await ctx.api.get(c.path, { query: { limit: 0 } })).body.data).toHaveLength(1);
    });

    test("AMS-R19: the envelope reports limit, cursor, next_cursor and has_more", async () => {
      const all = await ctx.api.get(c.path);
      expect(all.status).toBe(200);
      expect(all.body.data).toHaveLength(c.total);
      expect(all.body.pagination).toEqual({ limit: 25, cursor: null, next_cursor: null, has_more: false });

      const first = await ctx.api.get(c.path, { query: { limit: 2 } });
      expect(first.body.data).toHaveLength(2);
      expect(first.body.pagination).toMatchObject({ limit: 2, cursor: null, has_more: true });
      expect(typeof first.body.pagination.next_cursor).toBe("string");

      const second = await ctx.api.get(c.path, { query: { limit: 2, cursor: first.body.pagination.next_cursor } });
      expect(second.body.pagination.cursor).toBe(first.body.pagination.next_cursor);

      const exact = await ctx.api.get(c.path, { query: { limit: c.total } });
      expect(exact.body.pagination).toMatchObject({ has_more: false, next_cursor: null });
    });

    test("AMS-R20: following next_cursor visits every row once, in the operation's sort order", async () => {
      const paged = await readAll(ctx.api, c.path, { limit: 2 });
      const whole = (await ctx.api.get(c.path, { query: { limit: 100 } })).body.data;
      expect(paged).toEqual(whole);
      expect(paged).toHaveLength(c.total);
      expect(new Set(paged.map((item) => JSON.stringify(sortKey(item, c)))).size).toBe(c.total);
      expect(inOrder(paged, c)).toBe(true);
    });

    test("AMS-R20: a cursor is base64 JSON holding the sort-key values of the last row of the page", async () => {
      const first = await ctx.api.get(c.path, { query: { limit: 2 } });
      const decoded = JSON.parse(atob(first.body.pagination.next_cursor));
      const last = first.body.data[1];
      expect(decoded).toEqual(Object.fromEntries(c.sort.map(([field]) => [field, last[field]])));
    });

    test("AMS-R21: an undecodable cursor, or one without the sort fields, is a validation error", async () => {
      for (const cursor of ["not-a-cursor", btoa("[1,2]"), btoa(JSON.stringify({ unrelated: "x" }))]) {
        const res = await ctx.api.get(c.path, { query: { cursor } });
        expectError(res, 400, "VALIDATION_ERROR", { field: "cursor", code: "invalid_format" });
        contract.check(res);
      }
    });

    test("AMS-R21: an empty cursor is treated as absent", async () => {
      const res = await ctx.api.get(c.path, { query: { cursor: "" } });
      expect(res.status).toBe(200);
      expect(res.body.pagination.cursor).toBeNull();
      expect(res.body.data).toHaveLength(c.total);
    });
  });
}

describe("pagination with filters", () => {
  test("AMS-R20: filters repeated with the cursor keep applying on later pages", async () => {
    const all = await readAll(ctx.api, "/v1/policies", { limit: 1, client_id: "CLI-C" });
    expect(all.map((p) => p.policy_id)).toEqual(["POL-C-OLD", "POL-C-NR", "POL-C-CAN", "POL-C-EXP"]);
  });
});

test("AMS-G17: listTasks pages past a task without a due date", async () => {
  await ctx.svc.seed({ base: "empty" });
  const t1 = (await ctx.api.post("/v1/tasks", { title: "No due 1", priority: "low" })).body;
  const t2 = (await ctx.api.post("/v1/tasks", { title: "No due 2", priority: "low" })).body;
  const t3 = (await ctx.api.post("/v1/tasks", { title: "Has due", priority: "low", due_date: "2026-10-20" })).body;
  const all = await readAll(ctx.api, "/v1/tasks", { limit: 1 });
  expect(all.map((t) => t.id)).toEqual([t1.id, t2.id, t3.id].sort((a, b) => (a === t3.id ? 1 : b === t3.id ? -1 : a.localeCompare(b))));
});
