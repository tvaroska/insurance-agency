/**
 * Test report generators for JUnit XML and JSON formats.
 */

import { mkdirSync } from "fs";
import { dirname } from "path";

export interface TestResult {
  name: string;
  status: "pass" | "fail" | "skip";
  duration_ms: number;
  error?: string;
}

export interface TestSuiteResult {
  name: string;
  tests: TestResult[];
  duration_ms: number;
}

export interface ReportSummary {
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  suites: TestSuiteResult[];
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Write JUnit XML report.
 */
export function writeJUnitXml(summary: ReportSummary, outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${summary.total}" failures="${summary.failed}" skipped="${summary.skipped}" time="${(summary.duration_ms / 1000).toFixed(3)}">`,
  ];

  for (const suite of summary.suites) {
    const failures = suite.tests.filter((t) => t.status === "fail").length;
    const skipped = suite.tests.filter((t) => t.status === "skip").length;
    lines.push(
      `  <testsuite name="${escapeXml(suite.name)}" tests="${suite.tests.length}" failures="${failures}" skipped="${skipped}" time="${(suite.duration_ms / 1000).toFixed(3)}">`,
    );

    for (const test of suite.tests) {
      const timeAttr = `time="${(test.duration_ms / 1000).toFixed(3)}"`;
      if (test.status === "skip") {
        lines.push(`    <testcase name="${escapeXml(test.name)}" ${timeAttr}>`);
        lines.push("      <skipped/>");
        lines.push("    </testcase>");
      } else if (test.status === "fail") {
        lines.push(`    <testcase name="${escapeXml(test.name)}" ${timeAttr}>`);
        lines.push(
          `      <failure message="${escapeXml(test.error ?? "Test failed")}">${escapeXml(test.error ?? "")}</failure>`,
        );
        lines.push("    </testcase>");
      } else {
        lines.push(`    <testcase name="${escapeXml(test.name)}" ${timeAttr}/>`);
      }
    }

    lines.push("  </testsuite>");
  }

  lines.push("</testsuites>");
  Bun.write(outputPath, lines.join("\n") + "\n");
}

/**
 * Write JSON report.
 */
export function writeJsonReport(summary: ReportSummary, outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  Bun.write(outputPath, JSON.stringify(summary, null, 2) + "\n");
}

/**
 * Parse Bun test runner stdout lines into a ReportSummary.
 *
 * Bun outputs lines like:
 *   (pass) description [1.23ms]
 *   (fail) description [1.23ms]
 *   ✓ description [1.23ms]
 *   ✗ description [1.23ms]
 *
 * Suite headers:
 *   scenarios/pivot.test.ts:
 *   Pivot Agent (Cross-Sell) — end-to-end >
 */
export function parseBunOutput(stdout: string, duration_ms: number): ReportSummary {
  const lines = stdout.split("\n");
  const suites: TestSuiteResult[] = [];
  let currentSuite: TestSuiteResult | null = null;

  for (const line of lines) {
    // Detect suite from file path header
    const fileMatch = line.match(/^(.+\.test\.ts):$/);
    if (fileMatch) {
      currentSuite = { name: fileMatch[1], tests: [], duration_ms: 0 };
      suites.push(currentSuite);
      continue;
    }

    // Detect describe block as suite if no file header yet
    const describeMatch = line.match(/^(.+) >$/);
    if (describeMatch && !currentSuite) {
      currentSuite = { name: describeMatch[1], tests: [], duration_ms: 0 };
      suites.push(currentSuite);
      continue;
    }

    if (!currentSuite) continue;

    // Parse pass/fail lines
    const passMatch = line.match(/(?:✓|\(pass\))\s+(.+?)\s+\[([0-9.]+)ms\]/);
    if (passMatch) {
      const testDuration = parseFloat(passMatch[2]);
      currentSuite.tests.push({
        name: passMatch[1],
        status: "pass",
        duration_ms: testDuration,
      });
      currentSuite.duration_ms += testDuration;
      continue;
    }

    const failMatch = line.match(/(?:✗|\(fail\))\s+(.+?)\s+\[([0-9.]+)ms\]/);
    if (failMatch) {
      const testDuration = parseFloat(failMatch[2]);
      currentSuite.tests.push({
        name: failMatch[1],
        status: "fail",
        duration_ms: testDuration,
        error: `Test "${failMatch[1]}" failed`,
      });
      currentSuite.duration_ms += testDuration;
    }
  }

  const allTests = suites.flatMap((s) => s.tests);
  return {
    timestamp: new Date().toISOString(),
    total: allTests.length,
    passed: allTests.filter((t) => t.status === "pass").length,
    failed: allTests.filter((t) => t.status === "fail").length,
    skipped: allTests.filter((t) => t.status === "skip").length,
    duration_ms,
    suites,
  };
}
