#!/usr/bin/env bun
/**
 * Scenario 08: E&O Trap Navigation — Smoke Test
 *
 * Creates escalations for different reason codes and verifies the
 * manager engine returns the correct decisions.
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
  const body = await res.json();
  return body.access_token;
}

async function createAndResolve(
  headers: Record<string, string>,
  reason: string,
  summary: string,
  expectedDecision: string,
  label: string,
) {
  // Create
  const createRes = await fetch(`${AMS}/v1/escalations`, {
    method: "POST",
    headers,
    body: JSON.stringify({ client_id: "CL-smoke-08", reason, summary }),
  });
  const createBody = await createRes.json();
  report(`${label}: create escalation`, createRes.status === 201, `status=${createRes.status}`);

  if (createRes.status !== 201) return;

  // Poll 1 — pending
  const poll1 = await fetch(`${AMS}/v1/escalations/${createBody.escalation_id}`, { headers });
  const poll1Body = await poll1.json();
  report(`${label}: first poll is pending`, poll1Body.status === "pending", `status=${poll1Body.status}`);

  // Poll 2 — resolved
  const poll2 = await fetch(`${AMS}/v1/escalations/${createBody.escalation_id}`, { headers });
  const poll2Body = await poll2.json();
  report(`${label}: resolves to '${expectedDecision}'`, poll2Body.status === expectedDecision, `status=${poll2Body.status}`);
  report(`${label}: has manager_response`, poll2Body.manager_response != null);
  report(`${label}: has events audit trail`, poll2Body.events?.length >= 2, `events=${poll2Body.events?.length}`);
}

async function main() {
  console.log("\n=== Scenario 08: E&O Trap Navigation ===\n");

  let token: string;
  try {
    token = await getToken();
    report("Obtain JWT token", true);
  } catch (e: any) {
    report("Obtain JWT token", false, e.message);
    process.exit(1);
  }

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // Test each reason code
  await createAndResolve(headers, "premium_threshold", "Premium is $15,000", "approved", "Premium threshold (approve)");
  await createAndResolve(headers, "state_minimum_violation", "BI below state minimum", "denied", "State minimum violation");
  await createAndResolve(headers, "coverage_adequacy", "Roof inspection needed for old roof", "needs_info", "Coverage adequacy (roof)");
  await createAndResolve(headers, "surplus_lines", "Standard surplus placement", "approved", "Surplus lines (approve)");
  await createAndResolve(headers, "principal_review", "Standard review request", "approved", "Principal review (approve)");
  await createAndResolve(headers, "backdating", "Client wants backdated coverage", "denied", "Backdating");

  // Test listing with filters
  const listRes = await fetch(`${AMS}/v1/escalations?client_id=CL-smoke-08`, { headers });
  const listBody = await listRes.json();
  report("List escalations by client_id", listRes.status === 200 && listBody.data?.length >= 6, `count=${listBody.data?.length}`);

  const deniedRes = await fetch(`${AMS}/v1/escalations?status=denied&client_id=CL-smoke-08`, { headers });
  const deniedBody = await deniedRes.json();
  report("Filter denied escalations", deniedRes.status === 200 && deniedBody.data?.length >= 2, `count=${deniedBody.data?.length}`);

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
