#!/usr/bin/env bun
/**
 * Scenario 02: Multi-Carrier Quote Comparison — Smoke Test
 *
 * Submits a quote request via POST /v1/quotes/request,
 * then verifies results appear via GET /v1/quotes/{request_id}/results.
 *
 * Services: Rater (port 3001)
 */

const RATER = "http://localhost:3001";

let passed = 0;
let failed = 0;

function report(step: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${step}`);
  } else {
    failed++;
    console.log(`  FAIL  ${step}${detail ? ` — ${detail}` : ""}`);
  }
}

async function getToken(): Promise<string> {
  const res = await fetch(`${RATER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&client_id=agent-full&client_secret=dev-secret",
  });
  if (!res.ok) {
    throw new Error(`OAuth token request failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.access_token;
}

async function main() {
  console.log("\n=== Scenario 02: Multi-Carrier Quote Comparison ===\n");

  // Step 0: Obtain JWT
  let token: string;
  try {
    token = await getToken();
    report("Obtain JWT token", true);
  } catch (e: any) {
    report("Obtain JWT token", false, e.message);
    process.exit(1);
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  // Step 1: Submit quote request
  const quotePayload = {
    policy_type: "personal_auto",
    effective_date: "2026-04-01",
    client: {
      first_name: "Marcus",
      last_name: "Williams",
      dob: "1983-05-22",
      address: {
        street: "456 Oak Ave",
        city: "Austin",
        state: "TX",
        zip: "78702",
      },
    },
    drivers: [
      {
        first_name: "Marcus",
        last_name: "Williams",
        dob: "1983-05-22",
        license_number: "TX12345678",
        license_state: "TX",
      },
    ],
    vehicles: [
      {
        year: 2022,
        make: "Toyota",
        model: "Camry",
        vin: "1HGCG5655WA041390",
      },
    ],
    requested_coverages: [
      { type: "liability", limit: "100/300/100" },
      { type: "collision", deductible: 500 },
      { type: "comprehensive", deductible: 250 },
    ],
  };

  const submitRes = await fetch(`${RATER}/v1/quotes/request`, {
    method: "POST",
    headers,
    body: JSON.stringify(quotePayload),
  });

  const submitBody = await submitRes.json();

  report(
    "Submit quote request (POST /v1/quotes/request) returns 202",
    submitRes.status === 202,
    submitRes.status !== 202 ? `status=${submitRes.status} body=${JSON.stringify(submitBody)}` : undefined,
  );

  const requestId: string | undefined = submitBody.request_id;

  report(
    "Response contains request_id",
    typeof requestId === "string" && requestId.length > 0,
    !requestId ? `request_id missing` : undefined,
  );

  report(
    "Response contains carriers_queried count",
    typeof submitBody.carriers_queried === "number",
    typeof submitBody.carriers_queried !== "number" ? `carriers_queried=${submitBody.carriers_queried}` : undefined,
  );

  report(
    "At least one carrier was queried",
    submitBody.carriers_queried > 0,
    submitBody.carriers_queried <= 0 ? `carriers_queried=${submitBody.carriers_queried}` : undefined,
  );

  // Step 2: Retrieve quote results
  if (requestId) {
    const resultsRes = await fetch(`${RATER}/v1/quotes/${requestId}/results`, { headers });
    const resultsBody = await resultsRes.json();

    report(
      `Retrieve results (GET /v1/quotes/${requestId}/results) returns 200`,
      resultsRes.status === 200,
      resultsRes.status !== 200 ? `status=${resultsRes.status}` : undefined,
    );

    report(
      "Results contain request_id matching submission",
      resultsBody.request_id === requestId,
      resultsBody.request_id !== requestId ? `request_id=${resultsBody.request_id}` : undefined,
    );

    report(
      "Results contain carriers array",
      Array.isArray(resultsBody.carriers),
      !Array.isArray(resultsBody.carriers) ? "carriers is not an array" : undefined,
    );

    report(
      "At least one carrier quote returned",
      Array.isArray(resultsBody.carriers) && resultsBody.carriers.length > 0,
      Array.isArray(resultsBody.carriers) ? `count=${resultsBody.carriers.length}` : undefined,
    );

    if (Array.isArray(resultsBody.carriers) && resultsBody.carriers.length > 0) {
      const first = resultsBody.carriers[0];

      report(
        "Carrier quote has carrier_code",
        typeof first.carrier_code === "string" && first.carrier_code.length > 0,
        `carrier_code=${first.carrier_code}`,
      );

      report(
        "Carrier quote has premium_annual",
        typeof first.premium_annual === "number" && first.premium_annual > 0,
        `premium_annual=${first.premium_annual}`,
      );

      report(
        "Carrier quote has status",
        typeof first.status === "string",
        `status=${first.status}`,
      );
    }
  } else {
    report("Retrieve results (skipped — no request_id)", false, "No request_id from submission");
  }

  // Summary
  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
