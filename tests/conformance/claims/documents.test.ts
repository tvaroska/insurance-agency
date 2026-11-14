import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { CLAIM_STATUSES, DOCUMENT_ID, DOCUMENT_TYPES, EVENT_ID, ISO_UTC, claim, seedTables, start, type Ctx } from "./support";

const contract = loadContract("claims");
let ctx: Ctx;
const ID = "CLM-2024-000001";
const upload = (body: unknown, claimId = ID) => ctx.api.post(`/v1/claims/${claimId}/documents`, body);
const docBody = (overrides: Record<string, unknown> = {}) => ({
  document_type: "estimate",
  file_name: "estimate.pdf",
  file_path: "/claims/estimate.pdf",
  ...overrides,
});

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({ tables: seedTables([claim()]) });
});

describe("POST /v1/claims/{claim_id}/documents", () => {
  test("CLM-R80: document_type, file_name and file_path are required", async () => {
    for (const field of ["document_type", "file_name", "file_path"]) {
      for (const value of [undefined, null, ""]) {
        const { result, diff } = await ctx.svc.changes(() => upload(docBody({ [field]: value })));
        expectError(result, 400, "VALIDATION_ERROR", { field, code: "required" });
        contract.check(result);
        expect(diff).toEqual({});
      }
    }
  });

  test("CLM-R80: bad values are reported together, before the claim is looked up", async () => {
    const res = await upload(
      { document_type: "invoice", file_name: "f".repeat(256), file_path: "p".repeat(1001) },
      "CLM-0000-000000",
    );
    expectError(
      res,
      400,
      "VALIDATION_ERROR",
      { field: "document_type", code: "invalid_enum" },
      { field: "file_name", code: "too_long" },
      { field: "file_path", code: "too_long" },
    );
    expect(res.body.details).toHaveLength(3);
  });

  test("CLM-R80: an unknown claim is 404 NOT_FOUND and writes nothing", async () => {
    const { result, diff } = await ctx.svc.changes(() => upload(docBody(), "CLM-0000-000000"));
    expectError(result, 404, "NOT_FOUND");
    expect(result.body.message).toBe("claim not found.");
    contract.check(result);
    expect(diff).toEqual({});
  });

  test("CLM-R81, CLM-R82: stores the document row and one document_upload event", async () => {
    const { result: res, diff } = await ctx.svc.changes(() => upload(docBody({ uploaded_by: "csr-7" })));
    expect(res.status).toBe(201);
    contract.check(res);
    expect(res.body).toEqual({
      document_id: expect.stringMatching(DOCUMENT_ID),
      claim_id: ID,
      document_type: "estimate",
      file_name: "estimate.pdf",
      file_path: "/claims/estimate.pdf",
      uploaded_by: "csr-7",
      uploaded_at: expect.stringMatching(ISO_UTC),
    });
    expect(Object.keys(diff).sort()).toEqual(["claim_documents", "claim_timeline"]);
    expect(diff.claim_documents.added).toEqual([res.body]);
    expect(diff.claim_timeline.added).toEqual([
      {
        event_id: expect.stringMatching(EVENT_ID),
        claim_id: ID,
        event_type: "document_upload",
        description: "Document uploaded: estimate.pdf (estimate).",
        old_value: null,
        new_value: res.body.document_id,
        created_by: null,
        created_at: expect.stringMatching(ISO_UTC),
      },
    ]);
  });

  test("CLM-R81: uploaded_by defaults to null; every document type and the length limits are accepted", async () => {
    for (const document_type of DOCUMENT_TYPES) {
      const res = await upload(docBody({ document_type, file_name: "f".repeat(255), file_path: "p".repeat(1000) }));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ document_type, uploaded_by: null });
    }
    expect(await ctx.svc.table("claim_documents")).toHaveLength(DOCUMENT_TYPES.length);
  });

  test("CLM-R81: documents can be added to a claim in any status, and the claim row is not touched", async () => {
    for (const status of CLAIM_STATUSES) {
      await ctx.svc.seed({ tables: seedTables([claim({ status })]) });
      const { result, diff } = await ctx.svc.changes(() => upload(docBody()));
      expect(result.status).toBe(201);
      expect(diff.claims).toBeUndefined();
    }
  });
});
