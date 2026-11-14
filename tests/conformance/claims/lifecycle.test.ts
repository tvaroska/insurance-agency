import { beforeAll, expect, test } from "bun:test";
import { loadContract } from "../harness";
import { fnolBody, seedTables, start, type Ctx } from "./support";

const contract = loadContract("claims");
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);

// The audit trail of a claim from intake to settlement, as listed under
// `workflows` in specs/claims.behavior.yaml. It also touches every operation.
test("CLM-R21, CLM-R54, CLM-R65, CLM-R82: a full claim lifecycle leaves the expected audit trail and every response matches specs/claims.yaml", async () => {
  await ctx.svc.seed({ tables: seedTables() });
  const types = async (claimId: string) => {
    const res = await ctx.api.get(`/v1/claims/${claimId}/timeline`);
    contract.check(res);
    return res.body.data.map((e: any) => e.event_type).sort();
  };
  const ok = (res: any, status: number) => {
    expect(res.status).toBe(status);
    contract.check(res);
    return res.body;
  };

  const filed = ok(await ctx.api.post("/v1/claims/fnol", fnolBody()), 201);
  const id = filed.claim_id;
  expect(await types(id)).toEqual(["status_change"]);
  ok(await ctx.api.post("/v1/claims", fnolBody()), 201);

  const assigned = ok(await ctx.api.post(`/v1/claims/${id}/assign`, { adjuster_id: "ADJ-A" }), 200);
  expect(assigned.status).toBe("assigned");
  expect(await types(id)).toEqual(["assignment", "status_change", "status_change"]);

  expect(ok(await ctx.api.patch(`/v1/claims/${id}`, { status: "investigating" }), 200).status).toBe("investigating");
  expect(ok(await ctx.api.patch(`/v1/claims/${id}`, { status: "reserved", reserve_amount: 12000 }), 200).status).toBe(
    "reserved",
  );
  ok(
    await ctx.api.post(`/v1/claims/${id}/documents`, {
      document_type: "estimate",
      file_name: "estimate.pdf",
      file_path: "/claims/estimate.pdf",
    }),
    201,
  );
  const settled = ok(
    await ctx.api.patch(`/v1/claims/${id}`, { status: "settled", settlement_amount: 11500, notes: "Settled with insured." }),
    200,
  );
  expect(settled).toMatchObject({ status: "settled", settlement_amount: 11500, reserve_amount: 12000, adjuster_id: "ADJ-A" });

  expect(await types(id)).toEqual([
    "assignment",
    "document_upload",
    "note",
    "reserve_change",
    "status_change",
    "status_change",
    "status_change",
    "status_change",
    "status_change",
  ]);

  const detail = ok(await ctx.api.get(`/v1/claims/${id}`), 200);
  expect(detail.adjuster.adjuster_id).toBe("ADJ-A");
  expect(detail.documents).toHaveLength(1);
  expect(detail.timeline).toHaveLength(9);
  const stamps = detail.timeline.map((e: any) => e.created_at);
  expect(stamps).toEqual([...stamps].sort());
  expect(detail.timeline[0]).toMatchObject({ event_type: "status_change", new_value: "reported" });
  expect(detail.timeline[8].created_at >= detail.timeline[7].created_at).toBe(true);

  ok(await ctx.api.get("/v1/claims"), 200);
  const adjusters = ok(await ctx.api.get("/v1/adjusters"), 200);
  expect(adjusters.data.find((a: any) => a.adjuster_id === "ADJ-A").open_claims_count).toBe(0);

  expect(contract.unchecked()).toEqual([]);
});
