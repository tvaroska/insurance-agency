import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract, startService } from "../harness";
import {
  DOCUMENT_ID,
  ISO_UTC,
  amsClient,
  amsPolicy,
  check,
  checkError,
  claimDetail,
  documentRow,
  expectPdf,
  pdfField,
  serveAms,
  start,
  todayUtc,
  type Ctx,
} from "./support";

const contract = loadContract("ecm");
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed();
  serveAms(ctx.ams, [amsClient()], [amsPolicy()]);
  ctx.claims.clear(true);
});

const COI_PATHS = ["/v1/documents/coi/generate", "/v1/documents/coi", "/v1/coi/generate", "/v1/coi"];
// ECM-G03: CoiGenerateResponse in specs/ecm.yaml types coverage limits as numbers and deductibles as non-null.
const COVERAGE_GAP = [/coverage_summary\/coverages\/\d+\/(limit|deductible): is /];
const coiBody = (overrides: Record<string, unknown> = {}) => ({
  policy_id: "POL-9",
  certificate_holder: { name: "First Bank", address: { street: "9 Loan Rd", city: "Dallas", state: "TX", zip: "75001" } },
  ...overrides,
});

describe("certificate of insurance: validation", () => {
  for (const path of COI_PATHS) {
    test(`ECM-R60, ECM-R61: POST ${path} requires policy_id and a certificate holder`, async () => {
      const { result, diff } = await ctx.svc.changes(() => ctx.api.post(path, {}));
      expectError(
        result,
        400,
        "VALIDATION_ERROR",
        { field: "policy_id", code: "required" },
        { field: "certificate_holder", code: "required" },
      );
      expect(result.body.details).toHaveLength(2);
      checkError(contract, result);
      expect(diff).toEqual({});
      expect(ctx.ams.calls).toEqual([]);
    });
  }

  test("ECM-R61: the holder needs a name, checked after the required fields", async () => {
    for (const certificate_holder of [{}, { address: { city: "Dallas" } }, { name: "" }]) {
      const res = await ctx.api.post("/v1/coi", coiBody({ certificate_holder }));
      expectError(res, 400, "VALIDATION_ERROR", { field: "certificate_holder.name", code: "required" });
      expect(res.body.details).toHaveLength(1);
    }
    expect(ctx.ams.calls).toEqual([]);
  });

  test("ECM-R63: a policy AMS does not know is a validation error with code not_found", async () => {
    const { result, diff } = await ctx.svc.changes(() => ctx.api.post("/v1/coi", coiBody({ policy_id: "POL-NOPE" })));
    expectError(result, 400, "VALIDATION_ERROR", { field: "policy_id", code: "not_found" });
    expect(result.body.details[0].message).toBe("Policy POL-NOPE not found.");
    checkError(contract, result);
    expect(diff).toEqual({});
  });

  for (const status of ["cancelled", "expired", "pending"]) {
    test(`ECM-R63: a policy with status ${status} is refused with code invalid_status`, async () => {
      serveAms(ctx.ams, [amsClient()], [amsPolicy({ status })]);
      const { result, diff } = await ctx.svc.changes(() => ctx.api.post("/v1/coi", coiBody()));
      expectError(result, 400, "VALIDATION_ERROR", { field: "policy_id", code: "invalid_status" });
      expect(result.body.details[0].message).toBe(
        `Cannot generate COI: policy status is '${status}'. Policy must be active.`,
      );
      expect(diff).toEqual({});
    });
  }
});

