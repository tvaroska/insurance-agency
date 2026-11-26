import { describe, expect, test } from "bun:test";
import {
  calculateAgencyRoi,
  COMPILED_WORKFLOW_SPECS,
  loadMeasuredStageBaselines,
  runEvolutionShowcase,
} from "../evolution-showcase";
import { runMultiHarnessComparison } from "../harnesses/runner";
import {
  computeTaskPassHatK,
  EXECUTIVE_SCENARIO_MATRIX,
  formatExecutiveScorecardHtml,
  generateReport,
  passHatK,
  unbiasedPassHatK,
} from "../report";

describe("3-Stage Agent-to-Code Evolution Showcase & 11-Staff Agency ROI", () => {
  test("calculateAgencyRoi models Evergreen 11-staff capacity lift from $200K to $385K rev/employee", () => {
    const baselines = loadMeasuredStageBaselines();
    const roi = calculateAgencyRoi();
    expect(roi.staffCount).toBe(11);
    expect(roi.baselineWrittenPremiumUsd).toBe(20_000_000);
    expect(roi.governedWrittenPremiumUsd).toBe(38_500_000);
    expect(roi.baselineRevenuePerEmployeeUsd).toBe(200_000);
    expect(roi.governedRevenuePerEmployeeUsd).toBe(385_000);
    expect(roi.revenueLiftPct).toBe(92.5);
    expect(roi.stage1GeneralAgentCpvoUsd).toBe(baselines.stage1CpvoUsd);
    expect(roi.stage2SkillCpvoUsd).toBe(baselines.stage2CpvoUsd);
    expect(roi.stage3BlendedCpvoUsd).toBeLessThan(roi.stage2SkillCpvoUsd);
    expect(roi.stage2SkillCpvoUsd).toBeLessThan(roi.stage1GeneralAgentCpvoUsd);
  });

  test("runEvolutionShowcase loads measured summary metrics and executes Stage 1 -> Stage 2 -> Stage 3 without fabricating pass^5", async () => {
    const standInFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "test-jwt" }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ status: "ok", data: [] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const baselines = loadMeasuredStageBaselines();
    const summary = await runEvolutionShowcase({ fetchImpl: standInFetch });
    expect(summary.summaryVersion).toBe("v0.9.1");
    expect(summary.summaryPath).toContain("eval/results/v0.9.1/summary-report.json");
    expect(summary.workflows).toHaveLength(COMPILED_WORKFLOW_SPECS.length);
    for (const spec of COMPILED_WORKFLOW_SPECS) {
      expect(spec.id.startsWith("compiled:")).toBe(true);
      expect(spec.id.includes("privy:")).toBe(false);
    }
    expect(summary.stages.stage2DomainSkill.label).not.toContain(
      "skills/insurance-servicing",
    );
    expect(summary.stages.stage1GeneralAgent.avgTokens).toBeGreaterThan(
      summary.stages.stage2DomainSkill.avgTokens,
    );
    expect(summary.stages.stage1GeneralAgent.cpvoUsd).toBe(baselines.stage1CpvoUsd);
    expect(summary.stages.stage1GeneralAgent.pass1).toBe(baselines.stage1Primary.pass_at_1);
    expect(summary.stages.stage1GeneralAgent.meanScore).toBe(baselines.stage1Primary.mean_score);
    expect(summary.stages.stage1GeneralAgent.pass5).toBe(baselines.stage1Primary.pass_hat_5);
    expect(summary.stages.stage1GeneralAgent.pass5Strict).toBe(
      baselines.stage1Primary.pass_hat_5_unbiased ?? null,
    );
    expect(summary.stages.stage1GeneralAgent.eoComplianceRate).toBe(
      baselines.stage1EoComplianceRate,
    );
    expect(summary.stages.stage1GeneralAgent.provenance).toBe(
      "measured_v0.9.1_baseline",
    );
    expect(summary.stages.stage1GeneralAgent.falseCompletionRateRange).toBe(
      baselines.falseCompletionRateRange,
    );
    expect(summary.stages.stage1GeneralAgent.measuredModels).toHaveLength(3);
    expect(summary.stages.stage2DomainSkill.avgTokens).toBeGreaterThan(0);
    expect(summary.stages.stage2DomainSkill.cpvoUsd).toBe(baselines.stage2CpvoUsd);
    expect(summary.stages.stage2DomainSkill.pass1).toBe(baselines.stage2Skill.pass_at_1);
    expect(summary.stages.stage2DomainSkill.pass5).toBe(baselines.stage2Skill.pass_hat_5);
    expect(summary.stages.stage2DomainSkill.pass5Strict).toBe(
      baselines.stage2Skill.pass_hat_5_unbiased ?? null,
    );
    expect(summary.stages.stage2DomainSkill.eoComplianceRate).toBe(
      baselines.stage2EoComplianceRate,
    );
    expect(summary.stages.stage2DomainSkill.provenance).toBe(
      "measured_v0.9.1_domain_skill",
    );
    expect(summary.stages.stage3CompiledCode.routineTokens).toBe(0);
    expect(summary.stages.stage3CompiledCode.routineCpvoUsd).toBe(0);
    expect(summary.stages.stage3CompiledCode.blendedCpvoUsd).toBe(
      summary.agencyRoi.stage3BlendedCpvoUsd,
    );
    expect(summary.stages.stage3CompiledCode.pass1).toBe(1.0);
    expect(summary.stages.stage3CompiledCode.pass5).toBe(1.0);
    expect(summary.stages.stage3CompiledCode.provenance).toBe(
      "measured_reference_verifier_with_projected_fallback",
    );
    expect(summary.stages.stage3CompiledCode.fallbackRatePct).toBe(22.0);

    for (const wf of summary.workflows) {
      // Per-workflow Stage 1 & Stage 2 pass^5 match the loaded per-task pass_hat_5, not pooled (pass@1)^5
      expect(wf.routineRun.stage1.pass5).toBe(baselines.stage1Primary.pass_hat_5);
      expect(wf.routineRun.stage2.pass5).toBe(baselines.stage2Skill.pass_hat_5);

      // Routine run: Stage 3 compiled code uses 0 tokens and $0 LLM cost
      expect(wf.routineRun.stage1.totalTokens).toBeGreaterThan(
        wf.routineRun.stage2.totalTokens,
      );
      expect(wf.routineRun.stage2.totalTokens).toBeGreaterThan(0);
      expect(wf.routineRun.stage3.totalTokens).toBe(0);
      expect(wf.routineRun.stage3.estimatedCostUsd).toBe(0);
      expect(wf.routineRun.stage3.status).toBe("COMPLETED_DETERMINISTIC");
      expect(wf.routineRun.stage3.traceScore).toBe(1);

      // Pivot run: Stage 3 detects unhandled mid-conversation pivot / E&O trap and triggers FALLBACK_TO_SKILL
      expect(wf.pivotRun.stage3WithFallback.status).toBe("FALLBACK_TO_SKILL");
      expect(wf.pivotRun.stage3WithFallback.fallbackReason).toBeDefined();
      expect(wf.pivotRun.stage3WithFallback.eoCompliant).toBe(true);
      expect(wf.pivotRun.stage3WithFallback.traceScore).toBe(1);
    }
  });

  test("computeTaskPassHatK aligns with summarize_inspect.py per-task (c/k)^k and strict k/k definitions", () => {
    // Two tasks with k=5 trials: task 1 passes 5/5, task 2 passes 4/5
    // Mean per-task (c/5)^5 = (1.0 + 0.8^5) / 2 = (1 + 0.32768) / 2 = 0.66384 -> 0.6638
    // Mean strict combinatorial C(c,5)/C(5,5) = (1 + 0) / 2 = 0.5
    const metrics = computeTaskPassHatK(
      [
        { successes: 5, trials: 5 },
        { successes: 4, trials: 5 },
      ],
      5,
    );
    expect(metrics.perTaskPower).toBeCloseTo(0.6638, 4);
    expect(metrics.strictCombinatorial).toBe(0.5);
    expect(unbiasedPassHatK(5, 5, 5)).toBe(1);
    expect(unbiasedPassHatK(4, 5, 5)).toBe(0);
    expect(unbiasedPassHatK(3, 4, 5)).toBeNull();
    expect(passHatK(5, 4, 5)).toBeCloseTo(0.8 ** 5, 6);
  });

  test("runMultiHarnessComparison supports both recorded log aggregation and live trajectory execution", async () => {
    const mockFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "test-jwt" }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ status: "ok", data: [] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const logsAgg = await runMultiHarnessComparison({
      harnesses: ["google-adk"],
      mode: "logs",
      runsByHarness: {
        "google-adk": [
          {
            runId: "r-01",
            timestamp: "2026-10-23T00:00:00Z",
            scenario: "01",
            caseId: "realistic-natural",
            seed: "realistic",
            overall: { score: 1, eoCompliant: true, apiCalls: 6, expectedRange: [5, 12] },
            trace: { score: 1, checks: [] },
            output: { score: 1, checks: [] },
            eoTraps: [],
          },
        ],
      },
    });
    expect(logsAgg.mode).toBe("logs");
    expect(logsAgg.markdown).toContain("Aggregated from recorded `ScenarioReport` artifacts");

    const live = await runMultiHarnessComparison({
      harnesses: ["google-adk"],
      scenarios: ["01", "16"],
      mode: "live",
      fetchImpl: mockFetch,
    });
    expect(live.mode).toBe("live");
    expect(live.markdown).toContain("Evaluated via `runBaselineAgent`");
  });

  test("formatExecutiveScorecardHtml renders GM3 Light Executive HTML Scorecard covering all 20 scenarios", () => {
    expect(EXECUTIVE_SCENARIO_MATRIX).toHaveLength(20);
    const html = formatExecutiveScorecardHtml([]);
    expect(html).toContain(
      "Evergreen Insurance Partners — Executive Governance &amp; Benchmark Scorecard",
    );
    expect(html).toContain('rel="icon" type="image/svg+xml"');
    expect(html).toContain("Trajectory Claim vs. 32-Table SQLite Database State Evidence");
    expect(html).toContain("3-Stage Agent-to-Code Evolution");
    expect(html).toContain("#20");
  });

  test("scorecard renders n/a without a report", () => {
    const emptyHtml = formatExecutiveScorecardHtml([]);
    const matrixStart = emptyHtml.indexOf('<table id="scenario-matrix">');
    expect(matrixStart).toBeGreaterThan(-1);
    const matrixSection = emptyHtml.slice(matrixStart);

    // Every one of the 20 scenario rows renders n/a (never hardcoded 100.0% / PASS)
    expect(matrixSection).not.toContain("100.0%");
    expect(matrixSection).not.toContain("PASS (0 Unauthorized)");
    expect(matrixSection).not.toContain(">PASS<");
    const naMatches = matrixSection.match(/>n\/a</g) ?? [];
    expect(naMatches.length).toBe(60); // 20 rows * 3 columns (Score, E&O Gate, State-Diff Audit)

    // Providing a single live ScenarioReport populates only that scenario and leaves the other 19 as n/a
    const singleReport = generateReport({
      runId: "r-01",
      scenario: "01",
      caseId: "realistic-natural",
      seed: "realistic",
      traceScores: [{ name: "t1", passed: true, weight: 1 }],
      outputScores: [{ name: "o1", passed: true, weight: 1 }],
      eoTrapResults: [],
      apiCallCount: 6,
      expectedRange: [5, 12],
      stateDiff: {
        insertedCount: 2,
        updatedCount: 0,
        deletedCount: 0,
        totalMutations: 2,
        collateralFree: false,
        unauthorizedMutations: 1,
        collateralPenalty: 0.1,
        findings: [],
      },
    });
    const partialHtml = formatExecutiveScorecardHtml([singleReport]);
    const partialMatrix = partialHtml.slice(partialHtml.indexOf('<table id="scenario-matrix">'));
    expect(partialMatrix).toContain("75.0%");
    expect(partialMatrix).toContain("FAIL (1)");
    expect(partialMatrix).toContain('<span class="chip chip-block">FAIL (1)</span>');
    const remainingNa = partialMatrix.match(/>n\/a</g) ?? [];
    expect(remainingNa.length).toBe(57); // 19 unscored rows * 3 columns
  });

  test("README.md stays a benchmark README; EXECUTIVE-BRIEF.md and design/story.md keep hygiene, canonical ports, and provenance", async () => {
    const readme = await Bun.file(
      new URL("../../README.md", import.meta.url),
    ).text();
    const brief = await Bun.file(
      new URL("../../EXECUTIVE-BRIEF.md", import.meta.url),
    ).text();
    const story = await Bun.file(
      new URL("../../design/story.md", import.meta.url),
    ).text();

    // 1. README.md is framed as a first step in benchmarking agents on knowledge work and carries no modeled economics
    expect(readme.startsWith("# Evergreen: A First Step in Benchmarking Agents on Knowledge Work")).toBe(true);
    for (const heading of ["## Results", "## How Scoring Works", "## How It Compares", "## Limitations"]) {
      expect(readme).toContain(heading);
    }
    expect(readme).not.toContain("Governed AI Operations");
    expect(readme).not.toContain("calculateAgencyRoi");
    expect(readme).not.toContain("+92.5%");

    // 2. Canonical ports in README.md and design/story.md
    expect(readme).toContain("Summit Fire & Casualty Commercial Web Portal:          http://localhost:3005/");
    expect(readme).toContain("Coastal Star Auto Personal Web Portal:                 http://localhost:3006/");
    expect(story).toContain("Summit Fire & Casualty (`:3005`):");
    expect(story).toContain("Coastal Star Auto (`:3006`):");
    expect(story).toContain("Claims Management (`Claims`, `:3007`):");
    expect(story).toContain("(`>$10K` authority cap)");
    expect(story).not.toContain(":3005` / `:3006`");
    expect(story).not.toContain(":3006` / `:3007`");
    expect(story).not.toContain(":3007` / `:3005`");
    expect(story).not.toContain("`$10K`/`$25K`");

    // 3. Zero em-dashes, arrows, or internal design-tier jargon in README.md, EXECUTIVE-BRIEF.md, and design/story.md
    for (const doc of [readme, brief, story]) {
      expect(doc).not.toContain("\u2014");
      expect(doc).not.toContain("\u2192");
      expect(doc).not.toContain("->");
      expect(doc).not.toContain(".stitch/DESIGN.md");
      expect(doc).not.toContain("GM3 Light");
      expect(doc).not.toContain("Tier-2 Reusable Showcase");
    }
    expect(brief).toContain("Measured vs. Modeled Provenance:");
    expect(brief).toContain("calculateAgencyRoi");

    // 4. Domain acronyms are expanded at their first use in README.md
    const acronyms: Record<string, string> = {
      "P&C": "Property and Casualty (P&C)",
      "E&O": "Errors and Omissions (E&O)",
      AMS: "Agency Management System (AMS)",
      CRM: "Customer Relationship Management (CRM)",
      ECM: "Enterprise Content Management (ECM)",
      MCP: "Model Context Protocol (MCP)",
      CSR: "Customer Service Representative (CSR)",
      FNOL: "First Notice of Loss (FNOL)",
      COI: "Certificate of Insurance (COI)",
    };
    for (const [short, expanded] of Object.entries(acronyms)) {
      const firstExpanded = readme.indexOf(expanded);
      expect(firstExpanded).toBeGreaterThan(-1);
      const firstShort = readme.search(new RegExp(`\\b${short}\\b`));
      expect(firstShort).toBe(firstExpanded + expanded.length - short.length - 1);
    }
  });

  test("README.md workflow table matches the Harbor task manifest", async () => {
    const readme = await Bun.file(
      new URL("../../README.md", import.meta.url),
    ).text();
    const manifest = (await Bun.file(
      new URL("../harbor/tasks-manifest.json", import.meta.url),
    ).json()) as {
      total_tasks: number;
      tasks: Record<string, { scenario_id: string }>;
    };

    const expected = new Map<string, number>();
    for (const task of Object.values(manifest.tasks)) {
      expected.set(task.scenario_id, (expected.get(task.scenario_id) ?? 0) + 1);
    }

    const rows = [...readme.matchAll(/^\| \*\*(\d{2})\*\* \|[^|]*\|[^|]*\| (\d+) \|/gm)];
    expect(rows).toHaveLength(expected.size);
    for (const row of rows) {
      expect(Number(row[2])).toBe(expected.get(row[1] ?? "") ?? -1);
    }
    expect(readme).toContain(`${manifest.total_tasks} tasks`);
  });
});
