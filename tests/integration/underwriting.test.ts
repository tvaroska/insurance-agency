/**
 * Integration Test: The Underwriting Agent
 *
 * Agent reads commercial documents and verifies coverage meets lease requirements.
 * Flow: ECM → AMS → AMS → Rater → Rater → Rater
 */
import { describe, expect, test, beforeAll } from "bun:test";
import {
  amsApp,
  raterApp,
  ecmApp,
  authHeader,
  seedAmsClient,
  seedAmsPolicy,
  seedEcmDocument,
  seedRaterCarrier,
} from "./setup";

const clientId = "CLI-004";
let requestId: string;

beforeAll(() => {
  // Seed: commercial client with BOP policy
  seedAmsClient({
    id: clientId,
    first_name: "David",
    last_name: "Thompson",
    email: "d.thompson@thompsonllc.com",
    address_state: "IL",
  });

  seedAmsPolicy({
    policy_id: "POL-BOP-004",
    client_id: clientId,
    carrier_code: "TRAV",
    policy_type: "bop",
    premium_current: 3200.0,
  });

  // No general_liability policy — underwriting agent should detect this gap

  // Seed documents for compliance audit
  seedEcmDocument({
    document_id: "doc_lease_004",
    client_id: clientId,
    document_type: "lease_agreement",
    filename: "thompson_llc_lease.pdf",
    status: "uploaded",
  });
  seedEcmDocument({
    document_id: "doc_app_004",
    client_id: clientId,
    document_type: "signed_application",
    filename: "thompson_bop_application.pdf",
    status: "signed",
    signer_name: "David Thompson",
    signer_email: "d.thompson@thompsonllc.com",
    signed_date: "2025-06-15",
  });

  // Seed carrier for BOP quotes
  seedRaterCarrier({
    carrier_code: "HART",
    carrier_name: "Hartford",
    states: JSON.stringify(["IL", "IN", "OH", "WI"]),
    policy_types: JSON.stringify(["bop", "general_liability", "workers_comp"]),
    risk_categories: JSON.stringify(["preferred", "standard"]),
    appetite_level: "high",
    min_driver_age: null,
    max_vehicles: null,
    accepts_sr22: false,
  });
});

describe("Underwriting Agent — end-to-end", () => {
  test("Step 1: Get document audit from ECM", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await ecmApp.request(`/v1/documents/${clientId}/audit`, { headers });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.client_id).toBe(clientId);
    expect(body.documents).toBeArray();
    expect(body.documents.length).toBeGreaterThanOrEqual(2);
  });

  test("Step 2: Get client policies from AMS and check for BOP", async () => {
    const headers = await authHeader(["ams:policies:read"]);
    const res = await amsApp.request(`/v1/clients/${clientId}/policies`, { headers });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const bopPolicy = body.data.find((p: any) => p.policy_type === "bop");
    expect(bopPolicy).toBeDefined();
    expect(bopPolicy.carrier_code).toBe("TRAV");
  });

  test("Step 3: Check policies — no general liability coverage found", async () => {
    const headers = await authHeader(["ams:policies:read"]);
    const res = await amsApp.request(`/v1/clients/${clientId}/policies`, { headers });
    expect(res.status).toBe(200);

    const body = await res.json();
    const glPolicy = body.data.find((p: any) => p.policy_type === "general_liability");
    expect(glPolicy).toBeUndefined();
  });

  test("Step 4: Check carrier appetite for BOP in IL", async () => {
    const headers = await authHeader(["rater:carriers:read"]);
    const res = await raterApp.request("/v1/carriers/appetite?state=IL&policy_type=bop", { headers });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const hartford = body.data.find((c: any) => c.carrier_code === "HART");
    expect(hartford).toBeDefined();
    expect(hartford.appetite_level).toBe("high");
  });

  test("Step 5: Submit quote request for additional coverage", async () => {
    const headers = await authHeader(["rater:quotes:create"]);
    const res = await raterApp.request("/v1/quotes/request", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        policy_type: "bop",
        effective_date: "2026-04-01",
        client: {
          first_name: "David",
          last_name: "Thompson",
          address: { state: "IL", city: "Chicago", zip: "60601" },
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
    expect(body.carriers_queried).toBeGreaterThanOrEqual(1);
    requestId = body.request_id;
  });

  test("Step 6: Poll for carrier quote results", async () => {
    const headers = await authHeader(["rater:quotes:read"]);
    const res = await raterApp.request(`/v1/quotes/${requestId}/results`, { headers });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.request_id).toBe(requestId);
    expect(body.status).toBe("completed");
    expect(body.carriers.length).toBeGreaterThanOrEqual(1);

    const quotedCarrier = body.carriers.find((c: any) => c.status === "quoted");
    expect(quotedCarrier).toBeDefined();
    expect(quotedCarrier.premium_annual).toBeGreaterThan(0);
  });
});