describe("certificate of insurance: effects", () => {
  for (const path of COI_PATHS) {
    test(`ECM-R60, ECM-R64: POST ${path} stores a generated coi document and returns the certificate summary`, async () => {
      const { result: res, diff } = await ctx.svc.changes(() => ctx.api.post(path, coiBody()));
      expect(res.status).toBe(201);
      check(contract, res, COVERAGE_GAP);
      expect(res.body).toEqual({
        document_id: expect.stringMatching(DOCUMENT_ID),
        client_id: "CLI-9",
        policy_id: "POL-9",
        document_type: "coi",
        filename: expect.stringMatching(/^COI-POL-9-\d{13}\.pdf$/),
        file_size_bytes: expect.any(Number),
        pdf_url: `/v1/documents/coi/${res.body.document_id}/pdf`,
        status: "generated",
        certificate_holder: {
          name: "First Bank",
          address: { street: "9 Loan Rd", city: "Dallas", state: "TX", zip: "75001" },
        },
        description: "Certificate of Insurance for Cora Client",
        coverage_summary: {
          policy_type: "personal_auto",
          carrier_code: "ERIE",
          effective_date: "2026-01-01",
          expiration_date: "2027-01-01",
          coverages: amsPolicy().coverages,
        },
        created_at: expect.stringMatching(ISO_UTC),
      });
      expect(Object.keys(diff)).toEqual(["documents"]);
      expect(diff.documents.added).toEqual([
        {
          document_id: res.body.document_id,
          client_id: "CLI-9",
          document_type: "coi",
          filename: res.body.filename,
          mime_type: "application/pdf",
          file_size_bytes: res.body.file_size_bytes,
          status: "generated",
          upload_date: res.body.created_at,
          signer_name: null,
          signer_email: null,
          signed_date: null,
          expiration_date: "2027-01-01",
          tags: '["coi","personal_auto"]',
        },
      ]);

      const pdf = await ctx.api.get(res.body.pdf_url);
      expectPdf(pdf);
      expect(pdf.bytes.length).toBe(res.body.file_size_bytes);
    });
  }

  test("ECM-R61, ECM-R64: holder_name and holder_address stand in for certificate_holder, and description is kept", async () => {
    const flat = await ctx.api.post("/v1/coi", {
      policy_id: "POL-9",
      holder_name: "Second Bank",
      holder_address: { city: "Waco" },
      description: "Loan 77 collateral.",
    });
    expect(flat.status).toBe(201);
    expect(flat.body).toMatchObject({
      certificate_holder: { name: "Second Bank", address: { city: "Waco" } },
      description: "Loan 77 collateral.",
    });
    const noAddress = await ctx.api.post("/v1/coi", { policy_id: "POL-9", holder_name: "Third Bank" });
    expect(noAddress.body.certificate_holder).toEqual({ name: "Third Bank", address: {} });
    const nested = await ctx.api.post("/v1/coi", {
      policy_id: "POL-9",
      certificate_holder: { name: "Nested Wins" },
      holder_name: "Flat Loses",
    });
    expect(nested.body.certificate_holder).toEqual({ name: "Nested Wins", address: {} });
  });

  test("ECM-R65: the certificate PDF is an ACORD 25 that names the insured, the policy and the holder", async () => {
    const res = await ctx.api.post("/v1/coi", coiBody({ description: "Loan 77 collateral." }));
    const pdf = await ctx.api.get(res.body.pdf_url);
    const text = expectPdf(pdf);
    expect(pdf.headers.get("content-disposition")).toBe(`inline; filename="ACORD-25-${res.body.document_id}.pdf"`);
    expect(text.slice(0, 4)).toEqual([
      "ACORD 25",
      "CERTIFICATE OF LIABILITY INSURANCE",
      "Evergreen Insurance Agency",
      `Generated: ${todayUtc()}`,
    ]);
    expect(text.slice(-2)).toEqual(["ACORD 25 (2025/01)", "Generated by Evergreen Insurance Platform"]);
    const fields = Object.fromEntries(
      [
        "PRODUCER",
        "INSURED",
        "INSURED EMAIL",
        "INSURED ADDRESS",
        "INSURED PHONE",
        "POLICY NUMBER",
        "INSURER / CARRIER",
        "LINE OF BUSINESS",
        "POLICY EFF DATE",
        "POLICY EXP DATE",
        "ANNUAL PREMIUM",
        "CERTIFICATE HOLDER",
        "HOLDER ADDRESS",
        "DESCRIPTION OF OPERATIONS / LOCATIONS",
      ].map((label) => [label, pdfField(text, label)]),
    );
    expect(fields).toEqual({
      PRODUCER: "Evergreen Insurance Partners",
      INSURED: "Cora Client",
      "INSURED EMAIL": "cora@example.test",
      "INSURED ADDRESS": "1 Main St, Austin, TX, 78701",
      "INSURED PHONE": "+1-555-010-0009",
      "POLICY NUMBER": "POL-9",
      "INSURER / CARRIER": "ERIE",
      "LINE OF BUSINESS": "PERSONAL_AUTO",
      "POLICY EFF DATE": "2026-01-01",
      "POLICY EXP DATE": "2027-01-01",
      "ANNUAL PREMIUM": "$1,200.00",
      "CERTIFICATE HOLDER": "First Bank",
      "HOLDER ADDRESS": "9 Loan Rd, Dallas, TX, 75001",
      "DESCRIPTION OF OPERATIONS / LOCATIONS": "Loan 77 collateral.",
    });
    const table = text.slice(text.indexOf("DEDUCTIBLE") + 1, text.indexOf("CERTIFICATE HOLDER & DESCRIPTION OF OPERATIONS"));
    expect(table).toEqual(["Bodily Injury", "100/300", "—", "Collision", "—", "$500"]);
  });

  test("ECM-R65: a holder without an address shows On File, and a missing phone shows a dash", async () => {
    serveAms(ctx.ams, [amsClient({ phone: null })], [amsPolicy({ coverages: [] })]);
    const res = await ctx.api.post("/v1/coi", { policy_id: "POL-9", holder_name: "Third Bank" });
    const text = expectPdf(await ctx.api.get(res.body.pdf_url));
    expect(pdfField(text, "HOLDER ADDRESS")).toBe("On File");
    expect(pdfField(text, "INSURED PHONE")).toBe("—");
    expect(pdfField(text, "DESCRIPTION OF OPERATIONS / LOCATIONS")).toBe("Certificate of Insurance for Cora Client");
  });

  test("ECM-R66: both PDF paths serve the certificate, and an unknown id is 404", async () => {
    const res = await ctx.api.post("/v1/coi", coiBody());
    const a = await ctx.api.get(`/v1/documents/coi/${res.body.document_id}/pdf`);
    const b = await ctx.api.get(`/v1/coi/${res.body.document_id}/pdf`);
    contract.check(a);
    contract.check(b);
    expect(expectPdf(a)).toEqual(expectPdf(b));
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);

    for (const path of ["/v1/documents/coi/doc_nope/pdf", "/v1/coi/doc_nope/pdf"]) {
      const missing = await ctx.api.get(path);
      expectError(missing, 404, "NOT_FOUND");
      expect(missing.body.message).toBe("COI document not found.");
      checkError(contract, missing);
    }
  });

  test("ECM-R67: a stored coi document that this process did not generate gets a placeholder certificate", async () => {
    // The service remembers a placeholder for as long as the process lives, so the id is new on every run.
    const id = `DOC-COI-${Date.now()}`;
    await ctx.svc.seed({
      tables: {
        documents: [
          documentRow({ document_id: id, client_id: "CLI-5", document_type: "coi", filename: "COI-POLX-1.pdf", expiration_date: "2031-12-31" }),
          documentRow({ document_id: "DOC-APP", document_type: "signed_application" }),
        ],
      },
    });
    ctx.ams.clear();
    const pdf = await ctx.api.get(`/v1/coi/${id}/pdf`);
    const text = expectPdf(pdf);
    expect(pdf.headers.get("content-disposition")).toBe('inline; filename="COI-POLX-1.pdf"');
    expect(text[0]).toBe("ACORD 25");
    expect(pdfField(text, "INSURED")).toBe("Policyholder CLI-5");
    expect(pdfField(text, "CERTIFICATE HOLDER")).toBe("Certificate Holder on File");
    expect(pdfField(text, "POLICY EXP DATE")).toBe("2031-12-31");
    expect(ctx.ams.calls).toEqual([]);

    const again = await ctx.api.get(`/v1/documents/coi/${id}/pdf`);
    expectPdf(again);
    expect(Buffer.from(again.bytes).equals(Buffer.from(pdf.bytes))).toBe(true);
    expect(again.headers.get("content-disposition")).toBe(`inline; filename="ACORD-25-${id}.pdf"`);

    const notCoi = await ctx.api.get("/v1/coi/DOC-APP/pdf");
    expectError(notCoi, 404, "NOT_FOUND");
  });
});

