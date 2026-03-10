#!/usr/bin/env bun
/**
 * Scenario 14: Lead Qualification — Smoke Test
 *
 * Retrieves leads via GET /v1/leads with filters and
 * checks scoring data is present.
 *
 * Services: CRM (port 3002)
 */

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

async function getToken(): Promise<string> {
  const res = await fetch(`${CRM}/oauth/token`, {
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
  console.log("\n=== Scenario 14: Lead Qualification ===\n");

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

  // Step 1: Get all leads (unfiltered)
  const allLeadsRes = await fetch(`${CRM}/v1/leads?limit=20`, { headers });
  const allLeadsBody = await allLeadsRes.json();

  report(
    "Fetch all leads (GET /v1/leads) returns 200",
    allLeadsRes.status === 200,
    allLeadsRes.status !== 200 ? `status=${allLeadsRes.status}` : undefined,
  );

  report(
    "Response has data array",
    Array.isArray(allLeadsBody.data),
    !Array.isArray(allLeadsBody.data) ? "data is not an array" : undefined,
  );

  const allLeads: any[] = allLeadsBody.data ?? [];
  report(
    "At least one lead exists",
    allLeads.length > 0,
    allLeads.length === 0 ? "no leads returned" : `count=${allLeads.length}`,
  );

  if (allLeads.length > 0) {
    const lead = allLeads[0];

    report(
      "Lead has lead_id",
      typeof lead.lead_id === "string" && lead.lead_id.length > 0,
      `lead_id=${lead.lead_id}`,
    );

    report(
      "Lead has first_name",
      typeof lead.first_name === "string" && lead.first_name.length > 0,
      `first_name=${lead.first_name}`,
    );

    report(
      "Lead has last_name",
      typeof lead.last_name === "string" && lead.last_name.length > 0,
      `last_name=${lead.last_name}`,
    );

    report(
      "Lead has email",
      typeof lead.email === "string" && lead.email.length > 0,
      `email=${lead.email}`,
    );

    report(
      "Lead has score (number 0-100)",
      typeof lead.score === "number" && lead.score >= 0 && lead.score <= 100,
      `score=${lead.score}`,
    );

    report(
      "Lead has status",
      typeof lead.status === "string" && lead.status.length > 0,
      `status=${lead.status}`,
    );

    report(
      "Lead has source",
      typeof lead.source === "string" && lead.source.length > 0,
      `source=${lead.source}`,
    );
  }

  // Step 2: Filter leads by status=qualified
  const qualifiedRes = await fetch(`${CRM}/v1/leads?status=qualified`, { headers });
  const qualifiedBody = await qualifiedRes.json();

  report(
    "Filter by status=qualified returns 200",
    qualifiedRes.status === 200,
    qualifiedRes.status !== 200 ? `status=${qualifiedRes.status}` : undefined,
  );

  const qualifiedLeads: any[] = qualifiedBody.data ?? [];
  const allQualified = qualifiedLeads.every((l: any) => l.status === "qualified");

  report(
    "All filtered leads have status=qualified",
    qualifiedLeads.length === 0 || allQualified,
    !allQualified ? "some leads have wrong status" : `count=${qualifiedLeads.length}`,
  );

  // Step 3: Filter leads by source=referral
  const referralRes = await fetch(`${CRM}/v1/leads?source=referral`, { headers });
  const referralBody = await referralRes.json();

  report(
    "Filter by source=referral returns 200",
    referralRes.status === 200,
    referralRes.status !== 200 ? `status=${referralRes.status}` : undefined,
  );

  const referralLeads: any[] = referralBody.data ?? [];
  const allReferral = referralLeads.every((l: any) => l.source === "referral");

  report(
    "All filtered leads have source=referral",
    referralLeads.length === 0 || allReferral,
    !allReferral ? "some leads have wrong source" : `count=${referralLeads.length}`,
  );

  // Step 4: Filter leads by min_score
  const highScoreRes = await fetch(`${CRM}/v1/leads?min_score=70`, { headers });
  const highScoreBody = await highScoreRes.json();

  report(
    "Filter by min_score=70 returns 200",
    highScoreRes.status === 200,
    highScoreRes.status !== 200 ? `status=${highScoreRes.status}` : undefined,
  );

  const highScoreLeads: any[] = highScoreBody.data ?? [];
  const allHighScore = highScoreLeads.every((l: any) => typeof l.score === "number" && l.score >= 70);

  report(
    "All filtered leads have score >= 70",
    highScoreLeads.length === 0 || allHighScore,
    !allHighScore ? "some leads have score < 70" : `count=${highScoreLeads.length}`,
  );

  // Summary
  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
