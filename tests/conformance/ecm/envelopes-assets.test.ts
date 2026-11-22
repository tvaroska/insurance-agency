import { beforeAll, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import {
  ASSET_CATEGORIES,
  ENVELOPE_ID,
  ENVELOPE_STATUSES,
  ISO_UTC,
  asset,
  check,
  checkError,
  documentRow,
  envelopeRow,
  start,
  type Ctx,
} from "./support";

const contract = loadContract("ecm");
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);

const ENVELOPES = [
  envelopeRow({ envelope_id: "ENV-1", client_id: "CLI-1", status: "sent", created_at: "2024-01-10T00:00:00Z" }),
  envelopeRow({ envelope_id: "ENV-2", client_id: "CLI-1", status: "completed", created_at: "2024-03-10T00:00:00Z", completed_at: "2024-03-11T00:00:00Z" }),
  envelopeRow({ envelope_id: "ENV-3", client_id: "CLI-2", status: "created", created_at: "2024-02-10T00:00:00Z", signers: [], message: null }),
  envelopeRow({ envelope_id: "ENV-4", client_id: "CLI-2", status: "declined", created_at: "2024-02-10T00:00:00Z" }),
];

describe("GET /v1/envelopes", () => {
  const ids = async (query: Record<string, string | number> = {}) => {
    const res = await ctx.api.get("/v1/envelopes", { query });
    expect(res.status).toBe(200);
    check(contract, res);
    return res.body.data.map((e: any) => e.envelope_id);
  };

  test("ECM-R40: lists envelopes newest first with document ids and signers as arrays and the first signer repeated", async () => {
    await ctx.svc.seed({ tables: { envelopes: ENVELOPES } });
    const res = await ctx.api.get("/v1/envelopes");
    expect(res.status).toBe(200);
    check(contract, res);
    expect(res.body.data.map((e: any) => e.envelope_id)).toEqual(["ENV-2", "ENV-4", "ENV-3", "ENV-1"]);
    expect(res.body.pagination).toEqual({ limit: 50, cursor: null, next_cursor: null, has_more: false });
    expect(res.body.data[3]).toEqual({
      envelope_id: "ENV-1",
      client_id: "CLI-1",
      document_ids: ["DOC-1"],
      signers: [{ name: "Cora Client", email: "cora@example.test", role: "policyholder", status: "pending", signed_at: null }],
      signer_name: "Cora Client",
      signer_email: "cora@example.test",
      message: "Please sign.",
      redirect_url: null,
      status: "sent",
      created_at: "2024-01-10T00:00:00Z",
      completed_at: null,
      expiration_date: "2999-01-01T00:00:00.000Z",
    });
    expect(res.body.data[2]).toMatchObject({ envelope_id: "ENV-3", signers: [], signer_name: null, signer_email: null, message: null });
  });

  test("ECM-R41: client_id and status filter the list; a status outside the envelope statuses is a validation error", async () => {
    await ctx.svc.seed({ tables: { envelopes: ENVELOPES } });
    expect(await ids({ client_id: "CLI-1" })).toEqual(["ENV-2", "ENV-1"]);
    expect(await ids({ status: "declined" })).toEqual(["ENV-4"]);
    expect(await ids({ client_id: "CLI-2", status: "created" })).toEqual(["ENV-3"]);
    expect(await ids({ client_id: "CLI-9" })).toEqual([]);
    for (const status of ENVELOPE_STATUSES) await ids({ status });
    const bad = await ctx.api.get("/v1/envelopes", { query: { status: "lost" } });
    expectError(bad, 400, "VALIDATION_ERROR", { field: "status", code: "invalid_enum" });
    checkError(contract, bad);
  });

  test("ECM-R41: limit defaults to 50 and pages use a cursor built from created_at and envelope_id", async () => {
    const many = Array.from({ length: 55 }, (_, i) =>
      envelopeRow({ envelope_id: `ENV-${String(i).padStart(3, "0")}`, created_at: "2024-01-01T00:00:00Z" }),
    );
    await ctx.svc.seed({ tables: { envelopes: many } });
    const first = await ctx.api.get("/v1/envelopes");
    expect(first.body.data).toHaveLength(50);
    expect(first.body.pagination).toMatchObject({ limit: 50, has_more: true });
    expect(JSON.parse(atob(first.body.pagination.next_cursor))).toEqual({
      created_at: "2024-01-01T00:00:00Z",
      envelope_id: "ENV-005",
    });
    const second = await ctx.api.get("/v1/envelopes", { query: { cursor: first.body.pagination.next_cursor } });
    expect(second.body.data.map((e: any) => e.envelope_id)).toEqual(["ENV-004", "ENV-003", "ENV-002", "ENV-001", "ENV-000"]);
    expect(second.body.pagination.has_more).toBe(false);
    const limit = async (value: string) => (await ctx.api.get("/v1/envelopes", { query: { limit: value } })).body.pagination.limit;
    expect([await limit("0"), await limit("500"), await limit("abc"), await limit("7")]).toEqual([1, 100, 25, 7]);
    expectError(await ctx.api.get("/v1/envelopes", { query: { cursor: "%%%" } }), 400, "VALIDATION_ERROR", {
      field: "cursor",
      code: "invalid_format",
    });
  });
});

