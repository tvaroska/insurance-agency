import { beforeAll, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import {
  DOCUMENT_ID,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  ISO_UTC,
  check,
  checkError,
  document,
  documentRow,
  start,
  type Ctx,
} from "./support";

const contract = loadContract("ecm");
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);

function form(fields: Record<string, string | File | string[] | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}
const pdfFile = () => new File(["%PDF-1.4 test"], "license.pdf", { type: "application/pdf" });

describe("POST /v1/documents/upload", () => {
  const upload = (fields: Record<string, string | File | string[] | undefined>) =>
    ctx.api.post("/v1/documents/upload", form(fields));

  test("ECM-R10: file, client_id and document_type are required and reported together", async () => {
    await ctx.svc.seed();
    const { result, diff } = await ctx.svc.changes(() => upload({ note: "nothing useful" }));
    expectError(
      result,
      400,
      "VALIDATION_ERROR",
      { field: "file", code: "required" },
      { field: "client_id", code: "required" },
      { field: "document_type", code: "required" },
    );
    expect(result.body.details).toHaveLength(3);
    checkError(contract, result);
    expect(diff).toEqual({});

    const noFile = await upload({ client_id: "CLI-1", document_type: "coi" });
    expectError(noFile, 400, "VALIDATION_ERROR", { field: "file", code: "required" });
    expect(noFile.body.details).toHaveLength(1);
  });

  test("ECM-R10: document_type must be one of the seven document types", async () => {
    await ctx.svc.seed();
    const bad = await upload({ file: pdfFile(), client_id: "CLI-1", document_type: "passport" });
    expectError(bad, 400, "VALIDATION_ERROR", { field: "document_type", code: "invalid_enum" });
    for (const document_type of DOCUMENT_TYPES) {
      expect((await upload({ file: pdfFile(), client_id: "CLI-1", document_type })).status).toBe(201);
    }
    expect(await ctx.svc.table("documents")).toHaveLength(DOCUMENT_TYPES.length);
  });

  test("ECM-R11: stores the file's metadata as an uploaded document and returns five fields", async () => {
    await ctx.svc.seed();
    const { result: res, diff } = await ctx.svc.changes(() =>
      upload({ file: pdfFile(), client_id: "CLI-7", document_type: "id_verification", tags: ["id", "2026"] }),
    );
    expect(res.status).toBe(201);
    check(contract, res);
    expect(res.body).toEqual({
      document_id: expect.stringMatching(DOCUMENT_ID),
      filename: "license.pdf",
      mime_type: "application/pdf",
      upload_date: expect.stringMatching(ISO_UTC),
      status: "uploaded",
    });
    expect(Math.abs(Date.parse(res.body.upload_date) - Date.now())).toBeLessThan(60_000);
    expect(Object.keys(diff)).toEqual(["documents"]);
    expect(diff.documents.added).toEqual([
      {
        document_id: res.body.document_id,
        client_id: "CLI-7",
        document_type: "id_verification",
        filename: "license.pdf",
        mime_type: "application/pdf",
        file_size_bytes: 13,
        status: "uploaded",
        upload_date: res.body.upload_date,
        signer_name: null,
        signer_email: null,
        signed_date: null,
        expiration_date: null,
        tags: '["id","2026"]',
      },
    ]);
  });

  test("ECM-R11: without tags the list is empty, and a file without a type is application/octet-stream", async () => {
    await ctx.svc.seed();
    const res = await upload({ file: new File(["abc"], "scan"), client_id: "CLI-7", document_type: "dec_page" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ filename: "scan", mime_type: "application/octet-stream" });
    expect((await ctx.svc.table("documents"))[0]).toMatchObject({ tags: "[]", file_size_bytes: 3 });
  });

  test("ECM-R11: the client id is not verified and no other service is called", async () => {
    await ctx.svc.seed();
    ctx.ams.clear(true);
    const res = await upload({ file: pdfFile(), client_id: "no-such-client", document_type: "coi" });
    expect(res.status).toBe(201);
    expect(ctx.ams.calls).toEqual([]);
  });
});

const DOCS = [
  documentRow({ document_id: "DOC-1", client_id: "CLI-1", document_type: "signed_application", status: "signed", upload_date: "2024-01-10T00:00:00Z" }),
  documentRow({ document_id: "DOC-2", client_id: "CLI-1", document_type: "id_verification", status: "uploaded", upload_date: "2024-03-10T00:00:00Z" }),
  documentRow({ document_id: "DOC-3", client_id: "CLI-2", document_type: "dec_page", status: "uploaded", upload_date: "2024-02-10T00:00:00Z" }),
  documentRow({ document_id: "DOC-4", client_id: "CLI-2", document_type: "coi", status: "generated", upload_date: "2024-02-10T00:00:00Z" }),
  documentRow({ document_id: "DOC-5", client_id: "CLI-3", document_type: "endorsement", status: "pending_signature", upload_date: "2024-04-10T00:00:00Z" }),
];