describe("policy lookup in AMS", () => {
  test("ECM-R62, ECM-R80, ECM-R81: walks the client list, then each client's policies, with the caller's token", async () => {
    const clients = [amsClient({ id: "CLI-A" }), amsClient({ id: "CLI-B" }), amsClient({ id: "CLI-C" })];
    ctx.ams.clear(true);
    ctx.ams.on("GET", "/v1/clients", (call) =>
      call.query.cursor === "page2"
        ? { body: { data: [clients[1], clients[2]], pagination: { has_more: false, next_cursor: null } } }
        : { body: { data: [clients[0]], pagination: { has_more: true, next_cursor: "page2" } } },
    );
    ctx.ams.on("GET", "/v1/clients/{id}/policies", (call) => ({
      body: { data: call.path.includes("CLI-B") ? [amsPolicy({ policy_id: "POL-OTHER" }), amsPolicy({ client_id: "CLI-B" })] : [] },
    }));

    const token = await ctx.svc.token({ scopes: ["ecm:documents:write"] });
    const res = await ctx.svc.withToken(token).post("/v1/coi", coiBody());
    expect(res.status).toBe(201);
    expect(res.body.client_id).toBe("CLI-B");
    expect(ctx.ams.calls.map((c) => [c.method, c.path, c.query])).toEqual([
      ["GET", "/v1/clients", { limit: "100" }],
      ["GET", "/v1/clients", { limit: "100", cursor: "page2" }],
      ["GET", "/v1/clients/CLI-A/policies", { limit: "100" }],
      ["GET", "/v1/clients/CLI-B/policies", { limit: "100" }],
    ]);
    for (const call of ctx.ams.calls) {
      expect(call.headers.authorization).toBe(`Bearer ${token}`);
      expect(call.headers["x-evergreen-internal"]).toBe("1");
    }
  });

  test("ECM-R82: when AMS answers with an error the service answers 500 INTERNAL_ERROR and writes nothing", async () => {
    for (const failing of ["/v1/clients", "/v1/clients/{id}/policies"]) {
      serveAms(ctx.ams, [amsClient()], [amsPolicy()]);
      ctx.ams.on("GET", failing, { status: 503, body: {} });
      const { result, diff } = await ctx.svc.changes(() => ctx.api.post("/v1/coi", coiBody()));
      expectError(result, 500, "INTERNAL_ERROR");
      expect(diff).toEqual({});
      expectError(await ctx.api.get("/v1/documents/acord/90", { query: { policy_id: "POL-9" } }), 500, "INTERNAL_ERROR");
    }
  });

  test("ECM-R80: the peer addresses come from AMS_BASE_URL and CLAIMS_BASE_URL, and from AMS_URL and CLAIMS_URL when those are empty", async () => {
    const viaFallback = await startService("ecm", {
      env: { AMS_BASE_URL: "", AMS_URL: `${ctx.ams.url}/`, CLAIMS_BASE_URL: "", CLAIMS_URL: `${ctx.claims.url}/` },
    });
    const api = await viaFallback.client();
    ctx.claims.on("GET", "/v1/claims/{id}", { body: claimDetail() });
    expectPdf(await api.get("/v1/documents/acord/35", { query: { claim_id: "CLM-1" } }));
    expect(ctx.claims.calls.map((c) => c.path)).toEqual(["/v1/claims/CLM-1"]);
    expect(ctx.ams.calls.map((c) => c.path)).toEqual(["/v1/clients/CLI-9", "/v1/clients/CLI-9/policies"]);
  }, 30_000);
});

