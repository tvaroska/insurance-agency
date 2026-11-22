import { beforeAll, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import {
  ISO_UTC,
  LEAD_ID,
  LEAD_SOURCES,
  LEAD_STATUSES,
  checkError,
  lead,
  leadRow,
  start,
  todayUtc,
  type Ctx,
} from "./support";

const contract = loadContract("crm");
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);

const seedLeads = (...rows: Record<string, unknown>[]) => ctx.svc.seed({ tables: { leads: rows } });

const FIVE = [
  leadRow({ lead_id: "lead_a", score: 90, client_id: "CLI-1", status: "qualified", source: "web", assigned_producer: "prod_1" }),
  leadRow({ lead_id: "lead_b", score: 70, client_id: "CLI-2", status: "new", source: "referral", assigned_producer: "prod_2" }),
  leadRow({ lead_id: "lead_c", score: 70, client_id: "CLI-1", status: "new", source: "web", assigned_producer: "prod_1" }),
  leadRow({ lead_id: "lead_d", score: 30, client_id: "CLI-3", status: "closed_lost", source: "cold_call", assigned_producer: "prod_2" }),
  leadRow({ lead_id: "lead_e", score: 0, client_id: "CLI-4", status: "contacted", source: "event", assigned_producer: "prod_1" }),
];

for (const [path, rule] of [
  ["/v1/leads", "CRM-R10"],
  ["/v1/leads/scoring", "CRM-R14"],
] as const) {
  describe(`GET ${path}`, () => {
    const ids = async (query: Record<string, string | number> = {}) => {
      const res = await ctx.api.get(path, { query });
      expect(res.status).toBe(200);
      contract.check(res);
      return res.body.data.map((l: any) => l.lead_id);
    };

    test(`${rule}: returns leads by score descending, then lead_id descending, with tags as an array`, async () => {
      await seedLeads(...FIVE);
      const res = await ctx.api.get(path);
      expect(res.status).toBe(200);
      contract.check(res);
      expect(res.body.data.map((l: any) => l.lead_id)).toEqual(["lead_a", "lead_c", "lead_b", "lead_d", "lead_e"]);
      expect(res.body.pagination).toEqual({ limit: 25, cursor: null, next_cursor: null, has_more: false });
      expect(res.body.data[0]).toEqual(
        lead({ lead_id: "lead_a", score: 90, client_id: "CLI-1", status: "qualified", source: "web", assigned_producer: "prod_1" }),
      );
    });

    test(`${rule}, CRM-R11: status, source, assigned_producer and min_score filter the list`, async () => {
      await seedLeads(...FIVE);
      expect(await ids({ status: "new" })).toEqual(["lead_c", "lead_b"]);
      expect(await ids({ source: "cold_call" })).toEqual(["lead_d"]);
      expect(await ids({ assigned_producer: "prod_2" })).toEqual(["lead_b", "lead_d"]);
      expect(await ids({ min_score: 70 })).toEqual(["lead_a", "lead_c", "lead_b"]);
      expect(await ids({ min_score: 0 })).toHaveLength(5);
      expect(await ids({ min_score: 100 })).toEqual([]);
      expect(await ids({ status: "new", assigned_producer: "prod_1", min_score: 50 })).toEqual(["lead_c"]);
    });

    test(`${rule}, CRM-R12: invalid filters are reported together`, async () => {
      for (const value of LEAD_STATUSES) expect((await ctx.api.get(path, { query: { status: value } })).status).toBe(200);
      for (const value of LEAD_SOURCES) expect((await ctx.api.get(path, { query: { source: value } })).status).toBe(200);
      const res = await ctx.api.get(path, { query: { status: "open", source: "tv", min_score: 101 } });
      expectError(
        res,
        400,
        "VALIDATION_ERROR",
        { field: "status", code: "invalid_enum" },
        { field: "source", code: "invalid_enum" },
        { field: "min_score", code: "out_of_range" },
      );
      checkError(contract, res);
      expectError(await ctx.api.get(path, { query: { min_score: -1 } }), 400, "VALIDATION_ERROR", {
        field: "min_score",
        code: "out_of_range",
      });
    });

    test(`${rule}, CRM-R13: limit is clamped and next_cursor walks the list without gaps or repeats`, async () => {
      await seedLeads(...FIVE);
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 5; i++) {
        const res = await ctx.api.get(path, { query: { limit: 2, cursor } });
        contract.check(res);
        expect(res.body.pagination.cursor).toBe(cursor ?? null);
        seen.push(...res.body.data.map((l: any) => l.lead_id));
        if (!res.body.pagination.has_more) {
          expect(res.body.pagination.next_cursor).toBeNull();
          break;
        }
        const last = res.body.data[res.body.data.length - 1];
        expect(JSON.parse(atob(res.body.pagination.next_cursor))).toEqual({ score: last.score, lead_id: last.lead_id });
        cursor = res.body.pagination.next_cursor;
      }
      expect(seen).toEqual(["lead_a", "lead_c", "lead_b", "lead_d", "lead_e"]);

      const limits = async (limit: string) => (await ctx.api.get(path, { query: { limit } })).body.pagination.limit;
      expect(await limits("0")).toBe(1);
      expect(await limits("500")).toBe(100);
      expect(await limits("abc")).toBe(25);
    });

    test(`${rule}, CRM-R13: a malformed cursor is a validation error`, async () => {
      for (const cursor of ["%%%", btoa(JSON.stringify({ score: 5 }))]) {
        const res = await ctx.api.get(path, { query: { cursor } });
        expectError(res, 400, "VALIDATION_ERROR", { field: "cursor", code: "invalid_format" });
      }
    });
  });
}

