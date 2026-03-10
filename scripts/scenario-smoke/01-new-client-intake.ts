#!/usr/bin/env bun
/**
 * Scenario 01: New Client Intake — Smoke Test
 *
 * Creates a new client via POST /v1/clients, then verifies
 * the client appears in GET /v1/clients/{id}.
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
  console.log("\n=== Scenario 01: New Client Intake ===\n");

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

  const uniqueEmail = `smoke-01-${Date.now()}@example.com`;

  // Step 1: Check for duplicates — search by last name
  const searchRes = await fetch(`${AMS}/v1/clients?last_name=SmokeTestIntake`, { headers });
  report(
    "Search AMS for duplicates (GET /v1/clients?last_name=SmokeTestIntake)",
    searchRes.status === 200,
    searchRes.status !== 200 ? `status=${searchRes.status}` : undefined,
  );

  // Step 2: Create client record
  const createPayload = {
    first_name: "SmokeTest",
    last_name: "SmokeTestIntake",
    email: uniqueEmail,
    phone: "512-555-0199",
    dob: "1990-06-15",
    occupation: "Engineer",
    preferred_contact_method: "email",
    address: {
      street: "123 Smoke Test Ln",
      city: "Austin",
      state: "TX",
      zip: "78701",
    },
  };

  const createRes = await fetch(`${AMS}/v1/clients`, {
    method: "POST",
    headers,
    body: JSON.stringify(createPayload),
  });

  const createBody = await createRes.json();
  const clientId: string | undefined = createBody.id;

  report(
    "Create client (POST /v1/clients) returns 201",
    createRes.status === 201,
    createRes.status !== 201 ? `status=${createRes.status} body=${JSON.stringify(createBody)}` : undefined,
  );

  report(
    "Created client has an id",
    typeof clientId === "string" && clientId.length > 0,
    !clientId ? "id is missing" : undefined,
  );

  report(
    "Created client has correct first_name",
    createBody.first_name === "SmokeTest",
    createBody.first_name !== "SmokeTest" ? `first_name=${createBody.first_name}` : undefined,
  );

  report(
    "Created client has correct last_name",
    createBody.last_name === "SmokeTestIntake",
    createBody.last_name !== "SmokeTestIntake" ? `last_name=${createBody.last_name}` : undefined,
  );

  report(
    "Created client has correct email",
    createBody.email === uniqueEmail,
    createBody.email !== uniqueEmail ? `email=${createBody.email}` : undefined,
  );

  // Step 3: Verify client appears in GET /v1/clients/{id}
  if (clientId) {
    const getRes = await fetch(`${AMS}/v1/clients/${clientId}`, { headers });
    const getBody = await getRes.json();

    report(
      `Retrieve client (GET /v1/clients/${clientId}) returns 200`,
      getRes.status === 200,
      getRes.status !== 200 ? `status=${getRes.status}` : undefined,
    );

    report(
      "Retrieved client id matches created client",
      getBody.id === clientId,
      getBody.id !== clientId ? `id=${getBody.id}` : undefined,
    );

    report(
      "Retrieved client email matches",
      getBody.email === uniqueEmail,
      getBody.email !== uniqueEmail ? `email=${getBody.email}` : undefined,
    );

    report(
      "Retrieved client address is populated",
      getBody.address?.city === "Austin" && getBody.address?.state === "TX",
      `address=${JSON.stringify(getBody.address)}`,
    );
  } else {
    report("Retrieve client (skipped — no client ID)", false, "No client ID from creation");
  }

  // Summary
  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
