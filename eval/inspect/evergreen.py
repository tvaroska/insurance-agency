"""
UK AISI Inspect AI (`inspect_ai`) `@task` definition for Evergreen Insurance API Gym.

Delegates `@task def evergreen(...)` to the canonical typed-tool pipeline in
`evergreen_langchain.py` (`prepare_services`, `langchain_agent`,
`service_trace_scorer`, `release_services`) while exposing `GYM_ROOT` and
`load_evergreen_samples` for dataset loading and lightweight unit tests.

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
RECOMMENDED_MODELS = [
    "google/gemini-3.8-flash",
    "anthropic/vertex/claude-sonnet-5-5",
    "openai-api/vertex-maas/deepseek-ai/deepseek-v4.1-flash-maas",
    "google/gemini-4-argon",
]

# Graceful fallback shims so this module can be imported and unit-tested
# in environments without `inspect_ai` installed while using native `inspect_ai` at runtime.
try:
    from inspect_ai import Task, task
    from inspect_ai.dataset import MemoryDataset, Sample
    from inspect_ai.scorer import Score, Target, accuracy, scorer, stderr

    _HAS_INSPECT = True
except ImportError:  # pragma: no cover
    _HAS_INSPECT = False

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
        setup: Any = None
        solver: Any = None
        scorer: Any = None
        cleanup: Any = None
        turn_limit: int = 100
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


def load_evergreen_samples(
    scenario: str | int | list[str | int] | tuple[str | int, ...] | None = None,
    seed: str | None = "realistic",
    difficulty: str | None = None,
    modality_mode: str = "strict",
) -> list[Sample]:
    """Load and filter Evergreen Insurance tasks from `eval/metr/tasks.json`."""
    if not TASKS_JSON_PATH.exists():
        raise FileNotFoundError(f"Tasks catalog not found at {TASKS_JSON_PATH}")

    raw_tasks: dict[str, dict[str, Any]] = json.loads(TASKS_JSON_PATH.read_text())
    # Inspect CLI parses `-T scenario=01` as int 1 and `-T scenario=01,14,20` as a list.
    if scenario is None:
        scenario_filter = None
    elif isinstance(scenario, (list, tuple, set)):
        scenario_filter = {str(s).strip().zfill(2) for s in scenario if str(s).strip()}
    else:
        scenario_filter = {s.strip().zfill(2) for s in str(scenario).split(",") if s.strip()}

    samples: list[Sample] = []
    # Scenarios without a variant named `realistic` (e.g. 09: moderate / severe / market-exit)
    # use their first non-clean variant as the messy-data arm, so `seed=realistic` covers all 20.
    seeds_by_scenario: dict[str, list[str]] = {}
    for item in raw_tasks.values():
        seeds_by_scenario.setdefault(item["scenario_id"], [])
        if item["seed"] not in seeds_by_scenario[item["scenario_id"]]:
            seeds_by_scenario[item["scenario_id"]].append(item["seed"])

    def wanted_seed(scenario_id: str) -> str | None:
        if not seed or seed == "all":
            return None
        available = seeds_by_scenario.get(scenario_id, [])
        if seed == "realistic" and "realistic" not in available:
            messy = [s for s in available if s != "clean"]
            return messy[0] if messy else seed
        return seed

    for task_id in sorted(raw_tasks.keys()):
        item = raw_tasks[task_id]
        if scenario_filter and item["scenario_id"] not in scenario_filter:
            continue
        target_seed = wanted_seed(item["scenario_id"])
        if target_seed is not None and item["seed"] != target_seed:
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
    """Invoke `bun eval/score.ts` on an existing trace file and return the parsed `ScenarioReport`."""
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    trace_file = Path(trace_path)
    if not trace_file.exists():
        raise FileNotFoundError(f"Trace file not found: {trace_file}")

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
    """Offline trace-directory Inspect AI scorer wrapping `bun eval/score.ts`."""

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
def evergreen(
    scenario: str | None = None,
    seed: str = "realistic",
    difficulty: str | None = None,
    modality_mode: str = "strict",
    turn_limit: int = 100,
    learning_mechanism: str = "none",
    artifacts_dir: str | None = None,
) -> Task:
    """UK AISI Inspect AI `@task` for Evergreen Insurance API Gym.

    Delegates to the canonical `evergreen_langchain` typed-tool pipeline
    (`prepare_services`, `langchain_agent`, `service_trace_scorer`, `release_services`).
    """
    if _HAS_INSPECT:
        from evergreen_langchain import evergreen_langchain

        t = evergreen_langchain(
            scenario=scenario,
            seed=seed,
            difficulty=difficulty,
            modality_mode=modality_mode,
            turn_limit=turn_limit,
            learning_mechanism=learning_mechanism,
            artifacts_dir=artifacts_dir,
        )
        t.metadata = {**(t.metadata or {}), "recommended_models": list(RECOMMENDED_MODELS)}
        return t

    norm_learning = (learning_mechanism or "none").strip().lower().replace("-", "_")
    learning_label = "Domain skill (SOP)" if norm_learning == "domain_skill" else "None (zero-shot)"
    samples = load_evergreen_samples(
        scenario=scenario,
        seed=seed,
        difficulty=difficulty,
        modality_mode=modality_mode,
    )
    return Task(
        dataset=MemoryDataset(samples=samples, name="evergreen_insurance"),
        setup="prepare_services",
        solver="langchain_agent",
        scorer=evergreen_scorer(),
        cleanup="release_services",
        turn_limit=turn_limit,
        metadata={
            "benchmark": "evergreen_insurance_gym",
            "harness": "langchain create_agent via inspect agent_bridge",
            "harness_label": "Inspect + LangChain",
            "learning_mechanism": learning_label,
            "learning_mechanism_id": norm_learning,
            "modality_mode": modality_mode,
            "seed": seed,
            "scenario_filter": scenario,
            "difficulty_filter": difficulty,
            "recommended_models": list(RECOMMENDED_MODELS),
        },
    )


def evergreen_insurance(
    scenario: str | None = None,
    seed: str = "realistic",
    difficulty: str | None = None,
    modality_mode: str = "strict",
    turn_limit: int = 100,
    learning_mechanism: str = "none",
    artifacts_dir: str | None = None,
) -> Task:
    """Backwards-compatible Python callable alias for `evergreen(...)`."""
    return evergreen(
        scenario=scenario,
        seed=seed,
        difficulty=difficulty,
        modality_mode=modality_mode,
        turn_limit=turn_limit,
        learning_mechanism=learning_mechanism,
        artifacts_dir=artifacts_dir,
    )