describe("GET /v1/documents", () => {
  const ids = async (query: Record<string, string | number> = {}) => {
    const res = await ctx.api.get("/v1/documents", { query });
    expect(res.status).toBe(200);
    check(contract, res);
    return res.body.data.map((d: any) => d.document_id);
  };

  test("ECM-R20: lists documents newest upload first, then document_id descending, with tags as an array", async () => {
    await ctx.svc.seed({ tables: { documents: DOCS } });
    const res = await ctx.api.get("/v1/documents");
    expect(res.status).toBe(200);
    check(contract, res);
    expect(res.body.data.map((d: any) => d.document_id)).toEqual(["DOC-5", "DOC-2", "DOC-4", "DOC-3", "DOC-1"]);
    expect(res.body.data[4]).toEqual(
      document({ document_id: "DOC-1", upload_date: "2024-01-10T00:00:00Z" }),
    );
    expect(res.body.pagination).toEqual({ limit: 25, cursor: null, next_cursor: null, has_more: false });
  });

  test("ECM-R21: status, document_type, client_id, date_from and date_to filter the list", async () => {
    await ctx.svc.seed({ tables: { documents: DOCS } });
    expect(await ids({ status: "uploaded" })).toEqual(["DOC-2", "DOC-3"]);
    expect(await ids({ document_type: "coi" })).toEqual(["DOC-4"]);
    expect(await ids({ client_id: "CLI-2" })).toEqual(["DOC-4", "DOC-3"]);
    expect(await ids({ date_from: "2024-03-10T00:00:00Z" })).toEqual(["DOC-5", "DOC-2"]);
    expect(await ids({ date_to: "2024-02-10T00:00:00Z" })).toEqual(["DOC-4", "DOC-3", "DOC-1"]);
    expect(await ids({ date_from: "2024-02", date_to: "2024-04" })).toEqual(["DOC-2", "DOC-4", "DOC-3"]);
    expect(await ids({ client_id: "CLI-2", status: "generated" })).toEqual(["DOC-4"]);
    expect(await ids({ client_id: "CLI-9" })).toEqual([]);
  });

  test("ECM-R22: status and document_type outside their value sets are reported together", async () => {
    await ctx.svc.seed({ tables: { documents: DOCS } });
    for (const status of DOCUMENT_STATUSES) await ids({ status });
    for (const document_type of DOCUMENT_TYPES) await ids({ document_type });
    const res = await ctx.api.get("/v1/documents", { query: { status: "lost", document_type: "passport" } });
    expectError(
      res,
      400,
      "VALIDATION_ERROR",
      { field: "status", code: "invalid_enum" },
      { field: "document_type", code: "invalid_enum" },
    );
    checkError(contract, res);
  });

  test("ECM-R23: pages with a cursor built from upload_date and document_id", async () => {
    await ctx.svc.seed({ tables: { documents: DOCS } });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const res = await ctx.api.get("/v1/documents", { query: { limit: 2, cursor } });
      check(contract, res);
      expect(res.body.pagination.cursor).toBe(cursor ?? null);
      seen.push(...res.body.data.map((d: any) => d.document_id));
      if (!res.body.pagination.has_more) break;
      const last = res.body.data[res.body.data.length - 1];
      expect(JSON.parse(atob(res.body.pagination.next_cursor))).toEqual({
        upload_date: last.upload_date,
        document_id: last.document_id,
      });
      cursor = res.body.pagination.next_cursor;
    }
    expect(seen).toEqual(["DOC-5", "DOC-2", "DOC-4", "DOC-3", "DOC-1"]);
    const limit = async (value: string) => (await ctx.api.get("/v1/documents", { query: { limit: value } })).body.pagination.limit;
    expect([await limit("0"), await limit("500"), await limit("abc")]).toEqual([1, 100, 25]);
    expectError(await ctx.api.get("/v1/documents", { query: { cursor: "%%%" } }), 400, "VALIDATION_ERROR", {
      field: "cursor",
      code: "invalid_format",
    });
  });
});

