import { beforeAll, describe, expect, test } from "bun:test";
import { loadContract } from "../harness";
import {
  amsClient,
  amsPolicy,
  check,
  claimDetail,
  documentRow,
  envelopeRow,
  asset,
  expectPdf,
  serveAms,
  start,
  type Ctx,
} from "./support";

const contract = loadContract("ecm");
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);

function countBy(rows: Record<string, any>[], column: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row[column]] = (counts[row[column]] ?? 0) + 1;
  return counts;
}

describe("seed data", () => {
  test("ECM-R100: GET /sim/snapshot exposes the three tables; base empty leaves them empty", async () => {
    await ctx.svc.seed({ base: "empty" });
    expect(await ctx.svc.snapshot()).toEqual({ documents: [], envelopes: [], marketing_assets: [] });
    expect((await ctx.api.get("/v1/documents")).body.data).toEqual([]);
  });

  for (const [mode, facts] of [
    [
      "realistic",
      {
        documents: 87,
        statuses: { signed: 36, uploaded: 47, pending_signature: 3, expired: 1 },
        types: { signed_application: 37, dec_page: 16, id_verification: 24, welcome_kit: 2, coi: 4, endorsement: 2, cancellation_notice: 2 },
        envelopes: { completed: 5, sent: 1, viewed: 1, declined: 1, expired: 1, created: 1 },
      },
    ],
    [
      "clean",
      {
        documents: 85,
        statuses: { signed: 38, uploaded: 47 },
        types: { signed_application: 37, dec_page: 16, id_verification: 24, welcome_kit: 2, coi: 4, endorsement: 2 },
        envelopes: { completed: 10 },
      },
    ],
  ] as const) {
    test(`ECM-R101: the ${mode} data set`, async () => {
      await ctx.svc.reset(mode);
      const tables = await ctx.svc.snapshot();
      expect(tables.documents).toHaveLength(facts.documents);
      expect(countBy(tables.documents, "status")).toEqual(facts.statuses);
      expect(countBy(tables.documents, "document_type")).toEqual(facts.types);
      expect(tables.documents[0].document_id).toBe("DOC-001");
      expect(tables.envelopes).toHaveLength(10);
      expect(countBy(tables.envelopes, "status")).toEqual(facts.envelopes);
      expect(tables.envelopes[0].envelope_id).toBe("ENV-001");
      expect(tables.marketing_assets).toHaveLength(8);
      expect(countBy(tables.marketing_assets, "category")).toEqual({
        welcome_kit: 2,
        flyer: 2,
        comparison_template: 2,
        social_media: 2,
      });

      const audit = await ctx.api.get("/v1/documents/CLI-001/audit");
      check(contract, audit);
      expect(audit.body).toMatchObject({ compliance_status: "compliant", missing_documents: [] });
      expect(audit.body.documents).toHaveLength(5);

      check(contract, await ctx.api.get("/v1/documents", { query: { limit: 100 } }));
      check(contract, await ctx.api.get("/v1/envelopes"));
      check(contract, await ctx.api.get("/v1/assets/marketing"));
    });
  }

  test("ECM-R102: POST /sim/reset and POST /sim/seed discard earlier writes", async () => {
    await ctx.svc.reset("clean");
    await ctx.api.post("/v1/envelopes/create", {
      client_id: "CLI-001",
      document_ids: ["DOC-001"],
      signers: [{ name: "S", email: "s@example.test", role: "policyholder" }],
    });
    expect(await ctx.svc.table("envelopes")).toHaveLength(11);
    await ctx.svc.reset("clean");
    expect(await ctx.svc.table("envelopes")).toHaveLength(10);
  });
});

