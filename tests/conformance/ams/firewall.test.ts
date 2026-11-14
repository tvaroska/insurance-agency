import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { loadContract, type HttpResult } from "../harness";
import {
  autoPolicyBody,
  book,
  DAY_BEFORE_FIREWALL_TODAY,
  endorsementBody,
  escalation,
  FIREWALL_TODAY,
  policyBody,
  start,
  type Ctx,
} from "./support";

const contract = loadContract("ams");
let ctx: Ctx;

const STATE_MIN = "E_EO_STATE_MINIMUM_VIOLATION";
const PREMIUM = "E_EO_PREMIUM_THRESHOLD_EXCEEDED";
const BACKDATING = "E_EO_BACKDATING_PROHIBITED";

// AMS-R85: [state, per person, per accident, property damage, shorthand].
const MINIMUMS: [string, number, number, number, string][] = [
  ["CA", 30_000, 60_000, 15_000, "30/60/15"],
  ["TX", 30_000, 60_000, 25_000, "30/60/25"],
  ["FL", 10_000, 20_000, 10_000, "10/20/10"],
  ["NY", 25_000, 50_000, 10_000, "25/50/10"],
  ["IL", 25_000, 50_000, 20_000, "25/50/20"],
  ["PA", 15_000, 30_000, 5_000, "15/30/5"],
  ["OH", 25_000, 50_000, 25_000, "25/50/25"],
  ["GA", 25_000, 50_000, 25_000, "25/50/25"],
  ["NC", 50_000, 100_000, 50_000, "50/100/50"],
  ["MI", 50_000, 100_000, 10_000, "50/100/10"],
];

const usd = (n: number) => n.toLocaleString("en-US");
const backdatingMessage = (date: string, floor: string) =>
  `E&O Firewall: Retroactive coverage backdating to ${date} (prior to ${floor}) is prohibited without Principal Underwriter approval.`;

/** Escalations used as waivers: one per combination the waiver rules distinguish. */
const WAIVERS = [
  escalation("esc_pt_ok", { reason: "premium_threshold", status: "approved" }),
  escalation("esc_pt_pending", { reason: "premium_threshold", status: "pending" }),
  escalation("esc_pt_denied", { reason: "premium_threshold", status: "denied" }),
  escalation("esc_pt_info", { reason: "premium_threshold", status: "needs_info" }),
  escalation("esc_pt_other_client", { reason: "premium_threshold", status: "approved", client_id: "CLI-B" }),
  escalation("esc_bd_ok", { reason: "backdating", status: "approved" }),
  escalation("esc_bd_pending", { reason: "backdating", status: "pending" }),
  escalation("esc_bd_denied", { reason: "backdating", status: "denied" }),
  escalation("esc_bd_other_client", { reason: "backdating", status: "approved", client_id: "CLI-B" }),
  escalation("esc_bd_this_policy", { reason: "backdating", status: "approved", policy_id: "POL-A-AUTO" }),
  escalation("esc_bd_other_policy", { reason: "backdating", status: "approved", policy_id: "POL-A-HOME" }),
  escalation("esc_sm_ok", { reason: "state_minimum_violation", status: "approved" }),
  escalation("esc_pr_ok", { reason: "principal_review", status: "approved" }),
];

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({ tables: book({ escalations: WAIVERS }) });
});

function expectFirewall(res: HttpResult, code: string, field: string, message?: string) {
  expect([res.status, res.body?.error_code]).toEqual([422, code]);
  expect(res.body.details).toEqual([{ field, message: res.body.message, code }]);
  expect(typeof res.body.correlation_id).toBe("string");
  if (message !== undefined) expect(res.body.message).toBe(message);
}

const createPolicy = (body: unknown) => ctx.api.post("/v1/policies", body);
const endorse = (policyId: string, overrides: Record<string, unknown> = {}) =>
  ctx.api.post(`/v1/policies/${policyId}/endorsements`, endorsementBody(overrides));

