/**
 * E2E Scenario: Content Auditor Agent
 *
 * Agent monitors leads, checks document compliance, sends welcome kits,
 * creates e-signature envelopes.
 *
 * Flow: CRM leads → AMS policies → ECM assets → ECM audit → ECM envelope → Comm send → CRM update
 */
import { describe, expect, test } from "bun:test";
import { e2eAuthRequest, mcpCall } from "../client";
import { CLIENTS, LEADS, DOCUMENTS } from "../fixtures";

const client = CLIENTS.SARAH_CHEN;

describe("Content Auditor Agent — E2E", () => {
  test("Step 1: Get qualified leads from CRM", async () => {
    // Ensure the lead is in "qualified" status (may have been changed by prior test runs)
    await e2eAuthRequest(
      "crm",
      `/v1/leads/${LEADS.SARAH_CHEN}`,
      ["crm:leads:write"],
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "qualified" }),
      },
    );

    const res = await e2eAuthRequest(
      "crm",
      "/v1/leads/scoring?status=qualified",
      ["crm:leads:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const lead = body.data.find((l: any) => l.client_id === client.id);
    expect(lead).toBeDefined();
    expect(lead.status).toBe("qualified");
  });

  test("Step 2: Get client policies from AMS", async () => {
    const res = await e2eAuthRequest(
      "ams",
      `/v1/clients/${client.id}/policies`,
      ["ams:policies:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const policyTypes = body.data.map((p: any) => p.policy_type);
    // Sarah Chen has auto and homeowners
    expect(policyTypes).toContain("personal_auto");
    expect(policyTypes).toContain("homeowners");
  });

  test("Step 3: Fetch welcome kit from ECM", async () => {
    const res = await e2eAuthRequest(
      "ecm",
      "/v1/assets/marketing?category=welcome_kit",
      ["ecm:assets:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const kit = body.data.find((a: any) => a.category === "welcome_kit");
    expect(kit).toBeDefined();
    expect(kit.url).toBeTruthy();
  });

  test("Step 4: Run document audit via ECM", async () => {
    const res = await e2eAuthRequest(
      "ecm",
      `/v1/documents/${client.id}/audit`,
      ["ecm:documents:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.client_id).toBe(client.id);
    expect(body.documents).toBeArray();
    expect(body.documents.length).toBeGreaterThanOrEqual(1);
  });

  test("Step 5: Create e-signature envelope", async () => {
    const res = await e2eAuthRequest("ecm", "/v1/envelopes/create", ["ecm:envelopes:create"], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: client.id,
        document_ids: [DOCUMENTS.SARAH_AUTO_APP],
        signers: [
          {
            name: `${client.first_name} ${client.last_name}`,
            email: client.email,
            role: "policyholder",
          },
        ],
        message: "Please review and sign your policy documents.",
      }),
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.envelope_id).toBeTruthy();
    expect(body.status).toBe("created");
    expect(body.signers).toBeArray();
  });

  test("Step 6: Send welcome email via Comm Hub", async () => {
    const result = await mcpCall("send_message", {
      to: client.email,
      channel: "email",
      subject: "Welcome to Evergreen Insurance — Your Policy Documents",
      body: `Hi ${client.first_name}, welcome to Evergreen! Your policy documents are ready for review and signature.`,
      client_id: client.id,
    });
    expect(result.isError).toBeUndefined();

    const data = JSON.parse(result.content[0].text);
    expect(data.message_id).toBeTruthy();
    expect(data.status).toBe("queued");
  });

  test("Step 7: Update lead status in CRM", async () => {
    const res = await e2eAuthRequest(
      "crm",
      `/v1/leads/${LEADS.SARAH_CHEN}`,
      ["crm:leads:write"],
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "contacted",
          tags: ["welcome-kit-sent", "e-signature-pending"],
          notes: "Welcome kit emailed, e-signature envelope created for policy docs.",
        }),
      },
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.lead_id).toBe(LEADS.SARAH_CHEN);
    expect(body.status).toBe("contacted");
  });
});
