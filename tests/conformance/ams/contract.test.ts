import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { loadContract, type HttpResult } from "../harness";
import {
  book,
  CLIENT_GAPS,
  commission,
  COMMISSION_GAPS,
  endorsement,
  endorsementBody,
  escalation,
  POLICY_GAPS,
  policyBody,
  start,
  task,
  TASK_GAPS,
  type Ctx,
} from "./support";

// Every operation of specs/ams.yaml answers its documented success status with a
// body that satisfies the documented schema, apart from the gaps listed in
// specs/ams.spec.md section 14.1. The allow-lists name those gaps one by one.

const contract = loadContract("ams");
let ctx: Ctx;

const ENDORSEMENT_GAPS = [/\/(notes|premium_delta): is null/];

interface Case {
  operationId: string;
  status: number;
  call: () => Promise<HttpResult>;
  allow?: (string | RegExp)[];
}

const CASES: Case[] = [
  { operationId: "listClients", status: 200, call: () => ctx.api.get("/v1/clients"), allow: CLIENT_GAPS },
  {
    operationId: "createClient",
    status: 201,
    call: () => ctx.api.post("/v1/clients", { first_name: "New", last_name: "Client", email: "new@example.test" }),
    allow: CLIENT_GAPS,
  },
  { operationId: "getClient", status: 200, call: () => ctx.api.get("/v1/clients/CLI-A"), allow: CLIENT_GAPS },
  { operationId: "updateClient", status: 200, call: () => ctx.api.patch("/v1/clients/CLI-A", { occupation: "Pilot" }), allow: CLIENT_GAPS },
  {
    operationId: "mergeClient",
    status: 200,
    call: () => ctx.api.post("/v1/clients/CLI-A/merge", { source_client_id: "CLI-B" }),
    allow: CLIENT_GAPS,
  },
  { operationId: "getHouseholdSummary", status: 200, call: () => ctx.api.get("/v1/clients/household/HH-1"), allow: CLIENT_GAPS },
  { operationId: "listClientPolicies", status: 200, call: () => ctx.api.get("/v1/clients/CLI-A/policies"), allow: POLICY_GAPS },
  {
    operationId: "listPolicies",
    status: 200,
    call: () => ctx.api.get("/v1/policies"),
    allow: [...POLICY_GAPS, "is missing required property 'coverages'"],
  },
  {
    operationId: "createPolicy",
    status: 201,
    call: () => ctx.api.post("/v1/policies", policyBody()),
    allow: [...POLICY_GAPS, "is missing required property 'premium_current'"],
  },
  { operationId: "getPolicyById", status: 200, call: () => ctx.api.get("/v1/policies/POL-A-AUTO"), allow: POLICY_GAPS },
  {
    operationId: "listPolicyEndorsements",
    status: 200,
    call: () => ctx.api.get("/v1/policies/POL-A-AUTO/endorsements"),
    allow: ENDORSEMENT_GAPS,
  },
  {
    operationId: "createEndorsement",
    status: 201,
    call: () => ctx.api.post("/v1/policies/POL-A-AUTO/endorsements", endorsementBody()),
    allow: ENDORSEMENT_GAPS,
  },
  { operationId: "listCommissions", status: 200, call: () => ctx.api.get("/v1/accounting/commissions"), allow: COMMISSION_GAPS },
  { operationId: "listTasks", status: 200, call: () => ctx.api.get("/v1/tasks"), allow: TASK_GAPS },
  { operationId: "createTask", status: 201, call: () => ctx.api.post("/v1/tasks", { title: "Schema check" }), allow: TASK_GAPS },
  { operationId: "updateTask", status: 200, call: () => ctx.api.patch("/v1/tasks/T-1", { status: "completed" }), allow: TASK_GAPS },
  { operationId: "listEscalations", status: 200, call: () => ctx.api.get("/v1/escalations") },
  {
    operationId: "createEscalation",
    status: 201,
    call: () => ctx.api.post("/v1/escalations", { client_id: "CLI-A", reason: "premium_threshold", summary: "Over the limit.", context: { a: 1 } }),
  },
  { operationId: "getEscalation", status: 200, call: () => ctx.api.get("/v1/escalations/esc_1") },
];

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({
    tables: book({
      tasks: [task("T-1", { assigned_to: "USR-1", related_client_id: "CLI-A", description: "Described." }), task("T-2")],
      commissions: [commission("COM-1"), commission("COM-2", { status: "paid", payment_date: "2025-07-01", carrier_code: "ERIE" })],
      endorsements: [endorsement("END-1", "POL-A-AUTO", { notes: "With notes." })],
      escalations: [escalation("esc_1", { context: '{"k":1}' })],
    }),
  });
});