describe("GET /v1/documents/{client_id}/audit", () => {
  const audit = (clientId: string, query: Record<string, string | number> = {}) =>
    ctx.api.get(`/v1/documents/${clientId}/audit`, { query });
  const both = [
    documentRow({ document_id: "DOC-1", document_type: "signed_application", upload_date: "2024-01-10T00:00:00Z" }),
    documentRow({ document_id: "DOC-2", document_type: "id_verification", status: "uploaded", upload_date: "2024-03-10T00:00:00Z" }),
  ];

  test("ECM-R30: a client without documents is 404 NOT_FOUND", async () => {
    await ctx.svc.seed({ tables: { documents: both } });
    const res = await audit("CLI-NOPE");
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("client documents not found.");
    checkError(contract, res);
  });

  test("ECM-R30: a status filter that matches none of the client's documents is 404 too", async () => {
    await ctx.svc.seed({ tables: { documents: both } });
    expectError(await audit("CLI-1", { status: "expired" }), 404, "NOT_FOUND");
  });

  test("ECM-R31, ECM-R32: a client with both required documents is compliant", async () => {
    await ctx.svc.seed({ tables: { documents: [...both, documentRow({ document_id: "DOC-9", client_id: "CLI-2" })] } });
    const res = await audit("CLI-1");
    expect(res.status).toBe(200);
    check(contract, res);
    expect(res.body).toEqual({
      client_id: "CLI-1",
      documents: [
        document({ document_id: "DOC-2", document_type: "id_verification", status: "uploaded", upload_date: "2024-03-10T00:00:00Z" }),
        document({ document_id: "DOC-1", document_type: "signed_application", upload_date: "2024-01-10T00:00:00Z" }),
      ],
      compliance_status: "compliant",
      missing_documents: [],
      pagination: { limit: 25, cursor: null, next_cursor: null, has_more: false },
    });
  });

  test("ECM-R32: each missing required document type is listed with a due date 30 days ahead and a reason", async () => {
    await ctx.svc.seed({ tables: { documents: [documentRow({ document_type: "dec_page" })] } });
    const res = await audit("CLI-1");
    expect(res.status).toBe(200);
    check(contract, res);
    expect(res.body.compliance_status).toBe("missing_documents");
    expect(res.body.missing_documents).toEqual([
      {
        document_type: "signed_application",
        required_by: expect.stringMatching(ISO_UTC),
        reason: "A signed application is required to bind or renew any policy.",
      },
      {
        document_type: "id_verification",
        required_by: expect.stringMatching(ISO_UTC),
        reason: "State law requires a government-issued photo ID on file before binding coverage.",
      },
    ]);
    for (const missing of res.body.missing_documents) {
      const days = (Date.parse(missing.required_by) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThan(30.1);
    }

    await ctx.svc.seed({ tables: { documents: [both[0]] } });
    const one = await audit("CLI-1");
    expect(one.body.compliance_status).toBe("missing_documents");
    expect(one.body.missing_documents.map((m: any) => m.document_type)).toEqual(["id_verification"]);
  });

  test("ECM-R32: with nothing missing, a document past its expiration_date makes the client expired_documents", async () => {
    const expired = documentRow({ document_id: "DOC-3", document_type: "coi", expiration_date: "2020-01-01" });
    const valid = documentRow({ document_id: "DOC-4", document_type: "coi", expiration_date: "2999-01-01T00:00:00Z" });
    await ctx.svc.seed({ tables: { documents: [...both, valid] } });
    expect((await audit("CLI-1")).body.compliance_status).toBe("compliant");

    await ctx.svc.seed({ tables: { documents: [...both, valid, expired] } });
    const res = await audit("CLI-1");
    expect(res.body.compliance_status).toBe("expired_documents");
    expect(res.body.missing_documents).toEqual([]);

    await ctx.svc.seed({ tables: { documents: [both[0], expired] } });
    expect((await audit("CLI-1")).body.compliance_status).toBe("missing_documents");
  });

  test("ECM-R31, ECM-R32: status and paging narrow the document list but not the compliance verdict", async () => {
    await ctx.svc.seed({ tables: { documents: both } });
    const filtered = await audit("CLI-1", { status: "uploaded" });
    expect(filtered.body.documents.map((d: any) => d.document_id)).toEqual(["DOC-2"]);
    expect(filtered.body.compliance_status).toBe("compliant");

    const first = await audit("CLI-1", { limit: 1 });
    expect(first.body.documents.map((d: any) => d.document_id)).toEqual(["DOC-2"]);
    expect(first.body.pagination).toMatchObject({ limit: 1, has_more: true });
    expect(JSON.parse(atob(first.body.pagination.next_cursor))).toEqual({
      upload_date: "2024-03-10T00:00:00Z",
      document_id: "DOC-2",
    });
    const second = await audit("CLI-1", { limit: 1, cursor: first.body.pagination.next_cursor });
    check(contract, second);
    expect(second.body.documents.map((d: any) => d.document_id)).toEqual(["DOC-1"]);
    expect(second.body.pagination.has_more).toBe(false);
    expect(second.body.compliance_status).toBe("compliant");
  });

  test("ECM-R31: a status outside the document statuses is a validation error", async () => {
    await ctx.svc.seed({ tables: { documents: both } });
    const res = await audit("CLI-1", { status: "lost" });
    expectError(res, 400, "VALIDATION_ERROR", { field: "status", code: "invalid_enum" });
    checkError(contract, res);
  });
});