describe("violation shape", () => {
  test("AMS-R83: a violation is 422 with one detail that repeats the code and the message, and writes nothing", async () => {
    const cases: [() => Promise<HttpResult>, string, string][] = [
      [() => createPolicy(autoPolicyBody([{ type: "bodily_injury", limit: "15/30" }])), STATE_MIN, "coverages"],
      [() => createPolicy(policyBody({ annual_premium: 25_000 })), PREMIUM, "annual_premium"],
      [() => createPolicy(policyBody({ effective_date: "2026-01-01" })), BACKDATING, "effective_date"],
      [() => endorse("POL-A-AUTO", { effective_date: "2026-01-01" }), BACKDATING, "effective_date"],
      [() => endorse("POL-A-AUTO", { changes: { bodily_injury_limit: "15/30" } }), STATE_MIN, "changes"],
    ];
    for (const [call, code, field] of cases) {
      const { result, diff } = await ctx.svc.changes(call);
      expectFirewall(result, code, field);
      expect(result.body.correlation_id).toBe(result.headers.get("x-correlation-id"));
      expect(diff).toEqual({});
      contract.check(result, { allowUndocumentedStatus: true });
    }
  });
});

describe("state minimums", () => {
  test("AMS-R84: only personal auto policies are checked on create", async () => {
    const res = await createPolicy(policyBody({ coverages: [{ type: "bodily_injury", limit: "1/1/1" }] }));
    expect(res.status).toBe(201);
    const umbrella = await createPolicy(policyBody({ policy_type: "umbrella", coverages: [{ type: "liability", limit: "5000" }] }));
    expect(umbrella.status).toBe(201);
  });

  test("AMS-R84: only endorsements on personal auto policies are checked", async () => {
    expect((await endorse("POL-A-HOME", { changes: { bodily_injury_limit: "1/1", property_damage_limit: 1 } })).status).toBe(201);
    expectFirewall(await endorse("POL-A-AUTO", { changes: { bodily_injury_limit: "1/1" } }), STATE_MIN, "changes");
  });

  describe("AMS-R85: minimums per state", () => {
    for (const [state, person, accident, pd, shorthand] of MINIMUMS) {
      test(`AMS-R85, AMS-R88: ${state} requires ${shorthand}`, async () => {
        const body = (limit: string) => autoPolicyBody([{ type: "bodily_injury", limit }], { state });
        expect((await createPolicy(body(`${person}/${accident}/${pd}`))).status).toBe(201);

        expectFirewall(
          await createPolicy(body(`${person - 1000}/${accident}/${pd}`)),
          STATE_MIN,
          "coverages",
          `Bodily injury per-person limit ($${usd(person - 1000)}) is below ${state} statutory minimum of $${usd(person)} (${shorthand}).`,
        );
        expectFirewall(
          await createPolicy(body(`${person}/${accident - 1000}/${pd}`)),
          STATE_MIN,
          "coverages",
          `Bodily injury per-accident limit ($${usd(accident - 1000)}) is below ${state} statutory minimum of $${usd(accident)} (${shorthand}).`,
        );
        expectFirewall(
          await createPolicy(body(`${person}/${accident}/${pd - 1000}`)),
          STATE_MIN,
          "coverages",
          `Property damage limit ($${usd(pd - 1000)}) is below ${state} statutory minimum of $${usd(pd)} (${shorthand}).`,
        );
      });
    }

    test("AMS-R85: any other state, or no state, falls back to 25/50/10 and is called DEFAULT", async () => {
      for (const overrides of [{ state: "WA" }, { state: "??" }, { client_id: "CLI-D" }]) {
        const body = (limit: string) => autoPolicyBody([{ type: "bodily_injury", limit }], overrides);
        expect((await createPolicy(body("25000/50000/10000"))).status).toBe(201);
        expectFirewall(
          await createPolicy(body("24000/50000/10000")),
          STATE_MIN,
          "coverages",
          "Bodily injury per-person limit ($24,000) is below DEFAULT statutory minimum of $25,000 (25/50/10).",
        );
        expectFirewall(await createPolicy(body("25000/49000/10000")), STATE_MIN, "coverages");
        expectFirewall(await createPolicy(body("25000/50000/9000")), STATE_MIN, "coverages");
      }
    });
  });

  test("AMS-R85: on create, state in the body wins over the client's address, trimmed and upper-cased", async () => {
    // CLI-A lives in CA (30/60/15); FL needs only 10/20/10.
    const floridaLimits = [{ type: "bodily_injury", limit: "10000/20000/10000" }];
    expectFirewall(await createPolicy(autoPolicyBody(floridaLimits)), STATE_MIN, "coverages");
    expect((await createPolicy(autoPolicyBody(floridaLimits, { state: "FL" }))).status).toBe(201);
    expect((await createPolicy(autoPolicyBody(floridaLimits, { state: " fl " }))).status).toBe(201);
    // CLI-C lives in TX (property damage 25,000).
    expectFirewall(
      await createPolicy(autoPolicyBody([{ type: "property_damage", limit: "20000" }], { client_id: "CLI-C" })),
      STATE_MIN,
      "coverages",
      "Property damage limit ($20,000) is below TX statutory minimum of $25,000 (30/60/25).",
    );
  });

  test("AMS-R85: on endorse, the state is the address state of the policy's client", async () => {
    const changes = { coverage_type: "bodily_injury", limit: "30/60/20" };
    expect((await endorse("POL-A-AUTO", { changes })).status).toBe(201);
    expectFirewall(
      await endorse("POL-C-OLD", { changes }),
      STATE_MIN,
      "changes",
      "Property damage limit ($20,000) is below TX statutory minimum of $25,000 (30/60/25).",
    );
    expectFirewall(
      await endorse("POL-D-AUTO", { changes: { coverage_type: "bodily_injury", limit: "20/50" } }),
      STATE_MIN,
      "changes",
      "Bodily injury per-person limit ($20,000) is below DEFAULT statutory minimum of $25,000 (25/50/10).",
    );
  });

  test("AMS-R86: limits are read from numbers and from slash-separated text; amounts under 1,000 are thousands", async () => {
    const bi = (limit: unknown) => createPolicy(autoPolicyBody([{ type: "bodily_injury", limit }]));
    expect((await bi("30/60")).status).toBe(201);
    expect((await bi("30000/60000")).status).toBe(201);
    expect((await bi("$30,000 / $60,000")).status).toBe(201);
    expect((await bi("30k/60k/15k")).status).toBe(201);
    expect((await bi("30000")).status).toBe(201);

    expectFirewall(await bi("25/50"), STATE_MIN, "coverages", "Bodily injury per-person limit ($25,000) is below CA statutory minimum of $30,000 (30/60/15).");
    expectFirewall(await bi("$29,999 / $60,000"), STATE_MIN, "coverages", "Bodily injury per-person limit ($29,999) is below CA statutory minimum of $30,000 (30/60/15).");
    expectFirewall(await bi("29000"), STATE_MIN, "coverages");
    // A number is one amount; it is rejected here before anything is stored.
    expectFirewall(await bi(25), STATE_MIN, "coverages", "Bodily injury per-person limit ($25,000) is below CA statutory minimum of $30,000 (30/60/15).");
    // Parts that are not positive numbers are dropped, so "0/60" is the single amount 60,000.
    expect((await bi("0/60")).status).toBe(201);
  });

  test("AMS-R87: bodily_injury, liability and bi are bodily-injury items; property_damage and pd are property-damage items", async () => {
    const one = (item: Record<string, unknown>) => createPolicy(autoPolicyBody([item]));
    for (const type of ["bodily_injury", "liability", "bi", "BODILY_INJURY"]) {
      expectFirewall(await one({ type, limit: "15/30" }), STATE_MIN, "coverages");
      expect((await one({ type, limit: "30/60" })).status).toBe(201);
    }
    for (const type of ["property_damage", "pd"]) {
      expectFirewall(
        await one({ type, limit: "10000" }),
        STATE_MIN,
        "coverages",
        "Property damage limit ($10,000) is below CA statutory minimum of $15,000 (30/60/15).",
      );
      expect((await one({ type, limit: "15000" })).status).toBe(201);
    }
  });

  test("AMS-R87: other coverage kinds and absent limits are not checked", async () => {
    const one = (item: Record<string, unknown>) => createPolicy(autoPolicyBody([item]));
    expect((await one({ type: "collision", limit: "5", deductible: 500 })).status).toBe(201);
    expect((await one({ type: "uninsured_motorist", limit: "1/1" })).status).toBe(201);
    expect((await one({ type: "bodily_injury" })).status).toBe(201);
    expect((await one({ type: "property_damage", deductible: 100 })).status).toBe(201);
  });

  test("AMS-R87: numeric per_person_limit and per_accident_limit (or per_occurrence_limit) take precedence over the text", async () => {
    const change = (changes: Record<string, unknown>) => endorse("POL-A-AUTO", { changes });
    expectFirewall(
      await change({ coverage_type: "bodily_injury", per_person_limit: 20000, limit: "100/300" }),
      STATE_MIN,
      "changes",
      "Bodily injury per-person limit ($20,000) is below CA statutory minimum of $30,000 (30/60/15).",
    );
    expectFirewall(
      await change({ coverage_type: "bodily_injury", per_person_limit: 30000, per_accident_limit: 50000 }),
      STATE_MIN,
      "changes",
      "Bodily injury per-accident limit ($50,000) is below CA statutory minimum of $60,000 (30/60/15).",
    );
    expectFirewall(await change({ coverage_type: "bodily_injury", per_occurrence_limit: 50 }), STATE_MIN, "changes");
    expectFirewall(
      await change({ coverage_type: "property_damage", per_accident_limit: 10000 }),
      STATE_MIN,
      "changes",
      "Property damage limit ($10,000) is below CA statutory minimum of $15,000 (30/60/15).",
    );
    expect((await change({ coverage_type: "bodily_injury", per_person_limit: 30000, per_accident_limit: 60000 })).status).toBe(201);
  });

  test("AMS-R87: the kind is read from coverage_type, then type, then coverage; the limit from limit, then limits", async () => {
    const change = (changes: Record<string, unknown>) => endorse("POL-A-AUTO", { changes });
    expectFirewall(await change({ type: "bodily_injury", limit: "15/30" }), STATE_MIN, "changes");
    expectFirewall(await change({ coverage: "bodily_injury", limit: "15/30" }), STATE_MIN, "changes");
    expectFirewall(await change({ coverage_type: "liability", limits: "15000/30000/5000" }), STATE_MIN, "changes");
    // coverage_type wins over type.
    expect((await change({ coverage_type: "collision", type: "bodily_injury", limit: "15/30" })).status).toBe(201);
  });

  test("AMS-R87: an item without a kind is bodily injury when it has per_person_limit or a limit of two or more parts", async () => {
    const change = (changes: Record<string, unknown>) => endorse("POL-A-AUTO", { changes });
    expectFirewall(await change({ per_person_limit: 15000 }), STATE_MIN, "changes");
    expectFirewall(await change({ limit: "15/30" }), STATE_MIN, "changes");
    expect((await change({ limit: "15" })).status).toBe(201);
    expect((await change({ note: "no limits here" })).status).toBe(201);
  });

  test("AMS-R87: on endorse the shortcut fields, changes.coverages and an array of changes are all inspected", async () => {
    const change = (changes: unknown) => endorse("POL-A-AUTO", { changes });
    expectFirewall(await change({ bodily_injury_limit: "15000/30000" }), STATE_MIN, "changes");
    expectFirewall(await change({ liability_limit: "15/30" }), STATE_MIN, "changes");
    expectFirewall(
      await change({ property_damage_limit: 5000 }),
      STATE_MIN,
      "changes",
      "Property damage limit ($5,000) is below CA statutory minimum of $15,000 (30/60/15).",
    );
    expectFirewall(await change({ coverages: [{ type: "collision", deductible: 500 }, { type: "pd", limit: "5000" }] }), STATE_MIN, "changes");
    expectFirewall(await change([{ type: "collision" }, { type: "bi", limit: "15/30" }]), STATE_MIN, "changes");

    expect((await change({ bodily_injury_limit: "30/60", property_damage_limit: 15000 })).status).toBe(201);
    expect((await change({ coverages: [{ type: "pd", limit: "15000" }] })).status).toBe(201);
    expect((await change([{ type: "bi", limit: "30/60" }])).status).toBe(201);
  });

  test("AMS-R88: only the first violation is reported: per person, then per accident, then property damage, in item order", async () => {
    const allBad = await createPolicy(autoPolicyBody([{ type: "bodily_injury", limit: "15/30/5" }]));
    expectFirewall(allBad, STATE_MIN, "coverages", "Bodily injury per-person limit ($15,000) is below CA statutory minimum of $30,000 (30/60/15).");
    const accidentAndPd = await createPolicy(autoPolicyBody([{ type: "bodily_injury", limit: "30/30/5" }]));
    expectFirewall(accidentAndPd, STATE_MIN, "coverages", "Bodily injury per-accident limit ($30,000) is below CA statutory minimum of $60,000 (30/60/15).");
    const pdItemFirst = await createPolicy(
      autoPolicyBody([{ type: "property_damage", limit: "5000" }, { type: "bodily_injury", limit: "15/30" }]),
    );
    expectFirewall(pdItemFirst, STATE_MIN, "coverages", "Property damage limit ($5,000) is below CA statutory minimum of $15,000 (30/60/15).");
  });

  test("AMS-R89: no approved escalation waives a state minimum", async () => {
    for (const escalation_id of ["esc_sm_ok", "esc_pt_ok", "esc_bd_ok", "esc_pr_ok"]) {
      expectFirewall(
        await createPolicy(autoPolicyBody([{ type: "bodily_injury", limit: "15/30" }], { escalation_id })),
        STATE_MIN,
        "coverages",
      );
      expectFirewall(
        await endorse("POL-A-AUTO", { changes: { bodily_injury_limit: "15/30" }, escalation_id }),
        STATE_MIN,
        "changes",
      );
    }
  });
});

