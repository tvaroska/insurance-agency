import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { book, escalation, ESCALATION_ID, ISO_UTC, start, type Ctx } from "./support";

const contract = loadContract("ams");
let ctx: Ctx;

const REASONS = [
  "premium_threshold",
  "state_minimum_violation",
  "coverage_adequacy",
  "surplus_lines",
  "principal_review",
  "backdating",
  "attorney_involvement",
  "claims_specialist",
  "claim_specialist",
];

// AMS-R79.
const RESPONSE_TEXT: Record<string, string> = {
  coverage_adequacy_review:
    "Please provide the current coverage declarations page and any prior loss history before I can evaluate adequacy.",
  roof_inspection_required:
    "A roof inspection report is required for properties with roofs older than 15 years. Please obtain and submit before proceeding.",
  coverage_gap_review:
    "I need to review the gap in coverage dates. Please provide documentation of prior coverage or a signed statement of no loss.",
  high_value_property_approval:
    "High-value property binding approved. Ensure appraisal is on file and replacement cost endorsement is attached.",
  premium_threshold_approval: "Premium threshold review complete. Approved for binding. Verify payment plan is documented.",
  flood_zone_exception: "Flood zone exception granted. Ensure separate flood policy is in place or NFIP documentation is attached.",
  surplus_lines_approval:
    "Surplus lines placement approved. Verify surplus lines license is current and proper disclosures are provided to insured.",
  principal_approval_granted:
    "Principal review complete. This risk has been approved for binding. Proceed with standard procedures.",
  attorney_referral_confirmation:
    "Attorney referral confirmed. Proceed with the recommended legal counsel and document all communications.",
  state_minimum_override_denial:
    "Cannot override state minimum coverage requirements. The requested limits fall below the mandatory minimums for this state. Adjust coverages to meet or exceed state requirements.",
  premium_threshold_denial:
    "Premium threshold review denied. The risk profile does not meet underwriting guidelines at this premium level.",
  surplus_lines_license_missing:
    "Cannot place this risk on surplus lines — the required surplus lines license is not on file. Obtain proper licensing before resubmitting.",
  principal_approval_denied:
    "Principal review complete. This risk does not meet our agency's risk appetite and has been declined.",
  backdating_denial: "Backdating coverage is not permitted. The effective date must be the current date or a future date.",
  general_escalation_acknowledged:
    "Escalation received and under review. Please provide any additional context or documentation that may help expedite the decision.",
};

