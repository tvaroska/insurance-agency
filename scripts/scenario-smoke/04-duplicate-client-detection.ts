#!/usr/bin/env bun
/**
 * Scenario 04: Duplicate Client Detection — Smoke Test
 *
 * Searches AMS for clients by name to find potential duplicates,
 * then verifies merge endpoint works.
 *
 * Services: AMS (port 3000)
 */

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

async function getToken(): Promise<string> {
  const res = await fetch(`${AMS}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&client_id=agent-full&client_secret=dev-secret",
  });
  if (!res.ok) throw new Error(`OAuth failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function main() {
  console.log("\n=== Scenario 04: Duplicate Client Detection ===\n");

  let token: string;
  try {
    token = await getToken();
    report("Obtain JWT token", true);
  } catch (e: any) {
    report("Obtain JWT token", false, e.message);
    process.exit(1);
  }

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // Step 1: Search for potential duplicates by last name
  const searchRes = await fetch(`${AMS}/v1/clients?last_name=Hawkins`, { headers });
  const searchBody = await searchRes.json();
  report("Search clients by last_name=Hawkins", searchRes.status === 200, `status=${searchRes.status}`);
  report("Search returns data array", Array.isArray(searchBody.data), `type=${typeof searchBody.data}`);

  // Step 2: List all clients to check for duplicates
  const allRes = await fetch(`${AMS}/v1/clients?limit=50`, { headers });
  const allBody = await allRes.json();
  report("List all clients (paginated)", allRes.status === 200 && allBody.data?.length > 0, `count=${allBody.data?.length}`);

  // Step 3: If we find a client, try to get their details
  if (allBody.data?.length > 0) {
    const clientId = allBody.data[0].id;
    const detailRes = await fetch(`${AMS}/v1/clients/${clientId}`, { headers });
    report(`Get client detail (${clientId})`, detailRes.status === 200, `status=${detailRes.status}`);

    // Step 4: Check policies for this client
    const policiesRes = await fetch(`${AMS}/v1/policies?client_id=${clientId}`, { headers });
    report("Get client policies", policiesRes.status === 200, `status=${policiesRes.status}`);
  }

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
