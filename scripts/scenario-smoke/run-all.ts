#!/usr/bin/env bun
/**
 * Scenario Smoke Test Runner
 *
 * Executes all smoke tests in sequence and reports results.
 *
 * Usage:
 *   bun run scripts/scenario-smoke/run-all.ts
 */

import { join } from "path";

const SMOKE_DIR = import.meta.dir;

const TESTS = [
  { file: "01-new-client-intake.ts", name: "01: New Client Intake" },
  { file: "02-multi-carrier-quote.ts", name: "02: Multi-Carrier Quote Comparison" },
  { file: "03-policy-binding-e2e.ts", name: "03: Policy Binding E2E" },
  { file: "04-duplicate-client-detection.ts", name: "04: Duplicate Client Detection" },
  { file: "05-renewal-reshop.ts", name: "05: Renewal Re-Shop" },
  { file: "06-cross-sell-detection.ts", name: "06: Cross-Sell Detection" },
  { file: "07-fnol-claim-filing.ts", name: "07: FNOL Claim Filing" },
  { file: "08-eo-trap-navigation.ts", name: "08: E&O Trap Navigation" },
  { file: "09-carrier-denial-recovery.ts", name: "09: Carrier Denial Recovery" },
  { file: "10-book-of-business-audit.ts", name: "10: Book of Business Audit" },
  { file: "11-client-meeting-prep.ts", name: "11: Client Meeting Prep" },
  { file: "12-policy-status-inquiry.ts", name: "12: Policy Status Inquiry" },
  { file: "13-certificate-of-insurance.ts", name: "13: Certificate of Insurance" },
  { file: "14-lead-qualification.ts", name: "14: Lead Qualification" },
  { file: "15-commission-reconciliation.ts", name: "15: Commission Reconciliation" },
];

interface TestResult {
  name: string;
  file: string;
  exitCode: number;
  duration_ms: number;
}

async function runTest(test: { file: string; name: string }): Promise<TestResult> {
  const filePath = join(SMOKE_DIR, test.file);
  const start = Date.now();

  const proc = Bun.spawn(["bun", "run", filePath], {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env },
  });

  const exitCode = await proc.exited;
  const duration_ms = Date.now() - start;

  return { name: test.name, file: test.file, exitCode, duration_ms };
}

async function main() {
  console.log("============================================");
  console.log("  Scenario Smoke Test Runner");
  console.log("============================================\n");

  const results: TestResult[] = [];

  for (const test of TESTS) {
    const result = await runTest(test);
    results.push(result);
  }

  // Print summary
  console.log("\n============================================");
  console.log("  Summary");
  console.log("============================================\n");

  let allPassed = true;

  for (const result of results) {
    const status = result.exitCode === 0 ? "PASS" : "FAIL";
    const duration = (result.duration_ms / 1000).toFixed(1);
    console.log(`  ${status}  ${result.name} (${duration}s)`);
    if (result.exitCode !== 0) allPassed = false;
  }

  const totalDuration = results.reduce((sum, r) => sum + r.duration_ms, 0);
  const passedCount = results.filter((r) => r.exitCode === 0).length;
  const failedCount = results.filter((r) => r.exitCode !== 0).length;

  console.log(
    `\n  Total: ${passedCount} passed, ${failedCount} failed (${(totalDuration / 1000).toFixed(1)}s)\n`,
  );

  process.exit(allPassed ? 0 : 1);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
