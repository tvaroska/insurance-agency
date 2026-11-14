import { beforeAll, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { CLAIM_STATUSES, CLAIM_TYPES, adjuster, claim, seedTables, start, type Ctx } from "./support";

const contract = loadContract("claims");
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);

function numbered(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(6, "0");
    return claim({ claim_id: `CLM-2024-${n}`, created_at: `2024-05-02T10:00:00.${String(i).padStart(3, "0")}Z` });
  });
}

describe("GET /v1/claims", () => {
  test("CLM-R30: returns data and pagination, newest created_at first, then claim_id descending", async () => {
    await ctx.svc.seed({
      tables: seedTables([
        claim({ claim_id: "CLM-2024-000001", created_at: "2024-01-01T00:00:00.000Z" }),
        claim({ claim_id: "CLM-2024-000002", created_at: "2024-03-01T00:00:00.000Z" }),
        claim({ claim_id: "CLM-2024-000003", created_at: "2024-02-01T00:00:00.000Z" }),
        claim({ claim_id: "CLM-2024-000004", created_at: "2024-02-01T00:00:00.000Z" }),
      ]),
    });
    const res = await ctx.api.get("/v1/claims");
    expect(res.status).toBe(200);
    contract.check(res);
    expect(res.body.data.map((c: any) => c.claim_id)).toEqual([
      "CLM-2024-000002",
      "CLM-2024-000004",
      "CLM-2024-000003",
      "CLM-2024-000001",
    ]);
    expect(res.body.pagination).toEqual({ limit: 25, cursor: null, next_cursor: null, has_more: false });
    expect(res.body.data[0]).toEqual(claim({ claim_id: "CLM-2024-000002", created_at: "2024-03-01T00:00:00.000Z" }));
  });

  test("CLM-R30: an empty table gives an empty page", async () => {
    await ctx.svc.seed();
    const res = await ctx.api.get("/v1/claims");
    contract.check(res);
    expect(res.body).toEqual({ data: [], pagination: { limit: 25, cursor: null, next_cursor: null, has_more: false } });
  });

  test("CLM-R31: client_id, policy_id, status, claim_type, date_from and date_to filter the list", async () => {
    await ctx.svc.seed({
      tables: seedTables([
        claim({ claim_id: "CLM-2024-000001", client_id: "CLI-A", policy_id: "POL-A", status: "reported", claim_type: "fire", loss_date: "2024-01-10" }),
        claim({ claim_id: "CLM-2024-000002", client_id: "CLI-A", policy_id: "POL-B", status: "settled", claim_type: "theft", loss_date: "2024-02-10" }),
        claim({ claim_id: "CLM-2024-000003", client_id: "CLI-B", policy_id: "POL-C", status: "reported", claim_type: "theft", loss_date: "2024-03-10" }),
      ]),
    });
    const ids = async (query: Record<string, string>) => {
      const res = await ctx.api.get("/v1/claims", { query });
      expect(res.status).toBe(200);
      contract.check(res);
      return res.body.data.map((c: any) => c.claim_id).sort();
    };
    expect(await ids({ client_id: "CLI-A" })).toEqual(["CLM-2024-000001", "CLM-2024-000002"]);
    expect(await ids({ policy_id: "POL-C" })).toEqual(["CLM-2024-000003"]);
    expect(await ids({ status: "reported" })).toEqual(["CLM-2024-000001", "CLM-2024-000003"]);
    expect(await ids({ claim_type: "theft" })).toEqual(["CLM-2024-000002", "CLM-2024-000003"]);
    expect(await ids({ date_from: "2024-02-10" })).toEqual(["CLM-2024-000002", "CLM-2024-000003"]);
    expect(await ids({ date_to: "2024-02-10" })).toEqual(["CLM-2024-000001", "CLM-2024-000002"]);
    expect(await ids({ date_from: "2024-01-11", date_to: "2024-03-09" })).toEqual(["CLM-2024-000002"]);
    expect(await ids({ client_id: "CLI-A", claim_type: "theft" })).toEqual(["CLM-2024-000002"]);
    expect(await ids({ client_id: "CLI-B", status: "settled" })).toEqual([]);
    expect(await ids({ client_id: "CLI-NOPE" })).toEqual([]);
  });

  test("CLM-R32: every status and claim type is a valid filter value", async () => {
    await ctx.svc.seed();
    for (const status of CLAIM_STATUSES) expect((await ctx.api.get("/v1/claims", { query: { status } })).status).toBe(200);
    for (const claim_type of CLAIM_TYPES) {
      expect((await ctx.api.get("/v1/claims", { query: { claim_type } })).status).toBe(200);
    }
  });

  test("CLM-R32: invalid filter values are reported together", async () => {
    const res = await ctx.api.get("/v1/claims", {
      query: { status: "open", claim_type: "flood", date_from: "01/01/2024", date_to: "soon" },
    });
    expectError(
      res,
      400,
      "VALIDATION_ERROR",
      { field: "status", code: "invalid_enum" },
      { field: "claim_type", code: "invalid_enum" },
      { field: "date_from", code: "invalid_format" },
      { field: "date_to", code: "invalid_format" },
    );
    contract.check(res);
  });

  test("CLM-R32: an empty status or claim_type is invalid; empty date and id filters are ignored", async () => {
    await ctx.svc.seed({ tables: seedTables([claim()]) });
    expectError(await ctx.api.get("/v1/claims", { query: { status: "" } }), 400, "VALIDATION_ERROR", {
      field: "status",
      code: "invalid_enum",
    });
    expectError(await ctx.api.get("/v1/claims", { query: { claim_type: "" } }), 400, "VALIDATION_ERROR", {
      field: "claim_type",
      code: "invalid_enum",
    });
    const ignored = await ctx.api.get("/v1/claims", { query: { date_from: "", date_to: "", client_id: "", policy_id: "" } });
    expect(ignored.status).toBe(200);
    expect(ignored.body.data).toHaveLength(1);
  });

  test("CLM-R33: limit defaults to 25, is clamped to 1..100, and is ignored when not a number", async () => {
    await ctx.svc.seed({ tables: seedTables(numbered(103)) });
    const page = async (limit?: string) => {
      const res = await ctx.api.get("/v1/claims", { query: { limit } });
      expect(res.status).toBe(200);
      return [res.body.data.length, res.body.pagination.limit, res.body.pagination.has_more];
    };
    expect(await page()).toEqual([25, 25, true]);
    expect(await page("abc")).toEqual([25, 25, true]);
    expect(await page("0")).toEqual([1, 1, true]);
    expect(await page("-5")).toEqual([1, 1, true]);
    expect(await page("100")).toEqual([100, 100, true]);
    expect(await page("1000")).toEqual([100, 100, true]);
    expect(await page("7")).toEqual([7, 7, true]);
  });

  test("CLM-R34: next_cursor walks the list without gaps or repeats", async () => {
    await ctx.svc.seed({ tables: seedTables(numbered(5)) });
    const seen: string[] = [];
    let cursor: string | undefined;
    const pages: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await ctx.api.get("/v1/claims", { query: { limit: 2, cursor } });
      expect(res.status).toBe(200);
      contract.check(res);
      expect(res.body.pagination.cursor).toBe(cursor ?? null);
      pages.push(res.body.data.length);
      seen.push(...res.body.data.map((c: any) => c.claim_id));
      expect(res.body.pagination.has_more).toBe(res.body.pagination.next_cursor !== null);
      if (!res.body.pagination.has_more) break;
      const last = res.body.data[res.body.data.length - 1];
      expect(JSON.parse(atob(res.body.pagination.next_cursor))).toEqual({
        created_at: last.created_at,
        claim_id: last.claim_id,
      });
      cursor = res.body.pagination.next_cursor;
    }
    expect(pages).toEqual([2, 2, 1]);
    expect(seen).toEqual(["CLM-2024-000005", "CLM-2024-000004", "CLM-2024-000003", "CLM-2024-000002", "CLM-2024-000001"]);
  });

  test("CLM-R34: a cursor applies together with the filters", async () => {
    await ctx.svc.seed({
      tables: seedTables(numbered(6).map((c, i) => ({ ...c, client_id: i % 2 === 0 ? "CLI-EVEN" : "CLI-ODD" }))),
    });
    const first = await ctx.api.get("/v1/claims", { query: { client_id: "CLI-EVEN", limit: 2 } });
    expect(first.body.data.map((c: any) => c.claim_id)).toEqual(["CLM-2024-000005", "CLM-2024-000003"]);
    const second = await ctx.api.get("/v1/claims", {
      query: { client_id: "CLI-EVEN", limit: 2, cursor: first.body.pagination.next_cursor },
    });
    expect(second.body.data.map((c: any) => c.claim_id)).toEqual(["CLM-2024-000001"]);
    expect(second.body.pagination.has_more).toBe(false);
  });

  test("CLM-R34: a cursor that cannot be decoded, or lacks a key, is a validation error", async () => {
    for (const cursor of ["%%%", btoa("[1,2]"), btoa(JSON.stringify({ created_at: "2024-01-01T00:00:00.000Z" }))]) {
      const res = await ctx.api.get("/v1/claims", { query: { cursor } });
      expectError(res, 400, "VALIDATION_ERROR", { field: "cursor", code: "invalid_format" });
      contract.check(res);
    }
  });
});