describe("binding authority", () => {
  test("AMS-R90: a premium above 10,000 is blocked; exactly 10,000 is allowed", async () => {
    expect((await createPolicy(policyBody({ annual_premium: 10_000 }))).status).toBe(201);
    expectFirewall(
      await createPolicy(policyBody({ annual_premium: 10_000.01 })),
      PREMIUM,
      "annual_premium",
      "Premium of $10000.01 exceeds the $10,000 threshold requiring manager approval.",
    );
    expectFirewall(
      await createPolicy(policyBody({ annual_premium: 14_200 })),
      PREMIUM,
      "annual_premium",
      "Premium of $14200.00 exceeds the $10,000 threshold requiring manager approval.",
    );
  });

  test("AMS-R91: an approved premium_threshold escalation for the same client waives the rule", async () => {
    const { result, diff } = await ctx.svc.changes(() =>
      createPolicy(policyBody({ annual_premium: 14_200, escalation_id: "esc_pt_ok" })),
    );
    expect(result.status).toBe(201);
    expect(result.body.annual_premium).toBe(14_200);
    expect(Object.keys(diff).sort()).toEqual(["coverages", "policies"]);
  });

  test("AMS-R91: any other escalation does not waive the rule", async () => {
    for (const escalation_id of [
      "esc_pt_pending",
      "esc_pt_denied",
      "esc_pt_info",
      "esc_pt_other_client",
      "esc_bd_ok",
      "esc_pr_ok",
      "esc_unknown",
    ]) {
      const res = await createPolicy(policyBody({ annual_premium: 14_200, escalation_id }));
      expect([escalation_id, res.status, res.body.error_code]).toEqual([escalation_id, 422, PREMIUM]);
    }
  });
});

