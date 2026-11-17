import { beforeAll, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_TYPES,
  ENROLLMENT_ID,
  ISO_UTC,
  campaign,
  checkError,
  leadRow,
  start,
  type Ctx,
} from "./support";

const contract = loadContract("crm");
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);

const CAMPAIGNS = [
  campaign({ campaign_id: "camp_c", type: "retention", status: "paused" }),
  campaign({ campaign_id: "camp_a", type: "nurture", status: "active" }),
  campaign({ campaign_id: "camp_d", type: "welcome", status: "completed" }),
  campaign({ campaign_id: "camp_b", type: "cross_sell", status: "active" }),
];
const enrollment = (overrides: Record<string, unknown> = {}) => ({
  enrollment_id: "enr_seed",
  campaign_id: "camp_a",
  client_id: "CLI-1",
  trigger_reason: null,
  metadata: null,
  enrolled_at: "2024-05-01T00:00:00.000Z",
  sequence_step: 1,
  ...overrides,
});

describe("GET /v1/campaigns", () => {
  test("CRM-R60: lists campaigns by campaign_id ascending", async () => {
    await ctx.svc.seed({ tables: { campaigns: CAMPAIGNS } });
    const res = await ctx.api.get("/v1/campaigns");
    expect(res.status).toBe(200);
    contract.check(res);
    expect(res.body.data.map((c: any) => c.campaign_id)).toEqual(["camp_a", "camp_b", "camp_c", "camp_d"]);
    expect(res.body.data[0]).toEqual(campaign({ campaign_id: "camp_a", type: "nurture", status: "active" }));
    expect(res.body.pagination).toEqual({ limit: 25, cursor: null, next_cursor: null, has_more: false });
  });

  test("CRM-R61: status and type filter the list; invalid values are reported together", async () => {
    await ctx.svc.seed({ tables: { campaigns: CAMPAIGNS } });
    const ids = async (query: Record<string, string>) => {
      const res = await ctx.api.get("/v1/campaigns", { query });
      expect(res.status).toBe(200);
      contract.check(res);
      return res.body.data.map((c: any) => c.campaign_id);
    };
    expect(await ids({ status: "active" })).toEqual(["camp_a", "camp_b"]);
    expect(await ids({ type: "welcome" })).toEqual(["camp_d"]);
    expect(await ids({ status: "active", type: "cross_sell" })).toEqual(["camp_b"]);
    expect(await ids({ status: "paused", type: "welcome" })).toEqual([]);
    for (const status of CAMPAIGN_STATUSES) await ids({ status });
    for (const type of CAMPAIGN_TYPES) await ids({ type });

    const bad = await ctx.api.get("/v1/campaigns", { query: { status: "draft", type: "blast" } });
    expectError(
      bad,
      400,
      "VALIDATION_ERROR",
      { field: "status", code: "invalid_enum" },
      { field: "type", code: "invalid_enum" },
    );
    checkError(contract, bad);
  });

  test("CRM-R62: pages with a cursor built from campaign_id", async () => {
    await ctx.svc.seed({ tables: { campaigns: CAMPAIGNS } });
    const first = await ctx.api.get("/v1/campaigns", { query: { limit: 3 } });
    expect(first.body.data.map((c: any) => c.campaign_id)).toEqual(["camp_a", "camp_b", "camp_c"]);
    expect(first.body.pagination).toMatchObject({ limit: 3, has_more: true });
    expect(JSON.parse(atob(first.body.pagination.next_cursor))).toEqual({ campaign_id: "camp_c" });
    const second = await ctx.api.get("/v1/campaigns", { query: { limit: 3, cursor: first.body.pagination.next_cursor } });
    contract.check(second);
    expect(second.body.data.map((c: any) => c.campaign_id)).toEqual(["camp_d"]);
    expect(second.body.pagination).toEqual({
      limit: 3,
      cursor: first.body.pagination.next_cursor,
      next_cursor: null,
      has_more: false,
    });
    expectError(await ctx.api.get("/v1/campaigns", { query: { cursor: "%%%" } }), 400, "VALIDATION_ERROR", {
      field: "cursor",
      code: "invalid_format",
    });
  });
});

