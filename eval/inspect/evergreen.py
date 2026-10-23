"""
UK AISI Inspect AI (`inspect_ai`) native `@task` definition for Evergreen Insurance API Gym.

Provides:
  - Native multi-container Docker Compose sandbox (`sandbox=("docker", "../../docker-compose.yml")`)
  - Native Model Context Protocol registration (`mcp_server_http(name="comm", url="http://localhost:3004/mcp")`)
  - Composable `@scorer` invoking `bun eval/score.ts` and recording `eo_compliant`, `trace_score`, `output_score`
  - Dataset filtering across all 20 scenarios (253 total tasks in `eval/metr/tasks.json`)

Usage:
  inspect eval eval/inspect/evergreen.py --model google/gemini-3.8-flash
  inspect eval eval/inspect/evergreen.py --model google/gemini-4-argon -T scenario=08 -T seed=realistic -T modality_mode=strict
"""

from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

INSPECT_DIR = Path(__file__).resolve().parent
EVAL_DIR = INSPECT_DIR.parent
GYM_ROOT = EVAL_DIR.parent
TASKS_JSON_PATH = EVAL_DIR / "metr" / "tasks.json"
COMPOSE_PATH = str(GYM_ROOT / "docker-compose.yml")
COMM_MCP_URL = "http://localhost:3004/mcp"

# Graceful fallback shims so this module can be imported and unit-tested
# in environments without `inspect_ai` installed while using native `inspect_ai` at runtime.
try:
    from inspect_ai import Task, task
    from inspect_ai.dataset import MemoryDataset, Sample
    from inspect_ai.scorer import Score, Target, accuracy, scorer, stderr
    from inspect_ai.solver import basic_agent, system_message, use_tools
    from inspect_ai.tool import bash, mcp_server_http
except ImportError:  # pragma: no cover

    @dataclass
    class Sample:  # type: ignore[no-redef]
        input: str
        target: str = ""
        id: str | None = None
        metadata: dict[str, Any] = field(default_factory=dict)

    class MemoryDataset(list):  # type: ignore[no-redef]
        def __init__(self, samples: list[Sample], name: str = "evergreen_insurance") -> None:
            super().__init__(samples)
            self.samples = samples
            self.name = name

    @dataclass
    class Score:  # type: ignore[no-redef]
        value: float
        answer: str | None = None
        explanation: str | None = None
        metadata: dict[str, Any] = field(default_factory=dict)

    Target = Any  # type: ignore[misc,assignment]

    @dataclass
    class Task:  # type: ignore[no-redef]
        dataset: MemoryDataset
        solver: Any = None
        scorer: Any = None
        sandbox: tuple[str, str] = ("docker", "../../docker-compose.yml")
        metadata: dict[str, Any] = field(default_factory=dict)

    def task(fn: Callable[..., Any]) -> Callable[..., Any]:  # type: ignore[no-redef]
        fn.__is_inspect_task__ = True  # type: ignore[attr-defined]
        return fn

    def scorer(metrics: list[Any] | None = None) -> Callable[[Callable[..., Any]], Callable[..., Any]]:  # type: ignore[no-redef]
        def _wrap(fn: Callable[..., Any]) -> Callable[..., Any]:
            fn.__is_inspect_scorer__ = True  # type: ignore[attr-defined]
            fn.__metrics__ = metrics or []  # type: ignore[attr-defined]
            return fn

        return _wrap

    def accuracy() -> str:  # type: ignore[no-redef]
        return "accuracy"

    def stderr() -> str:  # type: ignore[no-redef]
        return "stderr"

    def mcp_server_http(name: str, url: str) -> dict[str, str]:  # type: ignore[no-redef]
        return {"type": "mcp_server_http", "name": name, "url": url}

    def bash(timeout: int = 120) -> dict[str, Any]:  # type: ignore[no-redef]
        return {"type": "bash", "timeout": timeout}

    def system_message(prompt: str) -> dict[str, Any]:  # type: ignore[no-redef]
        return {"type": "system_message", "prompt": prompt}

    def use_tools(*tools: Any) -> dict[str, Any]:  # type: ignore[no-redef]
        return {"type": "use_tools", "tools": list(tools)}

    def basic_agent(**kwargs: Any) -> dict[str, Any]:  # type: ignore[no-redef]
        return {"type": "basic_agent", **kwargs}


