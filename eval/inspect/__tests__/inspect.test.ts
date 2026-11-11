import { describe, it, expect } from "bun:test";
import { execFileSync } from "child_process";
import { resolve } from "path";

// System python3 exercises evergreen.py's dependency-free fallback path (fast, no inspect_ai import);
// the full inspect_ai pipeline is covered by `pytest eval/inspect/tests` in the evergreen-inspect venv.
const PYTHON_BIN = "python3";
const PY_TIMEOUT_MS = 30_000;

function runPythonJson(code: string): any {
  const out = execFileSync(PYTHON_BIN, ["-c", code], {
    cwd: resolve(import.meta.dir, ".."),
    encoding: "utf-8",
  });
  return JSON.parse(out.trim());
}

describe("UK AISI Inspect AI Task Definition (evergreen.py -> evergreen_langchain)", () => {
  it("loads evergreen.py and delegates @task evergreen to the typed LangChain pipeline", () => {
    const info = runPythonJson(`
import json
import evergreen

t = evergreen.evergreen(scenario=None, seed="all", modality_mode="strict", learning_mechanism="domain_skill")
print(json.dumps({
    "total_samples": len(t.dataset),
    "has_setup": t.setup is not None,
    "has_solver": t.solver is not None,
    "has_scorer": t.scorer is not None,
    "has_cleanup": t.cleanup is not None,
    "modality_mode": t.metadata["modality_mode"],
    "learning_mechanism": t.metadata["learning_mechanism"],
    "recommended_models": t.metadata["recommended_models"],
    "comm_mcp_url": evergreen.COMM_MCP_URL,
}))
`);

    expect(info.total_samples).toBe(259);
    expect(info.has_setup).toBe(true);
    expect(info.has_solver).toBe(true);
    expect(info.has_scorer).toBe(true);
    expect(info.has_cleanup).toBe(true);
    expect(info.modality_mode).toBe("strict");
    expect(info.learning_mechanism).toBe("Domain skill (SOP)");
    expect(info.comm_mcp_url).toBe("http://localhost:3004/mcp");
    expect(info.recommended_models).toContain("google/gemini-3.8-flash");
    expect(info.recommended_models).toContain("google/gemini-4-argon");
  }, PY_TIMEOUT_MS);

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
  }, PY_TIMEOUT_MS);
});
