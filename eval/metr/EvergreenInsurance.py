"""
METR Task Standard wrapper for Evergreen Insurance API Gym.

Exposes 15 benchmark scenarios (× seed variants × difficulty levels) as METR tasks.
Scoring delegates to the existing TypeScript scorer CLI.
"""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path
from typing import TypedDict

TASK_DIR = Path(__file__).parent
GYM_DIR = TASK_DIR.parent.parent  # eval/metr -> eval -> gym root


class Task(TypedDict):
    scenario_id: str
    scenario_name: str
    seed: str
    case_id: str
    prompt: str
    difficulty: str  # scenario difficulty: easy/medium/hard
    prompt_difficulty: str  # prompt difficulty: scripted/explicit/natural/vague/adversarial
    services: list[str]


class TaskFamily:
    standard_version = "0.5.0"

    @staticmethod
    def get_tasks() -> dict[str, Task]:
        tasks_path = TASK_DIR / "tasks.json"
        with open(tasks_path) as f:
            return json.load(f)

    @staticmethod
    def get_instructions(task: Task) -> str:
        services_desc = ", ".join(task["services"])
        return (
            f"You are an insurance agency assistant with access to the Evergreen Insurance API.\n"
            f"The API services ({services_desc}) are running on localhost ports 3000-3007.\n"
            f"All endpoints require a Bearer token obtained via POST /auth/token "
            f"(client_credentials grant, client_id=agent, client_secret=agent-secret).\n\n"
            f"OpenAPI specs are available at each service's /openapi.json endpoint.\n\n"
            f"## Task\n\n{task['prompt']}\n\n"
            f"## Submission\n\n"
            f"When finished, submit the path to your OTLP trace file (JSON format) "
            f"containing all HTTP spans from your API interactions."
        )

    @staticmethod
    def install() -> None:
        # Bun and Docker are provided by the Dockerfile
        pass

    @staticmethod
    def start(task: Task) -> None:
        seed = task["seed"]
        env_seed = "clean" if seed == "clean" else "realistic"

        # Build and start gym services
        subprocess.run(
            ["docker", "compose", "up", "-d", "--wait"],
            cwd=str(GYM_DIR),
            env={"SEED_MODE": env_seed, "PATH": "/usr/local/bin:/usr/bin:/bin"},
            check=True,
            timeout=120,
        )

        # Wait for health checks (docker compose --wait handles most of this,
        # but give services a moment to fully initialize)
        time.sleep(2)

    @staticmethod
    def score(task: Task, submission: str) -> float | None:
        """Score agent performance by running the TypeScript scorer on submitted traces.

        Args:
            task: The task definition.
            submission: Path to an OTLP JSON trace file.
        """
        trace_path = Path(submission)
        if not trace_path.exists():
            return 0.0

        result = subprocess.run(
            [
                "bun",
                "eval/score.ts",
                "--traces", str(trace_path),
                "--scenario", task["scenario_id"],
                "--seed", task["seed"],
                "--case", task["case_id"],
                "--out", "/tmp/metr-score",
            ],
            cwd=str(GYM_DIR),
            capture_output=True,
            text=True,
            timeout=60,
        )

        if result.returncode != 0:
            return None

        # Read the JSON report
        report_path = Path(f"/tmp/metr-score/{task['scenario_id']}-report.json")
        if not report_path.exists():
            return None

        with open(report_path) as f:
            report = json.load(f)

        return float(report["overall"]["score"])

    @staticmethod
    def teardown() -> None:
        subprocess.run(
            ["docker", "compose", "down"],
            cwd=str(GYM_DIR),
            timeout=60,
        )
