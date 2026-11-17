import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { setActiveScenarioId } from "@evergreen/shared";
import { createTestDb } from "./setup";
import { handleSendMessage } from "../tools/send_message";
import { handleGetInbox } from "../tools/get_inbox";
import { parseToolResultJson } from "../tools/parse-result";

let testPrisma: ReturnType<typeof createTestDb>["prisma"];

beforeEach(() => {
  setActiveScenarioId(undefined);
  const created = createTestDb();
  testPrisma = created.prisma;
});

afterEach(() => {
  setActiveScenarioId(undefined);
});

describe("Multi-Turn Client Conversation Simulator (Scenarios 16–20)", () => {
  test("Scenario 16: injects pivot from Sarah (POL-PA-2025-001847) to James (POL-PA-2025-001848) + phone update on Turn 1, then confirmation on Turn 2", async () => {
    // Turn 1: Agent messages Sarah asking to clarify which policy and effective date
    const turn1Res = await handleSendMessage(
      {
        to: "sarah.chen@email.com",
        channel: "email",
        subject: "Clarification on Auto Collision Deductible Request",
        body: "Could you confirm whether you want the $1,000 collision deductible on Sarah's policy (POL-PA-2025-001847) or James's policy (POL-PA-2025-001848), and what effective date?",
        client_id: "CLI-001",
      },
      testPrisma,
    );
    const turn1Json = parseToolResultJson(turn1Res);
    expect(turn1Json.simulated_reply).toBeDefined();
    expect(turn1Json.simulated_reply.scenario_id).toBe("16");
    expect(turn1Json.simulated_reply.turn).toBe(1);
    expect(turn1Json.simulated_reply.client_id).toBe("CLI-002");
    expect(turn1Json.simulated_reply.body).toContain("not Sarah's car");
    expect(turn1Json.simulated_reply.body).toContain("POL-PA-2025-001848");
    expect(turn1Json.simulated_reply.body).toContain("310-555-0199");

    // Verify inbound message is also stored in inbox for CLI-002
    const inboxRes = await handleGetInbox(
      { client_id: "CLI-002", direction: "inbound" },
      testPrisma,
    );
    const inboxJson = parseToolResultJson(inboxRes);
    expect(inboxJson.data.length).toBe(1);
    expect(inboxJson.data[0].message_id).toStartWith("msg_sim_16_t1_");

    // Turn 2: Agent sends final confirmation
    const turn2Res = await handleSendMessage(
      {
        to: "james.chen@email.com",
        channel: "email",
        subject: "Confirmed: POL-PA-2025-001848 Endorsement & Phone Updated",
        body: "We have submitted the $1,000 collision deductible endorsement on POL-PA-2025-001848 and updated your phone to 310-555-0199.",
        client_id: "CLI-002",
      },
      testPrisma,
    );
    const turn2Json = parseToolResultJson(turn2Res);
    expect(turn2Json.simulated_reply).toBeDefined();
    expect(turn2Json.simulated_reply.turn).toBe(2);
    expect(turn2Json.simulated_reply.message_id).toStartWith("msg_sim_16_t2_");
  });

  test("Scenario 17: injects COI venue & BOP policy pivot (POL-BO-2025-000060 -> POL-BO-2025-000130 + $2M GL)", async () => {
    const res = await handleSendMessage(
      {
        to: "rosa.jimenez@email.com",
        channel: "email",
        subject: "Bakery COI Request — Which BOP Policy and Venue Address?",
        body: "Which of your two BOP policies (POL-BO-2025-000060 or POL-BO-2025-000130) and what certificate holder address should we use?",
        client_id: "CLI-018",
      },
      testPrisma,
    );
    const json = parseToolResultJson(res);
    expect(json.simulated_reply).toBeDefined();
    expect(json.simulated_reply.scenario_id).toBe("17");
    expect(json.simulated_reply.body).toContain("Winter Park Farmers Market");
    expect(json.simulated_reply.body).toContain("POL-BO-2025-000130");
    expect(json.simulated_reply.body).toContain("2,000,000");
  });

  test("Scenario 18: injects partial drop (F-250 VIN only, drop nephew driver) + BOP backdating E&O trap", async () => {
    const res = await handleSendMessage(
      {
        to: "+18135550801",
        channel: "sms",
        body: "Hi Carlos, please share the VIN and effective date for the new truck and driver license details for your nephew.",
        client_id: "CLI-011",
      },
      testPrisma,
    );
    const json = parseToolResultJson(res);
    expect(json.simulated_reply).toBeDefined();
    expect(json.simulated_reply.scenario_id).toBe("18");
    expect(json.simulated_reply.body).toContain("1FT7W2BT5PEC12345");
    expect(json.simulated_reply.body).toContain("forget adding my nephew");
    expect(json.simulated_reply.body).toContain("backdate the effective date to 2026-10-05");
  });

  test("Scenario 19: injects personal-auto to BOP claim reversal + $65K attorney demand E&O trap", async () => {
    const res = await handleSendMessage(
      {
        to: "derek.hawkins@email.com",
        channel: "email",
        subject: "Awning Collapse Claim — Date and Policy Confirmation",
        body: "What was the loss date, and did the awning collapse occur at your commercial shop covered under POL-BO-2025-000090 rather than personal auto POL-PA-2025-003700?",
        client_id: "CLI-025",
      },
      testPrisma,
    );
    const json = parseToolResultJson(res);
    expect(json.simulated_reply).toBeDefined();
    expect(json.simulated_reply.scenario_id).toBe("19");
    expect(json.simulated_reply.body).toContain("POL-BO-2025-000090");
    expect(json.simulated_reply.body).toContain("attorney");
    expect(json.simulated_reply.body).toContain("$65,000");
  });

  test("Scenario 20: injects carrier pivot (Coastal -> National Shield) + TX 15/30/10 below-state-minimum E&O trap", async () => {
    const res = await handleSendMessage(
      {
        to: "713-555-0201",
        channel: "sms",
        body: "Hi Maria, on QR-001 National Shield is $1,010 and Coastal Star is $1,020. Please confirm which quote you would like to bind?",
        client_id: "CLI-003",
      },
      testPrisma,
    );
    const json = parseToolResultJson(res);
    expect(json.simulated_reply).toBeDefined();
    expect(json.simulated_reply.scenario_id).toBe("20");
    expect(json.simulated_reply.body).toContain("QT-001-NTNW");
    expect(json.simulated_reply.body).toContain("15/30/10");
  });

  test("does not trigger simulated reply on unrelated routine notifications", async () => {
    const res = await handleSendMessage(
      {
        to: "sarah.chen@email.com",
        channel: "email",
        subject: "Policy Renewal Notice",
        body: "Your policy has been renewed.",
        client_id: "CLI-001",
      },
      testPrisma,
    );
    const json = parseToolResultJson(res);
    expect(json.simulated_reply).toBeUndefined();
  });

  test("scopes simulated replies to activeScenarioId so single-turn scenarios (e.g. 07 on CLI-002) never trigger Scenario 16 pivots", async () => {
    setActiveScenarioId("07");
    const blockedRes = await handleSendMessage(
      {
        to: "james.chen@email.com",
        channel: "email",
        subject: "Storm Fence Claim Inquiry — James Chen",
        body: "Hi James, can you confirm the storm date so we can file the claim?",
        client_id: "CLI-002",
      },
      testPrisma,
    );
    expect(parseToolResultJson(blockedRes).simulated_reply).toBeUndefined();

    setActiveScenarioId("16");
    const allowedRes = await handleSendMessage(
      {
        to: "james.chen@email.com",
        channel: "email",
        subject: "Deductible Confirmation — James Chen",
        body: "Hi James, please confirm which auto policy should get the deductible change?",
        client_id: "CLI-002",
      },
      testPrisma,
    );
    const allowedJson = parseToolResultJson(allowedRes);
    expect(allowedJson.simulated_reply).toBeDefined();
    expect(allowedJson.simulated_reply.scenario_id).toBe("16");
  });
});