describe("POST /v1/campaigns/{id}/enroll", () => {
  const enroll = (id: string, body: unknown) => ctx.api.post(`/v1/campaigns/${id}/enroll`, body);
  const seed = (enrollments: Record<string, unknown>[] = []) =>
    ctx.svc.seed({ tables: { campaigns: CAMPAIGNS, campaign_enrollments: enrollments } });

  test("CRM-R70: client_id is required and trigger_reason is limited to 500 characters, before the lookup", async () => {
    await seed();
    for (const client_id of [undefined, null, ""]) {
      const res = await enroll("camp_zzz", { client_id });
      expectError(res, 400, "VALIDATION_ERROR", { field: "client_id", code: "required" });
      checkError(contract, res);
    }
    const long = await enroll("camp_zzz", { trigger_reason: "r".repeat(501) });
    expectError(
      long,
      400,
      "VALIDATION_ERROR",
      { field: "client_id", code: "required" },
      { field: "trigger_reason", code: "too_long" },
    );
    expect((await enroll("camp_a", { client_id: "CLI-5", trigger_reason: "r".repeat(500) })).status).toBe(201);
  });

  test("CRM-R70: an unknown campaign is 404 NOT_FOUND", async () => {
    await seed();
    const res = await enroll("camp_zzz", { client_id: "CLI-1" });
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("campaign not found.");
    checkError(contract, res);
  });

  test("CRM-R70: a campaign that is not active is 409 CONFLICT and nothing is written", async () => {
    await seed();
    for (const [id, status] of [
      ["camp_c", "paused"],
      ["camp_d", "completed"],
    ]) {
      const { result, diff } = await ctx.svc.changes(() => enroll(id, { client_id: "CLI-1" }));
      expectError(result, 409, "CONFLICT");
      expect(result.body.message).toBe(`Campaign ${id} is not active (status: ${status}).`);
      checkError(contract, result);
      expect(diff).toEqual({});
    }
  });

  test("CRM-R70: a client already enrolled in the campaign is 409 CONFLICT; other campaigns are unaffected", async () => {
    await seed([enrollment()]);
    const { result, diff } = await ctx.svc.changes(() => enroll("camp_a", { client_id: "CLI-1" }));
    expectError(result, 409, "CONFLICT");
    expect(result.body.message).toBe("Client CLI-1 is already enrolled in campaign camp_a.");
    expect(diff).toEqual({});
    expect((await enroll("camp_b", { client_id: "CLI-1" })).status).toBe(201);
    expect((await enroll("camp_a", { client_id: "CLI-2" })).status).toBe(201);
  });

  test("CRM-R70: the inactive-campaign check comes before the duplicate check", async () => {
    await seed([enrollment({ campaign_id: "camp_c" })]);
    const res = await enroll("camp_c", { client_id: "CLI-1" });
    expect(res.body.message).toContain("is not active");
  });

  test("CRM-R71: writes the enrollment, adds one to enrolled_count and returns five fields", async () => {
    await seed();
    const { result: res, diff } = await ctx.svc.changes(() =>
      enroll("camp_a", { client_id: "CLI-9", trigger_reason: "Renewal in 30 days", metadata: { policy: "POL-1", n: 2 } }),
    );
    expect(res.status).toBe(201);
    contract.check(res);
    expect(res.body).toEqual({
      enrollment_id: expect.stringMatching(ENROLLMENT_ID),
      campaign_id: "camp_a",
      client_id: "CLI-9",
      enrolled_at: expect.stringMatching(ISO_UTC),
      sequence_step: 1,
    });
    expect(Object.keys(diff).sort()).toEqual(["campaign_enrollments", "campaigns"]);
    expect(diff.campaign_enrollments.added).toEqual([
      { ...res.body, trigger_reason: "Renewal in 30 days", metadata: '{"policy":"POL-1","n":2}' },
    ]);
    expect(diff.campaigns.changed).toHaveLength(1);
    expect(diff.campaigns.changed[0]).toMatchObject({ key: "camp_a", fields: ["enrolled_count"] });
    expect(diff.campaigns.changed[0].after.enrolled_count).toBe(11);
  });

  test("CRM-R71: trigger_reason and metadata default to null; the client id is not verified", async () => {
    await seed();
    const res = await enroll("camp_a", { client_id: "no-such-client" });
    expect(res.status).toBe(201);
    expect((await ctx.svc.table("campaign_enrollments"))[0]).toMatchObject({
      client_id: "no-such-client",
      trigger_reason: null,
      metadata: null,
    });
  });
});