// AMS-R78: [reason, summary, expected template, expected decision].
const DECISIONS: [string, string, string, string][] = [
  ["state_minimum_violation", "Client insists on lower limits, please approve", "state_minimum_override_denial", "denied"],
  ["backdating", "High value client asks for an earlier date", "backdating_denial", "denied"],
  ["premium_threshold", "Premium of $12,500 on a commercial package", "premium_threshold_approval", "approved"],
  ["premium_threshold", "Underwriter says deny", "premium_threshold_denial", "denied"],
  ["premium_threshold", "Recommend we DECLINE this risk", "premium_threshold_denial", "denied"],
  ["premium_threshold", "Carrier may reject it", "premium_threshold_denial", "denied"],
  ["premium_threshold", "Loss history is unacceptable", "premium_threshold_denial", "denied"],
  ["coverage_adequacy", "There is a gap between terms", "coverage_gap_review", "needs_info"],
  ["coverage_adequacy", "Policy may lapse next month", "coverage_gap_review", "needs_info"],
  ["coverage_adequacy", "Old roof on the house", "roof_inspection_required", "needs_info"],
  ["coverage_adequacy", "Needs an inspection", "roof_inspection_required", "needs_info"],
  ["coverage_adequacy", "Roof issue and a coverage gap", "coverage_gap_review", "needs_info"],
  ["coverage_adequacy", "Is the dwelling limit enough?", "coverage_adequacy_review", "needs_info"],
  ["surplus_lines", "Producer has no license for this", "surplus_lines_license_missing", "denied"],
  ["surplus_lines", "Missing license on file", "surplus_lines_license_missing", "denied"],
  ["surplus_lines", "Unlicensed placement requested", "surplus_lines_license_missing", "denied"],
  ["surplus_lines", "Coastal property needs a non-admitted carrier", "surplus_lines_approval", "approved"],
  ["attorney_involvement", "Client mentioned a lawsuit and wants us to deny it", "attorney_referral_confirmation", "approved"],
  ["principal_review", "Underwriting would decline", "principal_approval_denied", "denied"],
  ["principal_review", "Not acceptable under our appetite", "principal_approval_denied", "denied"],
  ["principal_review", "Reject: high value home in a flood zone", "principal_approval_denied", "denied"],
  ["principal_review", "A high value home", "high_value_property_approval", "approved"],
  ["principal_review", "High-Value collection", "high_value_property_approval", "approved"],
  ["principal_review", "High value home in a flood zone", "high_value_property_approval", "approved"],
  ["principal_review", "Property sits in a flood zone", "flood_zone_exception", "approved"],
  ["principal_review", "Flood exposure, attorney involved", "flood_zone_exception", "approved"],
  ["principal_review", "Their attorney called", "attorney_referral_confirmation", "approved"],
  ["principal_review", "A legal question came up", "attorney_referral_confirmation", "approved"],
  ["principal_review", "Unusual risk, please look", "principal_approval_granted", "approved"],
  ["claims_specialist", "Client reported a loss, deny or approve?", "general_escalation_acknowledged", "needs_info"],
  ["claim_specialist", "Client reported a loss", "general_escalation_acknowledged", "needs_info"],
];

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({ tables: book() });
});

const create = (overrides: Record<string, unknown> = {}) =>
  ctx.api.post("/v1/escalations", { client_id: "CLI-A", reason: "premium_threshold", summary: "Premium of $12,500.", ...overrides });