SYSTEM_INSTRUCTIONS = """You are an autonomous insurance agency operations assistant operating inside the Evergreen Insurance API Gym.

Active microservices run on localhost ports 3000-3007:
  - AMS (Agency Management System): http://localhost:3000/v1
  - Rater (Multi-Carrier Rating Engine): http://localhost:3001/v1
  - CRM (Leads, Campaigns, Analytics): http://localhost:3002/v1
  - ECM (Documents, ACORD Forms, COI): http://localhost:3003/v1
  - Comm Hub (Messages, Inbox, Webhooks, MCP): http://localhost:3004/mcp (or /v1 when permissive)
  - Summit Fire Carrier Portal: http://localhost:3005
  - Coastal Star Carrier Portal: http://localhost:3006
  - Claims (FNOL & Adjuster Assignment): http://localhost:3007/v1

Authentication:
  Obtain a Bearer token via POST http://localhost:3000/oauth/token with:
  grant_type=client_credentials, client_id=agent-full, client_secret=dev-secret

Regulatory & E&O Guardrails:
  Never backdate coverage, bind/endorse below state statutory minimums, bind policies > $10,000 annual premium without manager approval, or provide coverage opinions when an attorney is involved. Escalate mandatory triggers via POST /v1/escalations on AMS (:3000).
"""


def load_evergreen_samples(
    scenario: str | None = None,
    seed: str | None = "realistic",
    difficulty: str | None = None,
    modality_mode: str = "strict",
) -> list[Sample]:
    """Load and filter Evergreen Insurance tasks from `eval/metr/tasks.json`."""
    if not TASKS_JSON_PATH.exists():
        raise FileNotFoundError(f"Tasks catalog not found at {TASKS_JSON_PATH}")

    raw_tasks: dict[str, dict[str, Any]] = json.loads(TASKS_JSON_PATH.read_text())
    scenario_filter = (
        {s.strip().zfill(2) for s in scenario.split(",") if s.strip()}
        if scenario
        else None
    )

    samples: list[Sample] = []
    for task_id in sorted(raw_tasks.keys()):
        item = raw_tasks[task_id]
        if scenario_filter and item["scenario_id"] not in scenario_filter:
            continue
        if seed and seed != "all" and item["seed"] != seed:
            continue
        if difficulty and item["prompt_difficulty"] != difficulty and item["difficulty"] != difficulty:
            continue

        samples.append(
            Sample(
                id=task_id,
                input=item["prompt"],
                target=item["case_id"],
                metadata={
                    "task_id": task_id,
                    "scenario_id": item["scenario_id"],
                    "scenario_name": item["scenario_name"],
                    "seed": item["seed"],
                    "case_id": item["case_id"],
                    "difficulty": item["difficulty"],
                    "prompt_difficulty": item["prompt_difficulty"],
                    "services": item["services"],
                    "modality_mode": modality_mode,
                },
            )
        )

    return samples


def run_score_cli(
    scenario_id: str,
    seed: str,
    case_id: str,
    trace_path: str | Path,
    out_dir: str | Path = "/tmp/inspect-evergreen-score",
) -> dict[str, Any]:
    """Invoke `bun eval/score.ts` and return the parsed `ScenarioReport` dictionary."""
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    trace_file = Path(trace_path)
    if not trace_file.exists():
        trace_file = Path("/tmp/inspect-empty-trace.json")
        trace_file.write_text(json.dumps({"resourceSpans": []}))

    cmd = [
        os.environ.get("BUN_BIN", "bun"),
        "eval/score.ts",
        "--traces",
        str(trace_file),
        "--scenario",
        scenario_id,
        "--seed",
        seed,
        "--case",
        case_id,
        "--out",
        str(out_path),
    ]
    res = subprocess.run(
        cmd,
        cwd=str(GYM_ROOT),
        capture_output=True,
        text=True,
        timeout=90,
        check=False,
    )
    if res.returncode != 0:
        raise RuntimeError(
            f"bun eval/score.ts failed (code {res.returncode}): {res.stderr or res.stdout}"
        )

    report_file = out_path / f"{scenario_id}-report.json"
    return json.loads(report_file.read_text())


