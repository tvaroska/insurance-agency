/**
 * E2E Scenario: Cross-Service Lifecycle
 *
 * Full lifecycle test touching all 7 services: AMS, Rater, CRM, ECM,
 * Comm Hub, Carrier-Summit, and Carrier-Coastal.
 *
 * Flow: AMS → Rater → CRM → ECM → Comm → Carrier-Summit → Carrier-Coastal
 */
import { describe, expect, test } from "bun:test";
import { e2eAuthRequest, e2eCarrierRequest, mcpCall } from "../client";
import { CLIENTS, CARRIER_QUOTES } from "../fixtures";

const client = CLIENTS.SARAH_CHEN;

describe("Cross-Service Lifecycle — E2E", () => {
  // ── AMS ──
  test("AMS: Look up client", async () => {
    const res = await e2eAuthRequest(
      "ams",
      `/v1/clients?last_name=${client.last_name}`,
      ["ams:clients:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    const found = body.data.find((c: any) => c.id === client.id);
    expect(found).toBeDefined();
    expect(found.status).toBe("active");
  });

  test("AMS: Get client policies", async () => {
    const res = await e2eAuthRequest(
      "ams",
      `/v1/clients/${client.id}/policies`,
      ["ams:policies:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(2);

    // Sarah has auto + homeowners
    const types = body.data.map((p: any) => p.policy_type);
    expect(types).toContain("personal_auto");
    expect(types).toContain("homeowners");
  });

  // ── Rater ──
  test("Rater: Check carrier appetite for CA auto", async () => {
    const res = await e2eAuthRequest(
      "rater",
      "/v1/carriers/appetite?state=CA&policy_type=personal_auto",
      ["rater:carriers:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  let requestId: string;
  test("Rater: Submit auto quote request", async () => {
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
            dob: "1985-03-15",
            license_number: "CA-D8832910",
            relationship: "self",
            violations: [],
            accidents: [],
          },
        ],
        vehicles: [
          {
            year: 2022,
            make: "Tesla",
            model: "Model 3",
            vin: "5YJ3E1EA1NF123456",
            usage: "commute",
            annual_miles: 12000,
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

  test("Rater: Poll for quote results", async () => {
    const res = await e2eAuthRequest(
      "rater",
      `/v1/quotes/${requestId}/results`,
      ["rater:quotes:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("completed");
    expect(body.carriers.length).toBeGreaterThanOrEqual(1);
  });

  // ── CRM ──
  test("CRM: Get lead scoring", async () => {
    const res = await e2eAuthRequest("crm", "/v1/leads/scoring", ["crm:leads:read"]);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    // Should include leads with scores
    const scored = body.data.filter((l: any) => l.score > 0);
    expect(scored.length).toBeGreaterThanOrEqual(1);
  });

  test("CRM: Get retention risk analytics", async () => {
    const res = await e2eAuthRequest(
      "crm",
      "/v1/analytics/retention-risk",
      ["crm:analytics:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  // ── ECM ──
  test("ECM: Document audit for client", async () => {
    const res = await e2eAuthRequest(
      "ecm",
      `/v1/documents/${client.id}/audit`,
      ["ecm:documents:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.client_id).toBe(client.id);
    expect(body.documents).toBeArray();
  });

  test("ECM: Get marketing assets", async () => {
    const res = await e2eAuthRequest("ecm", "/v1/assets/marketing", ["ecm:assets:read"]);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  // ── Comm Hub (MCP) ──
  test("Comm: Send notification via MCP", async () => {
    const result = await mcpCall("send_message", {
      to: client.email,
      channel: "email",
      subject: "Cross-Service Lifecycle Test Notification",
      body: "This is an automated E2E test notification.",
      client_id: client.id,
    });
    expect(result.isError).toBeUndefined();

    const data = JSON.parse(result.content[0].text);
    expect(data.message_id).toBeTruthy();
    expect(data.status).toBe("queued");
  });

  test("Comm: Get inbox via MCP", async () => {
    const result = await mcpCall("get_inbox", {
      client_id: client.id,
      limit: 5,
    });
    expect(result.isError).toBeUndefined();

    const data = JSON.parse(result.content[0].text);
    expect(data.data).toBeArray();
  });

  // ── Carrier-Summit ──
  test("Carrier-Summit: Get pre-seeded Summit quote", async () => {
    const res = await e2eCarrierRequest(
      "carrier-summit",
      `/v1/summit/quotes/${CARRIER_QUOTES.SMIT_QT_001}`,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.quote_id).toBe(CARRIER_QUOTES.SMIT_QT_001);
    expect(body.premium_annual).toBeGreaterThan(0);
  });

  // ── Carrier-Coastal ──
  test("Carrier-Coastal: Get pre-seeded Coastal Star risk assessment", async () => {
    const res = await e2eCarrierRequest(
      "carrier-coastal",
      `/v1/coastal/quotes/${CARRIER_QUOTES.CSTL_QT_001}/risk-assessment`,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.quote_id).toBe(CARRIER_QUOTES.CSTL_QT_001);
    expect(body.risk_score).toBeGreaterThan(0);
    expect(body.risk_tier).toBeTruthy();
    expect(body.factors).toBeArray();
  });
});
