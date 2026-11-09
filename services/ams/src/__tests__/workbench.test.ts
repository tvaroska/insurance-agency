import { mock, describe, expect, test, beforeAll, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { mkdtempSync } from "fs";
import { join } from "path";

const tmpDir = mkdtempSync("/tmp/test-ams-wb-");
const dbPath = join(tmpDir, "test.db");
const testSqlite = new Database(dbPath);
testSqlite.exec("PRAGMA journal_mode = WAL;");
testSqlite.exec("PRAGMA foreign_keys = ON;");

const testAdapter = new PrismaLibSql({ url: `file:${dbPath}` });
const testPrisma = new PrismaClient({ adapter: testAdapter });
mock.module("../prisma", () => ({ prisma: testPrisma }));

import { Hono } from "hono";
import { workbenchRouter } from "../routes/workbench";
import { createTables } from "./setup";

const app = new Hono();
app.route("/", workbenchRouter);

beforeAll(() => {
  createTables(testSqlite);
});

beforeEach(() => {
  testSqlite.exec("DELETE FROM escalation_events");
  testSqlite.exec("DELETE FROM escalations");
  testSqlite.exec("DELETE FROM tasks");
});

describe("AMS Executive Operations & Governance Workbench (:3000/)", () => {
  test("GET / serves GM3 Light 4-tab Executive Workbench HTML with inline SVG favicon", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain(
      "Evergreen Insurance Partners — Executive Operations &amp; Governance Workbench",
    );
    expect(html).toContain('rel="icon" type="image/svg+xml"');
    expect(html).toContain("--surface: #f8fafc");
    expect(html).toContain("1. Agency Command &amp; 5 Hero Journeys");
    expect(html).toContain("2. Principal E&amp;O &amp; Escalation Queue");
    expect(html).toContain("3. 3rd-Line State-Diff &amp; Trace Receipt");
    expect(html).toContain("4. 3-Stage Agent-to-Code Economics");
  });

  test("GET /workbench/api/overview returns agency ROI model, 7 promises, 5 hero journeys, 15 anomalies, and seeded escalations", async () => {
    const res = await app.request("/workbench/api/overview");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.agencyProfile.staffCount).toBe(11);
    expect(data.agencyProfile.baselineRevenuePerEmployeeUsd).toBe(200000);
    expect(data.agencyProfile.aiEnabledRevenuePerEmployeeUsd).toBe(385000);
    expect(data.sevenPromises).toHaveLength(7);
    expect(data.heroJourneys).toHaveLength(5);
    expect(data.anomalies).toHaveLength(15);
    expect(data.escalations.length).toBeGreaterThanOrEqual(3);
    expect(data.evolutionStages).toHaveLength(3);
  });

  test("POST /workbench/api/run-journey executes Hero Journey and writes a real SQLite audit task", async () => {
    const res = await app.request("/workbench/api/run-journey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ journeyId: "J2" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.journey.id).toBe("J2");
    expect(data.executionSummary.status).toBe("PASS");
    expect(data.executionSummary.compiledHandler).toBe("privy:cert-issuer");
    expect(data.stateDiffReceipt.amsTasksAfter).toBe(
      data.stateDiffReceipt.amsTasksBefore + 1,
    );
  });

  test("POST /workbench/api/test-firewall returns HTTP 422 EO_COMPLIANCE_VIOLATION on illegal CA 10/20/5 limits", async () => {
    const res = await app.request("/workbench/api/test-firewall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: "CA",
        biPerPerson: 10000,
        biPerAccident: 20000,
        pdPerAccident: 5000,
        effectiveDate: "2020-01-01",
        annualPremium: 32000,
      }),
    });
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error_code).toBe("EO_COMPLIANCE_VIOLATION");
    expect(data.blocked).toBe(true);
    expect(data.violations.length).toBe(3);
  });

  test("POST /workbench/api/run-journey supports Why-Transcript-Evals-Fail toggle (unguarded_transcript vs governed)", async () => {
    const unguardedRes = await app.request("/workbench/api/run-journey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ journeyId: "J1", evalMode: "unguarded_transcript" }),
    });
    expect(unguardedRes.status).toBe(200);
    const unguardedData = await unguardedRes.json();
    expect(unguardedData.executionSummary.status).toBe("FAIL_STATE_DIFF");
    expect(unguardedData.stateDiffReceipt.amsTasksAfter).toBe(
      unguardedData.stateDiffReceipt.amsTasksBefore,
    );
  });

  test("GET /workbench/api/acord25-preview.pdf serves valid %PDF-1.7 ACORD 25 certificate", async () => {
    const res = await app.request("/workbench/api/acord25-preview.pdf");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    const text = await res.text();
    expect(text.startsWith("%PDF-1.7")).toBe(true);
    expect(text).toContain("ACORD 25 - CERTIFICATE OF LIABILITY INSURANCE");
  });

  test("POST /workbench/api/chaos and POST /workbench/api/time-travel control simulation state", async () => {
    const chaosRes = await app.request("/workbench/api/chaos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, failureRate: 0.5 }),
    });
    expect(chaosRes.status).toBe(200);
    const chaosData = await chaosRes.json();
    expect(chaosData.chaos.enabled).toBe(true);
    expect(chaosData.chaos.failureRate).toBe(0.5);

    const ttRes = await app.request("/workbench/api/time-travel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: 30 }),
    });
    expect(ttRes.status).toBe(200);
    const ttData = await ttRes.json();
    expect(ttData.daysAdvanced).toBe(30);
    expect(ttData.createdRenewalTaskId).toMatch(/^TSK-TT-/);
  });

  test("POST /workbench/api/escalations/:id/resolve approves pending escalation and records audit event", async () => {
    await app.request("/workbench/api/overview");
    const res = await app.request(
      "/workbench/api/escalations/esc_showcase_01/resolve",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("approved");
    expect(data.manager_response.decision).toBe("approved");
  });
});