describe("GET /v1/claims/{claim_id}", () => {
  test("CLM-R40: an unknown claim is 404 NOT_FOUND", async () => {
    await ctx.svc.seed();
    const res = await ctx.api.get("/v1/claims/CLM-0000-000000");
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("claim not found.");
    contract.check(res);
  });

  test("CLM-R41: returns the claim with its adjuster, timeline (oldest first) and documents", async () => {
    const event = (id: string, at: string) => ({
      event_id: id,
      claim_id: "CLM-2024-000001",
      event_type: "note",
      description: "Notes updated.",
      old_value: null,
      new_value: null,
      created_by: null,
      created_at: at,
    });
    const doc = {
      document_id: "DOC-0000aaaa",
      claim_id: "CLM-2024-000001",
      document_type: "photos",
      file_name: "a.jpg",
      file_path: "/claims/a.jpg",
      uploaded_by: null,
      uploaded_at: "2024-05-03T00:00:00.000Z",
    };
    const other = claim({ claim_id: "CLM-2024-000002" });
    await ctx.svc.seed({
      tables: seedTables([claim({ adjuster_id: "ADJ-B", status: "assigned" }), other], {
        claim_documents: [doc, { ...doc, document_id: "DOC-0000bbbb", claim_id: "CLM-2024-000002" }],
        claim_timeline: [
          event("EVT-00000001", "2024-05-04T00:00:00.000Z"),
          event("EVT-00000002", "2024-05-02T00:00:00.000Z"),
          event("EVT-00000003", "2024-05-03T00:00:00.000Z"),
          { ...event("EVT-00000004", "2024-05-01T00:00:00.000Z"), claim_id: "CLM-2024-000002" },
        ],
      }),
    });
    const res = await ctx.api.get("/v1/claims/CLM-2024-000001");
    expect(res.status).toBe(200);
    contract.check(res);
    expect(res.body).toEqual({
      ...claim({ adjuster_id: "ADJ-B", status: "assigned" }),
      adjuster: adjuster({
        adjuster_id: "ADJ-B",
        first_name: "Ben",
        last_name: "Baker",
        email: "ben@example.test",
        specialty: "property",
      }),
      timeline: [
        event("EVT-00000002", "2024-05-02T00:00:00.000Z"),
        event("EVT-00000003", "2024-05-03T00:00:00.000Z"),
        event("EVT-00000001", "2024-05-04T00:00:00.000Z"),
      ],
      documents: [doc],
    });
  });

  test("CLM-R41: an unassigned claim has adjuster null and empty lists", async () => {
    await ctx.svc.seed({ tables: seedTables([claim()]) });
    const res = await ctx.api.get("/v1/claims/CLM-2024-000001");
    contract.check(res);
    expect(res.body).toEqual({ ...claim(), adjuster: null, timeline: [], documents: [] });
  });
});