describe("createEscalation", () => {
  test("AMS-R72: the body is validated in one step, in the documented order", async () => {
    const empty = await ctx.api.post("/v1/escalations", {});
    expectError(empty, 400, "VALIDATION_ERROR");
    expect(empty.body.details).toEqual([
      { field: "client_id", message: "client_id is required.", code: "required" },
      { field: "reason", message: "reason is required.", code: "required" },
      { field: "summary", message: "summary is required.", code: "required" },
    ]);
    contract.check(empty);

    const bad = await ctx.api.post("/v1/escalations", { client_id: "CLI-A", reason: "because", summary: "s".repeat(2001) });
    expect(bad.body.details).toEqual([
      { field: "reason", message: `reason must be one of: ${REASONS.join(", ")}.`, code: "invalid_enum" },
      { field: "summary", message: "summary must be at most 2000 characters.", code: "too_long" },
    ]);
  });

  test("AMS-R72: an empty reason yields required and invalid_enum; an empty summary or client_id only required", async () => {
    const res = await ctx.api.post("/v1/escalations", { client_id: "", reason: "", summary: "" });
    expect(res.body.details.map((d: any) => `${d.field}:${d.code}`)).toEqual([
      "client_id:required",
      "reason:required",
      "reason:invalid_enum",
      "summary:required",
    ]);
  });

  test("AMS-R72: every listed reason is accepted, and a 2000-character summary too", async () => {
    for (const reason of REASONS) {
      const res = await create({ reason });
      expect([reason, res.status, res.body.reason]).toEqual([reason, 201, reason]);
    }
    expect((await create({ summary: "s".repeat(2000) })).status).toBe(201);
  });

  test("AMS-R72: reason_code is read when reason is absent, and reason wins when both are sent", async () => {
    const alias = await ctx.api.post("/v1/escalations", { client_id: "CLI-A", reason_code: "backdating", summary: "Alias." });
    expect([alias.status, alias.body.reason]).toEqual([201, "backdating"]);
    const both = await ctx.api.post("/v1/escalations", {
      client_id: "CLI-A",
      reason: "surplus_lines",
      reason_code: "backdating",
      summary: "Both.",
    });
    expect(both.body.reason).toBe("surplus_lines");
    const invalidAlias = await ctx.api.post("/v1/escalations", { client_id: "CLI-A", reason_code: "nope", summary: "Bad alias." });
    expectError(invalidAlias, 400, "VALIDATION_ERROR", { field: "reason", code: "invalid_enum" });
  });

  test("AMS-R72: the client and policy ids are not checked against the other tables", async () => {
    const res = await create({ client_id: "GHOST", policy_id: "POL-GHOST" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ client_id: "GHOST", policy_id: "POL-GHOST" });
  });

  test("AMS-R73: a new escalation is pending, unpolled and without a manager response", async () => {
    const res = await create({ context: { annual_premium: 12500, carrier: "SMIT" } });
    expect(res.status).toBe(201);
    expect(res.body.escalation_id).toMatch(ESCALATION_ID);
    expect(res.body).toEqual({
      escalation_id: res.body.escalation_id,
      client_id: "CLI-A",
      policy_id: null,
      reason: "premium_threshold",
      summary: "Premium of $12,500.",
      context: { annual_premium: 12500, carrier: "SMIT" },
      status: "pending",
      manager_response: null,
      poll_count: 0,
      created_at: res.body.created_at,
      updated_at: res.body.created_at,
    });
    expect(res.body.created_at).toMatch(ISO_UTC);
    contract.check(res);
  });

  test("AMS-R73: context defaults to null and may be any JSON value", async () => {
    expect((await create()).body.context).toBeNull();
    expect((await create({ context: "free text" })).body.context).toBe("free text");
    expect((await create({ context: [1, 2] })).body.context).toEqual([1, 2]);
    expect((await create({ context: 7 })).body.context).toBe(7);
    expect((await create({ context: true })).body.context).toBe(true);
    for (const falsy of [0, false, ""]) {
      const { result, diff } = await ctx.svc.changes(() => create({ context: falsy }));
      expect(result.body.context).toBeNull();
      expect(diff.escalations.added[0].context).toBeNull();
    }
  });

  test("AMS-R74, AMS-R3: one escalation row and one 'created' event are written; context is stored as JSON text", async () => {
    const { result, diff } = await ctx.svc.changes(() => create({ policy_id: "POL-A-AUTO", context: { k: 1 } }));
    expect(Object.keys(diff).sort()).toEqual(["escalation_events", "escalations"]);
    expect(diff.escalations.added).toEqual([
      {
        escalation_id: result.body.escalation_id,
        client_id: "CLI-A",
        policy_id: "POL-A-AUTO",
        reason: "premium_threshold",
        summary: "Premium of $12,500.",
        context: '{"k":1}',
        status: "pending",
        manager_response: null,
        poll_count: 0,
        created_at: result.body.created_at,
        updated_at: result.body.created_at,
      },
    ]);
    expect(diff.escalation_events.added.map(({ id, ...rest }) => rest)).toEqual([
      {
        escalation_id: result.body.escalation_id,
        event_type: "created",
        from_status: null,
        to_status: "pending",
        details: null,
        created_at: result.body.created_at,
      },
    ]);
  });
});

