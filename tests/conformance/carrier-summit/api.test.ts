import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { API, documentRow, ISO_TIME, policyRow, quoteRow, start, submit, SUBMISSION, type Ctx } from "./support";

const contract = loadContract("carrier-summit");
let ctx: Ctx;

const QUOTE_FIELDS = [
  "quote_id", "request_id", "client_id", "policy_type", "premium_annual", "premium_monthly", "coverages",
  "deductibles", "status", "decline_reason", "valid_until", "submitted_at", "underwriting_status", "underwriting_notes",
];

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({
    tables: {
      quotes: [
        quoteRow({ quote_id: "QT-PENDING" }),
        quoteRow({ quote_id: "QT-REFERRED", underwriting_status: "referred", underwriting_notes: "needs a second look" }),
        quoteRow({ quote_id: "QT-APPROVED", status: "bound", underwriting_status: "approved" }),
        quoteRow({
          quote_id: "QT-DECLINED",
          status: "declined",
          underwriting_status: "declined",
          premium_annual: null,
          premium_monthly: null,
          coverages: [],
          deductibles: {},
          valid_until: null,
          decline_reason: "Roof older than 25 years",
        }),
      ],
      policies: [policyRow({ policy_id: "POL-DOCS" }), policyRow({ policy_id: "POL-BARE" })],
      policy_documents: [
        documentRow("SDOC-901", "POL-DOCS", { document_type: "dec_page", filename: "pol_docs_declarations.pdf", file_size_bytes: 181000 }),
        documentRow("SDOC-902", "POL-DOCS", { document_type: "id_cards", filename: "pol_docs_id_cards.pdf", file_size_bytes: 96000, supersedes: "SDOC-800" }),
      ],
    },
  });
});

const decide = (quoteId: string, body: unknown) => ctx.api.post(`${API}/underwriting/${quoteId}/decision`, body);
const quote = async (quoteId: string) => (await ctx.svc.table("quotes")).find((q) => q.quote_id === quoteId)!;

