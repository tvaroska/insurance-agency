#!/usr/bin/env bun
/**
 * Scenario 11: Client Meeting Prep — Smoke Test
 *
 * Gathers all information about a client: policies, claims, tasks.
 *
 * Services: AMS (port 3000), Claims (port 3007)
 */

const AMS = "http://localhost:3000";
const CLAIMS = "http://localhost:3007";

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
  console.log("\n=== Scenario 11: Client Meeting Prep ===\n");

  let amsToken: string, claimsToken: string;
  try {
    amsToken = await getToken(AMS);
    claimsToken = await getToken(CLAIMS);
    report("Obtain JWT tokens", true);
  } catch (e: any) {
    report("Obtain JWT tokens", false, e.message);
    process.exit(1);
  }

  const amsHeaders = { Authorization: `Bearer ${amsToken}`, "Content-Type": "application/json" };
  const claimsHeaders = { Authorization: `Bearer ${claimsToken}`, "Content-Type": "application/json" };

  // Step 1: Find client
  const clientsRes = await fetch(`${AMS}/v1/clients?limit=1`, { headers: amsHeaders });
  const clientsBody = await clientsRes.json();
  report("Find client", clientsRes.status === 200 && clientsBody.data?.length > 0);

  if (!clientsBody.data?.length) {
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(1);
  }

  const client = clientsBody.data[0];
  const clientId = client.id;

  // Step 2: Get full client profile
  const profileRes = await fetch(`${AMS}/v1/clients/${clientId}`, { headers: amsHeaders });
  report("Get client profile", profileRes.status === 200);

  // Step 3: Get all policies
  const policiesRes = await fetch(`${AMS}/v1/policies?client_id=${clientId}`, { headers: amsHeaders });
  const policiesBody = await policiesRes.json();
  report("Get client policies", policiesRes.status === 200, `count=${policiesBody.data?.length}`);

  // Step 4: Get tasks related to client
  const tasksRes = await fetch(`${AMS}/v1/tasks?client_id=${clientId}`, { headers: amsHeaders });
  report("Get client tasks", tasksRes.status === 200);

  // Step 5: Check claims
  const claimsRes = await fetch(`${CLAIMS}/v1/claims?client_id=${clientId}&limit=10`, { headers: claimsHeaders });
  report("Get client claims", claimsRes.status === 200);

  // Step 6: Check escalations
  const escRes = await fetch(`${AMS}/v1/escalations?client_id=${clientId}`, { headers: amsHeaders });
  report("Get client escalations", escRes.status === 200);

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
