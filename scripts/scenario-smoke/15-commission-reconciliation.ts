#!/usr/bin/env bun
/**
 * Scenario 15: Commission Reconciliation — Smoke Test
 *
 * Retrieves commissions via GET /v1/accounting/commissions
 * with date range and carrier filters.
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
  console.log("\n=== Scenario 15: Commission Reconciliation ===\n");

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

  // Step 1: Fetch all commissions (unfiltered)
  const allRes = await fetch(`${AMS}/v1/accounting/commissions?limit=20`, { headers });
  const allBody = await allRes.json();

  report(
    "Fetch commissions (GET /v1/accounting/commissions) returns 200",
    allRes.status === 200,
    allRes.status !== 200 ? `status=${allRes.status}` : undefined,
  );

  report(
    "Response has data array",
    Array.isArray(allBody.data),
    !Array.isArray(allBody.data) ? "data is not an array" : undefined,
  );

  const allCommissions: any[] = allBody.data ?? [];
  report(
    "At least one commission record exists",
    allCommissions.length > 0,
    allCommissions.length === 0 ? "no commissions returned" : `count=${allCommissions.length}`,
  );

  if (allCommissions.length > 0) {
    const comm = allCommissions[0];

    report(
      "Commission has commission_id",
      typeof comm.commission_id === "string" && comm.commission_id.length > 0,
      `commission_id=${comm.commission_id}`,
    );

    report(
      "Commission has policy_id",
      typeof comm.policy_id === "string" && comm.policy_id.length > 0,
      `policy_id=${comm.policy_id}`,
    );

    report(
      "Commission has carrier_code",
      typeof comm.carrier_code === "string" && comm.carrier_code.length > 0,
      `carrier_code=${comm.carrier_code}`,
    );

    report(
      "Commission has gross_amount (number)",
      typeof comm.gross_amount === "number",
      `gross_amount=${comm.gross_amount}`,
    );

    report(
      "Commission has net_amount (number)",
      typeof comm.net_amount === "number",
      `net_amount=${comm.net_amount}`,
    );

    report(
      "Commission has commission_rate (number)",
      typeof comm.commission_rate === "number",
      `commission_rate=${comm.commission_rate}`,
    );

    report(
      "Commission has effective_date",
      typeof comm.effective_date === "string" && comm.effective_date.length > 0,
      `effective_date=${comm.effective_date}`,
    );

    report(
      "Commission has status",
      typeof comm.status === "string" && comm.status.length > 0,
      `status=${comm.status}`,
    );

    report(
      "Commission has transaction_type",
      typeof comm.transaction_type === "string" && comm.transaction_type.length > 0,
      `transaction_type=${comm.transaction_type}`,
    );
  }

  // Step 2: Filter by carrier_code=SMIT
  const smitRes = await fetch(`${AMS}/v1/accounting/commissions?carrier_code=SMIT`, { headers });
  const smitBody = await smitRes.json();

  report(
    "Filter by carrier_code=SMIT returns 200",
    smitRes.status === 200,
    smitRes.status !== 200 ? `status=${smitRes.status}` : undefined,
  );

  const smitCommissions: any[] = smitBody.data ?? [];
  const allSmit = smitCommissions.every((c: any) => c.carrier_code === "SMIT");

  report(
    "All filtered commissions have carrier_code=SMIT",
    smitCommissions.length === 0 || allSmit,
    !allSmit ? "some commissions have wrong carrier_code" : `count=${smitCommissions.length}`,
  );

  // Step 3: Filter by date range (last quarter)
  const now = new Date();
  const quarterEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const quarterStart = new Date(quarterEnd);
  quarterStart.setMonth(quarterStart.getMonth() - 3);

  const dateFrom = quarterStart.toISOString().split("T")[0];
  const dateTo = quarterEnd.toISOString().split("T")[0];

  const dateRes = await fetch(
    `${AMS}/v1/accounting/commissions?effective_date_from=${dateFrom}&effective_date_to=${dateTo}`,
    { headers },
  );
  const dateBody = await dateRes.json();

  report(
    `Filter by date range (${dateFrom} to ${dateTo}) returns 200`,
    dateRes.status === 200,
    dateRes.status !== 200 ? `status=${dateRes.status}` : undefined,
  );

  report(
    "Date-filtered response has data array",
    Array.isArray(dateBody.data),
    !Array.isArray(dateBody.data) ? "data is not an array" : undefined,
  );

  const dateCommissions: any[] = dateBody.data ?? [];
  const allInRange = dateCommissions.every((c: any) => {
    return c.effective_date >= dateFrom && c.effective_date <= dateTo;
  });

  report(
    "All date-filtered commissions are within the date range",
    dateCommissions.length === 0 || allInRange,
    !allInRange ? "some commissions are outside the date range" : `count=${dateCommissions.length}`,
  );

  // Step 4: Combined filter — carrier + date range
  const combinedRes = await fetch(
    `${AMS}/v1/accounting/commissions?carrier_code=SMIT&effective_date_from=${dateFrom}&effective_date_to=${dateTo}`,
    { headers },
  );
  const combinedBody = await combinedRes.json();

  report(
    "Combined filter (SMIT + date range) returns 200",
    combinedRes.status === 200,
    combinedRes.status !== 200 ? `status=${combinedRes.status}` : undefined,
  );

  const combinedCommissions: any[] = combinedBody.data ?? [];
  const allCombinedMatch = combinedCommissions.every(
    (c: any) => c.carrier_code === "SMIT" && c.effective_date >= dateFrom && c.effective_date <= dateTo,
  );

  report(
    "Combined filter results match both criteria",
    combinedCommissions.length === 0 || allCombinedMatch,
    !allCombinedMatch ? "some commissions do not match combined filter" : `count=${combinedCommissions.length}`,
  );

  // Summary
  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
