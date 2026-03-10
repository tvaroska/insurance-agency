/**
 * E2E Scenario: Carrier Portal Workflows
 *
 * Tests new Summit Fire & Casualty and Coastal Star Insurance portal features.
 *
 * Flow 1: Summit property submission → inspection status → conditions
 * Flow 2: Coastal quick quote → coverage recalculation → bind → ID card
 */
import { describe, expect, test } from "bun:test";
import { e2eCarrierRequest } from "../client";

let summitQuoteId: string;
let coastalQuoteId: string;
let coastalPolicyId: string;

describe("Summit Fire & Casualty Portal — E2E", () => {
  test("Submit property for underwriting", async () => {
    const res = await e2eCarrierRequest("carrier-summit", "/v1/summit/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: "CLI-001",
        policy_type: "homeowners",
        property_address: {
          street: "123 Oak Lane",
          city: "Sacramento",
          state: "CA",
          zip: "95814",
        },
        property_details: {
          year_built: 2005,
          square_feet: 2200,
          construction_type: "frame",
          roof_type: "asphalt_shingle",
          roof_year: 2018,
          heating_type: "central",
        },
        photo_checklist: [
          { type: "front_exterior", uploaded: true },
          { type: "rear_exterior", uploaded: true },
          { type: "roof_view", uploaded: false },
        ],
        coverages: [
          { type: "dwelling", limit: 350000 },
          { type: "personal_property", limit: 175000 },
          { type: "liability", limit: 300000 },
        ],
        deductibles: { all_peril: 1000 },
      }),
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.quote_id).toBeTruthy();
    expect(body.inspection_status).toBe("scheduled");
    expect(body.conditions_count).toBeGreaterThanOrEqual(1);
    summitQuoteId = body.quote_id;
  });

  test("Get inspection status", async () => {
    const res = await e2eCarrierRequest(
      "carrier-summit",
      `/v1/summit/inspections/${summitQuoteId}`,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.quote_id).toBe(summitQuoteId);
    expect(body.inspection_status).toBe("scheduled");
    expect(body.inspection_scheduled_at).toBeTruthy();
  });

  test("Get underwriting conditions", async () => {
    const res = await e2eCarrierRequest(
      "carrier-summit",
      `/v1/summit/inspections/${summitQuoteId}/conditions`,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.quote_id).toBe(summitQuoteId);
    expect(body.conditions.length).toBeGreaterThanOrEqual(1);
    expect(body.conditions[0].status).toBe("pending");
  });
});

describe("Coastal Star Insurance Portal — E2E", () => {
  test("Quick quote with VIN decode", async () => {
    const res = await e2eCarrierRequest("carrier-coastal", "/v1/coastal/quotes/quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vin: "1HGCV1F34LA000001",
        client_id: "CLI-003",
        driver_name: "Maria Rodriguez",
        driver_dob: "1988-07-22",
        driver_license: "TX-M8890321",
      }),
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.quote_id).toBeTruthy();
    expect(body.vehicle.make).toBeTruthy();
    expect(body.premium.annual).toBeGreaterThan(0);
    expect(body.status).toBe("assessed");
    coastalQuoteId = body.quote_id;
  });

  test("Recalculate premium with coverage adjustments", async () => {
    const res = await e2eCarrierRequest(
      "carrier-coastal",
      `/v1/coastal/quotes/${coastalQuoteId}/recalculate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coverages: [
            { type: "bodily_injury", limit: "250/500" },
            { type: "property_damage", limit: "100000" },
            { type: "collision", deductible: 1000 },
            { type: "comprehensive", deductible: 500 },
            { type: "uninsured_motorist", limit: "100/300" },
          ],
        }),
      },
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.quote_id).toBe(coastalQuoteId);
    expect(body.adjusted_premium.annual).toBeGreaterThan(0);
  });

  test("Bind quote and get confirmation", async () => {
    const res = await e2eCarrierRequest(
      "carrier-coastal",
      `/v1/coastal/quotes/${coastalQuoteId}/bind`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effective_date: "2026-04-01",
          payment_plan: "semi_annual",
        }),
      },
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.policy_id).toBeTruthy();
    expect(body.bind_status).toBe("bound");
    coastalPolicyId = body.policy_id;
  });

  test("Get digital ID card", async () => {
    const res = await e2eCarrierRequest(
      "carrier-coastal",
      `/v1/coastal/policies/${coastalPolicyId}/id-card`,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.card_id).toBeTruthy();
    expect(body.card_data.carrier).toBe("Coastal Star Insurance");
    expect(body.card_data.policy_number).toBe(coastalPolicyId);
  });
});