describe("POST /v1/envelopes/create", () => {
  const create = (body: unknown) => ctx.api.post("/v1/envelopes/create", body);
  const signer = { name: "Cora Client", email: "cora@example.test", role: "policyholder" };
  const body = (overrides: Record<string, unknown> = {}) => ({
    client_id: "CLI-1",
    document_ids: ["DOC-1", "DOC-2"],
    signers: [signer],
    ...overrides,
  });
  const seedDocs = () =>
    ctx.svc.seed({
      tables: { documents: [documentRow({ document_id: "DOC-1" }), documentRow({ document_id: "DOC-2", client_id: "CLI-OTHER" })] },
    });

  test("ECM-R42: client_id, document_ids and signers are required; message is limited to 1000 characters", async () => {
    await seedDocs();
    const { result, diff } = await ctx.svc.changes(() => create({ message: "m".repeat(1001) }));
    expectError(
      result,
      400,
      "VALIDATION_ERROR",
      { field: "client_id", code: "required" },
      { field: "document_ids", code: "required" },
      { field: "signers", code: "required" },
      { field: "message", code: "too_long" },
    );
    expect(result.body.details).toHaveLength(4);
    checkError(contract, result);
    expect(diff).toEqual({});
    expect((await create(body({ message: "m".repeat(1000) }))).status).toBe(201);
  });

  test("ECM-R42: then document_ids, then signers, must be non-empty arrays", async () => {
    await seedDocs();
    for (const document_ids of [[], "DOC-1", { id: "DOC-1" }]) {
      const res = await create(body({ document_ids, signers: "nobody" }));
      expectError(res, 400, "VALIDATION_ERROR", { field: "document_ids", code: "invalid_format" });
      expect(res.body.details).toHaveLength(1);
    }
    for (const signers of [[], "Cora", { name: "Cora" }]) {
      const res = await create(body({ signers }));
      expectError(res, 400, "VALIDATION_ERROR", { field: "signers", code: "invalid_format" });
      expect(res.body.details).toHaveLength(1);
    }
  });

  test("ECM-R42: then each signer needs name, email and role; the first incomplete signer is reported", async () => {
    await seedDocs();
    const res = await create(body({ signers: [signer, { name: "Only Name" }, {}] }));
    expectError(
      res,
      400,
      "VALIDATION_ERROR",
      { field: "signers[1].email", code: "required" },
      { field: "signers[1].role", code: "required" },
    );
    expect(res.body.details).toHaveLength(2);
    const nullSigner = await create(body({ signers: [null] }));
    expectError(nullSigner, 400, "VALIDATION_ERROR", { field: "signers[0].name", code: "required" });
    expect(nullSigner.body.details).toHaveLength(3);
  });

  test("ECM-R43: every document must exist; the missing ids are named and nothing is written", async () => {
    await seedDocs();
    const { result, diff } = await ctx.svc.changes(() => create(body({ document_ids: ["DOC-9", "DOC-1", "DOC-8"] })));
    expectError(result, 404, "NOT_FOUND");
    expect(result.body.message).toBe("documents: DOC-9, DOC-8 not found.");
    checkError(contract, result);
    expect(diff).toEqual({});
  });

  test("ECM-R42, ECM-R43: validation comes before the document lookup", async () => {
    await seedDocs();
    const res = await create(body({ document_ids: ["DOC-9"], signers: [{}] }));
    expect(res.status).toBe(400);
  });

  test("ECM-R44: stores a created envelope that expires in 30 days, with every signer pending", async () => {
    await seedDocs();
    const second = { name: "Sam Second", email: "sam@example.test", role: "co-signer", status: "signed", signed_at: "2020-01-01" };
    const { result: res, diff } = await ctx.svc.changes(() =>
      create(body({ signers: [signer, second], message: "Please sign.", redirect_url: "https://example.test/done" })),
    );
    expect(res.status).toBe(201);
    check(contract, res);
    const signers = [
      { ...signer, status: "pending", signed_at: null },
      { name: "Sam Second", email: "sam@example.test", role: "co-signer", status: "pending", signed_at: null },
    ];
    expect(res.body).toEqual({
      envelope_id: expect.stringMatching(ENVELOPE_ID),
      client_id: "CLI-1",
      document_ids: ["DOC-1", "DOC-2"],
      signers,
      status: "created",
      created_at: expect.stringMatching(ISO_UTC),
      completed_at: null,
      expiration_date: expect.stringMatching(ISO_UTC),
    });
    const days = (Date.parse(res.body.expiration_date) - Date.parse(res.body.created_at)) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    expect(Object.keys(diff)).toEqual(["envelopes"]);
    expect(diff.envelopes.added).toEqual([
      {
        envelope_id: res.body.envelope_id,
        client_id: "CLI-1",
        document_ids: '["DOC-1","DOC-2"]',
        signers: JSON.stringify(signers),
        status: "created",
        message: "Please sign.",
        redirect_url: "https://example.test/done",
        created_at: res.body.created_at,
        completed_at: null,
        expiration_date: res.body.expiration_date,
      },
    ]);

    const listed = await ctx.api.get("/v1/envelopes", { query: { client_id: "CLI-1" } });
    expect(listed.body.data[0]).toMatchObject({
      envelope_id: res.body.envelope_id,
      signer_name: "Cora Client",
      signer_email: "cora@example.test",
      message: "Please sign.",
      redirect_url: "https://example.test/done",
    });
  });

  test("ECM-R44: message and redirect_url default to null, and the documents are left as they are", async () => {
    await seedDocs();
    const { result: res, diff } = await ctx.svc.changes(() => create(body()));
    expect(res.status).toBe(201);
    expect(diff.envelopes.added[0]).toMatchObject({ message: null, redirect_url: null });
    expect(diff.documents).toBeUndefined();
  });
});

