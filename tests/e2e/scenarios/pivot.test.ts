/**
 * E2E Scenario: Pivot Agent (Cross-Sell)
 *
 * A client with auto insurance has no life coverage — the agent detects
 * a cross-sell opportunity, quotes life insurance, and binds.
 *
 * Flow: AMS client lookup → AMS policies → Rater quote → Rater poll → Rater bind
 */
import { describe, expect, test } from "bun:test";
import { e2eAuthRequest } from "../client";
import { CLIENTS } from "../fixtures";

const client = CLIENTS.MARIA_RODRIGUEZ;
let requestId: string;
let bindableQuoteId: string;

describe("Pivot Agent (Cross-Sell) — E2E", () => {
  test("Step 1: Look up client by last name in AMS", async () => {
    const res = await e2eAuthRequest(
      "ams",
      `/v1/clients?last_name=${client.last_name}`,
      ["ams:clients:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const found = body.data.find((c: any) => c.id === client.id);
    expect(found).toBeDefined();
    expect(found.first_name).toBe(client.first_name);
    expect(found.email).toBe(client.email);
  });

  test("Step 2: Get policies — confirm auto, no life", async () => {
    const res = await e2eAuthRequest(
      "ams",
      `/v1/clients/${client.id}/policies`,
      ["ams:policies:read"],
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const policyTypes = body.data.map((p: any) => p.policy_type);
    expect(policyTypes).toContain("personal_auto");
    expect(policyTypes).not.toContain("life");
  });

  test("Step 3: Submit quote request to Rater for personal auto", async () => {
    const res = await e2eAuthRequest("rater", "/v1/quotes/request", ["rater:quotes:create"], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        policy_type: "personal_auto",
        effective_date: "2026-07-01",
        client: {
          first_name: client.first_name,
          last_name: client.last_name,
          address: { state: client.state, city: "Houston", zip: "77004" },
        },
        drivers: [
          {
            name: `${client.first_name} ${client.last_name}`,
            dob: "1990-11-08",
            license_number: "TX-19204837",
            relationship: "self",
            violations: [],
            accidents: [],
          },
        ],
        vehicles: [
          {
            year: 2023,
            make: "Toyota",
            model: "Camry",
            vin: "4T1BF1FK0NU123456",
            usage: "commute",
            annual_miles: 10000,
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
    expect(body.carriers_queried).toBeGreaterThanOrEqual(1);
    requestId = body.request_id;
  });

  test("Step 4: Poll for multi-carrier quote results", async () => {
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

    // Find a quoted (bindable) carrier
    const quoted = body.carriers.find((c: any) => c.status === "quoted");
    expect(quoted).toBeDefined();
    expect(quoted.premium_annual).toBeGreaterThan(0);
    bindableQuoteId = quoted.quote_id;
  });

  test("Step 5: Bind selected quote", async () => {
    const res = await e2eAuthRequest(
      "rater",
      `/v1/quotes/${bindableQuoteId}/bind`,
      ["rater:quotes:bind"],
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_method: "eft",
          producer_id: "prod_44e1bc90",
          insured_signature_collected: true,
          insured_signature_date: "2026-02-20",
        }),
      },
    );
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.policy_id).toBeTruthy();
    expect(body.policy_id).toStartWith("POL-");
    expect(body.bind_status).toBe("bound");
  });
});