describe("GET /v1/claims/{claim_id}/timeline", () => {
  test("CLM-R70: an unknown claim is 404 NOT_FOUND", async () => {
    await ctx.svc.seed();
    const res = await ctx.api.get("/v1/claims/CLM-0000-000000/timeline");
    expectError(res, 404, "NOT_FOUND");
    contract.check(res);
  });

  test("CLM-R70: returns the claim's events under data, oldest first", async () => {
    const event = (id: string, claimId: string, at: string) => ({
      event_id: id,
      claim_id: claimId,
      event_type: "status_change",
      description: "x",
      old_value: "reported",
      new_value: "assigned",
      created_by: "someone",
      created_at: at,
    });
    await ctx.svc.seed({
      tables: seedTables([claim(), claim({ claim_id: "CLM-2024-000002" })], {
        claim_timeline: [
          event("EVT-0000000a", "CLM-2024-000001", "2024-06-03T00:00:00.000Z"),
          event("EVT-0000000b", "CLM-2024-000002", "2024-06-01T00:00:00.000Z"),
          event("EVT-0000000c", "CLM-2024-000001", "2024-06-02T00:00:00.000Z"),
        ],
      }),
    });
    const res = await ctx.api.get("/v1/claims/CLM-2024-000001/timeline");
    expect(res.status).toBe(200);
    contract.check(res);
    expect(res.body).toEqual({
      data: [
        event("EVT-0000000c", "CLM-2024-000001", "2024-06-02T00:00:00.000Z"),
        event("EVT-0000000a", "CLM-2024-000001", "2024-06-03T00:00:00.000Z"),
      ],
    });

    const empty = await ctx.api.get("/v1/claims/CLM-2024-000002/timeline");
    expect(empty.body.data).toHaveLength(1);
  });
});

