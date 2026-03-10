/**
 * E2E Scenario: Underwriting Agent
 *
 * Agent reviews commercial documents, checks coverage gaps, submits for
 * carrier risk assessment via the Coastal Star portal.
 *
 * Flow: ECM audit → AMS policies → Rater appetite → Rater quote → Carrier-Coastal risk assessment
 */
import { describe, expect, test } from "bun:test";
import { e2eAuthRequest, e2eCarrierRequest } from "../client";
import { CLIENTS } from "../fixtures";

const client = CLIENTS.DAVID_THOMPSON;
let requestId: string;
let coastalQuoteId: string;

describe("Underwriting Agent — E2E", () => {
  test("Step 1: Get document audit from ECM", async () => {
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

  test("Step 2: Get client policies — confirm BOP", async () => {
    const res = await e2eAuthRequest(
      "ams",
      `/v1/clients/${client.id}/policies`,
      ["ams:policies:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const bopPolicy = body.data.find((p: any) => p.policy_type === "bop");
    expect(bopPolicy).toBeDefined();
  });

  test("Step 3: Check carrier appetite for BOP in IL", async () => {
    const res = await e2eAuthRequest(
      "rater",
      `/v1/carriers/appetite?state=${client.state}&policy_type=bop`,
      ["rater:carriers:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    // At least one carrier has appetite for BOP in IL
    const appetites = body.data.map((c: any) => c.appetite_level);
    expect(appetites.some((a: string) => a === "high" || a === "medium")).toBe(true);
  });

  test("Step 4: Submit quote request to Rater", async () => {
    const res = await e2eAuthRequest("rater", "/v1/quotes/request", ["rater:quotes:create"], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        policy_type: "bop",
        effective_date: "2026-07-01",
        client: {
          first_name: client.first_name,
          last_name: client.last_name,
          address: { state: client.state, city: "Chicago", zip: "60601" },
        },
        business: {
          name: "Thompson LLC",
          industry: "consulting",
          annual_revenue: 500000,
          employee_count: 12,
        },
        requested_coverages: [
          { coverage_type: "general_liability", per_occurrence_limit: 1000000 },
          { coverage_type: "property", limit: 250000 },
        ],
      }),
    });
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.request_id).toBeTruthy();
    requestId = body.request_id;
  });

  test("Step 5: Poll for carrier quote results", async () => {
    const res = await e2eAuthRequest(
      "rater",
      `/v1/quotes/${requestId}/results`,
      ["rater:quotes:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.request_id).toBe(requestId);
    expect(body.status).toBe("completed");
    expect(body.carriers.length).toBeGreaterThanOrEqual(1);
  });

  test("Step 6: Submit to Coastal Star portal for risk assessment", async () => {
    const res = await e2eCarrierRequest("carrier-coastal", "/v1/coastal/quotes/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: client.id,
        policy_type: "bop",
        effective_date: "2026-07-01",
        client_info: {
          first_name: client.first_name,
          last_name: client.last_name,
          state: client.state,
        },
        business: {
          name: "Thompson LLC",
          industry: "consulting",
          annual_revenue: 500000,
          employee_count: 12,
        },
        coverages: [
          { type: "general_liability", limit: 1000000 },
          { type: "property", limit: 250000 },
        ],
      }),
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.quote_id).toBeTruthy();
    expect(body.status).toBe("assessed");
    expect(body.risk_score).toBeGreaterThan(0);
    coastalQuoteId = body.quote_id;
  });

  test("Step 7: Get risk assessment from Coastal Star", async () => {
    const res = await e2eCarrierRequest(
      "carrier-coastal",
      `/v1/coastal/quotes/${coastalQuoteId}/risk-assessment`,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.quote_id).toBe(coastalQuoteId);
    expect(body.risk_score).toBeGreaterThan(0);
    expect(body.risk_tier).toBeTruthy();
    expect(body.factors).toBeArray();
    expect(body.recommendation).toBeTruthy();
  });
});
