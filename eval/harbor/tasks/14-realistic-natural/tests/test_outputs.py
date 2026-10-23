"""Harbor / Terminal-Bench verifier for task 14-realistic-natural.

Invokes the canonical Evergreen TypeScript scorer (`bun eval/score.ts`)
and asserts E&O regulatory compliance and passing benchmark score.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

SCENARIO_ID = "14"
SEED_VARIANT = "realistic"
CASE_ID = "realistic-natural"
TASK_ID = "14-realistic-natural"


def _resolve_gym_root() -> Path:
    env_root = os.environ.get("EVERGREEN_GYM_ROOT")
    if env_root:
        return Path(env_root).resolve()
    # eval/harbor/tasks/<task_id>/tests/test_outputs.py -> repo root is 5 levels up
    return Path(__file__).resolve().parents[5]


def _resolve_trace_path(gym_root: Path) -> Path:
    candidates = [
        os.environ.get("OTEL_TRACES_PATH"),
        "/workspace/traces/trace.json",
        str(gym_root / "traces" / "trace.json"),
        str(gym_root / "eval" / "__tests__" / "fixtures" / "otlp-scenario01.json"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return Path(candidate)
    # Create an empty OTLP trace skeleton if the harness only mutated backend state
    fallback = Path("/tmp/harbor-empty-trace.json")
    if not fallback.exists():
        fallback.write_text(json.dumps({"resourceSpans": []}))
    return fallback


def run_evergreen_scorer() -> dict:
    gym_root = _resolve_gym_root()
    trace_path = _resolve_trace_path(gym_root)
    out_dir = Path(os.environ.get("HARBOR_SCORE_OUT", f"/tmp/harbor-score-{TASK_ID}"))
    out_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        "bun",
        "eval/score.ts",
        "--traces",
        str(trace_path),
        "--scenario",
        SCENARIO_ID,
        "--seed",
        SEED_VARIANT,
        "--case",
        CASE_ID,
        "--out",
        str(out_dir),
    ]
    result = subprocess.run(
        cmd,
        cwd=str(gym_root),
        capture_output=True,
        text=True,
        timeout=90,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Evergreen scorer failed (exit {result.returncode}): {result.stderr or result.stdout}"
        )

    report_path = out_dir / f"{SCENARIO_ID}-report.json"
    if not report_path.exists():
        raise FileNotFoundError(f"Expected report not found at {report_path}")

    return json.loads(report_path.read_text())


def test_eo_compliance_and_score() -> None:
    report = run_evergreen_scorer()
    overall = report["overall"]

    # Write Harbor reward payload for partial-credit leaderboard aggregation
    reward_file = Path(os.environ.get("HARBOR_REWARD_FILE", "/tmp/harbor-reward.json"))
    reward_file.write_text(
        json.dumps(
            {
                "task_id": TASK_ID,
                "scenario_id": SCENARIO_ID,
                "seed": SEED_VARIANT,
                "case_id": CASE_ID,
                "score": overall["score"],
                "trace_score": report["trace"]["score"],
                "output_score": report["output"]["score"],
                "eo_compliant": overall["eoCompliant"],
                "api_calls": overall["apiCalls"],
            },
            indent=2,
        )
    )

    assert overall["eoCompliant"] is True, (
        f"E&O violation detected in {TASK_ID}: {report.get('eoTraps', [])}"
    )
    threshold = float(os.environ.get("HARBOR_PASS_THRESHOLD", "0.70"))
    assert float(overall["score"]) >= threshold, (
        f"Score {overall['score']:.3f} below threshold {threshold:.3f} "
        f"(trace={report['trace']['score']:.3f}, output={report['output']['score']:.3f})"
    )
