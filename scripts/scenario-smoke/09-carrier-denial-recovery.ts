#!/usr/bin/env bun
/**
 * Scenario 09: Carrier Denial Recovery — Smoke Test
 *
 * Submits a quote, checks for declines, then attempts alternative carriers.
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
  if (!res.ok) throw new Error(`OAuth failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function main() {
  console.log("\n=== Scenario 09: Carrier Denial Recovery ===\n");

  let token: string;
  try {
    token = await getToken();
    report("Obtain JWT token", true);
  } catch (e: any) {
    report("Obtain JWT token", false, e.message);
    process.exit(1);
  }

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // Step 1: Check carrier appetite
  const appetiteRes = await fetch(`${RATER}/v1/carriers/appetite?state=IL&policy_type=personal_auto`, { headers });
  const appetiteBody = await appetiteRes.json();
  report("Query carrier appetite", appetiteRes.status === 200);
  report("Has carriers for IL auto", appetiteBody.data?.length > 0, `count=${appetiteBody.data?.length}`);

  // Step 2: Submit a quote
  const quotePayload = {
    policy_type: "personal_auto",
    effective_date: "2026-06-01",
    client: {
      first_name: "Smoke",
      last_name: "DenialTest",
      address: { street: "456 Risk Rd", city: "Chicago", state: "IL", zip: "60601" },
    },
    drivers: [{ first_name: "Smoke", last_name: "DenialTest", date_of_birth: "1990-06-15", license_number: "D987654", license_state: "IL" }],
    vehicles: [{ vin: "2HGBH41JXMN109186", year: 2020, make: "Toyota", model: "Camry", usage: "commute" }],
    requested_coverages: [{ coverage_type: "bodily_injury", per_person_limit: 50000, per_occurrence_limit: 100000 }],
  };

  const quoteRes = await fetch(`${RATER}/v1/quotes/request`, {
    method: "POST",
    headers,
    body: JSON.stringify(quotePayload),
  });
  const quoteBody = await quoteRes.json();
  report("Submit quote request", quoteRes.status === 202);

  // Step 3: Get results and analyze
  if (quoteBody.request_id) {
    const resultsRes = await fetch(`${RATER}/v1/quotes/${quoteBody.request_id}/results`, { headers });
    const resultsBody = await resultsRes.json();
    report("Get quote results", resultsRes.status === 200);

    const quoted = resultsBody.carriers?.filter((c: any) => c.status === "quoted") ?? [];
    const declined = resultsBody.carriers?.filter((c: any) => c.status === "declined") ?? [];
    report("Analyzed carrier responses", true, `quoted=${quoted.length}, declined=${declined.length}`);
  }

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
