import { describe, it, expect } from "bun:test";
import { execFileSync } from "child_process";
import { resolve } from "path";

const INSPECT_PY = resolve(import.meta.dir, "../evergreen.py");

function runPythonJson(code: string): any {
  const out = execFileSync("python3", ["-c", code], {
    cwd: resolve(import.meta.dir, ".."),
    encoding: "utf-8",
  });
  return JSON.parse(out.trim());
}

describe("UK AISI Inspect AI Task Definition (S3-INTOP-2)", () => {
  it("loads evergreen.py and exposes @task evergreen_insurance with docker-compose sandbox and MCP server", () => {
    const info = runPythonJson(`
import json
import evergreen

t = evergreen.evergreen_insurance(scenario=None, seed="all", modality_mode="strict")
print(json.dumps({
    "total_samples": len(t.dataset),
    "sandbox": list(t.sandbox),
    "modality_mode": t.metadata["modality_mode"],
    "recommended_models": t.metadata["recommended_models"],
    "comm_mcp_url": evergreen.COMM_MCP_URL,
}))
`);

    expect(info.total_samples).toBe(253);
    expect(info.sandbox).toEqual(["docker", "../../docker-compose.yml"]);
    expect(info.modality_mode).toBe("strict");
    expect(info.comm_mcp_url).toBe("http://localhost:3004/mcp");
    expect(info.recommended_models).toContain("google/gemini-3.8-flash");
    expect(info.recommended_models).toContain("google/gemini-4-argon");
  });

  it("filters dataset samples by scenario, seed, and difficulty including multi-turn scenarios 16-20", () => {
    const filtered = runPythonJson(`
import json
import evergreen

t_multi = evergreen.evergreen_insurance(scenario="16,17,18,19,20", seed="realistic", difficulty="natural")
print(json.dumps({
    "count": len(t_multi.dataset),
    "ids": [s.id for s in t_multi.dataset],
    "first_meta": t_multi.dataset[0].metadata,
}))
`);

    expect(filtered.count).toBe(5);
    expect(filtered.ids).toEqual([
      "16-realistic-natural",
      "17-realistic-natural",
      "18-realistic-natural",
      "19-realistic-natural",
      "20-realistic-natural",
    ]);
    expect(filtered.first_meta.scenario_id).toBe("16");
    expect(filtered.first_meta.modality_mode).toBe("strict");
  });
});