describe("client_id filter", () => {
  test("CRM-R11: GET /v1/leads filters by client_id", async () => {
    await seedLeads(...FIVE);
    const res = await ctx.api.get("/v1/leads", { query: { client_id: "CLI-1" } });
    expect(res.body.data.map((l: any) => l.lead_id)).toEqual(["lead_a", "lead_c"]);
  });

  test("CRM-R11: source=phone selects leads whose source is phone", async () => {
    await seedLeads(leadRow({ source: "phone" }), leadRow({ lead_id: "lead_b", source: "web" }));
    for (const path of ["/v1/leads", "/v1/leads/scoring"]) {
      const res = await ctx.api.get(path, { query: { source: "phone" } });
      expect(res.status).toBe(200);
      expect(res.body.data.map((l: any) => l.lead_id)).toEqual(["lead_a"]);
      contract.check(res);
    }
  });

  test("CRM-R14: GET /v1/leads/scoring ignores client_id", async () => {
    await seedLeads(...FIVE);
    const res = await ctx.api.get("/v1/leads/scoring", { query: { client_id: "CLI-1" } });
    expect(res.body.data).toHaveLength(5);
  });
});

describe("GET /v1/leads/{id}", () => {
  test("CRM-R20: returns the lead, or 404 NOT_FOUND", async () => {
    await seedLeads(leadRow({ tags: ["a", "b"], notes: "note" }));
    const found = await ctx.api.get("/v1/leads/lead_a");
    expect(found.status).toBe(200);
    contract.check(found);
    expect(found.body).toEqual(lead({ tags: ["a", "b"], notes: "note" }));

    const missing = await ctx.api.get("/v1/leads/lead_zzz");
    expectError(missing, 404, "NOT_FOUND");
    expect(missing.body.message).toBe("lead not found.");
    checkError(contract, missing);
  });
});

