#!/usr/bin/env bun
/**
 * Scenario 03: Policy Binding E2E — Smoke Test
 *
 * Tests the full bind flow including E&O guard:
 *   1. Submit a quote request
 *   2. Get results, pick a quote
 *   3. Attempt bind on high-premium quote → expect 409 with eo_rules
 *   4. Create an escalation in AMS
 *   5. Poll escalation twice to resolve
 *   6. Bind with approved escalation_id → expect 201
 *
 * Services: Rater (port 3001), AMS (port 3000)
 */

const RATER = "http://localhost:3001";
const AMS = "http://localhost:3000";

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

async function getToken(base: string): Promise<string> {
  const res = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&client_id=agent-full&client_secret=dev-secret",
  });
  if (!res.ok) throw new Error(`OAuth failed: ${res.status}`);
  const body = await res.json();
  return body.access_token;
}

async function main() {
  console.log("\n=== Scenario 03: Policy Binding E2E ===\n");

  let raterToken: string;
  let amsToken: string;
  try {
    raterToken = await getToken(RATER);
    amsToken = await getToken(AMS);
    report("Obtain JWT tokens", true);
  } catch (e: any) {
    report("Obtain JWT tokens", false, e.message);
    process.exit(1);
  }

  const raterHeaders = { Authorization: `Bearer ${raterToken}`, "Content-Type": "application/json" };
  const amsHeaders = { Authorization: `Bearer ${amsToken}`, "Content-Type": "application/json" };

  // Step 1: Submit quote request
  const quotePayload = {
    policy_type: "personal_auto",
    effective_date: "2026-06-01",
    client: {
      first_name: "Smoke",
      last_name: "BindTest",
      address: { street: "100 Test Blvd", city: "Chicago", state: "IL", zip: "60601" },
    },
    drivers: [{ first_name: "Smoke", last_name: "BindTest", date_of_birth: "1985-01-15", license_number: "S123456", license_state: "IL" }],
    vehicles: [{ vin: "1HGBH41JXMN109186", year: 2023, make: "Honda", model: "Civic", usage: "commute" }],
    requested_coverages: [{ coverage_type: "bodily_injury", per_person_limit: 100000, per_occurrence_limit: 300000 }],
  };

  const quoteRes = await fetch(`${RATER}/v1/quotes/request`, {
    method: "POST",
    headers: raterHeaders,
    body: JSON.stringify(quotePayload),
  });
  const quoteBody = await quoteRes.json();
  report("Submit quote request (POST /v1/quotes/request)", quoteRes.status === 202, `status=${quoteRes.status}`);

  // Step 2: Get results
  const resultsRes = await fetch(`${RATER}/v1/quotes/${quoteBody.request_id}/results`, { headers: raterHeaders });
  const resultsBody = await resultsRes.json();
  report("Get quote results", resultsRes.status === 200 && resultsBody.carriers?.length > 0, `carriers=${resultsBody.carriers?.length}`);

  const quotedCarrier = resultsBody.carriers?.find((c: any) => c.status === "quoted");
  if (!quotedCarrier) {
    report("Find a quoted carrier", false, "No quoted carriers found");
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(1);
  }
  report("Find a quoted carrier", true);

  // Step 3: Normal bind (should work if premium <= $10K)
  const bindPayload = {
    payment_method: "eft",
    producer_id: "PROD-001",
    insured_signature_collected: true,
    insured_signature_date: "2026-03-10",
  };

  const bindRes = await fetch(`${RATER}/v1/quotes/${quotedCarrier.quote_id}/bind`, {
    method: "POST",
    headers: raterHeaders,
    body: JSON.stringify(bindPayload),
  });
  const bindBody = await bindRes.json();

  if (bindRes.status === 201) {
    report("Bind quote (normal premium path)", true);
    report("Bind response has policy_id", !!bindBody.policy_id);
  } else if (bindRes.status === 409 && bindBody.eo_rules) {
    report("Bind triggers E&O guard (high premium)", true);

    // Step 4: Create escalation
    const escPayload = {
      client_id: "CL-smoke-03",
      reason: "premium_threshold",
      summary: `Premium of $${quotedCarrier.premium_annual} exceeds threshold`,
      context: { quote_id: quotedCarrier.quote_id, premium: quotedCarrier.premium_annual },
    };

    const escRes = await fetch(`${AMS}/v1/escalations`, {
      method: "POST",
      headers: amsHeaders,
      body: JSON.stringify(escPayload),
    });
    const escBody = await escRes.json();
    report("Create escalation (POST /v1/escalations)", escRes.status === 201, `status=${escRes.status}`);

    // Step 5: Poll escalation twice
    const poll1Res = await fetch(`${AMS}/v1/escalations/${escBody.escalation_id}`, { headers: amsHeaders });
    const poll1Body = await poll1Res.json();
    report("First poll — still pending", poll1Body.status === "pending", `status=${poll1Body.status}`);

    const poll2Res = await fetch(`${AMS}/v1/escalations/${escBody.escalation_id}`, { headers: amsHeaders });
    const poll2Body = await poll2Res.json();
    report("Second poll — resolved", poll2Body.status !== "pending", `status=${poll2Body.status}`);

    if (poll2Body.status === "approved") {
      // Step 6: Bind with escalation_id
      const bindWithEscRes = await fetch(`${RATER}/v1/quotes/${quotedCarrier.quote_id}/bind`, {
        method: "POST",
        headers: raterHeaders,
        body: JSON.stringify({ ...bindPayload, escalation_id: escBody.escalation_id }),
      });
      const bindWithEscBody = await bindWithEscRes.json();
      report("Bind with approved escalation", bindWithEscRes.status === 201, `status=${bindWithEscRes.status}`);
      report("Bind response has policy_id", !!bindWithEscBody.policy_id);
    } else {
      report("Escalation approved for bind", false, `status=${poll2Body.status} (expected approved)`);
    }
  } else {
    report("Bind quote (unexpected response)", false, `status=${bindRes.status} body=${JSON.stringify(bindBody)}`);
  }

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
