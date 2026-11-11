/**
 * Integration Test: The Pivot Agent (Cross-Sell)
 *
 * A client calls about a claim; the agent detects a cross-sell opportunity.
 * Flow: Comm (HTTP /mcp JSON-RPC) → AMS → AMS → CRM → Comm (HTTP /mcp) → CRM
 */
import { describe, expect, test, beforeAll } from "bun:test";
import {
  amsApp,
  crmApp,
  commApp,
  authHeader,
  callCommMcpJsonRpc,
  callCommMcpTool,
  seedAmsClient,
  seedAmsPolicy,
  seedCommMessage,
  seedCrmLead,
  seedCrmCampaign,
} from "./setup";

let clientId: string;
let leadId: string;
let campaignId: string;

beforeAll(async () => {
  const client = await seedAmsClient({
    id: "CLI-011",
    first_name: "Carlos",
    last_name: "Gutierrez",
    email: "carlos.gutierrez@email.com",
  });
  clientId = client.id;

  await seedAmsPolicy({
    policy_id: "POL-AUTO-011",
    client_id: clientId,
    carrier_code: "PROG",
    policy_type: "personal_auto",
  });

  await seedCommMessage({
    message_id: "MSG-CALL-003",
    client_id: clientId,
    channel: "phone",
    direction: "inbound",
    call_id: "CALL-003",
    duration_seconds: 420,
    transcript:
      "Agent: Thank you for calling Evergreen. This is Amy speaking.\n" +
      "Caller: Hi Amy, I just had a new baby and I want to make sure we have enough coverage.\n" +
      "Agent: Congratulations! Let me review your current policies.\n" +
      "Caller: I think we might need life insurance too.",
    sentiment: "positive",
    topics: JSON.stringify(["new_baby", "life_insurance", "coverage_review"]),
    subject: null,
    body: null,
    from_addr: "caller",
    to_addr: "800-555-EVER",
  });

  const lead = await seedCrmLead({
    lead_id: "lead_pivot_011",
    client_id: clientId,
    first_name: "Carlos",
    last_name: "Gutierrez",
    email: "carlos.gutierrez@email.com",
    status: "new",
    score: 65,
  });
  leadId = lead.lead_id;

  const campaign = await seedCrmCampaign({
    campaign_id: "camp_life_pivot_2026",
    name: "Life Insurance Pivot",
    type: "nurture",
    status: "active",
  });
  campaignId = campaign.campaign_id;
});

describe("Pivot Agent (Cross-Sell) — end-to-end", () => {
  test("Step 0: MCP initialize & tools/list succeed over HTTP /mcp while strict mode blocks direct REST", async () => {
    const initResult = await callCommMcpJsonRpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "integration-test", version: "1.0.0" },
    });
    expect(initResult.serverInfo?.name).toBe("evergreen-comm");

    const listResult = await callCommMcpJsonRpc("tools/list");
    const toolNames = (listResult.tools ?? []).map((t: any) => t.name);
    expect(toolNames).toContain("get_transcript");
    expect(toolNames).toContain("send_message");
    expect(toolNames).toContain("get_inbox");

    // Under MODALITY_MODE=strict, direct REST access without X-Eval-Scorer is blocked (403)
    const headers = await authHeader(["comm:messages:read"]);
    const restRes = await commApp.request("/v1/messages/inbox", { headers });
    expect(restRes.status).toBe(403);
  });

  test("Step 1: Get call transcript from Comm Hub via HTTP /mcp JSON-RPC", async () => {
    const result = await callCommMcpTool("get_transcript", { call_id: "CALL-003" });
    expect(result.isError).toBeUndefined();

    const data = JSON.parse(result.content[0].text);
    expect(data.call_id).toBe("CALL-003");
    expect(data.client_id).toBe(clientId);
    expect(data.sentiment).toBe("positive");
    expect(data.topics).toContain("new_baby");
    expect(data.topics).toContain("life_insurance");
    expect(data.transcript_text).toContain("new baby");
  });

  test("Step 2: Look up client in AMS by last name", async () => {
    const headers = await authHeader(["ams:clients:read"]);
    const res = await amsApp.request("/v1/clients?last_name=Gutierrez", { headers });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const client = body.data.find((c: any) => c.id === clientId);
    expect(client).toBeDefined();
    expect(client.first_name).toBe("Carlos");
  });

  test("Step 3: Review existing policies — confirm no life insurance", async () => {
    const headers = await authHeader(["ams:policies:read"]);
    const res = await amsApp.request(`/v1/clients/${clientId}/policies`, { headers });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const policyTypes = body.data.map((p: any) => p.policy_type);
    expect(policyTypes).toContain("personal_auto");
    expect(policyTypes).not.toContain("life");
  });

  test("Step 4: Enroll client in Life Insurance Pivot campaign", async () => {
    const headers = await authHeader(["crm:campaigns:enroll"]);
    const res = await crmApp.request(`/v1/campaigns/${campaignId}/enroll`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        trigger_reason: "Life event detected: new baby. No life insurance policy on file.",
      }),
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.enrollment_id).toBeTruthy();
    expect(body.campaign_id).toBe(campaignId);
    expect(body.client_id).toBe(clientId);
  });

  test("Step 5: Send personalized cross-sell email via Comm Hub HTTP /mcp JSON-RPC", async () => {
    const result = await callCommMcpTool("send_message", {
      to: "carlos.gutierrez@email.com",
      channel: "email",
      subject: "Protect your growing family — Life Insurance options",
      body: "Congratulations on your new baby! We noticed you don't currently have life insurance. Here are some options to protect your family.",
      client_id: clientId,
    });
    expect(result.isError).toBeUndefined();

    const data = JSON.parse(result.content[0].text);
    expect(data.message_id).toBeTruthy();
    expect(data.status).toBe("queued");
    expect(data.channel).toBe("email");
  });

  test("Step 6: Update lead status to contacted", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await crmApp.request(`/v1/leads/${leadId}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "contacted",
        tags: ["life-pivot", "new-baby"],
        notes: "Cross-sell email sent after new baby life event detected in call transcript.",
      }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.lead_id).toBe(leadId);
    expect(body.status).toBe("contacted");
  });
});
