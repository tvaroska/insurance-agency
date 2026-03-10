#!/usr/bin/env bun
/**
 * Scenario 10: Book of Business Audit — Smoke Test
 *
 * Pulls all policies, checks compliance, identifies issues.
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
  console.log("\n=== Scenario 10: Book of Business Audit ===\n");

  let token: string;
  try {
    token = await getToken();
    report("Obtain JWT token", true);
  } catch (e: any) {
    report("Obtain JWT token", false, e.message);
    process.exit(1);
  }

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // Step 1: Pull all active policies (paginated)
  let allPolicies: any[] = [];
  let url = `${AMS}/v1/policies?status=active&limit=25`;
  let pages = 0;

  while (url && pages < 10) {
    const res = await fetch(url, { headers });
    const body = await res.json();
    if (res.status !== 200) break;
    allPolicies.push(...(body.data ?? []));
    if (body.pagination?.has_more && body.pagination?.next_cursor) {
      url = `${AMS}/v1/policies?status=active&limit=25&cursor=${body.pagination.next_cursor}`;
    } else {
      url = "";
    }
    pages++;
  }

  report("Pull all active policies", allPolicies.length > 0, `count=${allPolicies.length}, pages=${pages}`);

  // Step 2: Check for expiring policies
  const now = new Date();
  const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const expiring = allPolicies.filter(
    (p) => p.expiration_date && new Date(p.expiration_date) <= thirtyDays,
  );
  report("Identified expiring policies (30 days)", true, `count=${expiring.length}`);

  // Step 3: Pull all clients
  const clientsRes = await fetch(`${AMS}/v1/clients?limit=50`, { headers });
  const clientsBody = await clientsRes.json();
  report("Pull clients for audit", clientsRes.status === 200, `count=${clientsBody.data?.length}`);

  // Step 4: Check tasks for pending items
  const tasksRes = await fetch(`${AMS}/v1/tasks?status=open&limit=25`, { headers });
  const tasksBody = await tasksRes.json();
  report("Check open tasks", tasksRes.status === 200, `count=${tasksBody.data?.length}`);

  // Step 5: Check accounting
  const accountingRes = await fetch(`${AMS}/v1/accounting/commissions?limit=10`, { headers });
  report("Check commissions", accountingRes.status === 200);

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
