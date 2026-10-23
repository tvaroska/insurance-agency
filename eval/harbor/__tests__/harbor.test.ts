import { describe, it, expect } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildHarborManifest,
  renderTaskYaml,
  renderTestOutputsPy,
  renderHarborDockerCompose,
  exportHarborTasks,
} from "../export-harbor";

describe("Harbor / Terminal-Bench 2.0 Exporter (S2-INTOP-1)", () => {
  it("builds a complete manifest covering all 20 scenarios and 253 tasks", () => {
    const manifest = buildHarborManifest();

    expect(manifest.standard).toBe("harbor-2.0");
    expect(manifest.benchmark).toBe("evergreen-insurance-gym");
    expect(manifest.total_scenarios).toBe(20);
    expect(manifest.total_tasks).toBe(253);
    expect(manifest.default_models.workhorse).toBe("gemini-3.8-flash");
    expect(manifest.default_models.reasoning).toBe("gemini-4-argon");
    expect(manifest.default_models.fast).toBe("gemini-3.5-flash-lite");

    // Check single-turn and multi-turn tasks exist
    expect(manifest.tasks["01-realistic-natural"]).toBeDefined();
    expect(manifest.tasks["08-realistic-adversarial"]).toBeDefined();
    expect(manifest.tasks["16-realistic-natural"]).toBeDefined();
    expect(manifest.tasks["20-realistic-adversarial"]).toBeDefined();
  });

  it("renders valid task.yaml with scenario metadata, services, and E&O trap IDs", () => {
    const manifest = buildHarborManifest();
    const task08 = manifest.tasks["08-realistic-natural"];
    const yaml = renderTaskYaml(task08);

    expect(yaml).toContain('task_id: "08-realistic-natural"');
    expect(yaml).toContain('scenario_id: "08"');
    expect(yaml).toContain('difficulty: "hard"');
    expect(yaml).toContain('prompt_difficulty: "natural"');
    expect(yaml).toContain("eo-compliance-trap");
    expect(yaml).toContain('docker_compose: "../../docker-compose.harbor.yaml"');
    expect(yaml).toContain("POST http://localhost:3000/oauth/token");
  });

  it("renders test_outputs.py that delegates grading to bun eval/score.ts", () => {
    const manifest = buildHarborManifest();
    const task19 = manifest.tasks["19-realistic-natural"];
    const py = renderTestOutputsPy(task19);

    expect(py).toContain('SCENARIO_ID = "19"');
    expect(py).toContain('SEED_VARIANT = "realistic"');
    expect(py).toContain('CASE_ID = "realistic-natural"');
    expect(py).toContain('"eval/score.ts"');
    expect(py).toContain("def test_eo_compliance_and_score()");
  });

  it("renders shared docker-compose.harbor.yaml referencing all 8 services", () => {
    const compose = renderHarborDockerCompose();
    expect(compose).toContain("include:");
    expect(compose).toContain("../../docker-compose.yml");
    expect(compose).toContain("harbor-agent:");
    expect(compose).toContain("gemini-3.8-flash");
    for (const svc of [
      "ams",
      "rater",
      "crm",
      "ecm",
      "comm",
      "carrier-summit",
      "carrier-coastal",
      "claims",
    ]) {
      expect(compose).toContain(`${svc}:`);
    }
  });

  it("exports representative task directories and manifest to a target directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "harbor-test-"));
    try {
      const res = await exportHarborTasks({ outDir: tempDir });
      expect(res.exportedTaskIds).toHaveLength(20);

      const sampleYaml = await readFile(
        join(tempDir, "tasks", "16-realistic-natural", "task.yaml"),
        "utf-8",
      );
      expect(sampleYaml).toContain('task_id: "16-realistic-natural"');

      const samplePy = await readFile(
        join(
          tempDir,
          "tasks",
          "16-realistic-natural",
          "tests",
          "test_outputs.py",
        ),
        "utf-8",
      );
      expect(samplePy).toContain('SCENARIO_ID = "16"');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