describe("POST /v1/leads/{id}/enroll", () => {
  const enroll = (id: string, body: unknown) => ctx.api.post(`/v1/leads/${id}/enroll`, body);
  const seed = (enrollments: Record<string, unknown>[] = []) =>
    ctx.svc.seed({
      tables: {
        leads: [
          leadRow({ lead_id: "lead_a", client_id: "CLI-1" }),
          leadRow({ lead_id: "lead_null", client_id: null }),
          leadRow({ lead_id: "lead_blank", client_id: "" }),
        ],
        campaigns: CAMPAIGNS,
        campaign_enrollments: enrollments,
      },
    });

  test("CRM-R50: campaign_id is required, checked before the lead is looked up", async () => {
    await seed();
    for (const campaign_id of [undefined, null, ""]) {
      const res = await enroll("lead_zzz", { campaign_id });
      expectError(res, 400, "VALIDATION_ERROR", { field: "campaign_id", code: "required" });
      checkError(contract, res);
    }
  });

  test("CRM-R50: an unknown lead is 404, then an unknown campaign is 404", async () => {
    await seed();
    const noLead = await enroll("lead_zzz", { campaign_id: "camp_zzz" });
    expectError(noLead, 404, "NOT_FOUND");
    expect(noLead.body.message).toBe("lead not found.");
    const noCampaign = await enroll("lead_a", { campaign_id: "camp_zzz" });
    expectError(noCampaign, 404, "NOT_FOUND");
    expect(noCampaign.body.message).toBe("campaign not found.");
    checkError(contract, noCampaign);
  });

  test("CRM-R50: an inactive campaign is 409, then an existing enrollment of the lead's client is 409", async () => {
    await seed([enrollment(), enrollment({ enrollment_id: "enr_seed2", campaign_id: "camp_c" })]);
    const inactive = await ctx.svc.changes(() => enroll("lead_a", { campaign_id: "camp_c" }));
    expectError(inactive.result, 409, "CONFLICT");
    expect(inactive.result.body.message).toBe("Campaign camp_c is not active (status: paused).");
    expect(inactive.diff).toEqual({});

    const duplicate = await ctx.svc.changes(() => enroll("lead_a", { campaign_id: "camp_a" }));
    expectError(duplicate.result, 409, "CONFLICT");
    expect(duplicate.result.body.message).toBe("Client CLI-1 is already enrolled in campaign camp_a.");
    checkError(contract, duplicate.result);
    expect(duplicate.diff).toEqual({});
  });

  test("CRM-R51: enrolls the lead's client, adds one to enrolled_count and leaves the lead untouched", async () => {
    await seed();
    const { result: res, diff } = await ctx.svc.changes(() =>
      enroll("lead_a", { campaign_id: "camp_b", trigger_reason: "r".repeat(600), metadata: { k: "v" } }),
    );
    expect(res.status).toBe(201);
    contract.check(res);
    expect(res.body).toEqual({
      enrollment_id: expect.stringMatching(ENROLLMENT_ID),
      campaign_id: "camp_b",
      client_id: "CLI-1",
      enrolled_at: expect.stringMatching(ISO_UTC),
      sequence_step: 1,
    });
    expect(Object.keys(diff).sort()).toEqual(["campaign_enrollments", "campaigns"]);
    expect(diff.campaign_enrollments.added).toEqual([
      { ...res.body, trigger_reason: "r".repeat(600), metadata: '{"k":"v"}' },
    ]);
    expect(diff.campaigns.changed[0].key).toBe("camp_b");
    expect(diff.campaigns.changed[0].after.enrolled_count).toBe(11);

    const again = await enroll("lead_a", { campaign_id: "camp_b" });
    expectError(again, 409, "CONFLICT");
  });

  for (const id of ["lead_null", "lead_blank"]) {
    test(`CRM-R52: a lead without a client (${id}) is enrolled with an empty client_id, as often as asked`, async () => {
      await seed();
      const first = await enroll(id, { campaign_id: "camp_a" });
      const second = await enroll(id, { campaign_id: "camp_a" });
      expect([first.status, second.status]).toEqual([201, 201]);
      contract.check(first);
      expect(first.body.client_id).toBe("");
      const rows = await ctx.svc.table("campaign_enrollments");
      expect(rows.map((r) => r.client_id)).toEqual(["", ""]);
      expect((await ctx.svc.table("campaigns")).find((c) => c.campaign_id === "camp_a")!.enrolled_count).toBe(12);
    });
  }

  test.todo(
    "CRM-G07: enrolling a lead that has no client is refused (the service writes an enrollment with client_id \"\" and skips the duplicate check)",
    () => {},
  );
});