describe("POST /v1/leads", () => {
  const body = (overrides: Record<string, unknown> = {}) => ({
    first_name: "Nia",
    last_name: "New",
    email: "nia@example.test",
    source: "referral",
    ...overrides,
  });

  test("CRM-R30: first_name, last_name, email and source are required", async () => {
    await seedLeads();
    for (const field of ["first_name", "last_name", "email", "source"]) {
      for (const value of [undefined, null, ""]) {
        const { result, diff } = await ctx.svc.changes(() => ctx.api.post("/v1/leads", body({ [field]: value })));
        expectError(result, 400, "VALIDATION_ERROR", { field, code: "required" });
        checkError(contract, result);
        expect(diff).toEqual({});
      }
    }
  });

  test("CRM-R30: over-long values and an unknown source are reported together", async () => {
    await seedLeads();
    const res = await ctx.api.post(
      "/v1/leads",
      body({
        first_name: "f".repeat(101),
        last_name: "l".repeat(101),
        email: "e".repeat(256),
        source: "tv",
        notes: "n".repeat(2001),
      }),
    );
    expectError(
      res,
      400,
      "VALIDATION_ERROR",
      { field: "first_name", code: "too_long" },
      { field: "last_name", code: "too_long" },
      { field: "email", code: "too_long" },
      { field: "source", code: "invalid_enum" },
      { field: "notes", code: "too_long" },
    );
    expect(res.body.details).toHaveLength(5);

    const edge = await ctx.api.post(
      "/v1/leads",
      body({ first_name: "f".repeat(100), last_name: "l".repeat(100), email: "e".repeat(255), notes: "n".repeat(2000) }),
    );
    expect(edge.status).toBe(201);
  });

  test("CRM-R30: every lead source is accepted, including phone", async () => {
    await seedLeads();
    for (const source of LEAD_SOURCES) {
      const res = await ctx.api.post("/v1/leads", body({ source }));
      expect(res.status).toBe(201);
      expect(res.body.source).toBe(source);
    }
  });

  test("CRM-R31: email and phone formats are not checked and duplicate emails are allowed", async () => {
    await seedLeads();
    const first = await ctx.api.post("/v1/leads", body({ email: "not-an-email", phone: "12345" }));
    const second = await ctx.api.post("/v1/leads", body({ email: "not-an-email", phone: "12345" }));
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(first.body).toMatchObject({ email: "not-an-email", phone: "12345" });
    expect(first.body.lead_id).not.toBe(second.body.lead_id);
    expect(await ctx.svc.table("leads")).toHaveLength(2);
  });

  test("CRM-R32: stores a new lead with score 50 and status new, and writes one row", async () => {
    await seedLeads();
    const { result: res, diff } = await ctx.svc.changes(() =>
      ctx.api.post(
        "/v1/leads",
        body({
          client_id: "CLI-77",
          phone: "+1-555-010-0199",
          assigned_producer: "prod_9",
          tags: ["home", "bundle"],
          notes: "Met at the fair.",
          status: "closed_won",
          score: 99,
          lead_id: "lead_mine",
        }),
      ),
    );
    expect(res.status).toBe(201);
    contract.check(res);
    expect(res.body).toEqual({
      lead_id: expect.stringMatching(LEAD_ID),
      client_id: "CLI-77",
      first_name: "Nia",
      last_name: "New",
      email: "nia@example.test",
      phone: "+1-555-010-0199",
      source: "referral",
      status: "new",
      score: 50,
      assigned_producer: "prod_9",
      tags: ["home", "bundle"],
      notes: "Met at the fair.",
      last_activity_date: todayUtc(),
      created_at: expect.stringMatching(ISO_UTC),
      updated_at: res.body.created_at,
    });
    expect(res.body.lead_id).not.toBe("lead_mine");
    expect(Object.keys(diff)).toEqual(["leads"]);
    expect(diff.leads.added).toEqual([{ ...res.body, tags: '["home","bundle"]' }]);
  });

  test("CRM-R32: optional fields default to an empty client_id, null phone, producer and notes, and no tags", async () => {
    await seedLeads();
    const res = await ctx.api.post("/v1/leads", body());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ client_id: "", phone: null, assigned_producer: null, notes: null, tags: [] });
    expect((await ctx.svc.table("leads"))[0]).toMatchObject({ client_id: "", tags: "[]" });
  });

  test("CRM-G02, CRM-G03, CRM-G04: nullable fields, source=phone, and freeform email/phone pass specs/crm.yaml", async () => {
    await seedLeads(leadRow({ client_id: null, phone: null, assigned_producer: null, source: "phone" }));
    const fetched = await ctx.api.get("/v1/leads/lead_a");
    expect(fetched.status).toBe(200);
    contract.check(fetched);

    const created = await ctx.api.post("/v1/leads", body({ email: "not-an-email", phone: "12345", source: "phone" }));
    expect(created.status).toBe(201);
    contract.check(created);
  });
});