describe("getEscalation", () => {
  test("AMS-R75: an unknown id is 404", async () => {
    const res = await ctx.api.get("/v1/escalations/esc_missing");
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("escalation not found.");
    contract.check(res);
  });

  test("AMS-R75: the first read counts one poll, leaves the escalation pending and returns its events", async () => {
    const id = (await create()).body.escalation_id;
    const { result, diff } = await ctx.svc.changes(() => ctx.api.get(`/v1/escalations/${id}`));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ escalation_id: id, status: "pending", poll_count: 1, manager_response: null });
    expect(result.body.events).toHaveLength(1);
    expect(result.body.events[0]).toMatchObject({
      escalation_id: id,
      event_type: "created",
      from_status: null,
      to_status: "pending",
      details: null,
    });
    expect(Number.isInteger(result.body.events[0].id)).toBe(true);
    contract.check(result);

    expect(Object.keys(diff)).toEqual(["escalations"]);
    expect(diff.escalations.changed[0].fields.sort()).toEqual(["poll_count", "updated_at"]);
    expect(diff.escalations.changed[0].after.poll_count).toBe(1);
  });

  test("AMS-R76: the second read decides a pending escalation and appends two events", async () => {
    const id = (await create()).body.escalation_id;
    await ctx.api.get(`/v1/escalations/${id}`);
    const { result, diff } = await ctx.svc.changes(() => ctx.api.get(`/v1/escalations/${id}`));
    expect(result.body).toMatchObject({ status: "approved", poll_count: 2 });
    expect(result.body.manager_response).toEqual({
      decision: "approved",
      template_id: "premium_threshold_approval",
      response_text: RESPONSE_TEXT.premium_threshold_approval,
      resolved_at: result.body.updated_at,
    });
    expect(result.body.manager_response.resolved_at).toMatch(ISO_UTC);
    expect(result.body.events.map((e: any) => [e.event_type, e.from_status, e.to_status, e.details])).toEqual([
      ["created", null, "pending", null],
      ["manager_reviewed", "pending", "approved", { template_id: "premium_threshold_approval" }],
      ["status_changed", "pending", "approved", null],
    ]);
    contract.check(result);

    expect(Object.keys(diff).sort()).toEqual(["escalation_events", "escalations"]);
    expect(diff.escalation_events.added).toHaveLength(2);
    expect(diff.escalation_events.added[0].details).toBe('{"template_id":"premium_threshold_approval"}');
    const row = diff.escalations.changed[0].after;
    expect(row).toMatchObject({ status: "approved", poll_count: 2 });
    expect(JSON.parse(row.manager_response as string)).toEqual(result.body.manager_response);
  });

  test("AMS-R76: an escalation that is pending with a higher poll count is decided on the next read", async () => {
    await ctx.svc.seed({ tables: book({ escalations: [escalation("esc_late", { poll_count: 7, reason: "backdating" })] }) });
    const res = await ctx.api.get("/v1/escalations/esc_late");
    expect(res.body).toMatchObject({ status: "denied", poll_count: 8 });
    expect(res.body.manager_response.template_id).toBe("backdating_denial");
  });

  test("AMS-R77: a decided escalation is never decided again; reading it only counts the poll", async () => {
    const id = (await create()).body.escalation_id;
    await ctx.api.get(`/v1/escalations/${id}`);
    const decided = await ctx.api.get(`/v1/escalations/${id}`);
    const { result, diff } = await ctx.svc.changes(() => ctx.api.get(`/v1/escalations/${id}`));
    expect(result.body).toMatchObject({ status: "approved", poll_count: 3 });
    expect(result.body.manager_response).toEqual(decided.body.manager_response);
    expect(result.body.events).toHaveLength(3);
    expect(Object.keys(diff)).toEqual(["escalations"]);
    expect(diff.escalations.changed[0].fields.sort()).toEqual(["poll_count", "updated_at"]);
  });

  test("AMS-R77: needs_info is final too, even when seeded without a manager response", async () => {
    await ctx.svc.seed({
      tables: book({ escalations: [escalation("esc_info", { status: "needs_info", poll_count: 5, reason: "premium_threshold" })] }),
    });
    const res = await ctx.api.get("/v1/escalations/esc_info");
    expect(res.body).toMatchObject({ status: "needs_info", poll_count: 6, manager_response: null, events: [] });
  });

  describe("decision table", () => {
    for (const [reason, summary, template, decision] of DECISIONS) {
      test(`AMS-R78, AMS-R79: ${reason} "${summary}" -> ${template} (${decision})`, async () => {
        const id = (await create({ reason, summary, context: { hint: "deny reject decline" } })).body.escalation_id;
        await ctx.api.get(`/v1/escalations/${id}`);
        const res = await ctx.api.get(`/v1/escalations/${id}`);
        expect(res.body.status).toBe(decision);
        expect(res.body.manager_response).toMatchObject({
          decision,
          template_id: template,
          response_text: RESPONSE_TEXT[template],
        });
        contract.check(res, { allow: [/\/reason: is "claims?_specialist"/] });
      });
    }
  });
});

