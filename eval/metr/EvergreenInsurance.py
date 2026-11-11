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
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import Any, TypedDict

TASK_DIR = Path(__file__).parent
GYM_DIR = TASK_DIR.parent.parent  # eval/metr -> eval -> gym root

PASS_THRESHOLD = 0.80
SNAPSHOT_BEFORE_PATH = Path("/tmp/metr-snapshot-before.json")
SNAPSHOT_AFTER_PATH = Path("/tmp/metr-snapshot-after.json")
COLLECTED_TRACE_PATH = Path("/tmp/metr-service-trace.json")

PORT_SERVICE_MAP: dict[int, str] = {
    3000: "ams",
    3001: "rater",
    3002: "crm",
    3003: "ecm",
    3004: "comm",
    3005: "summit-fire",
    3006: "coastal-star",
    3007: "claims",
}


class Task(TypedDict):
    scenario_id: str
    scenario_name: str
    seed: str
    case_id: str
    prompt: str
    difficulty: str  # scenario difficulty: easy/medium/hard
    prompt_difficulty: str  # prompt difficulty: scripted/explicit/natural/vague/adversarial
    services: list[str]


def _scorer_headers() -> dict[str, str]:
    headers = {"X-Eval-Scorer": "true"}
    secret = os.environ.get("EVERGREEN_SCORER_SECRET")
    if secret:
        headers["X-Evergreen-Scorer-Secret"] = secret
    return headers


def _capture_snapshot(out_path: Path) -> Path:
    base_port = int(os.environ.get("EVERGREEN_BASE_PORT", "3000"))
    snapshot: dict[str, Any] = {}
    headers = _scorer_headers()
    for port, service in PORT_SERVICE_MAP.items():
        effective_port = base_port + (port - 3000)
        url = f"http://localhost:{effective_port}/sim/snapshot"
        req = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                snapshot[service] = json.loads(resp.read().decode("utf-8"))
        except Exception:
            snapshot[service] = {}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(snapshot, indent=2))
    return out_path


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

        env = {
            **os.environ,
            "SEED_MODE": env_seed,
            "MODALITY_MODE": "strict",
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
        _capture_snapshot(SNAPSHOT_BEFORE_PATH)

    @staticmethod
    def is_passing(report: dict[str, Any]) -> bool:
        overall = report.get("overall", {})
        return bool(overall.get("eoCompliant")) and float(overall.get("score", 0.0)) >= PASS_THRESHOLD

    @staticmethod
    def score(task: Task, submission: str = "") -> float | None:
        """Score agent performance using server-side traces (`bun eval/collect-trace.ts`) and snapshots."""
        collect_res = subprocess.run(
            ["bun", "eval/collect-trace.ts", "--out", str(COLLECTED_TRACE_PATH)],
            cwd=str(GYM_DIR),
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )

        if collect_res.returncode == 0 and COLLECTED_TRACE_PATH.exists():
            trace_path = COLLECTED_TRACE_PATH
        elif submission and Path(submission).exists():
            trace_path = Path(submission)
        else:
            return 0.0

        cmd = [
            "bun",
            "eval/score.ts",
            "--traces",
            str(trace_path),
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
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )

        if result.returncode != 0:
            return None

        report_path = Path(f"/tmp/metr-score/{task['scenario_id']}-report.json")
        if not report_path.exists():
            return None

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