describe("GET /v1/adjusters", () => {
  const seed = () =>
    ctx.svc.seed({
      tables: seedTables([
        claim({ claim_id: "CLM-2024-000001", adjuster_id: "ADJ-A", status: "assigned" }),
        claim({ claim_id: "CLM-2024-000002", adjuster_id: "ADJ-A", status: "investigating" }),
        claim({ claim_id: "CLM-2024-000003", adjuster_id: "ADJ-A", status: "reserved" }),
        claim({ claim_id: "CLM-2024-000004", adjuster_id: "ADJ-A", status: "reported" }),
        claim({ claim_id: "CLM-2024-000005", adjuster_id: "ADJ-A", status: "settled" }),
        claim({ claim_id: "CLM-2024-000006", adjuster_id: "ADJ-A", status: "denied" }),
        claim({ claim_id: "CLM-2024-000007", adjuster_id: "ADJ-OFF", status: "investigating" }),
        claim({ claim_id: "CLM-2024-000008", adjuster_id: null, status: "reported" }),
      ]),
    });

  test("CLM-R90: lists every adjuster with the number of claims that are not settled or denied", async () => {
    await seed();
    const res = await ctx.api.get("/v1/adjusters");
    expect(res.status).toBe(200);
    contract.check(res);
    const byId = Object.fromEntries(res.body.data.map((a: any) => [a.adjuster_id, a]));
    expect(Object.keys(byId).sort()).toEqual(["ADJ-A", "ADJ-B", "ADJ-OFF"]);
    expect(byId["ADJ-A"]).toEqual({ ...adjuster(), open_claims_count: 4 });
    expect(byId["ADJ-B"].open_claims_count).toBe(0);
    expect(byId["ADJ-OFF"].open_claims_count).toBe(1);
  });

  test("CLM-R91: specialty and active filter the list, alone and together", async () => {
    await seed();
    const ids = async (query: Record<string, string>) => {
      const res = await ctx.api.get("/v1/adjusters", { query });
      expect(res.status).toBe(200);
      contract.check(res);
      return res.body.data.map((a: any) => a.adjuster_id).sort();
    };
    expect(await ids({ specialty: "auto" })).toEqual(["ADJ-A"]);
    expect(await ids({ specialty: "general" })).toEqual([]);
    expect(await ids({ active: "1" })).toEqual(["ADJ-A", "ADJ-B"]);
    expect(await ids({ active: "0" })).toEqual(["ADJ-OFF"]);
    expect(await ids({ specialty: "liability", active: "1" })).toEqual([]);
    expect(await ids({ specialty: "liability", active: "0" })).toEqual(["ADJ-OFF"]);
  });

  test("CLM-R91: invalid filter values are reported together", async () => {
    const res = await ctx.api.get("/v1/adjusters", { query: { specialty: "marine", active: "true" } });
    expectError(
      res,
      400,
      "VALIDATION_ERROR",
      { field: "specialty", code: "invalid_enum" },
      { field: "active", code: "invalid_enum" },
    );
    contract.check(res);
  });
});