describe("backdating on createPolicy", () => {
  test(`AMS-R92: an effective date before ${FIREWALL_TODAY} is blocked; that date itself is allowed`, async () => {
    expect((await createPolicy(policyBody({ effective_date: FIREWALL_TODAY }))).status).toBe(201);
    expectFirewall(
      await createPolicy(policyBody({ effective_date: DAY_BEFORE_FIREWALL_TODAY })),
      BACKDATING,
      "effective_date",
      backdatingMessage(DAY_BEFORE_FIREWALL_TODAY, FIREWALL_TODAY),
    );
    expectFirewall(await createPolicy(policyBody({ effective_date: "2020-01-01" })), BACKDATING, "effective_date");
  });

  test("AMS-R93: an approved backdating escalation for the same client waives the rule", async () => {
    const res = await createPolicy(policyBody({ effective_date: "2026-01-01", escalation_id: "esc_bd_ok" }));
    expect(res.status).toBe(201);
    expect(res.body.effective_date).toBe("2026-01-01");
  });

  test("AMS-R93: any other escalation does not waive the rule", async () => {
    for (const escalation_id of ["esc_bd_pending", "esc_bd_denied", "esc_bd_other_client", "esc_pt_ok", "esc_pr_ok", "esc_unknown"]) {
      const res = await createPolicy(policyBody({ effective_date: "2026-01-01", escalation_id }));
      expect([escalation_id, res.status, res.body.error_code]).toEqual([escalation_id, 422, BACKDATING]);
    }
  });

  test("AMS-R93: one escalation covers one rule, so a backdated policy over the threshold cannot be created", async () => {
    const body = (escalation_id: string) => policyBody({ annual_premium: 14_200, effective_date: "2026-01-01", escalation_id });
    expectFirewall(await createPolicy(body("esc_pt_ok")), BACKDATING, "effective_date");
    expectFirewall(await createPolicy(body("esc_bd_ok")), PREMIUM, "annual_premium");
  });
});

