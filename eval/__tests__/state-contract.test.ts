import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import type { GymSnapshot } from "../types";
import { resolveBaseUrls } from "../collect-trace";
import {
  evaluateSnapshotsAgainstContract,
  formatStateContractReport,
  loadStateScenarios,
  matchFieldValue,
  validateStateScenario,
} from "../evaluators/state-contract";
import { verifyDeterministicSuite } from "../run-state-scenarios";

function emptySnapshot(): GymSnapshot {
  return {
    ams: {
      clients: [],
      policies: [],
      coverages: [],
      endorsements: [],
      commissions: [],
      tasks: [],
      escalations: [],
      escalation_events: [],
    },
    rater: { quote_requests: [], carrier_quotes: [], carriers: [] },
    crm: { leads: [], campaigns: [], campaign_enrollments: [], retention_risks: [] },
    ecm: { documents: [], envelopes: [], marketing_assets: [] },
    comm: { messages: [], webhooks: [], webhook_deliveries: [] },
    "summit-fire": { quotes: [], policies: [], policy_documents: [], underwriting_conditions: [] },
    "coastal-star": { quotes: [], policies: [], id_cards: [] },
    claims: { adjusters: [], claims: [], claim_documents: [], claim_timeline: [] },
  };
}

describe("Pure 32-Table DB State-Contract Evaluator", () => {
  test("field matchers handle primitives, regex, contains, numeric bounds, jsonMatch, and anyOf", () => {
    expect(matchFieldValue("POL-1", "POL-1")).toBe(true);
    expect(matchFieldValue("POL-1", "POL-2")).toBe(false);
    expect(matchFieldValue("reported", { oneOf: ["reported", "assigned"] })).toBe(true);
    expect(matchFieldValue("denied", { oneOf: ["reported", "assigned"] })).toBe(false);
    expect(matchFieldValue("VIN 1FT7W2BT5PEC12345 added", { contains: "1ft7w2bt5pec12345" })).toBe(true);
    expect(matchFieldValue("VIN 1FT7W2BT5PEC12345", { contains: "1ft7w2bt5pec12345", caseSensitive: true })).toBe(false);
    expect(matchFieldValue("alpha beta gamma", { containsAll: ["ALPHA", "gamma"] })).toBe(true);
    expect(matchFieldValue("deductible $1,000", { regex: "1,?000" })).toBe(true);
    expect(matchFieldValue(1500, { gte: 1000, lte: 2000 })).toBe(true);
    expect(matchFieldValue(999, { gte: 1000 })).toBe(false);
    expect(matchFieldValue("non-empty", { present: true })).toBe(true);
    expect(matchFieldValue("", { present: true })).toBe(false);
    expect(matchFieldValue(null, { present: false })).toBe(true);
    expect(
      matchFieldValue('{"coverage":"collision","deductible":1000}', {
        jsonMatch: { coverage: "collision", deductible: { gte: 1000 } },
      }),
    ).toBe(true);
    expect(
      matchFieldValue("collision_1000", {
        anyOf: [{ equals: "exact" }, { contains: "1000" }],
      }),
    ).toBe(true);
  });

  test("enforces exact 1-to-1 matching on must_insert using augmenting-path matching", () => {
    const before = emptySnapshot();
    const after = emptySnapshot();
    after.ams.endorsements = [
      {
        endorsement_id: "END-1",
        policy_id: "POL-1",
        change_type: "modify_coverage",
        effective_date: "2026-03-01",
        changes: '{"deductible":1000}',
      },
      {
        endorsement_id: "END-2",
        policy_id: "POL-1",
        change_type: "add_vehicle",
        effective_date: "2026-03-01",
        changes: '{"vin":"ABC"}',
      },
    ];

    // Rule 1 matches BOTH rows; Rule 2 matches ONLY row 0.
    // Exact bipartite matching must assign Rule 1 -> row 1 and Rule 2 -> row 0.
    const passResult = evaluateSnapshotsAgainstContract(before, after, {
      must_insert: [
        { label: "any_pol1", service: "ams", table: "endorsements", where: { policy_id: "POL-1" } },
        {
          label: "only_modify",
          service: "ams",
          table: "endorsements",
          where: { policy_id: "POL-1", change_type: "modify_coverage" },
        },
      ],
      strict_no_unexpected_writes: true,
    });
    expect(passResult.passed).toBe(true);
    expect(passResult.matchedInserts).toHaveLength(2);
    expect(passResult.unexpectedWrites).toHaveLength(0);

    // Requiring two modify_coverage rows fails because only 1 distinct row matches
    const failDup = evaluateSnapshotsAgainstContract(before, after, {
      must_insert: [
        { service: "ams", table: "endorsements", where: { change_type: "modify_coverage" } },
        { service: "ams", table: "endorsements", where: { change_type: "modify_coverage" } },
      ],
      strict_no_unexpected_writes: true,
    });
    expect(failDup.passed).toBe(false);
    expect(failDup.missingInserts).toHaveLength(1);
  });

  test("enforces must_update unchanged_fields, allowed_extras max_count, and closed-world unexpected writes", () => {
    const before = emptySnapshot();
    before.ams.clients = [
      { id: "CLI-1", first_name: "Sarah", last_name: "Chen", phone: "111", email: "s@ex.com" },
      { id: "CLI-2", first_name: "James", last_name: "Chen", phone: "222", email: "j@ex.com" },
    ];
    const after = structuredClone(before);
    after.ams.clients[1].phone = "333";
    after.comm.messages = [
      { message_id: "msg_out_1", client_id: "CLI-2", direction: "outbound", body: "Confirmed" },
      // Inbound environment reply should never count as unexpected agent write
      { message_id: "msg_sim_16_t1_abc", client_id: "CLI-2", direction: "inbound", body: "Thanks" },
    ];

    const ok = evaluateSnapshotsAgainstContract(before, after, {
      must_update: [
        {
          service: "ams",
          table: "clients",
          key: "id:CLI-2",
          after: { phone: "333" },
          unchanged_fields: ["first_name", "email"],
          only_changed_fields: ["phone"],
        },
      ],
      allowed_extras: [{ service: "comm", table: "messages", op: "insert", max_count: 1 }],
      strict_no_unexpected_writes: true,
    });
    expect(ok.passed).toBe(true);
    expect(ok.allowedExtrasUsed).toHaveLength(1);
    expect(ok.extraGovernanceWrites).toBe(1);
    expect(ok.systemAuditWrites).toBe(0);

    // Adding a second outbound message exceeds max_count=1 and fails
    const overQuota = structuredClone(after);
    overQuota.comm.messages.push({
      message_id: "msg_out_2",
      client_id: "CLI-2",
      direction: "outbound",
      body: "Extra",
    });
    const overQuotaRes = evaluateSnapshotsAgainstContract(before, overQuota, {
      must_update: [{ service: "ams", table: "clients", key: "id:CLI-2", after: { phone: "333" } }],
      allowed_extras: [{ service: "comm", table: "messages", op: "insert", max_count: 1 }],
      strict_no_unexpected_writes: true,
    });
    expect(overQuotaRes.passed).toBe(false);
    expect(overQuotaRes.unexpectedWrites).toHaveLength(1);
    expect(formatStateContractReport("TEST", overQuotaRes)).toContain("UNEXPECTED WRITE");

    // Mutating an unchanged_field fails must_update
    const badField = structuredClone(after);
    badField.ams.clients[1].email = "changed@ex.com";
    const badFieldRes = evaluateSnapshotsAgainstContract(before, badField, {
      must_update: [
        {
          service: "ams",
          table: "clients",
          key: "id:CLI-2",
          after: { phone: "333" },
          unchanged_fields: ["email"],
        },
      ],
      allowed_extras: [{ service: "comm", table: "messages", op: "insert", max_count: 1 }],
      strict_no_unexpected_writes: true,
    });
    expect(badFieldRes.passed).toBe(false);
    expect(badFieldRes.missingUpdates).toHaveLength(1);
  });

  test("validateStateScenario rejects unknown tables and single-turn definitions", () => {
    expect(() =>
      validateStateScenario({
        id: "BAD-1",
        slug: "bad",
        name: "Bad",
        description: "Bad",
        difficulty: "easy",
        services: ["ams"],
        start_state: { base: "empty", tables: { ams: { nonexistent_table: [] } } },
        turns: [
          { role: "client", message: "t1" },
          { role: "client", message: "t2" },
        ],
        expected_diff: {},
      }),
    ).toThrow(/unknown table/);

    expect(() =>
      validateStateScenario({
        id: "BAD-2",
        slug: "bad",
        name: "Bad",
        description: "Bad",
        difficulty: "easy",
        services: ["ams"],
        start_state: { base: "empty" },
        turns: [{ role: "client", message: "only one turn" }],
        expected_diff: {},
      }),
    ).toThrow(/at least 2 turns/);
  });

  test("all 10 YAML scenarios in eval/deterministic/ pass reference, fail no-op, and fail every adversarial trap in-process", async () => {
    const scenarios = loadStateScenarios();
    expect(scenarios.map((s) => s.id)).toEqual([
      "DT-01",
      "DT-02",
      "DT-03",
      "DT-04",
      "DT-05",
      "DT-06",
      "DT-07",
      "DT-08",
      "DT-09",
      "DT-10",
    ]);

    const baseUrls = resolveBaseUrls();
    const { ok, rows } = await verifyDeterministicSuite(scenarios, baseUrls);
    for (const row of rows) {
      expect(row.details).toEqual([]);
      expect(row.referencePassed).toBe(true);
      expect(row.noopFailed).toBe(true);
      expect(row.negativesAllFailed).toBe(true);
    }
    expect(ok).toBe(true);
  }, 30_000);

  test("CLI --score-snapshots scores snapshot files purely against DT-01 contract", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "evergreen-dt-cli-"));
    try {
      const before = emptySnapshot();
      before.ams.clients = [
        {
          id: "CLI-DT01-B",
          first_name: "James",
          last_name: "Chen",
          email: "james.chen@example.com",
          phone: "310-555-0102",
          status: "active",
        },
      ];
      const after = structuredClone(before);
      after.ams.clients[0].phone = "310-555-0199";
      after.ams.endorsements = [
        {
          endorsement_id: "END-2026-000001",
          policy_id: "POL-PA-DT01-B",
          change_type: "modify_coverage",
          effective_date: "2026-03-01",
          changes: '{"coverage":"collision","deductible":1000}',
        },
      ];

      const beforePath = join(tmpDir, "before.json");
      const afterPath = join(tmpDir, "after.json");
      const outPath = join(tmpDir, "report.json");
      writeFileSync(beforePath, JSON.stringify(before));
      writeFileSync(afterPath, JSON.stringify(after));

      const proc = Bun.spawnSync(
        [
          process.execPath,
          resolve(import.meta.dir, "../run-state-scenarios.ts"),
          "--score-snapshots",
          "--scenario",
          "DT-01",
          "--before",
          beforePath,
          "--after",
          afterPath,
          "--out",
          outPath,
        ],
        { cwd: resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" },
      );
      expect(proc.exitCode).toBe(0);
      const parsed = JSON.parse(proc.stdout.toString());
      expect(parsed.scenario_id).toBe("DT-01");
      expect(parsed.passed).toBe(true);
      expect(parsed.score).toBe(1);
      expect(parsed.unexpectedWrites).toEqual([]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("hybrid policy separates systemAuditWrites from extraGovernanceWrites and rejects wrong-client extras", () => {
    const before = emptySnapshot();
    const after = emptySnapshot();
    after.ams.escalations = [
      { escalation_id: "esc_1", client_id: "CLI-DT03-A", reason: "attorney_involvement" },
      { escalation_id: "esc_2", client_id: "CLI-DT03-A", reason: "coverage_adequacy" },
    ];
    after.ams.escalation_events = [
      { id: 1, escalation_id: "esc_1", event_type: "created" },
      { id: 2, escalation_id: "esc_2", event_type: "created" },
    ];
    after.ams.tasks = [
      { id: "TASK-1", related_client_id: "CLI-DT03-A", title: "Follow up" },
    ];
    after.claims.claims = [
      {
        claim_id: "CLM-1",
        client_id: "CLI-DT03-A",
        policy_id: "POL-BO-DT03-A",
        claim_type: "property_damage",
        loss_date: "2026-02-17",
        status: "reported",
      },
    ];
    after.claims.claim_timeline = [{ event_id: "EVT-1", claim_id: "CLM-1" }];

    const dt03 = loadStateScenarios().find((s) => s.id === "DT-03")!;
    const res = evaluateSnapshotsAgainstContract(before, after, dt03.expected_diff);
    expect(res.passed).toBe(true);
    expect(res.systemAuditWrites).toBe(3); // 2 escalation_events + 1 claim_timeline
    expect(res.extraGovernanceWrites).toBe(2); // 1 optional coverage_adequacy + 1 scoped task
    expect(res.summary).toContain("extra_gov 2");
    expect(res.summary).toContain("audit 3");

    // Wrong-client task or duplicate attorney_involvement escalation still fails
    const badExtra = structuredClone(after);
    badExtra.ams.escalations.push({
      escalation_id: "esc_3",
      client_id: "CLI-DT03-A",
      reason: "attorney_involvement",
    });
    const badRes = evaluateSnapshotsAgainstContract(before, badExtra, dt03.expected_diff);
    expect(badRes.passed).toBe(false);
    expect(badRes.unexpectedWrites).toHaveLength(1);
    expect(badRes.unexpectedWrites[0].table).toBe("escalations");
  });
});
