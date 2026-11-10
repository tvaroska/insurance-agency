import { describe, expect, test } from "bun:test";
import {
  calculateAgencyRoi,
  COMPILED_WORKFLOW_SPECS,
  runEvolutionShowcase,
} from "../evolution-showcase";
import { runMultiHarnessComparison } from "../harnesses/runner";
import {
  formatExecutiveScorecardHtml,
  EXECUTIVE_SCENARIO_MATRIX,
} from "../report";

describe("3-Stage Agent-to-Code Evolution Showcase & 11-Staff Agency ROI", () => {
  test("calculateAgencyRoi models Evergreen 11-staff capacity lift from $200K to $385K rev/employee", () => {
    const roi = calculateAgencyRoi();
    expect(roi.staffCount).toBe(11);
    expect(roi.baselineWrittenPremiumUsd).toBe(20_000_000);
    expect(roi.governedWrittenPremiumUsd).toBe(38_500_000);
    expect(roi.baselineRevenuePerEmployeeUsd).toBe(200_000);
    expect(roi.governedRevenuePerEmployeeUsd).toBe(385_000);
    expect(roi.revenueLiftPct).toBe(92.5);
    expect(roi.stage3BlendedCpvoUsd).toBeLessThan(roi.stage2SkillCpvoUsd);
    expect(roi.stage2SkillCpvoUsd).toBeLessThan(roi.stage1GeneralAgentCpvoUsd);
  });

  test("runEvolutionShowcase executes Stage 1 -> Stage 2 -> Stage 3 ($0-token + FallbackToSkill) across all 4 workflows", async () => {
    const summary = await runEvolutionShowcase();
    expect(summary.workflows).toHaveLength(COMPILED_WORKFLOW_SPECS.length);
    expect(summary.stages.stage1GeneralAgent.avgTokens).toBe(6500);
    expect(summary.stages.stage1GeneralAgent.cpvoUsd).toBe(0.0029);
    expect(summary.stages.stage1GeneralAgent.avgLatencyMs).toBe(3900);
    expect(summary.stages.stage1GeneralAgent.pass1).toBe(0.667);
    expect(summary.stages.stage1GeneralAgent.meanScore).toBe(0.68);
    expect(summary.stages.stage1GeneralAgent.provenance).toBe(
      "measured_v0.7_baseline",
    );
    expect(summary.stages.stage1GeneralAgent.falseCompletionRateRange).toBe(
      "16.7%–66.7%",
    );
    expect(summary.stages.stage1GeneralAgent.measuredModels).toHaveLength(3);
    expect(summary.stages.stage2DomainSkill.avgTokens).toBe(2700);
    expect(summary.stages.stage2DomainSkill.cpvoUsd).toBe(0.0012);
    expect(summary.stages.stage2DomainSkill.avgLatencyMs).toBe(1650);
    expect(summary.stages.stage2DomainSkill.pass1).toBe(0.97);
    expect(summary.stages.stage2DomainSkill.provenance).toBe(
      "projected_skill_target",
    );
    expect(summary.stages.stage3CompiledCode.routineTokens).toBe(0);
    expect(summary.stages.stage3CompiledCode.routineCpvoUsd).toBe(0);
    expect(summary.stages.stage3CompiledCode.avgLatencyMs).toBe(180);
    expect(summary.stages.stage3CompiledCode.pass1).toBe(1.0);
    expect(summary.stages.stage3CompiledCode.provenance).toBe(
      "measured_reference_verifier_with_projected_fallback",
    );
    expect(summary.stages.stage3CompiledCode.fallbackRatePct).toBe(22.0);

    for (const wf of summary.workflows) {
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

  test("runMultiHarnessComparison supports both precomputed and live execution modes", async () => {
    const mockFetch = (async () =>
      new Response(JSON.stringify({ status: "ok", data: [] }), {
        status: 200,
      })) as unknown as typeof fetch;

    const pre = await runMultiHarnessComparison({
      harnesses: ["google-adk"],
      scenarios: ["01", "16"],
      mode: "precomputed",
    });
    expect(pre.mode).toBe("precomputed");
    expect(pre.markdown).toContain("Precomputed Reference Baselines");

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
    expect(html).toContain("Trajectory Claim vs. 35-Table SQLite Database State Evidence");
    expect(html).toContain("3-Stage Agent-to-Code Evolution");
    expect(html).toContain("#20");
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
