"""
METR Task Standard wrapper for Evergreen Insurance API Gym.

Exposes 20 benchmark scenarios (x seed variants x difficulty levels = 259 tasks) as METR tasks.
Runs under `MODALITY_MODE=strict`, collects authoritative server-side traces via
`bun eval/collect-trace.ts`, and evaluates pre/post database snapshots via `bun eval/score.ts`
with a 0.80 pass threshold.
"""

from __future__ import annotations

import json
import os
import secrets
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, TypedDict

TASK_DIR = Path(__file__).parent
GYM_DIR = TASK_DIR.parent.parent  # eval/metr -> eval -> gym root

_INSPECT_DIR = str(TASK_DIR.parent / "inspect")
if _INSPECT_DIR not in sys.path:
    sys.path.insert(0, _INSPECT_DIR)

import control_plane as _control_plane  # noqa: E402

PASS_THRESHOLD = 0.80
SNAPSHOT_BEFORE_PATH = Path("/tmp/metr-snapshot-before.json")
SNAPSHOT_AFTER_PATH = Path("/tmp/metr-snapshot-after.json")
COLLECTED_TRACE_PATH = Path("/tmp/metr-service-trace.json")
SCORER_SECRET_FILE = Path("/root/.evergreen-scorer-secret")

PORT_SERVICE_MAP: dict[int, str] = dict(_control_plane.PORT_SERVICE_MAP)


class Task(TypedDict):
    scenario_id: str
    scenario_name: str
    seed: str
    case_id: str
    prompt: str
    difficulty: str  # scenario difficulty: easy/medium/hard
    prompt_difficulty: str  # prompt difficulty: scripted/explicit/natural/vague/adversarial
    services: list[str]


def _resolve_scorer_secret(create_if_missing: bool = False) -> str:
    env_secret = os.environ.get("EVERGREEN_SCORER_SECRET")
    if env_secret:
        return env_secret
    try:
        if SCORER_SECRET_FILE.is_file():
            stored = SCORER_SECRET_FILE.read_text(encoding="utf-8").strip()
            if stored:
                return stored
    except OSError:
        pass
    if not create_if_missing:
        return ""
    minted = f"evergreen-metr-{secrets.token_hex(24)}"
    os.environ["EVERGREEN_SCORER_SECRET"] = minted
    try:
        SCORER_SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
        SCORER_SECRET_FILE.write_text(minted, encoding="utf-8")
        SCORER_SECRET_FILE.chmod(0o600)
    except OSError:
        pass
    return minted


def _scorer_headers() -> dict[str, str]:
    return _control_plane.scorer_headers(secret=_resolve_scorer_secret())


def _service_urls() -> dict[str, str]:
    return _control_plane.service_base_urls()


def _reset_all_services(seed_mode: str, scenario_id: str) -> None:
    _control_plane.reset_services(
        _service_urls(),
        seed_mode,
        scenario_id=scenario_id,
        secret=_resolve_scorer_secret(),
    )