describe("PATCH /v1/leads/{id}", () => {
  test("CRM-R40: a body without status, score, tags, notes or assigned_producer is rejected before the lookup", async () => {
    await seedLeads(leadRow());
    for (const [id, payload] of [
      ["lead_a", {}],
      ["lead_a", { first_name: "X", email: "x@example.test" }],
      ["lead_zzz", {}],
    ] as const) {
      const { result, diff } = await ctx.svc.changes(() => ctx.api.patch(`/v1/leads/${id}`, payload));
      expectError(result, 400, "VALIDATION_ERROR", { field: "body", code: "required" });
      checkError(contract, result);
      expect(diff).toEqual({});
    }
  });

  test("CRM-R41: bad values are reported together, before the lookup", async () => {
    await seedLeads(leadRow());
    const res = await ctx.api.patch("/v1/leads/lead_zzz", { status: "won", score: 101, notes: "n".repeat(2001) });
    expectError(
      res,
      400,
      "VALIDATION_ERROR",
      { field: "status", code: "invalid_enum" },
      { field: "score", code: "out_of_range" },
      { field: "notes", code: "too_long" },
    );
    expect(res.body.details).toHaveLength(3);
    expectError(await ctx.api.patch("/v1/leads/lead_a", { score: -1 }), 400, "VALIDATION_ERROR", {
      field: "score",
      code: "out_of_range",
    });
  });

  test("CRM-R42: an unknown lead is 404 NOT_FOUND", async () => {
    await seedLeads(leadRow());
    const res = await ctx.api.patch("/v1/leads/lead_zzz", { score: 10 });
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("lead not found.");
    checkError(contract, res);
  });

  test("CRM-R43: stores the given fields, stamps updated_at and last_activity_date, and ignores other fields", async () => {
    await seedLeads(leadRow(), leadRow({ lead_id: "lead_b" }));
    const { result: res, diff } = await ctx.svc.changes(() =>
      ctx.api.patch("/v1/leads/lead_a", {
        status: "qualified",
        score: 88,
        tags: ["vip"],
        notes: "Called back.",
        assigned_producer: "prod_2",
        first_name: "Changed",
        email: "changed@example.test",
        client_id: "CLI-OTHER",
        source: "event",
      }),
    );
    expect(res.status).toBe(200);
    contract.check(res);
    expect(res.body).toEqual(
      lead({
        status: "qualified",
        score: 88,
        tags: ["vip"],
        notes: "Called back.",
        assigned_producer: "prod_2",
        last_activity_date: todayUtc(),
        updated_at: expect.stringMatching(ISO_UTC),
      }),
    );
    expect(res.body.updated_at > lead().updated_at).toBe(true);
    expect(Object.keys(diff)).toEqual(["leads"]);
    expect(diff.leads.changed).toHaveLength(1);
    expect(diff.leads.changed[0].key).toBe("lead_a");
    expect(diff.leads.changed[0].fields.sort()).toEqual([
      "assigned_producer",
      "last_activity_date",
      "notes",
      "score",
      "status",
      "tags",
      "updated_at",
    ]);
    expect(diff.leads.changed[0].after.tags).toBe('["vip"]');
  });

  test("CRM-R43: a single field can be updated; score bounds 0 and 100 are accepted; null clears notes and producer", async () => {
    await seedLeads(leadRow({ notes: "old" }));
    expect((await ctx.api.patch("/v1/leads/lead_a", { score: 0 })).body.score).toBe(0);
    expect((await ctx.api.patch("/v1/leads/lead_a", { score: 100 })).body.score).toBe(100);
    const cleared = await ctx.api.patch("/v1/leads/lead_a", { notes: null, assigned_producer: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ notes: null, assigned_producer: null, score: 100, status: "new" });
    const tags = await ctx.api.patch("/v1/leads/lead_a", { tags: [] });
    expect(tags.body.tags).toEqual([]);
  });

  test("CRM-R44: any status may follow any other status", async () => {
    for (const from of LEAD_STATUSES) {
      await seedLeads(leadRow({ status: from }));
      for (const to of LEAD_STATUSES) {
        const res = await ctx.api.patch("/v1/leads/lead_a", { status: to });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(to);
      }
    }
  });
});