describe("schema conformance of every operation", () => {
  for (const c of CASES) {
    test(`AMS-R14, AMS-R19: ${c.operationId} answers ${c.status} with a body that satisfies specs/ams.yaml`, async () => {
      const res = await c.call();
      expect(res.status).toBe(c.status);
      const result = contract.check(res, { allow: c.allow });
      expect(result.operationId).toBe(c.operationId);
      expect(result.schemaChecked).toBe(true);
    });
  }

  test("every operation in specs/ams.yaml has a case above", () => {
    expect(CASES.map((c) => c.operationId).sort()).toEqual(contract.operations().map((op) => op.operationId).sort());
  });

  test("AMS-R4: the allow-lists are needed: without them the known gaps are reported, and only those", async () => {
    const res = await ctx.api.get("/v1/clients/CLI-D");
    const issues = contract.inspect(res).issues;
    expect(issues.length).toBeGreaterThan(0);
    const unexplained = issues.filter((line) => !CLIENT_GAPS.some((rule) => (typeof rule === "string" ? line.includes(rule) : rule.test(line))));
    expect(unexplained).toEqual([]);
  });

  test("a decided escalation with all three events satisfies the Escalation and EscalationEvent schemas", async () => {
    await ctx.api.get("/v1/escalations/esc_1");
    const res = await ctx.api.get("/v1/escalations/esc_1");
    expect(res.body.status).toBe("approved");
    contract.check(res);
    contract.checkSchema("ManagerResponse", res.body.manager_response);
  });

  afterAll(() => {
    expect(contract.unchecked()).toEqual([]);
  });
});

test.todo("AMS-G2: the scope ams:policies:write, required by createPolicy, is missing from the security scheme in specs/ams.yaml", () => {});
test.todo("AMS-G3: specs/ams.yaml declares client, household, task, assignee and producer ids as UUIDs and a POL-XX-YYYY-NNNNNN policy id; real ids are CLI-001, CL-ab12cd, HH-001, TSK-001, POL-ab12cd", () => {});
test.todo("AMS-G4: Coverage.limit is a required number in specs/ams.yaml; the service stores text or null, and a numeric limit in createPolicy fails with 500", () => {});
test.todo("AMS-G5: PolicyType in specs/ams.yaml lacks renters, which the service accepts", () => {});
test.todo("AMS-G6: Client.preferred_contact_method lists email, sms, phone in specs/ams.yaml; writes accept email, phone, mail", () => {});
test.todo("AMS-G7: client fields returned as null (dob, phone, address parts and others) are not nullable in specs/ams.yaml, and Client.phone declares an E.164 pattern nothing enforces", () => {});
test.todo("AMS-G10: createPolicy returns annual_premium instead of the Policy schema's premium_current, and listPolicies items have no coverages", () => {});
test.todo("AMS-G13: specs/ams.yaml documents no 409 for updateClient; a duplicate email returns it", () => {});
test.todo("AMS-G14: FieldError.code in specs/ams.yaml lacks 'invalid' (annual_premium) and the E_EO_* codes", () => {});