describe("backdating on createEndorsement", () => {
  test("AMS-R94: for a policy still in force the floor is the firewall's today", async () => {
    // POL-A-AUTO runs 2025-06-01 to 2026-06-01.
    expect((await endorse("POL-A-AUTO", { effective_date: FIREWALL_TODAY })).status).toBe(201);
    expectFirewall(
      await endorse("POL-A-AUTO", { effective_date: DAY_BEFORE_FIREWALL_TODAY }),
      BACKDATING,
      "effective_date",
      backdatingMessage(DAY_BEFORE_FIREWALL_TODAY, FIREWALL_TODAY),
    );
    expectFirewall(await endorse("POL-A-AUTO", { effective_date: "2025-06-01" }), BACKDATING, "effective_date");
  });

  test("AMS-R94: for a policy that starts later the floor is the policy's effective date", async () => {
    // POL-B-AUTO starts 2026-03-01.
    expect((await endorse("POL-B-AUTO", { effective_date: "2026-03-01" })).status).toBe(201);
    expectFirewall(
      await endorse("POL-B-AUTO", { effective_date: "2026-02-28" }),
      BACKDATING,
      "effective_date",
      backdatingMessage("2026-02-28", "2026-03-01"),
    );
  });

  test("AMS-R94: for a policy that ended before today the floor is the policy's effective date", async () => {
    // POL-C-OLD is active but ran 2025-01-01 to 2026-01-01.
    expect((await endorse("POL-C-OLD", { effective_date: "2025-01-01" })).status).toBe(201);
    expect((await endorse("POL-C-OLD", { effective_date: "2025-07-04" })).status).toBe(201);
    expectFirewall(
      await endorse("POL-C-OLD", { effective_date: "2024-12-31" }),
      BACKDATING,
      "effective_date",
      backdatingMessage("2024-12-31", "2025-01-01"),
    );
  });

  test("AMS-R94: there is no upper bound on the effective date", async () => {
    expect((await endorse("POL-A-AUTO", { effective_date: "2030-01-01" })).status).toBe(201);
  });

  test("AMS-R95: an approved backdating escalation for the policy's client waives the rule, with no policy or this policy", async () => {
    for (const escalation_id of ["esc_bd_ok", "esc_bd_this_policy"]) {
      const res = await endorse("POL-A-AUTO", { effective_date: "2025-12-25", escalation_id });
      expect([escalation_id, res.status]).toEqual([escalation_id, 201]);
      expect(res.body.effective_date).toBe("2025-12-25");
    }
    // With a waiver the check is skipped entirely, even before the policy began.
    expect((await endorse("POL-A-AUTO", { effective_date: "2020-01-01", escalation_id: "esc_bd_ok" })).status).toBe(201);
  });

  test("AMS-R95: an escalation for another policy, another client, another reason or not approved does not waive the rule", async () => {
    for (const escalation_id of [
      "esc_bd_other_policy",
      "esc_bd_other_client",
      "esc_bd_pending",
      "esc_bd_denied",
      "esc_pt_ok",
      "esc_sm_ok",
      "esc_unknown",
    ]) {
      const res = await endorse("POL-A-AUTO", { effective_date: "2025-12-25", escalation_id });
      expect([escalation_id, res.status, res.body.error_code]).toEqual([escalation_id, 422, BACKDATING]);
    }
  });
});