describe("GET /quotes/{quote_id}", () => {
  test("SMT-R21: a quote is returned with its fourteen fields, JSON columns decoded", async () => {
    const res = await ctx.api.get(`${API}/quotes/QT-PENDING`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(QUOTE_FIELDS);
    expect(res.body).toEqual({
      quote_id: "QT-PENDING",
      request_id: "QR-T-1",
      client_id: "CLI-900",
      policy_type: "homeowners",
      premium_annual: 1200,
      premium_monthly: 100,
      coverages: [{ type: "dwelling", limit: 300000 }],
      deductibles: { all_perils: 1000 },
      status: "quoted",
      decline_reason: null,
      valid_until: "2030-01-31",
      submitted_at: "2026-01-05T09:00:00Z",
      underwriting_status: "pending_review",
      underwriting_notes: null,
    });
    contract.check(res);
  });

  test("SMT-R21: a declined quote keeps null premiums and its decline reason", async () => {
    const res = await ctx.api.get(`${API}/quotes/QT-DECLINED`);
    expect(res.body).toMatchObject({
      premium_annual: null,
      premium_monthly: null,
      coverages: [],
      deductibles: {},
      valid_until: null,
      decline_reason: "Roof older than 25 years",
      underwriting_status: "declined",
    });
    contract.check(res);
  });

  test("SMT-R21: an unknown quote is 404 'quote not found.' and reading writes nothing", async () => {
    const { result: res, diff } = await ctx.svc.changes(async () => {
      await ctx.api.get(`${API}/quotes/QT-PENDING`);
      return ctx.api.get(`${API}/quotes/QT-NOPE`);
    });
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("quote not found.");
    contract.check(res);
    expect(diff).toEqual({});
  });

  test("SMT-R3: coverages and deductibles are stored as JSON text", async () => {
    const row = await quote("QT-PENDING");
    expect(row.coverages).toBe('[{"type":"dwelling","limit":300000}]');
    expect(row.deductibles).toBe('{"all_perils":1000}');
  });
});

describe("POST /underwriting/{quote_id}/decision", () => {
  const invalid: [string, unknown, string[]][] = [
    ["an empty body", {}, ["required"]],
    ["a null decision", { decision: null }, ["required"]],
    ["an empty decision", { decision: "" }, ["required", "invalid_enum"]],
    ["the past tense 'approved'", { decision: "approved" }, ["invalid_enum"]],
    ["the past tense 'declined'", { decision: "declined" }, ["invalid_enum"]],
    ["the past tense 'referred'", { decision: "referred" }, ["invalid_enum"]],
    ["upper case", { decision: "APPROVE" }, ["invalid_enum"]],
    ["an unknown word", { decision: "escalate", notes: "x" }, ["invalid_enum"]],
  ];
  for (const [label, body, codes] of invalid) {
    test(`SMT-R22: ${label} is 400 on the decision field`, async () => {
      const { result: res, diff } = await ctx.svc.changes(() => decide("QT-PENDING", body));
      expectError(res, 400, "VALIDATION_ERROR", ...codes.map((code) => ({ field: "decision", code })));
      expect(res.body.message).toBe("One or more fields failed validation.");
      expect(res.body.details.map((d: any) => d.code)).toEqual(codes);
      expect(diff).toEqual({});
    });
  }

  test("SMT-R22: the body is validated before the quote is looked up", async () => {
    expectError(await decide("QT-NOPE", { decision: "approved" }), 400, "VALIDATION_ERROR");
    expectError(await decide("QT-APPROVED", {}), 400, "VALIDATION_ERROR");
  });

  test("SMT-R23: a valid decision on an unknown quote is 404", async () => {
    const res = await decide("QT-NOPE", { decision: "approve" });
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("quote not found.");
    contract.check(res);
  });

  for (const status of ["approved", "declined"]) {
    for (const decision of ["approve", "decline", "refer"]) {
      test(`SMT-R24: ${decision} on a quote already ${status} is 409 and changes nothing`, async () => {
        const id = status === "approved" ? "QT-APPROVED" : "QT-DECLINED";
        const { result: res, diff } = await ctx.svc.changes(() => decide(id, { decision, notes: "again" }));
        expectError(res, 409, "CONFLICT");
        expect(res.body.message).toBe(`Quote already has underwriting decision '${status}'.`);
        contract.check(res);
        expect(diff).toEqual({});
      });
    }
  }

  const outcomes: [string, string][] = [["approve", "approved"], ["decline", "declined"], ["refer", "referred"]];
  for (const from of ["QT-PENDING", "QT-REFERRED"]) {
    for (const [decision, status] of outcomes) {
      test(`SMT-R25: ${decision} moves ${from} to ${status} and touches only the two underwriting columns`, async () => {
        const { result: res, diff } = await ctx.svc.changes(() => decide(from, { decision, notes: `note for ${decision}` }));
        expect(res.status).toBe(200);
        expect(Object.keys(diff)).toEqual(["quotes"]);
        expect(diff.quotes.added).toEqual([]);
        expect(diff.quotes.removed).toEqual([]);
        expect(diff.quotes.changed).toHaveLength(1);
        const change = diff.quotes.changed[0];
        expect(change.after).toMatchObject({ quote_id: from, underwriting_status: status, underwriting_notes: `note for ${decision}` });
        expect([...change.fields].sort()).toEqual(
          from === "QT-REFERRED" && status === "referred" ? ["underwriting_notes"] : ["underwriting_notes", "underwriting_status"],
        );
        expect(change.after.status).toBe("quoted");
      });
    }
  }

  test("SMT-R25: without notes an earlier note is cleared", async () => {
    const res = await decide("QT-REFERRED", { decision: "refer" });
    expect(res.status).toBe(200);
    expect(res.body.underwriting_notes).toBeNull();
    expect((await quote("QT-REFERRED")).underwriting_notes).toBeNull();
  });

  test("SMT-R25: approving creates no policy and leaves the quote status alone", async () => {
    const { diff } = await ctx.svc.changes(() => decide("QT-PENDING", { decision: "approve" }));
    expect(Object.keys(diff)).toEqual(["quotes"]);
    expect((await quote("QT-PENDING")).status).toBe("quoted");
    const declined = await decide("QT-REFERRED", { decision: "decline", notes: "no" });
    expect(declined.body).toMatchObject({ status: "quoted", decline_reason: null, underwriting_status: "declined" });
  });

  test("SMT-R26: the response is the updated quote plus decided_at", async () => {
    const before = (await ctx.svc.now()).getTime();
    const res = await decide("QT-PENDING", { decision: "approve", notes: "Clean loss history" });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual([...QUOTE_FIELDS, "decided_at"]);
    expect(res.body).toMatchObject({ quote_id: "QT-PENDING", underwriting_status: "approved", underwriting_notes: "Clean loss history" });
    expect(res.body.decided_at).toMatch(ISO_TIME);
    expect(Math.abs(Date.parse(res.body.decided_at) - before)).toBeLessThan(60_000);
    expect(await quote("QT-PENDING")).not.toHaveProperty("decided_at");
    const { decided_at: _, ...rest } = res.body;
    expect((await ctx.api.get(`${API}/quotes/QT-PENDING`)).body).toEqual(rest);
    contract.check(res);
  });

  test("SMT-R24: a referred quote can be decided again, then the decision is final", async () => {
    expect((await decide("QT-PENDING", { decision: "refer" })).body.underwriting_status).toBe("referred");
    expect((await decide("QT-PENDING", { decision: "refer" })).body.underwriting_status).toBe("referred");
    expect((await decide("QT-PENDING", { decision: "decline" })).body.underwriting_status).toBe("declined");
    expectError(await decide("QT-PENDING", { decision: "approve" }), 409, "CONFLICT");
  });

  test("Known gap 1: invalid underwriting decision body conforms to 400 BadRequest", async () => {
    const res = await decide("QT-PENDING", { decision: "approved" });
    expectError(res, 400, "VALIDATION_ERROR", { field: "decision", code: "invalid_enum" });
    contract.check(res);
  });
});

describe("GET /policies/{policy_id}/documents", () => {
  test("SMT-R27: the documents of a policy are listed without version or supersedes", async () => {
    const res = await ctx.api.get(`${API}/policies/POL-DOCS/documents`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["policy_id", "document_count", "documents"]);
    expect(res.body.policy_id).toBe("POL-DOCS");
    expect(res.body.document_count).toBe(2);
    const docs = [...res.body.documents].sort((a: any, b: any) => (a.document_id < b.document_id ? -1 : 1));
    expect(docs).toEqual([
      { document_id: "SDOC-901", document_type: "dec_page", filename: "pol_docs_declarations.pdf", file_size_bytes: 181000, created_at: "2026-01-01T00:00:00Z" },
      { document_id: "SDOC-902", document_type: "id_cards", filename: "pol_docs_id_cards.pdf", file_size_bytes: 96000, created_at: "2026-01-01T00:00:00Z" },
    ]);
    contract.check(res);
  });

  test("SMT-R27: a policy without documents returns an empty list", async () => {
    const res = await ctx.api.get(`${API}/policies/POL-BARE/documents`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ policy_id: "POL-BARE", document_count: 0, documents: [] });
    contract.check(res);
  });

  test("SMT-R27: an unknown policy is 404 'policy not found.'", async () => {
    const res = await ctx.api.get(`${API}/policies/POL-NOPE/documents`);
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("policy not found.");
    contract.check(res);
  });
});