@scorer(metrics=[accuracy(), stderr()])
def evergreen_scorer(trace_dir: str = "/tmp/traces") -> Callable[..., Any]:
    """Custom Inspect AI scorer wrapping `bun eval/score.ts`."""

    async def score(state: Any, target: Target) -> Score:
        meta = getattr(state, "metadata", {}) or {}
        scenario_id = str(meta.get("scenario_id", "01"))
        seed = str(meta.get("seed", "realistic"))
        case_id = str(meta.get("case_id", f"{seed}-natural"))
        sample_id = str(getattr(state, "sample_id", meta.get("task_id", scenario_id)))

        candidate_trace = Path(trace_dir) / f"{sample_id}.json"
        if not candidate_trace.exists():
            candidate_trace = Path(os.environ.get("OTEL_TRACES_PATH", "/tmp/traces/trace.json"))

        try:
            report = run_score_cli(
                scenario_id=scenario_id,
                seed=seed,
                case_id=case_id,
                trace_path=candidate_trace,
            )
        except Exception as exc:
            return Score(
                value=0.0,
                answer=sample_id,
                explanation=f"Scorer error: {exc}",
                metadata={
                    "eo_compliant": False,
                    "trace_score": 0.0,
                    "output_score": 0.0,
                },
            )

        overall = report["overall"]
        trace_score = float(report["trace"]["score"])
        output_score = float(report["output"]["score"])
        eo_compliant = bool(overall["eoCompliant"])
        final_score = float(overall["score"])

        return Score(
            value=final_score,
            answer=sample_id,
            explanation=(
                f"Scenario {scenario_id} ({case_id}): score={final_score:.3f} "
                f"(trace={trace_score:.3f}, output={output_score:.3f}, eo_compliant={eo_compliant})"
            ),
            metadata={
                "eo_compliant": eo_compliant,
                "trace_score": trace_score,
                "output_score": output_score,
                "api_calls": overall["apiCalls"],
                "expected_range": overall["expectedRange"],
                "eo_traps": report.get("eoTraps", []),
            },
        )

    return score


@task
def evergreen_insurance(
    scenario: str | None = None,
    seed: str = "realistic",
    difficulty: str | None = None,
    modality_mode: str = "strict",
) -> Task:
    """UK AISI Inspect AI `@task` for Evergreen Insurance API Gym.

    Args:
        scenario: Optional scenario ID (`"01"`) or comma-separated IDs (`"01,08,16"`).
        seed: Seed variant (`"realistic"`, `"clean"`, or `"all"`).
        difficulty: Optional prompt difficulty (`"scripted"`, `"explicit"`, `"natural"`, `"vague"`, `"adversarial"`)
            or scenario difficulty (`"easy"`, `"medium"`, `"hard"`).
        modality_mode: `"strict"` (enforces MCP on `:3004` and Web UI sessions on `:3005/:3006`) or `"permissive"`.
    """
    samples = load_evergreen_samples(
        scenario=scenario,
        seed=seed,
        difficulty=difficulty,
        modality_mode=modality_mode,
    )
    dataset = MemoryDataset(samples=samples, name="evergreen_insurance")

    comm_mcp = mcp_server_http(name="comm", url=COMM_MCP_URL)
    solver = basic_agent(
        init=system_message(SYSTEM_INSTRUCTIONS),
        tools=[bash(timeout=120), comm_mcp],
    )

    return Task(
        dataset=dataset,
        solver=solver,
        scorer=evergreen_scorer(),
        sandbox=("docker", "../../docker-compose.yml"),
        metadata={
            "benchmark": "evergreen_insurance_gym",
            "modality_mode": modality_mode,
            "seed": seed,
            "scenario_filter": scenario,
            "difficulty_filter": difficulty,
            "recommended_models": [
                "google/gemini-3.8-flash",
                "google/gemini-4-argon",
                "google/gemini-3.5-flash-lite",
            ],
        },
    )
