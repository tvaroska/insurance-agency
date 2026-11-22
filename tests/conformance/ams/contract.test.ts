import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { loadContract, type HttpResult } from "../harness";
import {
  book,
  commission,
  endorsement,
  endorsementBody,
  escalation,
  policyBody,
  start,
  task,
  type Ctx,
} from "./support";

// Every operation of specs/ams.yaml answers its documented success status with a
// body that satisfies the documented schema strictly with zero allow-list overrides.

const contract = loadContract("ams");
let ctx: Ctx;

interface Case {
  operationId: string;
  status: number;
  call: () => Promise<HttpResult>;
}

const CASES: Case[] = [
  { operationId: "listClients", status: 200, call: () => ctx.api.get("/v1/clients") },
  {
    operationId: "createClient",
    status: 201,
    call: () => ctx.api.post("/v1/clients", { first_name: "New", last_name: "Client", email: "new@example.test" }),
  },
  { operationId: "getClient", status: 200, call: () => ctx.api.get("/v1/clients/CLI-A") },
  { operationId: "updateClient", status: 200, call: () => ctx.api.patch("/v1/clients/CLI-A", { occupation: "Pilot" }) },
  {
    operationId: "mergeClient",
    status: 200,
    call: () => ctx.api.post("/v1/clients/CLI-A/merge", { source_client_id: "CLI-B" }),
  },
  { operationId: "getHouseholdSummary", status: 200, call: () => ctx.api.get("/v1/clients/household/HH-1") },
  { operationId: "listClientPolicies", status: 200, call: () => ctx.api.get("/v1/clients/CLI-A/policies") },
  { operationId: "listPolicies", status: 200, call: () => ctx.api.get("/v1/policies") },
  { operationId: "createPolicy", status: 201, call: () => ctx.api.post("/v1/policies", policyBody()) },
  { operationId: "getPolicyById", status: 200, call: () => ctx.api.get("/v1/policies/POL-A-AUTO") },
  { operationId: "listPolicyEndorsements", status: 200, call: () => ctx.api.get("/v1/policies/POL-A-AUTO/endorsements") },
  {
    operationId: "createEndorsement",
    status: 201,
    call: () => ctx.api.post("/v1/policies/POL-A-AUTO/endorsements", endorsementBody()),
  },
  { operationId: "listCommissions", status: 200, call: () => ctx.api.get("/v1/accounting/commissions") },
  { operationId: "listTasks", status: 200, call: () => ctx.api.get("/v1/tasks") },
  { operationId: "createTask", status: 201, call: () => ctx.api.post("/v1/tasks", { title: "Schema check" }) },
  { operationId: "updateTask", status: 200, call: () => ctx.api.patch("/v1/tasks/T-1", { status: "completed" }) },
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
      const result = contract.check(res);
      expect(result.operationId).toBe(c.operationId);
      expect(result.schemaChecked).toBe(true);
    });
  }

  test("every operation in specs/ams.yaml has a case above", () => {
    expect(CASES.map((c) => c.operationId).sort()).toEqual(contract.operations().map((op) => op.operationId).sort());
  });

  test("AMS-R4: sparse client records with null fields and non-UUID ids conform with zero schema issues", async () => {
    const res = await ctx.api.get("/v1/clients/CLI-D");
    expect(contract.inspect(res).issues).toEqual([]);
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

test("AMS-G2, G3, G4, G5, G6, G7, G10, G13, G14: resolved OpenAPI contract details match service behaviour", async () => {
  const scopes = contract.document.components?.securitySchemes?.oauth2?.flows?.clientCredentials?.scopes ?? {};
  expect(scopes).toHaveProperty("ams:policies:write");
  expect(contract.document.components?.schemas?.PolicyType?.enum).toContain("renters");
  expect(contract.document.components?.schemas?.Client?.properties?.preferred_contact_method?.enum).toEqual(["email", "sms", "phone", "mail"]);
  expect(contract.document.components?.schemas?.Client?.properties?.id?.format).toBeUndefined();
  expect(contract.document.components?.schemas?.Policy?.properties?.policy_id?.pattern).toBeUndefined();
  expect(contract.operation("updateClient").statuses).toContain("409");
  expect(contract.document.components?.schemas?.FieldError?.properties?.code?.enum).toEqual(
    expect.arrayContaining(["invalid", "E_EO_STATE_MINIMUM_VIOLATION", "E_EO_PREMIUM_THRESHOLD_EXCEEDED", "E_EO_BACKDATING_PROHIBITED"]),
  );
  // Numeric coverage limits succeed and satisfy PolicyCreateResponse / Policy schemas.
  const numeric = await ctx.api.post("/v1/policies", policyBody({ coverages: [{ type: "dwelling", limit: 250000, deductible: 1000 }] }));
  expect(numeric.status).toBe(201);
  contract.check(numeric);
});
