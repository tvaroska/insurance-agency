#!/usr/bin/env bun
/**
 * Scenario 12: Policy Status Inquiry — Smoke Test
 *
 * Retrieves policies via GET /v1/clients/{id}/policies with filters,
 * verifying response structure and data.
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
  if (!res.ok) {
    throw new Error(`OAuth token request failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.access_token;
}

async function main() {
  console.log("\n=== Scenario 12: Policy Status Inquiry ===\n");

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

  // Step 1: Search for a known client to find one with policies
  const searchRes = await fetch(`${AMS}/v1/clients?status=active&limit=5`, { headers });
  const searchBody = await searchRes.json();

  report(
    "Search for active clients (GET /v1/clients?status=active)",
    searchRes.status === 200,
    searchRes.status !== 200 ? `status=${searchRes.status}` : undefined,
  );

  report(
    "Response has data array",
    Array.isArray(searchBody.data),
    !Array.isArray(searchBody.data) ? "data is not an array" : undefined,
  );

  const clientList: any[] = searchBody.data ?? [];
  report(
    "At least one active client found",
    clientList.length > 0,
    clientList.length === 0 ? "no clients returned" : undefined,
  );

  if (clientList.length === 0) {
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(1);
  }

  // Step 2: Get policies for the first active client
  const clientId = clientList[0].id;

  const policiesRes = await fetch(`${AMS}/v1/clients/${clientId}/policies`, { headers });
  const policiesBody = await policiesRes.json();

  report(
    `Retrieve policies (GET /v1/clients/${clientId}/policies) returns 200`,
    policiesRes.status === 200,
    policiesRes.status !== 200 ? `status=${policiesRes.status}` : undefined,
  );

  report(
    "Response has data array",
    Array.isArray(policiesBody.data),
    !Array.isArray(policiesBody.data) ? "data is not an array" : undefined,
  );

  const policyList: any[] = policiesBody.data ?? [];

  if (policyList.length > 0) {
    const policy = policyList[0];

    report(
      "Policy has policy_id",
      typeof policy.policy_id === "string" && policy.policy_id.length > 0,
      `policy_id=${policy.policy_id}`,
    );

    report(
      "Policy has policy_type",
      typeof policy.policy_type === "string" && policy.policy_type.length > 0,
      `policy_type=${policy.policy_type}`,
    );

    report(
      "Policy has carrier_code",
      typeof policy.carrier_code === "string" && policy.carrier_code.length > 0,
      `carrier_code=${policy.carrier_code}`,
    );

    report(
      "Policy has effective_date",
      typeof policy.effective_date === "string" && policy.effective_date.length > 0,
      `effective_date=${policy.effective_date}`,
    );

    report(
      "Policy has expiration_date",
      typeof policy.expiration_date === "string" && policy.expiration_date.length > 0,
      `expiration_date=${policy.expiration_date}`,
    );

    report(
      "Policy has status",
      typeof policy.status === "string" && policy.status.length > 0,
      `status=${policy.status}`,
    );

    report(
      "Policy has premium_current",
      typeof policy.premium_current === "number",
      `premium_current=${policy.premium_current}`,
    );

    report(
      "Policy has coverages array",
      Array.isArray(policy.coverages),
      !Array.isArray(policy.coverages) ? "coverages is not an array" : undefined,
    );

    // Step 3: Filter by policy_type
    const policyType = policy.policy_type;
    const filteredRes = await fetch(
      `${AMS}/v1/clients/${clientId}/policies?policy_type=${policyType}`,
      { headers },
    );
    const filteredBody = await filteredRes.json();

    report(
      `Filter by policy_type=${policyType} returns 200`,
      filteredRes.status === 200,
      filteredRes.status !== 200 ? `status=${filteredRes.status}` : undefined,
    );

    const filteredPolicies: any[] = filteredBody.data ?? [];
    const allMatchType = filteredPolicies.every((p: any) => p.policy_type === policyType);

    report(
      "All filtered policies match the requested policy_type",
      allMatchType,
      !allMatchType ? "some policies have wrong policy_type" : undefined,
    );
  } else {
    report("Client has policies (data available for validation)", false, "no policies returned");
  }

  // Summary
  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