describe("POST /submissions", () => {
  const REQUIRED = ["client_id", "policy_type", "property_address", "property_details", "coverages"];

  test("SMT-R28: an empty body reports the five required fields, in order, and writes nothing", async () => {
    const { result: res, diff } = await ctx.svc.changes(() => submit(ctx.api, {}));
    expectError(res, 400, "VALIDATION_ERROR");
    expect(res.body.details.map((d: any) => [d.field, d.code])).toEqual(REQUIRED.map((f) => [f, "required"]));
    expect(res.body.details[0].message).toBe("client_id is required.");
    expect(diff).toEqual({});
  });

  for (const field of REQUIRED) {
    for (const [label, value] of [["missing", undefined], ["null", null], ["an empty string", ""]] as const) {
      test(`SMT-R28: ${field} ${label} is a required error on that field only`, async () => {
        const body: Record<string, unknown> = { ...SUBMISSION, [field]: value };
        if (value === undefined) delete body[field];
        const { result: res, diff } = await ctx.svc.changes(() => submit(ctx.api, body));
        expectError(res, 400, "VALIDATION_ERROR", { field, code: "required" });
        expect(res.body.details).toHaveLength(1);
        expect(diff).toEqual({});
      });
    }
  }

  test("SMT-R28: empty objects and arrays count as present, and contents are not checked", async () => {
    const res = await submit(ctx.api, { client_id: "NOT-A-CLIENT", policy_type: "spaceship", property_address: {}, property_details: {}, coverages: [] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ client_id: "NOT-A-CLIENT", policy_type: "spaceship", premium_annual: 1479, premium_monthly: 123.25 });
  });

  const premiums: [string, Record<string, unknown>, number, number][] = [
    ["2400 sq ft built 1996", { square_feet: 2400, year_built: 1996 }, 1734, 144.5],
    ["defaults of 2000 sq ft and year 2000", {}, 1479, 123.25],
    ["zero values fall back to the defaults", { square_feet: 0, year_built: 0 }, 1479, 123.25],
    ["built in 2026 has no age discount", { square_feet: 2000, year_built: 2026 }, 1700, 141.67],
    ["built after 2026 raises the premium", { square_feet: 2000, year_built: 2030 }, 1734, 144.5],
    ["a very old building bottoms out at zero", { square_feet: 2400, year_built: 1700 }, 0, 0],
    ["rounding to cents", { square_feet: 1234, year_built: 2011 }, 970.23, 80.85],
    ["only square footage given", { square_feet: 3000 }, 2218.5, 184.88],
  ];
  for (const [label, details, annual, monthly] of premiums) {
    test(`SMT-R29: premium, ${label}`, async () => {
      const res = await submit(ctx.api, { ...SUBMISSION, property_details: details });
      expect(res.status).toBe(201);
      expect(res.body.premium_annual).toBe(annual);
      expect(res.body.premium_monthly).toBe(monthly);
    });
  }

  test("SMT-R30: a submission inserts one submitted quote with a scheduled inspection", async () => {
    const before = (await ctx.svc.now()).getTime();
    const { result: res, diff } = await ctx.svc.changes(() =>
      submit(ctx.api, { ...SUBMISSION, deductibles: { all_perils: 2500 }, photo_checklist: ["front_exterior", "roof_view"] }),
    );
    expect(res.status).toBe(201);
    expect(res.body.quote_id).toMatch(/^QT-SMIT-\d{13}$/);
    expect(res.body.request_id).toMatch(/^QR-\d{13}$/);
    const stamp = Number(res.body.quote_id.slice("QT-SMIT-".length));
    expect(Math.abs(stamp - before)).toBeLessThan(60_000);
    expect(res.body.submitted_at).toMatch(ISO_TIME);
    expect(Math.abs(Date.parse(res.body.submitted_at) - stamp)).toBeLessThan(1000);
    expect(Date.parse(res.body.inspection_scheduled_at) - Date.parse(res.body.submitted_at)).toBeGreaterThanOrEqual(7 * 86_400_000 - 1000);
    expect(Date.parse(res.body.inspection_scheduled_at) - Date.parse(res.body.submitted_at)).toBeLessThanOrEqual(7 * 86_400_000 + 1000);
    expect(diff.quotes.added).toEqual([
      {
        quote_id: res.body.quote_id,
        request_id: res.body.request_id,
        client_id: "CLI-001",
        policy_type: "homeowners",
        premium_annual: 1734,
        premium_monthly: 144.5,
        coverages: JSON.stringify(SUBMISSION.coverages),
        deductibles: '{"all_perils":2500}',
        status: "submitted",
        decline_reason: null,
        valid_until: null,
        submitted_at: res.body.submitted_at,
        underwriting_status: "pending_review",
        underwriting_notes: null,
        property_address: JSON.stringify(SUBMISSION.property_address),
        property_details: JSON.stringify(SUBMISSION.property_details),
        photo_checklist: '["front_exterior","roof_view"]',
        inspection_status: "scheduled",
        inspection_scheduled_at: res.body.inspection_scheduled_at,
        inspection_completed_at: null,
        inspection_notes: null,
      },
    ]);
    expect(diff.quotes.changed).toEqual([]);
    expect(diff.quotes.removed).toEqual([]);
    expect(Object.keys(diff).sort()).toEqual(["quotes", "underwriting_conditions"]);
  });

  test("SMT-R30: deductibles default to {} and the photo checklist to []", async () => {
    const res = await submit(ctx.api);
    const row = await quote(res.body.quote_id);
    expect(row.deductibles).toBe("{}");
    expect(row.photo_checklist).toBe("[]");
  });

  test("SMT-R31: three pending conditions are created for the quote", async () => {
    const { result: res, diff } = await ctx.svc.changes(() => submit(ctx.api));
    const id = res.body.quote_id;
    const base = { quote_id: id, status: "pending", created_at: res.body.submitted_at, resolved_at: null };
    expect(diff.underwriting_conditions.added).toEqual([
      { ...base, condition_id: `COND-${id}-1`, condition_type: "inspection_required", description: "4-point inspection report required (roof, electrical, plumbing, HVAC)" },
      { ...base, condition_id: `COND-${id}-2`, condition_type: "document_required", description: "Proof of prior insurance coverage required" },
      { ...base, condition_id: `COND-${id}-3`, condition_type: "document_required", description: "Property photos must be reviewed and verified" },
    ]);
  });

  test("SMT-R32: the response is 201 with the eleven documented fields", async () => {
    const res = await submit(ctx.api);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual([
      "quote_id", "request_id", "client_id", "policy_type", "premium_annual", "premium_monthly", "status",
      "inspection_status", "inspection_scheduled_at", "conditions_count", "submitted_at",
    ]);
    expect(res.body).toMatchObject({ status: "submitted", inspection_status: "scheduled", conditions_count: 3 });
    contract.check(res);
  });

  test("SMT-R32: a submitted quote can be read back and decided", async () => {
    const res = await submit(ctx.api);
    const read = await ctx.api.get(`${API}/quotes/${res.body.quote_id}`);
    expect(read.body).toMatchObject({ status: "submitted", underwriting_status: "pending_review", valid_until: null, coverages: SUBMISSION.coverages, deductibles: {} });
    contract.check(read);
    const decided = await decide(res.body.quote_id, { decision: "approve" });
    expect(decided.body).toMatchObject({ status: "submitted", underwriting_status: "approved" });
  });

  test("Known gaps 1 & 3: invalid submission conforms to 400 BadRequest; quotes and documents conform strictly to specs/carrier-summit.yaml", async () => {
    const invalid = await submit(ctx.api, {});
    expectError(invalid, 400, "VALIDATION_ERROR");
    contract.check(invalid);
    const bound = await ctx.api.get(`${API}/quotes/QT-APPROVED`);
    contract.check(bound);
    const docs = await ctx.api.get(`${API}/policies/POL-DOCS/documents`);
    contract.check(docs);
  });
});

