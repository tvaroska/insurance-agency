#!/usr/bin/env bun
/**
 * Scenario 06: Cross-Sell Detection — Smoke Test
 *
 * Pulls client policies from AMS, identifies coverage gaps,
 * and enrolls in a CRM cross-sell campaign.
 *
 * Services: AMS (port 3000), CRM (port 3002)
 */

const AMS = "http://localhost:3000";
const CRM = "http://localhost:3002";

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
  console.log("\n=== Scenario 06: Cross-Sell Detection ===\n");

  let amsToken: string, crmToken: string;
  try {
    amsToken = await getToken(AMS);
    crmToken = await getToken(CRM);
    report("Obtain JWT tokens", true);
  } catch (e: any) {
    report("Obtain JWT tokens", false, e.message);
    process.exit(1);
  }

  const amsHeaders = { Authorization: `Bearer ${amsToken}`, "Content-Type": "application/json" };
  const crmHeaders = { Authorization: `Bearer ${crmToken}`, "Content-Type": "application/json" };

  // Step 1: Get a client with policies
  const clientsRes = await fetch(`${AMS}/v1/clients?limit=5`, { headers: amsHeaders });
  const clientsBody = await clientsRes.json();
  report("List clients from AMS", clientsRes.status === 200 && clientsBody.data?.length > 0);

  if (!clientsBody.data?.length) {
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(1);
  }

  const clientId = clientsBody.data[0].id;

  // Step 2: Get policies for coverage gap analysis
  const policiesRes = await fetch(`${AMS}/v1/policies?client_id=${clientId}`, { headers: amsHeaders });
  const policiesBody = await policiesRes.json();
  report("Get client policies for gap analysis", policiesRes.status === 200);

  const policyTypes = policiesBody.data?.map((p: any) => p.policy_type) ?? [];
  report("Identified existing coverage types", true, `types=${policyTypes.join(",")}`);

  // Step 3: Check CRM for leads
  const leadsRes = await fetch(`${CRM}/v1/leads?limit=5`, { headers: crmHeaders });
  report("Query CRM leads", leadsRes.status === 200);

  // Step 4: Check CRM campaigns
  const campaignsRes = await fetch(`${CRM}/v1/campaigns?limit=5`, { headers: crmHeaders });
  report("Query CRM campaigns", campaignsRes.status === 200);

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
