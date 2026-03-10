#!/usr/bin/env bun
/**
 * E2E test runner: health-check services, run tests, generate reports.
 *
 * Usage:
 *   bun run tests/e2e/run.ts
 *   K8S_BASE_URL=http://... bun run tests/e2e/run.ts
 */

import { healthCheck } from "./client";
import { ALL_SERVICES, type ServiceName } from "./config";
import { parseBunOutput, writeJUnitXml, writeJsonReport } from "./reporter";
import { join } from "path";

const REPORTS_DIR = join(import.meta.dir, "reports");

async function checkServices(): Promise<boolean> {
  console.log("Health-checking services...");
  const results: Array<{ service: ServiceName; ok: boolean }> = [];

  for (const service of ALL_SERVICES) {
    const ok = await healthCheck(service);
    results.push({ service, ok });
    console.log(`  ${ok ? "OK" : "FAIL"}  ${service}`);
  }

  const allOk = results.every((r) => r.ok);
  if (!allOk) {
    const failed = results.filter((r) => !r.ok).map((r) => r.service);
    console.error(`\nServices not healthy: ${failed.join(", ")}`);
    console.error("Start services with: docker compose up -d");
  }
  return allOk;
}

async function runTests(): Promise<{ exitCode: number; stdout: string; duration_ms: number }> {
  console.log("\nRunning E2E tests...\n");
  const start = Date.now();

  const proc = Bun.spawn(["bun", "test", "--serial", "scenarios/"], {
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env },
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  const duration_ms = Date.now() - start;

  process.stdout.write(stdout);
  return { exitCode, stdout, duration_ms };
}

async function reseedServices(): Promise<void> {
  console.log("\nReseeding service databases...");
  const foundation = ["ams", "rater", "crm", "claims"];
  const dependent = ["ecm", "comm", "carrier-summit", "carrier-coastal"];

  for (const batch of [foundation, dependent]) {
    const procs = batch.map((svc) =>
      Bun.spawn(["docker", "compose", "exec", svc, "bun", "run", "seed"], {
        cwd: join(import.meta.dir, "..", ".."),
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    for (const proc of procs) {
      await proc.exited;
    }
  }
  console.log("  Databases reseeded.");
}

async function main() {
  const servicesOk = await checkServices();
  if (!servicesOk) {
    process.exit(1);
  }

  await reseedServices();

  const { exitCode, stdout, duration_ms } = await runTests();

  console.log("\nGenerating reports...");
  const summary = parseBunOutput(stdout, duration_ms);

  writeJUnitXml(summary, join(REPORTS_DIR, "junit.xml"));
  writeJsonReport(summary, join(REPORTS_DIR, "results.json"));

  console.log(`  JUnit XML: ${join(REPORTS_DIR, "junit.xml")}`);
  console.log(`  JSON:      ${join(REPORTS_DIR, "results.json")}`);
  console.log(
    `\nResults: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped (${(duration_ms / 1000).toFixed(1)}s)`,
  );

  process.exit(exitCode);
}

main();