describe("inspections", () => {
  test("SMT-R33: the inspection of a submission shows the schedule and the decoded property", async () => {
    const sub = await submit(ctx.api);
    const res = await ctx.api.get(`${API}/inspections/${sub.body.quote_id}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual([
      "quote_id", "inspection_status", "inspection_scheduled_at", "inspection_completed_at", "inspection_notes",
      "property_address", "property_details",
    ]);
    expect(res.body).toEqual({
      quote_id: sub.body.quote_id,
      inspection_status: "scheduled",
      inspection_scheduled_at: sub.body.inspection_scheduled_at,
      inspection_completed_at: null,
      inspection_notes: null,
      property_address: SUBMISSION.property_address,
      property_details: SUBMISSION.property_details,
    });
    contract.check(res);
  });

  test("SMT-R33: a quote that was never submitted through the portal is not_scheduled with null property", async () => {
    const res = await ctx.api.get(`${API}/inspections/QT-PENDING`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      quote_id: "QT-PENDING",
      inspection_status: "not_scheduled",
      inspection_scheduled_at: null,
      inspection_completed_at: null,
      inspection_notes: null,
      property_address: null,
      property_details: null,
    });
    contract.check(res);
  });

  test("SMT-R33: an unknown quote is 404", async () => {
    const res = await ctx.api.get(`${API}/inspections/QT-NOPE`);
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("quote not found.");
    contract.check(res);
  });

  test("SMT-R34: the conditions of a submission are listed with their six fields", async () => {
    const sub = await submit(ctx.api);
    const res = await ctx.api.get(`${API}/inspections/${sub.body.quote_id}/conditions`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["quote_id", "conditions_count", "conditions"]);
    expect(res.body.quote_id).toBe(sub.body.quote_id);
    expect(res.body.conditions_count).toBe(3);
    const conditions = [...res.body.conditions].sort((a: any, b: any) => (a.condition_id < b.condition_id ? -1 : 1));
    expect(conditions.map((c: any) => Object.keys(c))).toEqual(
      Array(3).fill(["condition_id", "condition_type", "description", "status", "created_at", "resolved_at"]),
    );
    expect(conditions.map((c: any) => [c.condition_id, c.condition_type, c.status, c.resolved_at])).toEqual([
      [`COND-${sub.body.quote_id}-1`, "inspection_required", "pending", null],
      [`COND-${sub.body.quote_id}-2`, "document_required", "pending", null],
      [`COND-${sub.body.quote_id}-3`, "document_required", "pending", null],
    ]);
    contract.check(res);
  });

  test("SMT-R34: a quote without conditions returns an empty list, an unknown quote 404", async () => {
    const empty = await ctx.api.get(`${API}/inspections/QT-PENDING/conditions`);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ quote_id: "QT-PENDING", conditions_count: 0, conditions: [] });
    contract.check(empty);
    const missing = await ctx.api.get(`${API}/inspections/QT-NOPE/conditions`);
    expectError(missing, 404, "NOT_FOUND");
    contract.check(missing);
  });

  test("SMT-R34: conditions belong to their own quote", async () => {
    const a = await submit(ctx.api);
    const b = await submit(ctx.api);
    const res = await ctx.api.get(`${API}/inspections/${a.body.quote_id}/conditions`);
    expect(res.body.conditions.every((c: any) => c.condition_id.startsWith(`COND-${a.body.quote_id}-`))).toBe(true);
    expect(await ctx.svc.table("underwriting_conditions")).toHaveLength(6);
    expect(b.body.quote_id).not.toBe(a.body.quote_id);
  });

  test("Known gap 3: inspection status not_scheduled for seed quotes conforms strictly to InspectionStatusResponse", async () => {
    const res = await ctx.api.get(`${API}/inspections/QT-PENDING`);
    expect(res.status).toBe(200);
    expect(res.body.inspection_status).toBe("not_scheduled");
    contract.check(res);
  });
});
