/**
 * Integration Test: The Retention Agent
 *
 * Agent detects at-risk clients and proactively re-shops to prevent churn.
 * Flow: CRM → AMS → Rater → Rater → ECM → CRM → Comm
 */
import { describe, expect, test, beforeAll } from "bun:test";
import {
  amsApp,
  raterApp,
  crmApp,
  ecmApp,
  comm,
  authHeader,
  handleSendMessage,
  seedAmsClient,
  seedAmsPolicy,
  seedRaterCarrier,
  seedCrmLead,
  seedCrmRetentionRisk,
  seedEcmAsset,
} from "./setup";

const clientId = "CLI-002";
let leadId: string;
let requestId: string;

beforeAll(() => {
  // Seed: at-risk client with high premium increase
  seedAmsClient({
    id: clientId,
    first_name: "Maria",
    last_name: "Chen",
    email: "maria.chen@email.com",
    address_state: "IL",
  });

  seedAmsPolicy({
    policy_id: "POL-HOME-002",
    client_id: clientId,
    carrier_code: "TRAV",
    policy_type: "homeowners",
    premium_current: 2400.0,
    premium_prior: 2000.0,
  });

  seedAmsPolicy({
    policy_id: "POL-AUTO-002",
    client_id: clientId,
    carrier_code: "PROG",
    policy_type: "personal_auto",
    premium_current: 1500.0,
    premium_prior: 1350.0,
  });

  // Seed retention risk
  seedCrmRetentionRisk({
    client_id: clientId,
    client_name: "Maria Chen",
    risk_score: 88,
    rate_increase_pct: 20.0,
    months_since_contact: 5,
    email_open_rate: 0.08,
    policies_count: 2,
    recommended_action: "Re-shop homeowners and send comparison.",
  });

  // Seed lead for CRM update
  const lead = seedCrmLead({
    lead_id: "lead_ret_002",
    client_id: clientId,
    first_name: "Maria",
    last_name: "Chen",
    email: "maria.chen@email.com",
    status: "active",
    score: 40,
  });
  leadId = lead.lead_id;

  // Seed carrier for re-quoting
  seedRaterCarrier({
    carrier_code: "PROG",
    carrier_name: "Progressive",
    states: JSON.stringify(["IL", "IN", "OH", "MI"]),
    policy_types: JSON.stringify(["personal_auto", "homeowners"]),
    risk_categories: JSON.stringify(["preferred", "standard", "non_standard"]),
    appetite_level: "high",
    min_driver_age: 16,
    max_vehicles: 8,
    accepts_sr22: true,
  });

  // Seed comparison template in ECM
  seedEcmAsset({
    asset_id: "asset_comparison_tmpl",
    name: "Price Comparison Template",
    description: "Side-by-side premium comparison for retention outreach",
    category: "comparison_template",
    mime_type: "application/pdf",
    url: "https://cdn.evergreen-insurance.com/assets/comparison-template.pdf",
  });
});

describe("Retention Agent — end-to-end", () => {
  test("Step 1: Get high-risk clients from CRM", async () => {
    const headers = await authHeader(["crm:analytics:read"]);
    const res = await crmApp.request("/v1/analytics/retention-risk?min_risk_score=70", { headers });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const atRisk = body.data.find((r: any) => r.client_id === clientId);
    expect(atRisk).toBeDefined();
    expect(atRisk.risk_score).toBeGreaterThanOrEqual(70);
    expect(atRisk.factors.rate_increase_pct).toBe(20.0);
  });

  test("Step 2: Get current policies from AMS", async () => {
    const headers = await authHeader(["ams:policies:read"]);
    const res = await amsApp.request(`/v1/clients/${clientId}/policies`, { headers });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBe(2);

    // Verify premium increase on homeowners
    const homePolicy = body.data.find((p: any) => p.policy_type === "homeowners");
    expect(homePolicy).toBeDefined();
    expect(homePolicy.premium_current).toBeGreaterThan(homePolicy.premium_prior);
  });

  test("Step 3: Submit re-quote request to Rater", async () => {
    const headers = await authHeader(["rater:quotes:create"]);
    const res = await raterApp.request("/v1/quotes/request", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        policy_type: "homeowners",
        effective_date: "2026-04-01",
        client: {
          first_name: "Maria",
          last_name: "Chen",
          address: { state: "IL", city: "Evanston", zip: "60201" },
        },
        property: {
          year_built: 1998,
          square_feet: 2200,
          construction_type: "frame",
          roof_year: 2015,
        },
        requested_coverages: [
          { coverage_type: "dwelling", limit: 350000 },
          { coverage_type: "personal_property", limit: 175000 },
        ],
      }),
    });
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.request_id).toBeTruthy();
    requestId = body.request_id;
  });

  test("Step 4: Poll for re-quote results", async () => {
    const headers = await authHeader(["rater:quotes:read"]);
    const res = await raterApp.request(`/v1/quotes/${requestId}/results`, { headers });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.request_id).toBe(requestId);
    expect(body.carriers.length).toBeGreaterThanOrEqual(1);

    // At least one carrier should have a quote
    const quoted = body.carriers.filter((c: any) => c.status === "quoted");
    expect(quoted.length).toBeGreaterThanOrEqual(1);
  });

  test("Step 5: Get comparison template from ECM", async () => {
    const headers = await authHeader(["ecm:assets:read"]);
    const res = await ecmApp.request("/v1/assets/marketing?category=comparison_template", { headers });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const template = body.data.find((a: any) => a.category === "comparison_template");
    expect(template).toBeDefined();
    expect(template.name).toBe("Price Comparison Template");
  });

  test("Step 6: Update lead status in CRM", async () => {
    const headers = await authHeader(["crm:leads:write"]);
    const res = await crmApp.request(`/v1/leads/${leadId}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "contacted",
        tags: ["retention", "re-shop"],
        notes: "Retention outreach: re-shopped homeowners, sent comparison.",
      }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("contacted");
  });

  test("Step 7: Send comparison email via Comm Hub", async () => {
    const result = await handleSendMessage(
      {
        to: "maria.chen@email.com",
        channel: "email",
        subject: "Your Homeowners Insurance — Better Options Available",
        body: "Hi Maria, we found lower rates for your homeowners coverage. See the attached comparison.",
        client_id: clientId,
      },
      comm.db,
    );
    expect(result.isError).toBeUndefined();

    const data = JSON.parse(result.content[0].text as string);
    expect(data.message_id).toBeTruthy();
    expect(data.status).toBe("queued");
  });
});
