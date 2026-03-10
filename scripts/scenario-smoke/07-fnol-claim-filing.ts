#!/usr/bin/env bun
/**
 * Scenario 07: FNOL Claim Filing — Smoke Test
 *
 * Files a first notice of loss claim, verifies it appears in the system.
 *
 * Services: Claims (port 3007), AMS (port 3000)
 */

const CLAIMS = "http://localhost:3007";
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
  return (await res.json()).access_token;
}

async function main() {
  console.log("\n=== Scenario 07: FNOL Claim Filing ===\n");

  let claimsToken: string, amsToken: string;
  try {
    claimsToken = await getToken(CLAIMS);
    amsToken = await getToken(AMS);
    report("Obtain JWT tokens", true);
  } catch (e: any) {
    report("Obtain JWT tokens", false, e.message);
    process.exit(1);
  }

  const claimsHeaders = { Authorization: `Bearer ${claimsToken}`, "Content-Type": "application/json" };
  const amsHeaders = { Authorization: `Bearer ${amsToken}`, "Content-Type": "application/json" };

  // Step 1: Find a client with a policy
  const policiesRes = await fetch(`${AMS}/v1/policies?status=active&limit=1`, { headers: amsHeaders });
  const policiesBody = await policiesRes.json();
  report("Find active policy", policiesRes.status === 200 && policiesBody.data?.length > 0);

  if (!policiesBody.data?.length) {
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(1);
  }

  const policy = policiesBody.data[0];

  // Step 2: File FNOL claim
  const claimPayload = {
    policy_id: policy.policy_id,
    client_id: policy.client_id,
    loss_date: "2026-03-08",
    loss_type: "collision",
    description: "Smoke test: rear-end collision at intersection",
    estimated_damage: 5000,
  };

  const claimRes = await fetch(`${CLAIMS}/v1/claims`, {
    method: "POST",
    headers: claimsHeaders,
    body: JSON.stringify(claimPayload),
  });
  const claimBody = await claimRes.json();
  report("File FNOL claim", claimRes.status === 201, `status=${claimRes.status}`);

  if (claimBody.claim_id) {
    report("Claim has ID", true, `claim_id=${claimBody.claim_id}`);

    // Step 3: Retrieve claim
    const getRes = await fetch(`${CLAIMS}/v1/claims/${claimBody.claim_id}`, { headers: claimsHeaders });
    report("Retrieve filed claim", getRes.status === 200);
  }

  // Step 4: List claims
  const listRes = await fetch(`${CLAIMS}/v1/claims?limit=5`, { headers: claimsHeaders });
  report("List claims", listRes.status === 200);

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