describe("GET /v1/assets/marketing", () => {
  const ASSETS = [
    asset({ asset_id: "AST-1", category: "welcome_kit", published_date: "2024-01-01T00:00:00Z" }),
    asset({ asset_id: "AST-2", category: "flyer", published_date: "2024-03-01T00:00:00Z" }),
    asset({ asset_id: "AST-3", category: "flyer", published_date: "2024-02-01T00:00:00Z", description: null }),
    asset({ asset_id: "AST-4", category: "social_media", published_date: "2024-02-01T00:00:00Z" }),
  ];
  test("ECM-R50: lists assets newest published first, then asset_id descending", async () => {
    await ctx.svc.seed({ tables: { marketing_assets: ASSETS } });
    const res = await ctx.api.get("/v1/assets/marketing");
    expect(res.status).toBe(200);
    contract.check(res);
    expect(res.body.data.map((a: any) => a.asset_id)).toEqual(["AST-2", "AST-4", "AST-3", "AST-1"]);
    expect(res.body.data[3]).toEqual(asset({ asset_id: "AST-1", category: "welcome_kit", published_date: "2024-01-01T00:00:00Z" }));
    expect(res.body.pagination).toEqual({ limit: 25, cursor: null, next_cursor: null, has_more: false });
  });

  test("ECM-R51: category filters the list; a category outside the four categories is a validation error", async () => {
    await ctx.svc.seed({ tables: { marketing_assets: ASSETS } });
    const ids = async (category: string) => {
      const res = await ctx.api.get("/v1/assets/marketing", { query: { category } });
      expect(res.status).toBe(200);
      contract.check(res);
      return res.body.data.map((a: any) => a.asset_id);
    };
    expect(await ids("flyer")).toEqual(["AST-2", "AST-3"]);
    expect(await ids("comparison_template")).toEqual([]);
    for (const category of ASSET_CATEGORIES) await ids(category);
    const bad = await ctx.api.get("/v1/assets/marketing", { query: { category: "billboard" } });
    expectError(bad, 400, "VALIDATION_ERROR", { field: "category", code: "invalid_enum" });
    checkError(contract, bad);
  });

  test("ECM-R51: pages with a cursor built from published_date and asset_id", async () => {
    await ctx.svc.seed({ tables: { marketing_assets: ASSETS } });
    const first = await ctx.api.get("/v1/assets/marketing", { query: { limit: 3 } });
    expect(first.body.data.map((a: any) => a.asset_id)).toEqual(["AST-2", "AST-4", "AST-3"]);
    expect(JSON.parse(atob(first.body.pagination.next_cursor))).toEqual({
      published_date: "2024-02-01T00:00:00Z",
      asset_id: "AST-3",
    });
    const second = await ctx.api.get("/v1/assets/marketing", { query: { limit: 3, cursor: first.body.pagination.next_cursor } });
    expect(second.body.data.map((a: any) => a.asset_id)).toEqual(["AST-1"]);
    expect(second.body.pagination).toMatchObject({ limit: 3, cursor: first.body.pagination.next_cursor, has_more: false });
    expectError(await ctx.api.get("/v1/assets/marketing", { query: { cursor: "%%%" } }), 400, "VALIDATION_ERROR", {
      field: "cursor",
      code: "invalid_format",
    });
  });
});

test("ECM-G04, ECM-G05: envelopes and marketing assets conform strictly to specs/ecm.yaml", async () => {
  await ctx.svc.seed({
    tables: {
      envelopes: [envelopeRow()],
      marketing_assets: [asset({ asset_id: "AST-NULL", description: null })],
    },
  });
  const envelopes = await ctx.api.get("/v1/envelopes");
  expect(envelopes.status).toBe(200);
  expect(envelopes.body.data[0]).not.toHaveProperty("document_Ids");
  expect(envelopes.body.data[0]).not.toHaveProperty("policy_id");
  contract.check(envelopes);

  const assets = await ctx.api.get("/v1/assets/marketing");
  expect(assets.status).toBe(200);
  expect(assets.body.data[0].description).toBeNull();
  contract.check(assets);
});