def _capture_snapshot(out_path: Path) -> Path:
    snapshot = _control_plane.take_snapshot(
        _service_urls(),
        secret=_resolve_scorer_secret(),
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    return out_path


def export_otlp_trace() -> dict[str, Any]:
    """Collect service-side OTLP traces across all 8 services; fails closed on any non-2xx or error."""
    return _control_plane.export_otlp_trace(
        _service_urls(),
        secret=_resolve_scorer_secret(),
    )


class TaskFamily:
    standard_version = "0.5.0"
    pass_threshold = PASS_THRESHOLD

    @staticmethod
    def get_tasks() -> dict[str, Task]:
        tasks_path = TASK_DIR / "tasks.json"
        with open(tasks_path) as f:
            return json.load(f)

    @staticmethod
    def get_instructions(task: Task) -> str:
        services_desc = ", ".join(task["services"])
        return (
            f"You are an insurance agency assistant with access to the Evergreen Insurance API (`MODALITY_MODE=strict`).\n"
            f"The API services ({services_desc}) are running on localhost ports 3000-3007.\n"
            f"REST endpoints require a Bearer token obtained via POST http://localhost:3000/oauth/token "
            f"(client_credentials grant, client_id=agent-full, client_secret=dev-secret).\n"
            f"Comm Hub is enforced via MCP (`http://localhost:3004/mcp`), and carrier web portals run on "
            f"`http://localhost:3005/` (Summit Fire) and `http://localhost:3006/` (Coastal Star).\n\n"
            f"OpenAPI specs for REST services are available in the specs/ directory.\n\n"
            f"## Task\n\n{task['prompt']}\n\n"
            f"## Evaluation\n\n"
            f"Grading collects server-side request traces (`bun eval/collect-trace.ts`) and pre/post database snapshots "
            f"(`bun eval/score.ts`, pass threshold >= {PASS_THRESHOLD:.2f}, mandatory E&O compliance)."
        )

    @staticmethod
    def install() -> None:
        # Bun, Prisma clients, and Docker are provided by the Dockerfile
        pass

    @staticmethod
    def start(task: Task) -> None:
        seed = task["seed"]
        env_seed = "clean" if seed == "clean" else "realistic"
        scenario_id = str(task["scenario_id"])

        scorer_secret = _resolve_scorer_secret(create_if_missing=True)
        env = {
            **os.environ,
            "SEED_MODE": env_seed,
            "SCENARIO_ID": scenario_id,
            "MODALITY_MODE": "strict",
            "EVERGREEN_SCORER_SECRET": scorer_secret,
            "SIMULATED_TODAY": os.environ.get("SIMULATED_TODAY", "2026-10-14"),
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        }

        subprocess.run(
            ["docker", "compose", "up", "-d", "--wait"],
            cwd=str(GYM_DIR),
            env=env,
            check=True,
            timeout=120,
        )

        time.sleep(2)
        _reset_all_services(env_seed, scenario_id)
        _capture_snapshot(SNAPSHOT_BEFORE_PATH)

    @staticmethod
    def is_passing(report: dict[str, Any]) -> bool:
        overall = report.get("overall", {})
        return bool(overall.get("eoCompliant")) and float(overall.get("score", 0.0)) >= PASS_THRESHOLD

    @staticmethod
    def score(task: Task, submission: str = "") -> float | None:
        """Score agent performance strictly from server-side traces and snapshots; fails closed."""
        del submission  # Agent-supplied submission is untrusted and never scored as a trace.
        if COLLECTED_TRACE_PATH.is_dir() and not COLLECTED_TRACE_PATH.is_symlink():
            shutil.rmtree(COLLECTED_TRACE_PATH, ignore_errors=True)
        else:
            COLLECTED_TRACE_PATH.unlink(missing_ok=True)

        trace = export_otlp_trace()
        COLLECTED_TRACE_PATH.parent.mkdir(parents=True, exist_ok=True)
        COLLECTED_TRACE_PATH.write_text(json.dumps(trace, indent=2), encoding="utf-8")

        scorer_env = {**os.environ}
        secret = _resolve_scorer_secret()
        if secret:
            scorer_env["EVERGREEN_SCORER_SECRET"] = secret

        cmd = [
            "bun",
            "eval/score.ts",
            "--traces",
            str(COLLECTED_TRACE_PATH),
            "--scenario",
            task["scenario_id"],
            "--seed",
            task["seed"],
            "--case",
            task["case_id"],
            "--out",
            "/tmp/metr-score",
        ]
        if SNAPSHOT_BEFORE_PATH.exists():
            _capture_snapshot(SNAPSHOT_AFTER_PATH)
            cmd.extend([
                "--snapshot-before",
                str(SNAPSHOT_BEFORE_PATH),
                "--snapshot-after",
                str(SNAPSHOT_AFTER_PATH),
            ])

        result = subprocess.run(
            cmd,
            cwd=str(GYM_DIR),
            env=scorer_env,
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )

        if result.returncode != 0:
            raise RuntimeError(
                f"Scorer CLI failed ({result.returncode}): {result.stderr or result.stdout}"
            )

        report_path = Path(f"/tmp/metr-score/{task['scenario_id']}-report.json")
        if not report_path.exists():
            raise RuntimeError(f"Scorer report missing at {report_path}")

        with open(report_path) as f:
            report = json.load(f)

        if not report["overall"]["eoCompliant"]:
            return 0.0

        return float(report["overall"]["score"])

    @staticmethod
    def teardown() -> None:
        subprocess.run(
            ["docker", "compose", "down"],
            cwd=str(GYM_DIR),
            timeout=60,
        )
