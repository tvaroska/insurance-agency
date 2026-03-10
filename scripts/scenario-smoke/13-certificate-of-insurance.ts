#!/usr/bin/env bun
/**
 * Scenario 13: Certificate of Insurance — Smoke Test
 *
 * Finds an active policy, then generates a COI via
 * POST /v1/documents/coi/generate on the ECM service.
 *
 * Services: AMS (port 3000), ECM (port 3003)
 */

const AMS = "http://localhost:3000";
const ECM = "http://localhost:3003";

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

async function getToken(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&client_id=agent-full&client_secret=dev-secret",
  });
  if (!res.ok) {
    throw new Error(`OAuth token request failed at ${baseUrl}: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.access_token;
}

async function main() {
  console.log("\n=== Scenario 13: Certificate of Insurance ===\n");

  // Step 0: Obtain JWT tokens for both services
  let amsToken: string;
  let ecmToken: string;
  try {
    amsToken = await getToken(AMS);
    report("Obtain AMS JWT token", true);
  } catch (e: any) {
    report("Obtain AMS JWT token", false, e.message);
    process.exit(1);
  }

  try {
    ecmToken = await getToken(ECM);
    report("Obtain ECM JWT token", true);
  } catch (e: any) {
    report("Obtain ECM JWT token", false, e.message);
    process.exit(1);
  }

  const amsHeaders = {
    Authorization: `Bearer ${amsToken}`,
    "Content-Type": "application/json",
  };

  const ecmHeaders = {
    Authorization: `Bearer ${ecmToken}`,
    "Content-Type": "application/json",
  };

  // Step 1: Find a client with an active policy
  const clientsRes = await fetch(`${AMS}/v1/clients?status=active&limit=10`, {
    headers: amsHeaders,
  });
  const clientsBody = await clientsRes.json();

  report(
    "Fetch active clients from AMS",
    clientsRes.status === 200 && Array.isArray(clientsBody.data),
    clientsRes.status !== 200 ? `status=${clientsRes.status}` : undefined,
  );

  let activePolicyId: string | null = null;
  let targetClientId: string | null = null;

  const clients: any[] = clientsBody.data ?? [];
  for (const client of clients) {
    const polRes = await fetch(`${AMS}/v1/clients/${client.id}/policies?status=active`, {
      headers: amsHeaders,
    });
    if (polRes.status !== 200) continue;
    const polBody = await polRes.json();
    const activePolicies: any[] = (polBody.data ?? []).filter(
      (p: any) => p.status === "active",
    );
    if (activePolicies.length > 0) {
      activePolicyId = activePolicies[0].policy_id;
      targetClientId = client.id;
      break;
    }
  }

  report(
    "Found an active policy for COI generation",
    activePolicyId !== null,
    activePolicyId === null ? "no active policies found across clients" : `policy_id=${activePolicyId}`,
  );

  if (!activePolicyId || !targetClientId) {
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(1);
  }

  // Step 2: Generate COI
  const coiPayload = {
    policy_id: activePolicyId,
    certificate_holder: {
      name: "Smoke Test Venue LLC",
      address: {
        street: "789 Venue Blvd",
        city: "Austin",
        state: "TX",
        zip: "78703",
      },
    },
    description: "Smoke test COI generation",
  };

  const coiRes = await fetch(`${ECM}/v1/documents/coi/generate`, {
    method: "POST",
    headers: ecmHeaders,
    body: JSON.stringify(coiPayload),
  });

  const coiBody = await coiRes.json();

  report(
    "Generate COI (POST /v1/documents/coi/generate) returns 201",
    coiRes.status === 201,
    coiRes.status !== 201 ? `status=${coiRes.status} body=${JSON.stringify(coiBody)}` : undefined,
  );

  report(
    "COI response has document_id",
    typeof coiBody.document_id === "string" && coiBody.document_id.length > 0,
    `document_id=${coiBody.document_id}`,
  );

  report(
    "COI response has policy_id matching request",
    coiBody.policy_id === activePolicyId,
    coiBody.policy_id !== activePolicyId ? `policy_id=${coiBody.policy_id}` : undefined,
  );

  report(
    "COI document_type is 'coi'",
    coiBody.document_type === "coi",
    coiBody.document_type !== "coi" ? `document_type=${coiBody.document_type}` : undefined,
  );

  report(
    "COI status is 'generated'",
    coiBody.status === "generated",
    coiBody.status !== "generated" ? `status=${coiBody.status}` : undefined,
  );

  report(
    "COI has certificate_holder with correct name",
    coiBody.certificate_holder?.name === "Smoke Test Venue LLC",
    `certificate_holder=${JSON.stringify(coiBody.certificate_holder)}`,
  );

  report(
    "COI has coverage_summary with policy_type",
    typeof coiBody.coverage_summary?.policy_type === "string",
    `coverage_summary=${JSON.stringify(coiBody.coverage_summary)}`,
  );

  report(
    "COI has coverage_summary with effective_date",
    typeof coiBody.coverage_summary?.effective_date === "string",
    `effective_date=${coiBody.coverage_summary?.effective_date}`,
  );

  report(
    "COI has filename ending in .pdf",
    typeof coiBody.filename === "string" && coiBody.filename.endsWith(".pdf"),
    `filename=${coiBody.filename}`,
  );

  // Summary
  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