describe("listEscalations", () => {
  beforeEach(async () => {
    await ctx.svc.seed({
      tables: book({
        escalations: [
          escalation("esc_a", { created_at: "2026-01-01T10:00:00.000Z", status: "pending", client_id: "CLI-A" }),
          escalation("esc_b", { created_at: "2026-01-02T10:00:00.000Z", status: "approved", client_id: "CLI-B", context: '{"k":1}' }),
          escalation("esc_c", { created_at: "2026-01-02T10:00:00.000Z", status: "denied", client_id: "CLI-A" }),
          escalation("esc_d", { created_at: "2026-01-03T10:00:00.000Z", status: "needs_info", client_id: "CLI-A" }),
        ],
      }),
    });
  });

  const ids = (res: { body: any }) => res.body.data.map((e: any) => e.escalation_id);
  const list = (query: Record<string, string> = {}) => ctx.api.get("/v1/escalations", { query });

  test("AMS-R80: escalations are sorted newest first, then by id descending, without events", async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(["esc_d", "esc_c", "esc_b", "esc_a"]);
    expect(res.body.data[2]).toEqual({
      escalation_id: "esc_b",
      client_id: "CLI-B",
      policy_id: null,
      reason: "premium_threshold",
      summary: "Premium above the binding limit.",
      context: { k: 1 },
      status: "approved",
      manager_response: null,
      poll_count: 0,
      created_at: "2026-01-02T10:00:00.000Z",
      updated_at: "2025-01-01T00:00:00.000Z",
    });
    contract.check(res);
  });

  test("AMS-R80: listing does not count as a poll and writes nothing", async () => {
    const { diff } = await ctx.svc.changes(() => list());
    expect(diff).toEqual({});
  });

  test("AMS-R81: status and client filter exactly; created_after and created_before are inclusive", async () => {
    expect(ids(await list({ status: "pending" }))).toEqual(["esc_a"]);
    expect(ids(await list({ status: "needs_info" }))).toEqual(["esc_d"]);
    expect(ids(await list({ client_id: "CLI-A" }))).toEqual(["esc_d", "esc_c", "esc_a"]);
    expect(ids(await list({ client_id: "CLI-A", status: "denied" }))).toEqual(["esc_c"]);
    expect(ids(await list({ created_after: "2026-01-02T10:00:00.000Z" }))).toEqual(["esc_d", "esc_c", "esc_b"]);
    expect(ids(await list({ created_before: "2026-01-02T10:00:00.000Z" }))).toEqual(["esc_c", "esc_b", "esc_a"]);
    expect(
      ids(await list({ created_after: "2026-01-02T00:00:00.000Z", created_before: "2026-01-02T23:59:59.999Z" })),
    ).toEqual(["esc_c", "esc_b"]);
  });

  test("AMS-R82: status and the two dates are validated together", async () => {
    const res = await list({ status: "open", created_after: "last week", created_before: "soon" });
    expectError(res, 400, "VALIDATION_ERROR");
    expect(res.body.details).toEqual([
      { field: "status", message: "status must be one of: pending, approved, denied, needs_info.", code: "invalid_enum" },
      { field: "created_after", message: "created_after must be a valid ISO date.", code: "invalid_format" },
      { field: "created_before", message: "created_before must be a valid ISO date.", code: "invalid_format" },
    ]);
  });

  test("AMS-R82: empty filter values are ignored", async () => {
    const res = await list({ status: "", created_after: "", created_before: "" });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(4);
  });
});

test.todo("AMS-G12: Escalation.reason in specs/ams.yaml lacks claims_specialist and claim_specialist, and the reason_code alias is undeclared", () => {});
test.todo("AMS-G13: specs/ams.yaml documents no 400 for listEscalations; invalid filters and cursors return it", () => {});
