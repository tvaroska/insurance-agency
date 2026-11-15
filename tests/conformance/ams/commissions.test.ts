import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { book, commission, COMMISSION_GAPS, start, type Ctx } from "./support";

const contract = loadContract("ams");
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({
    tables: book({
      commissions: [
        commission("COM-1", { effective_date: "2025-06-01" }),
        commission("COM-2", {
          effective_date: "2025-06-01",
          carrier_code: "CSTL",
          transaction_type: "renewal",
          status: "paid",
          payment_date: "2025-07-15",
          producer_id: "USR-2",
          policy_id: "POL-A-HOME",
        }),
        commission("COM-3", { effective_date: "2025-09-15", status: "earned" }),
        commission("COM-4", { effective_date: "2025-01-10", carrier_code: "ERIE", transaction_type: "endorsement", producer_id: null }),
      ],
    }),
  });
});

const ids = (res: { body: any }) => res.body.data.map((c: any) => c.commission_id);
const list = (query: Record<string, string> = {}) => ctx.api.get("/v1/accounting/commissions", { query });

describe("listCommissions", () => {
  test("AMS-R60: commissions are sorted by effective date, latest first, then by id descending", async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(["COM-3", "COM-2", "COM-1", "COM-4"]);
    contract.check(res, { allow: COMMISSION_GAPS });
  });

  test("AMS-R60: an item carries the twelve commission fields", async () => {
    const res = await list({ carrier_code: "CSTL" });
    expect(res.body.data).toEqual([
      {
        commission_id: "COM-2",
        policy_id: "POL-A-HOME",
        carrier_code: "CSTL",
        transaction_type: "renewal",
        gross_amount: 150,
        net_amount: 105,
        commission_rate: 0.15,
        effective_date: "2025-06-01",
        payment_date: "2025-07-15",
        status: "paid",
        producer_id: "USR-2",
        created_at: "2025-01-01T00:00:00.000Z",
      },
    ]);
  });

  test("AMS-R61: carrier, transaction type, status and producer filter exactly", async () => {
    expect(ids(await list({ carrier_code: "SMIT" }))).toEqual(["COM-3", "COM-1"]);
    expect(ids(await list({ transaction_type: "endorsement" }))).toEqual(["COM-4"]);
    expect(ids(await list({ status: "earned" }))).toEqual(["COM-3"]);
    expect(ids(await list({ producer_id: "USR-1" }))).toEqual(["COM-3", "COM-1"]);
    expect(ids(await list({ status: "reversed" }))).toEqual([]);
  });

  test("AMS-R61, AMS-R2: the effective-date range is inclusive at both ends and combines with the other filters", async () => {
    expect(ids(await list({ effective_date_from: "2025-06-01" }))).toEqual(["COM-3", "COM-2", "COM-1"]);
    expect(ids(await list({ effective_date_to: "2025-06-01" }))).toEqual(["COM-2", "COM-1", "COM-4"]);
    expect(ids(await list({ effective_date_from: "2025-06-01", effective_date_to: "2025-06-01" }))).toEqual(["COM-2", "COM-1"]);
    expect(ids(await list({ effective_date_from: "2025-06-01", effective_date_to: "2025-06-01", carrier_code: "CSTL" }))).toEqual(["COM-2"]);
  });

  test("AMS-R62: the filters are validated together, in the documented order", async () => {
    const res = await list({
      carrier_code: "TRAV",
      transaction_type: "gift",
      status: "lost",
      effective_date_from: "June",
      effective_date_to: "2025/06/01",
    });
    expectError(res, 400, "VALIDATION_ERROR");
    expect(res.body.details).toEqual([
      { field: "carrier_code", message: "carrier_code must be one of: SMIT, CSTL, HRTF, ERIE, NTNW, SAFECO, LIBT.", code: "invalid_enum" },
      {
        field: "transaction_type",
        message: "transaction_type must be one of: new_business, renewal, endorsement, cancellation, reinstatement, audit.",
        code: "invalid_enum",
      },
      { field: "status", message: "status must be one of: earned, paid, reversed, pending.", code: "invalid_enum" },
      { field: "effective_date_from", message: "Must be YYYY-MM-DD", code: "invalid_format" },
      { field: "effective_date_to", message: "Must be YYYY-MM-DD", code: "invalid_format" },
    ]);
    contract.check(res);
  });

  test("AMS-R62: empty filter values are not ignored", async () => {
    const res = await list({ carrier_code: "", transaction_type: "", status: "", effective_date_from: "", effective_date_to: "" });
    expectError(res, 400, "VALIDATION_ERROR");
    expect(res.body.details.map((d: any) => `${d.field}:${d.code}`)).toEqual([
      "carrier_code:invalid_enum",
      "transaction_type:invalid_enum",
      "status:invalid_enum",
      "effective_date_from:invalid_format",
      "effective_date_to:invalid_format",
    ]);
  });

  test("AMS-R62: each carrier code, transaction type and status of the lists is accepted", async () => {
    for (const carrier_code of ["SMIT", "CSTL", "HRTF", "ERIE", "NTNW", "SAFECO", "LIBT"]) {
      expect((await list({ carrier_code })).status).toBe(200);
    }
    for (const transaction_type of ["new_business", "renewal", "endorsement", "cancellation", "reinstatement", "audit"]) {
      expect((await list({ transaction_type })).status).toBe(200);
    }
    for (const status of ["earned", "paid", "reversed", "pending"]) expect((await list({ status })).status).toBe(200);
  });

  test("AMS-R53, AMS-R59: creating a policy or an endorsement writes no commission", async () => {
    const before = await ctx.svc.table("commissions");
    await ctx.api.post("/v1/policies", {
      client_id: "CLI-A",
      policy_type: "homeowners",
      carrier_code: "SMIT",
      effective_date: "2026-11-01",
      expiration_date: "2027-11-01",
      annual_premium: 1200,
      coverages: [{ type: "dwelling" }],
    });
    await ctx.api.post("/v1/policies/POL-A-AUTO/endorsements", { effective_date: "2026-11-01", change_type: "other", changes: { a: 1 } });
    expect(await ctx.svc.table("commissions")).toEqual(before);
  });
});

test.todo("AMS-G5: CarrierCode in specs/ams.yaml lists TRAV and PROG; the service and the seed use SMIT and CSTL");
