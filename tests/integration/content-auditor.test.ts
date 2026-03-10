/**
 * Integration Test: The Content Auditor Agent
 *
 * Agent monitors new leads and sends appropriate Welcome Kits.
 * Flow: CRM → AMS → ECM → Comm → CRM → ECM
 */
import { describe, expect, test, beforeAll } from "bun:test";
import {
  amsApp,
  crmApp,
  ecmApp,
  comm,
  authHeader,
  handleSendMessage,
  seedAmsClient,
  seedAmsPolicy,
  seedCrmLead,
  seedEcmAsset,
  seedEcmDocument,
} from "./setup";

const clientId = "CLI-018";
let leadId: string;

beforeAll(() => {
  // Seed: new client with homeowners policy
  seedAmsClient({
    id: clientId,
    first_name: "Lisa",
    last_name: "Martinez",
    email: "l.martinez@email.com",
    address_state: "OH",
  });

  seedAmsPolicy({
    policy_id: "POL-HOME-018",
    client_id: clientId,
    carrier_code: "TRAV",
    policy_type: "homeowners",
    premium_current: 1850.0,
  });

  // Seed new lead
  const lead = seedCrmLead({
    lead_id: "lead_ca_018",
    client_id: clientId,
    first_name: "Lisa",
    last_name: "Martinez",
    email: "l.martinez@email.com",
    status: "new",
    score: 72,
  });
  leadId = lead.lead_id;

  // Seed welcome kit marketing asset
  seedEcmAsset({
    asset_id: "asset_wk_homeowners",
    name: "Homeowners Welcome Kit",
    description: "Welcome packet for new homeowners policyholders",
    category: "welcome_kit",
    mime_type: "application/pdf",
    url: "https://cdn.evergreen-insurance.com/assets/homeowners-welcome-kit.pdf",
  });

  // Seed some existing documents for audit
  seedEcmDocument({
    document_id: "doc_app_018",
    client_id: clientId,
    document_type: "signed_application",
    filename: "martinez_homeowners_app.pdf",
    status: "signed",
    signer_name: "Lisa Martinez",
    signer_email: "l.martinez@email.com",
    signed_date: "2026-01-20",
  });
});

describe("Content Auditor Agent — end-to-end", () => {
  test("Step 1: Check for new leads in CRM", async () => {
    const headers = await authHeader(["crm:leads:read"]);
    const res = await crmApp.request("/v1/leads/scoring?status=new", { headers });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const newLead = body.data.find((l: any) => l.client_id === clientId);
    expect(newLead).toBeDefined();
    expect(newLead.status).toBe("new");
  });

  test("Step 2: Get client policies from AMS to determine lines of business", async () => {
    const headers = await authHeader(["ams:policies:read"]);
    const res = await amsApp.request(`/v1/clients/${clientId}/policies`, { headers });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    // Client has homeowners — we'll send homeowners welcome kit
    const policyTypes = body.data.map((p: any) => p.policy_type);
    expect(policyTypes).toContain("homeowners");
  });

  test("Step 3: Fetch welcome kit from ECM based on policy type", async () => {
    const headers = await authHeader(["ecm:assets:read"]);
    const res = await ecmApp.request("/v1/assets/marketing?category=welcome_kit", { headers });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const homeKit = body.data.find((a: any) => a.name.includes("Homeowners"));
    expect(homeKit).toBeDefined();
    expect(homeKit.url).toBeTruthy();
  });

  test("Step 4: Send welcome kit email via Comm Hub", async () => {
    const result = await handleSendMessage(
      {
        to: "l.martinez@email.com",
        channel: "email",
        subject: "Welcome to Evergreen Insurance — Your Homeowners Welcome Kit",
        body: "Hi Lisa, welcome to Evergreen! Attached is your Homeowners Welcome Kit with important policy information.",
        client_id: clientId,
      },
      comm.db,
    );
    expect(result.isError).toBeUndefined();

    const data = JSON.parse(result.content[0].text as string);
    expect(data.message_id).toBeTruthy();
    expect(data.status).toBe("queued");
    expect(data.channel).toBe("email");
  });

  test("Step 5: Update lead status and add welcome-kit-sent tag", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await crmApp.request(`/v1/leads/${leadId}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "contacted",
        tags: ["welcome-kit-sent"],
        notes: "Homeowners Welcome Kit sent via email.",
      }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.lead_id).toBe(leadId);
    expect(body.status).toBe("contacted");
  });

  test("Step 6: Verify document compliance via ECM audit", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await ecmApp.request(`/v1/documents/${clientId}/audit`, { headers });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.client_id).toBe(clientId);
    expect(body.documents).toBeArray();
    expect(body.documents.length).toBeGreaterThanOrEqual(1);
  });
});
