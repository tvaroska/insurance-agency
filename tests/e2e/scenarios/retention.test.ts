/**
 * E2E Scenario: Retention Agent
 *
 * Agent detects at-risk clients, re-shops quotes, enrolls in campaign,
 * and sends outreach via Comm Hub.
 *
 * Flow: CRM risk → AMS policies → Rater quote → ECM assets → CRM enroll → Comm send
 */
import { describe, expect, test } from "bun:test";
import { e2eAuthRequest, mcpCall } from "../client";
import { CLIENTS, CAMPAIGNS } from "../fixtures";

const client = CLIENTS.JAMES_CHEN; // CLI-002, high retention risk (score 88)
let requestId: string;

describe("Retention Agent — E2E", () => {
  test("Step 1: Get high-risk clients from CRM", async () => {
    const res = await e2eAuthRequest(
      "crm",
      "/v1/analytics/retention-risk?min_risk_score=70",
      ["crm:analytics:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const atRisk = body.data.find((r: any) => r.client_id === client.id);
    expect(atRisk).toBeDefined();
    expect(atRisk.risk_score).toBeGreaterThanOrEqual(70);
  });

  test("Step 2: Get current policies from AMS", async () => {
    const res = await e2eAuthRequest(
      "ams",
      `/v1/clients/${client.id}/policies`,
      ["ams:policies:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    // Verify at least one policy has premium increase
    const withIncrease = body.data.find(
      (p: any) => p.premium_prior && p.premium_current > p.premium_prior,
    );
    expect(withIncrease).toBeDefined();
  });

  test("Step 3: Submit re-quote request to Rater", async () => {
    const res = await e2eAuthRequest("rater", "/v1/quotes/request", ["rater:quotes:create"], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        policy_type: "personal_auto",
        effective_date: "2026-07-01",
        client: {
          first_name: client.first_name,
          last_name: client.last_name,
          address: { state: client.state, city: "Los Angeles", zip: "90026" },
        },
        drivers: [
          {
            name: `${client.first_name} ${client.last_name}`,
            dob: "1983-07-22",
            license_number: "CA-D7741823",
            relationship: "self",
            violations: [],
            accidents: [],
          },
        ],
        vehicles: [
          {
            year: 2021,
            make: "BMW",
            model: "3 Series",
            vin: "WBA5R1C50LAF12345",
            usage: "commute",
            annual_miles: 15000,
          },
        ],
        requested_coverages: [
          { type: "bodily_injury", limit: "100000/300000" },
          { type: "property_damage", limit: "50000" },
          { type: "collision", deductible: 500 },
          { type: "comprehensive", deductible: 250 },
        ],
      }),
    });
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.request_id).toBeTruthy();
    requestId = body.request_id;
  });

  test("Step 4: Poll for re-quote results", async () => {
    const res = await e2eAuthRequest(
      "rater",
      `/v1/quotes/${requestId}/results`,
      ["rater:quotes:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.request_id).toBe(requestId);
    expect(body.carriers.length).toBeGreaterThanOrEqual(1);

    const quoted = body.carriers.filter((c: any) => c.status === "quoted");
    expect(quoted.length).toBeGreaterThanOrEqual(1);
  });

  test("Step 5: Get comparison template from ECM", async () => {
    const res = await e2eAuthRequest(
      "ecm",
      "/v1/assets/marketing?category=comparison_template",
      ["ecm:assets:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const template = body.data.find((a: any) => a.category === "comparison_template");
    expect(template).toBeDefined();
  });

  test("Step 6: Enroll client in retention campaign", async () => {
    const res = await e2eAuthRequest(
      "crm",
      `/v1/campaigns/${CAMPAIGNS.RENEWAL_Q1}/enroll`,
      ["crm:campaigns:enroll"],
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: client.id,
          trigger_reason: "High retention risk (score 88). Re-shopped auto, sending comparison.",
        }),
      },
    );
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.enrollment_id).toBeTruthy();
    expect(body.campaign_id).toBe(CAMPAIGNS.RENEWAL_Q1);
    expect(body.client_id).toBe(client.id);
  });

  test("Step 7: Send comparison email via Comm Hub", async () => {
    const result = await mcpCall("send_message", {
      to: client.email,
      channel: "email",
      subject: "Your Auto Insurance — Better Options Available",
      body: `Hi ${client.first_name}, we found competitive rates for your auto coverage. See the attached comparison.`,
      client_id: client.id,
    });
    expect(result.isError).toBeUndefined();

    const data = JSON.parse(result.content[0].text);
    expect(data.message_id).toBeTruthy();
    expect(data.status).toBe("queued");
    expect(data.channel).toBe("email");
  });
});