describe("clock, order and approvals", () => {
  test("AMS-R96: /sim/time-travel does not move the firewall's today", async () => {
    // Late enough to matter, early enough that POL-D-AUTO (to 2026-10-01) is not expired by the move.
    await ctx.svc.timeTravel({ target_date: "2026-08-01T00:00:00.000Z" });
    expect((await createPolicy(policyBody({ effective_date: FIREWALL_TODAY }))).status).toBe(201);
    expectFirewall(
      await createPolicy(policyBody({ effective_date: DAY_BEFORE_FIREWALL_TODAY })),
      BACKDATING,
      "effective_date",
      backdatingMessage(DAY_BEFORE_FIREWALL_TODAY, FIREWALL_TODAY),
    );
    expectFirewall(
      await endorse("POL-D-AUTO", { effective_date: DAY_BEFORE_FIREWALL_TODAY }),
      BACKDATING,
      "effective_date",
      backdatingMessage(DAY_BEFORE_FIREWALL_TODAY, FIREWALL_TODAY),
    );
    expect((await endorse("POL-D-AUTO", { effective_date: FIREWALL_TODAY })).status).toBe(201);
  });

  test("AMS-R51, AMS-R97: createPolicy checks state minimums, then binding authority, then backdating", async () => {
    const lowLimits = [{ type: "bodily_injury", limit: "15/30" }];
    const all = await createPolicy(autoPolicyBody(lowLimits, { annual_premium: 14_200, effective_date: "2026-01-01" }));
    expectFirewall(all, STATE_MIN, "coverages");
    const premiumAndDate = await createPolicy(policyBody({ annual_premium: 14_200, effective_date: "2026-01-01" }));
    expectFirewall(premiumAndDate, PREMIUM, "annual_premium");
    const dateOnly = await createPolicy(policyBody({ effective_date: "2026-01-01" }));
    expectFirewall(dateOnly, BACKDATING, "effective_date");
  });

  test("AMS-R58, AMS-R97: createEndorsement checks backdating, then state minimums", async () => {
    const both = await endorse("POL-A-AUTO", { effective_date: "2026-01-01", changes: { bodily_injury_limit: "15/30" } });
    expectFirewall(both, BACKDATING, "effective_date");
    const waived = await endorse("POL-A-AUTO", {
      effective_date: "2026-01-01",
      changes: { bodily_injury_limit: "15/30" },
      escalation_id: "esc_bd_ok",
    });
    expectFirewall(waived, STATE_MIN, "changes");
  });

  test("AMS-R97: an escalation approved by the decision table works as a waiver", async () => {
    const created = await ctx.api.post("/v1/escalations", {
      client_id: "CLI-A",
      reason: "premium_threshold",
      summary: "Commercial package at $14,200 annual premium.",
    });
    const escalation_id = created.body.escalation_id;
    const body = policyBody({ annual_premium: 14_200, escalation_id });

    expectFirewall(await createPolicy(body), PREMIUM, "annual_premium");
    await ctx.api.get(`/v1/escalations/${escalation_id}`);
    expectFirewall(await createPolicy(body), PREMIUM, "annual_premium");
    expect((await ctx.api.get(`/v1/escalations/${escalation_id}`)).body.status).toBe("approved");
    expect((await createPolicy(body)).status).toBe(201);
  });

  test("AMS-R97, AMS-R107: an escalation approved in the workbench works as a waiver", async () => {
    const created = await ctx.api.post("/v1/escalations", { client_id: "CLI-A", reason: "backdating", summary: "Client asks for 25 December." });
    const escalation_id = created.body.escalation_id;
    expectFirewall(await endorse("POL-A-AUTO", { effective_date: "2025-12-25", escalation_id }), BACKDATING, "effective_date");

    const resolved = await ctx.svc.http.post(`/workbench/api/escalations/${escalation_id}/resolve`, { decision: "approved" });
    expect(resolved.status).toBe(200);
    expect((await endorse("POL-A-AUTO", { effective_date: "2025-12-25", escalation_id })).status).toBe(201);
  });
});

test.todo("AMS-G1: specs/ams.yaml documents no 422 for createPolicy or createEndorsement and names none of the E_EO_* codes");
test.todo("AMS-G11: createPolicy accepts state and escalation_id, createEndorsement accepts escalation_id; specs/ams.yaml declares neither");