describe("simulated clock", () => {
  const baseMs = Date.parse("2026-10-14T12:00:00.000Z");
  const at = (days: number) => new Date(baseMs + days * 86_400_000).toISOString();
  const seed = () =>
    ctx.svc.seed({
      tables: {
        envelopes: [
          envelopeRow({ envelope_id: "ENV-A", status: "created", expiration_date: at(10) }),
          envelopeRow({ envelope_id: "ENV-B", status: "sent", expiration_date: at(10) }),
          envelopeRow({ envelope_id: "ENV-C", status: "viewed", expiration_date: at(10) }),
          envelopeRow({ envelope_id: "ENV-D", status: "completed", expiration_date: at(10) }),
          envelopeRow({ envelope_id: "ENV-E", status: "sent", expiration_date: at(100) }),
        ],
        documents: [documentRow({ expiration_date: at(10) })],
      },
    });

  test("ECM-R110: moving the clock past expiration_date expires created and sent envelopes only", async () => {
    await seed();
    const early = await ctx.svc.changes(() => ctx.svc.timeTravel({ days: 5 }));
    expect(early.result.transitions).toEqual({ envelopes_expired: 0 });
    expect(early.diff).toEqual({});

    const { result, diff } = await ctx.svc.changes(() => ctx.svc.timeTravel({ days: 6 }));
    expect(result).toMatchObject({ status: "ok", service: "ecm", days_advanced: 6 });
    expect(result.transitions).toEqual({ envelopes_expired: 2 });
    expect(Object.keys(diff)).toEqual(["envelopes"]);
    expect(diff.envelopes.changed.map((c) => [c.key, c.fields, c.after.status])).toEqual([
      ["ENV-A", ["status"], "expired"],
      ["ENV-B", ["status"], "expired"],
    ]);
  });

  test("ECM-R111: the check runs on every time-travel call, also with zero or negative days", async () => {
    await ctx.svc.seed({ tables: { envelopes: [envelopeRow({ status: "sent", expiration_date: "2000-01-01T00:00:00Z" })] } });
    expect((await ctx.svc.timeTravel({ days: 0 })).transitions).toEqual({ envelopes_expired: 1 });
    expect((await ctx.svc.timeTravel({ days: -30 })).transitions).toEqual({ envelopes_expired: 0 });
  });

  test("ECM-R112: request handling advances with the simulated clock after time travel", async () => {
    await ctx.svc.seed({
      tables: {
        documents: [
          documentRow({ document_id: "DOC-1", document_type: "signed_application" }),
          documentRow({ document_id: "DOC-2", document_type: "id_verification", expiration_date: at(30) }),
        ],
      },
    });
    await ctx.svc.timeTravel({ days: 400 });
    const simMs = (await ctx.svc.now()).getTime();
    const audit = await ctx.api.get("/v1/documents/CLI-1/audit");
    expect(audit.body.compliance_status).toBe("expired_documents");

    const created = await ctx.api.post("/v1/envelopes/create", {
      client_id: "CLI-1",
      document_ids: ["DOC-1"],
      signers: [{ name: "S", email: "s@example.test", role: "policyholder" }],
    });
    expect(Math.abs(Date.parse(created.body.created_at) - simMs)).toBeLessThan(60_000);
    expect(Math.abs(Date.parse(created.body.expiration_date) - simMs - 30 * 86_400_000)).toBeLessThan(2 * 3_600_000);
  });

  test("ECM-R113: seeding or resetting returns the clock to real time", async () => {
    await ctx.svc.seed();
    await ctx.svc.timeTravel({ days: 9 });
    await ctx.svc.seed();
    expect((await ctx.svc.status()).clock_offset_ms).toBe(0);
  });
});

test("every operation in specs/ecm.yaml answers its success status in the documented form", async () => {
  await ctx.svc.seed({
    tables: { documents: [documentRow()], envelopes: [envelopeRow()], marketing_assets: [asset()] },
  });
  serveAms(ctx.ams, [amsClient()], [amsPolicy()]);
  ctx.claims.clear(true);
  ctx.claims.on("GET", "/v1/claims/{id}", { body: claimDetail() });
  const ok = (res: any, status: number) => {
    expect(res.status).toBe(status);
    contract.check(res);
    return res.body;
  };

  const form = new FormData();
  form.append("file", new File(["x"], "a.pdf", { type: "application/pdf" }));
  form.append("client_id", "CLI-1");
  form.append("document_type", "dec_page");
  ok(await ctx.api.post("/v1/documents/upload", form), 201);
  ok(await ctx.api.get("/v1/documents"), 200);
  ok(await ctx.api.get("/v1/documents/CLI-1/audit"), 200);
  ok(await ctx.api.get("/v1/envelopes"), 200);
  ok(
    await ctx.api.post("/v1/envelopes/create", {
      client_id: "CLI-1",
      document_ids: ["DOC-1"],
      signers: [{ name: "S", email: "s@example.test", role: "policyholder" }],
    }),
    201,
  );
  ok(await ctx.api.get("/v1/assets/marketing"), 200);
  const holder = { policy_id: "POL-9", certificate_holder: { name: "First Bank" } };
  const coi = ok(await ctx.api.post("/v1/documents/coi/generate", holder), 201);
  ok(await ctx.api.post("/v1/documents/coi", holder), 201);
  ok(await ctx.api.post("/v1/coi/generate", holder), 201);
  ok(await ctx.api.post("/v1/coi", holder), 201);
  for (const path of [`/v1/documents/coi/${coi.document_id}/pdf`, `/v1/coi/${coi.document_id}/pdf`]) {
    const pdf = await ctx.api.get(path);
    contract.check(pdf);
    expectPdf(pdf);
  }
  const acord = await ctx.api.get("/v1/documents/acord/35", { query: { claim_id: "CLM-1" } });
  contract.check(acord);
  expectPdf(acord);
  expect(contract.unchecked()).toEqual([]);
});

test("ECM-G02, ECM-G08, ECM-G14: specs/ecm.yaml aligns ID formats, omits unused 409s, and allows date-only expiration_date", async () => {
  const { parse } = await import("yaml");
  const doc = parse(await Bun.file(new URL("../../../specs/ecm.yaml", import.meta.url)).text());
  expect(doc.paths["/documents/upload"].post.responses["409"]).toBeUndefined();
  expect(doc.paths["/envelopes/create"].post.responses["409"]).toBeUndefined();
  expect(doc.components.schemas.Document.properties.document_id.format).toBeUndefined();
  expect(doc.components.schemas.Document.properties.expiration_date.format).toBeUndefined();
});