describe("GET /v1/documents/acord/{form_type}", () => {
  const acord = (form: string, query: Record<string, string> = {}) => ctx.api.get(`/v1/documents/acord/${form}`, { query });
  const home = () => serveAms(ctx.ams, [amsClient()], [amsPolicy({ policy_type: "homeowners", multi_policy_discount: true })]);

  test("ECM-R70: form_type must be 90, 80 or 35", async () => {
    for (const form of ["25", "99", "abc"]) {
      const res = await acord(form, { policy_id: "POL-9" });
      expectError(res, 400, "VALIDATION_ERROR", { field: "form_type", code: "invalid_enum" });
      checkError(contract, res);
    }
    expect(ctx.ams.calls).toEqual([]);
  });

  test("ECM-R71: forms 90 and 80 require policy_id, and form 35 requires claim_id", async () => {
    for (const form of ["90", "80"]) {
      expectError(await acord(form, { claim_id: "CLM-1" }), 400, "VALIDATION_ERROR", { field: "policy_id", code: "required" });
    }
    expectError(await acord("35", { policy_id: "POL-9" }), 400, "VALIDATION_ERROR", { field: "claim_id", code: "required" });
    expect(ctx.ams.calls).toEqual([]);
    expect(ctx.claims.calls).toEqual([]);
  });

  test("ECM-R71: an unknown policy and a policy of the wrong type are validation errors", async () => {
    const unknown = await acord("90", { policy_id: "POL-NOPE" });
    expectError(unknown, 400, "VALIDATION_ERROR", { field: "policy_id", code: "not_found" });
    expect(unknown.body.details[0].message).toBe("Policy POL-NOPE not found.");

    const wrong80 = await acord("80", { policy_id: "POL-9" });
    expectError(wrong80, 400, "VALIDATION_ERROR", { field: "policy_id", code: "invalid_type" });
    expect(wrong80.body.details[0].message).toBe("ACORD 80 requires a homeowners policy.");
    home();
    const wrong90 = await acord("90", { policy_id: "POL-9" });
    expectError(wrong90, 400, "VALIDATION_ERROR", { field: "policy_id", code: "invalid_type" });
    expect(wrong90.body.details[0].message).toBe("ACORD 90 requires a personal_auto policy.");
  });

  test("ECM-R73: form 90 is the auto application for the policy's client; nothing is stored", async () => {
    const { result: pdf, diff } = await ctx.svc.changes(() => acord("90", { policy_id: "POL-9" }));
    contract.check(pdf);
    const text = expectPdf(pdf);
    expect(pdf.headers.get("content-disposition")).toBe('inline; filename="ACORD-90.pdf"');
    expect(diff).toEqual({});
    expect(text.slice(0, 4)).toEqual([
      "ACORD 90",
      "PERSONAL AUTOMOBILE APPLICATION",
      "Evergreen Insurance Agency",
      `Generated: ${todayUtc()}`,
    ]);
    expect(text.slice(-2)).toEqual(["ACORD 90 (2025/01)", "Generated by Evergreen Insurance Platform"]);
    const labels = [
      "FULL NAME",
      "DATE OF BIRTH",
      "MARITAL STATUS",
      "MAILING ADDRESS",
      "DRIVER LICENSE #",
      "PHONE",
      "EMAIL",
      "OCCUPATION",
      "POLICY NUMBER",
      "CARRIER",
      "STATUS",
      "EFFECTIVE DATE",
      "EXPIRATION DATE",
      "ANNUAL PREMIUM",
      "MULTI-POLICY DISCOUNT",
    ];
    expect(Object.fromEntries(labels.map((label) => [label, pdfField(text, label)]))).toEqual({
      "FULL NAME": "Cora Client",
      "DATE OF BIRTH": "1980-01-01",
      "MARITAL STATUS": "single",
      "MAILING ADDRESS": "1 Main St, Austin, TX 78701",
      "DRIVER LICENSE #": "TX-123",
      PHONE: "+1-555-010-0009",
      EMAIL: "cora@example.test",
      OCCUPATION: "Engineer",
      "POLICY NUMBER": "POL-9",
      CARRIER: "ERIE",
      STATUS: "ACTIVE",
      "EFFECTIVE DATE": "2026-01-01",
      "EXPIRATION DATE": "2027-01-01",
      "ANNUAL PREMIUM": "$1,200.00",
      "MULTI-POLICY DISCOUNT": "No",
    });
    expect(text.slice(text.indexOf("DEDUCTIBLE") + 1, -2)).toEqual(["Bodily Injury", "100/300", "—", "Collision", "—", "$500"]);
  });

  test("ECM-R73: form 80 is the homeowners application, with the property address split into fields", async () => {
    home();
    const pdf = await acord("80", { policy_id: "POL-9" });
    contract.check(pdf);
    const text = expectPdf(pdf);
    expect(pdf.headers.get("content-disposition")).toBe('inline; filename="ACORD-80.pdf"');
    expect(text.slice(0, 2)).toEqual(["ACORD 80", "HOMEOWNERS APPLICATION"]);
    expect(text.slice(-2)).toEqual(["ACORD 80 (2025/01)", "Generated by Evergreen Insurance Platform"]);
    const labels = ["FULL NAME", "STREET ADDRESS", "CITY", "STATE", "ZIP CODE", "POLICY NUMBER", "STATUS", "MULTI-POLICY DISCOUNT"];
    expect(Object.fromEntries(labels.map((label) => [label, pdfField(text, label)]))).toEqual({
      "FULL NAME": "Cora Client",
      "STREET ADDRESS": "1 Main St",
      CITY: "Austin",
      STATE: "TX",
      "ZIP CODE": "78701",
      "POLICY NUMBER": "POL-9",
      STATUS: "ACTIVE",
      "MULTI-POLICY DISCOUNT": "Yes",
    });
  });

  test("ECM-R72, ECM-R73: form 35 reads the claim from Claims and the client and policy from AMS", async () => {
    ctx.claims.on("GET", "/v1/claims/{id}", {
      body: claimDetail({
        adjuster: { adjuster_id: "ADJ-1", first_name: "Ada", last_name: "Avery", email: "ada@example.test", phone: null, specialty: "auto" },
      }),
    });
    const token = await ctx.svc.token({ scopes: ["ecm:acord:read"] });
    const pdf = await ctx.svc.withToken(token).get("/v1/documents/acord/35", { query: { claim_id: "CLM-1" } });
    contract.check(pdf);
    const text = expectPdf(pdf);
    expect(pdf.headers.get("content-disposition")).toBe('inline; filename="ACORD-35.pdf"');

    expect(ctx.claims.calls.map((c) => [c.method, c.path])).toEqual([["GET", "/v1/claims/CLM-1"]]);
    expect(ctx.ams.calls.map((c) => [c.method, c.path, c.query]).sort()).toEqual([
      ["GET", "/v1/clients/CLI-9", {}],
      ["GET", "/v1/clients/CLI-9/policies", { limit: "100" }],
    ]);
    for (const call of [...ctx.claims.calls, ...ctx.ams.calls]) {
      expect(call.headers.authorization).toBe(`Bearer ${token}`);
      expect(call.headers["x-evergreen-internal"]).toBe("1");
    }

    expect(text.slice(0, 2)).toEqual(["ACORD 35", "LOSS NOTICE"]);
    expect(text.slice(-2)).toEqual(["ACORD 35 (2025/01)", "Generated by Evergreen Insurance Platform"]);
    const labels = [
      "FULL NAME",
      "MAILING ADDRESS",
      "POLICY NUMBER",
      "CARRIER",
      "POLICY TYPE",
      "DATE OF LOSS",
      "DATE REPORTED",
      "TYPE OF LOSS",
      "LOCATION OF LOSS",
      "CLAIM NUMBER",
      "CLAIM STATUS",
      "RESERVE AMOUNT",
      "SETTLEMENT AMOUNT",
      "ADJUSTER NAME",
      "SPECIALTY",
    ];
    expect(Object.fromEntries(labels.map((label) => [label, pdfField(text, label)]))).toEqual({
      "FULL NAME": "Cora Client",
      "MAILING ADDRESS": "1 Main St, Austin, TX 78701",
      "POLICY NUMBER": "POL-9",
      CARRIER: "ERIE",
      "POLICY TYPE": "PERSONAL AUTO",
      "DATE OF LOSS": "2026-02-01",
      "DATE REPORTED": "2026-02-02",
      "TYPE OF LOSS": "AUTO COLLISION",
      "LOCATION OF LOSS": "Austin, TX",
      "CLAIM NUMBER": "CLM-1",
      "CLAIM STATUS": "REPORTED",
      "RESERVE AMOUNT": "$2,500.00",
      "SETTLEMENT AMOUNT": "—",
      "ADJUSTER NAME": "Ada Avery",
      SPECIALTY: "AUTO",
    });
    expect(text).toContain("Rear-ended at a light.");
  });

  test("ECM-R73: form 35 leaves the adjuster section out when the claim has no adjuster", async () => {
    ctx.claims.on("GET", "/v1/claims/{id}", { body: claimDetail() });
    const text = expectPdf(await acord("35", { claim_id: "CLM-1" }));
    expect(text).not.toContain("ADJUSTER NAME");
  });

  test("ECM-R72: a claim whose policy AMS does not list for the client is a validation error", async () => {
    ctx.claims.on("GET", "/v1/claims/{id}", { body: claimDetail({ policy_id: "POL-GONE" }) });
    const res = await acord("35", { claim_id: "CLM-1" });
    expectError(res, 400, "VALIDATION_ERROR", { field: "claim_id", code: "not_found" });
    expect(res.body.details[0].message).toBe("Policy referenced by claim not found in AMS.");
  });

  test("ECM-R82: a claim that Claims does not return, or a client AMS does not return, answers 500 INTERNAL_ERROR", async () => {
    expectError(await acord("35", { claim_id: "CLM-NOPE" }), 500, "INTERNAL_ERROR");
    ctx.claims.on("GET", "/v1/claims/{id}", { body: claimDetail({ client_id: "CLI-GONE" }) });
    expectError(await acord("35", { claim_id: "CLM-1" }), 500, "INTERNAL_ERROR");
  });

  test.todo("ECM-G07: an unknown claim or an AMS failure gets a 4xx or 502 (the service answers 500 INTERNAL_ERROR)", () => {});
  test.todo(
    "ECM-G03: coverage_summary.coverages matches specs/ecm.yaml (the file types limit as a number and deductible as non-null; the service passes on AMS values such as \"100/300\" and null)",
    () => {},
  );
});
