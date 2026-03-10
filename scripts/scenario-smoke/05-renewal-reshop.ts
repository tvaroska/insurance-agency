#!/usr/bin/env bun
/**
 * Scenario 05: Renewal Re-Shop — Smoke Test
 *
 * Pulls an expiring policy from AMS, submits a re-shop quote to Rater,
 * and retrieves results for comparison.
 *
 * Services: AMS (port 3000), Rater (port 3001)
 */

const AMS = "http://localhost:3000";
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

async function getToken(base: string): Promise<string> {
  const res = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&client_id=agent-full&client_secret=dev-secret",
  });
  if (!res.ok) throw new Error(`OAuth failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function main() {
  console.log("\n=== Scenario 05: Renewal Re-Shop ===\n");

  let amsToken: string, raterToken: string;
  try {
    amsToken = await getToken(AMS);
    raterToken = await getToken(RATER);
    report("Obtain JWT tokens", true);
  } catch (e: any) {
    report("Obtain JWT tokens", false, e.message);
    process.exit(1);
  }

  const amsHeaders = { Authorization: `Bearer ${amsToken}`, "Content-Type": "application/json" };
  const raterHeaders = { Authorization: `Bearer ${raterToken}`, "Content-Type": "application/json" };

  // Step 1: Get policies expiring soon
  const policiesRes = await fetch(`${AMS}/v1/policies?status=active&limit=5`, { headers: amsHeaders });
  const policiesBody = await policiesRes.json();
  report("List active policies", policiesRes.status === 200, `status=${policiesRes.status}`);

  if (!policiesBody.data?.length) {
    report("Found policies for reshop", false, "No active policies");
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(1);
  }

  const policy = policiesBody.data[0];
  report("Found policy for reshop", true, `${policy.policy_id} — ${policy.policy_type}`);

  // Step 2: Get client details
  const clientRes = await fetch(`${AMS}/v1/clients/${policy.client_id}`, { headers: amsHeaders });
  const clientBody = await clientRes.json();
  report("Get client details", clientRes.status === 200, `status=${clientRes.status}`);

  // Step 3: Submit reshop quote
  const quotePayload = {
    policy_type: policy.policy_type || "personal_auto",
    effective_date: policy.expiration_date || "2026-07-01",
    client: {
      first_name: clientBody.first_name || "Test",
      last_name: clientBody.last_name || "Client",
      address: clientBody.address || { street: "123 Main", city: "Chicago", state: "IL", zip: "60601" },
    },
    drivers: [{ first_name: clientBody.first_name || "Test", last_name: clientBody.last_name || "Client", date_of_birth: "1985-01-01", license_number: "TEST123", license_state: clientBody.address?.state || "IL" }],
    vehicles: [{ vin: "1HGBH41JXMN109186", year: 2023, make: "Honda", model: "Civic", usage: "commute" }],
    requested_coverages: [{ coverage_type: "bodily_injury", per_person_limit: 100000, per_occurrence_limit: 300000 }],
  };

  const quoteRes = await fetch(`${RATER}/v1/quotes/request`, {
    method: "POST",
    headers: raterHeaders,
    body: JSON.stringify(quotePayload),
  });
  const quoteBody = await quoteRes.json();
  report("Submit reshop quote", quoteRes.status === 202, `status=${quoteRes.status}`);

  // Step 4: Get results
  if (quoteBody.request_id) {
    const resultsRes = await fetch(`${RATER}/v1/quotes/${quoteBody.request_id}/results`, { headers: raterHeaders });
    const resultsBody = await resultsRes.json();
    report("Get reshop results", resultsRes.status === 200, `status=${resultsRes.status}`);
    report("Has carrier quotes", resultsBody.carriers?.length > 0, `carriers=${resultsBody.carriers?.length}`);
  }

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
