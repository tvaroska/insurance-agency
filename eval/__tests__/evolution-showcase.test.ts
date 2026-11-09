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
    expect(summary.stages.stage1GeneralAgent.pass1).toBe(0.85);
    expect(summary.stages.stage2DomainSkill.avgTokens).toBe(2700);
    expect(summary.stages.stage2DomainSkill.cpvoUsd).toBe(0.0012);
    expect(summary.stages.stage2DomainSkill.avgLatencyMs).toBe(1650);
    expect(summary.stages.stage2DomainSkill.pass1).toBe(0.97);
    expect(summary.stages.stage3CompiledCode.routineTokens).toBe(0);
    expect(summary.stages.stage3CompiledCode.routineCpvoUsd).toBe(0);
    expect(summary.stages.stage3CompiledCode.avgLatencyMs).toBe(180);
    expect(summary.stages.stage3CompiledCode.pass1).toBe(1.0);
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

  test("README.md, EXECUTIVE-BRIEF.md, and design/story.md enforce showcase hygiene, canonical ports, and provenance", async () => {
    const readme = await Bun.file(
      new URL("../../README.md", import.meta.url),
    ).text();
    const brief = await Bun.file(
      new URL("../../EXECUTIVE-BRIEF.md", import.meta.url),
    ).text();
    const story = await Bun.file(
      new URL("../../design/story.md", import.meta.url),
    ).text();

    // 1. Clean H1 and fault-line table in README.md
    expect(readme.startsWith("# Evergreen Insurance Partners: Governed AI Operations for Independent P&C Brokerages")).toBe(true);
    expect(readme).toContain("### Why Default Agent Setups Fail in Regulated Insurance");
    expect(readme).toContain("| Default Approach | What It Shows | What It Misses | How Evergreen Fixes It |");

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
    for (const doc of [readme, brief]) {
      expect(doc).toContain("Measured vs. Modeled Provenance:");
      expect(doc).toContain("calculateAgencyRoi");
    }

    // 4. All 10 required domain acronyms expanded in README.md
    for (const acronym of [
      "Property and Casualty (P&C)",
      "Errors and Omissions (E&O)",
      "Customer Service Representative (CSR)",
      "Certificate of Insurance (COI)",
      "First Notice of Loss (FNOL)",
      "Special Investigations Unit (SIU)",
      "Motor Vehicle Record (MVR)",
      "Agency Management System (AMS)",
      "Enterprise Content Management (ECM)",
      "Model Context Protocol (MCP)",
    ]) {
      expect(readme).toContain(acronym);
    }
  });
});
