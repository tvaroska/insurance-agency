"""
OpenEnv (Meta PyTorch / Hugging Face) & Prime Intellect `verifiers` RL Gym Environment
for Evergreen Insurance API Gym (`eval/openenv/evergreen_env.py`).

Provides:
  1. `EvergreenGymEnv`: Gymnasium / OpenEnv-compatible environment (`reset`, `step`,
     `snapshot`, `score`, `time_travel`, `chaos`) backed by `/sim/*` and `eval/score.ts`.
  2. `EvergreenVerifiersEnv` & `load_environment()`: Prime Intellect `verifiers` (`vf.ToolEnv`)
     adapter with vectorized reward rubric for online RL training (GRPO / RLOO).
"""

from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

OPENENV_DIR = Path(__file__).resolve().parent
EVAL_DIR = OPENENV_DIR.parent
GYM_ROOT = EVAL_DIR.parent
TASKS_JSON_PATH = EVAL_DIR / "metr" / "tasks.json"

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

SERVICE_PORT_MAP: dict[str, int] = {v: k for k, v in PORT_SERVICE_MAP.items()}


@dataclass
class StepAction:
    """Action dispatched to an Evergreen microservice during an RL trajectory step."""

    service: str
    method: str = "GET"
    path: str = "/v1/clients"
    body: dict[str, Any] | None = None
    headers: dict[str, str] = field(default_factory=dict)
    done: bool = False


class EvergreenGymEnv:
    """Gymnasium / OpenEnv-compatible RL environment for Evergreen Insurance API Gym."""

    metadata = {"render_modes": ["ansi", "json"], "name": "EvergreenInsuranceGym-v0"}

    def __init__(
        self,
        task_id: str = "01-realistic-natural",
        max_steps: int = 30,
        host: str = "http://localhost",
        http_handler: Callable[[str, str, dict[str, Any] | None, dict[str, str]], tuple[int, Any]] | None = None,
        scorer_fn: Callable[[dict[str, Any], list[dict[str, Any]]], dict[str, Any]] | None = None,
    ) -> None:
        self.tasks = json.loads(TASKS_JSON_PATH.read_text())
        if task_id not in self.tasks:
            raise ValueError(f"Unknown task_id '{task_id}'. Total available: {len(self.tasks)}")
        self.task_id = task_id
        self.current_task = self.tasks[task_id]
        self.max_steps = max_steps
        self.host = host.rstrip("/")
        self._http_handler = http_handler
        self._scorer_fn = scorer_fn
        self.step_count = 0
        self.recorded_spans: list[dict[str, Any]] = []
        self._bearer_token: str | None = None

    def _request_json(
        self,
        method: str,
        url: str,
        body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, Any]:
        req_headers = {"Content-Type": "application/json", **(headers or {})}
        if self._http_handler is not None:
            return self._http_handler(method, url, body, req_headers)

        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read().decode("utf-8")
                return resp.status, json.loads(raw) if raw else {}
        except urllib.error.HTTPError as err:
            raw = err.read().decode("utf-8")
            try:
                parsed = json.loads(raw) if raw else {"error": str(err)}
            except Exception:
                parsed = {"error": raw or str(err)}
            return err.code, parsed

    def reset(
        self,
        *,
        seed: int | str | None = None,
        options: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Reset all 8 microservices via `POST /sim/reset` (<100ms in-memory/SQLite reset)."""
        if options and "task_id" in options:
            tid = str(options["task_id"])
            if tid not in self.tasks:
                raise ValueError(f"Unknown task_id '{tid}'")
            self.task_id = tid
            self.current_task = self.tasks[tid]

        seed_mode = (
            options.get("seed_mode")
            if options and "seed_mode" in options
            else (seed if isinstance(seed, str) else self.current_task["seed"])
        )
        effective_seed = "clean" if seed_mode == "clean" else "realistic"

        self.step_count = 0
        self.recorded_spans = []

        reset_statuses: dict[str, Any] = {}
        for port, service in PORT_SERVICE_MAP.items():
            url = f"{self.host}:{port}/sim/reset"
            status_code, payload = self._request_json(
                "POST", url, {"seed_mode": effective_seed}
            )
            reset_statuses[service] = {"status_code": status_code, "response": payload}

        obs = {
            "task_id": self.task_id,
            "scenario_id": self.current_task["scenario_id"],
            "scenario_name": self.current_task["scenario_name"],
            "seed": self.current_task["seed"],
            "prompt": self.current_task["prompt"],
            "services": self.current_task["services"],
            "step": 0,
            "last_response": None,
        }
        info = {
            "reset_services": reset_statuses,
            "seed_mode": effective_seed,
        }
        return obs, info

    def step(
        self, action: dict[str, Any] | StepAction
    ) -> tuple[dict[str, Any], float, bool, bool, dict[str, Any]]:
        """Execute a tool/API action against an Evergreen microservice and record an OTLP span."""
        if isinstance(action, StepAction):
            act = {
                "service": action.service,
                "method": action.method,
                "path": action.path,
                "body": action.body,
                "headers": action.headers,
                "done": action.done,
            }
        else:
            act = dict(action)

        self.step_count += 1
        done = bool(act.get("done", False))
        truncated = self.step_count >= self.max_steps and not done

        if done:
            report = self.score()
            reward = float(report["overall"]["score"])
            obs = {
                "task_id": self.task_id,
                "step": self.step_count,
                "last_response": {"status": "completed"},
            }
            return obs, reward, True, False, {"report": report}

        service = str(act.get("service", "ams"))
        port = SERVICE_PORT_MAP.get(service, 3000)
        method = str(act.get("method", "GET")).upper()
        path = str(act.get("path", "/v1/clients"))
        if not path.startswith("/"):
            path = "/" + path
        url = f"{self.host}:{port}{path}"

        start_ns = time.time_ns()
        status_code, response_body = self._request_json(
            method,
            url,
            act.get("body"),
            act.get("headers"),
        )
        end_ns = max(start_ns + 1_000_000, time.time_ns())

        self.recorded_spans.append(
            {
                "traceId": f"{self.step_count:032x}",
                "spanId": f"{self.step_count:016x}",
                "name": f"{method} {path}",
                "kind": 3,
                "startTimeUnixNano": str(start_ns),
                "endTimeUnixNano": str(end_ns),
                "attributes": [
                    {"key": "http.request.method", "value": {"stringValue": method}},
                    {"key": "url.full", "value": {"stringValue": url}},
                    {"key": "http.response.status_code", "value": {"intValue": status_code}},
                ],
            }
        )

        reward = 0.0
        info: dict[str, Any] = {"status_code": status_code, "url": url}
        if truncated:
            report = self.score()
            reward = float(report["overall"]["score"])
            info["report"] = report

        obs = {
            "task_id": self.task_id,
            "step": self.step_count,
            "last_response": {
                "status_code": status_code,
                "body": response_body,
            },
        }
        return obs, reward, False, truncated, info

    def snapshot(self, services: list[str] | None = None) -> dict[str, Any]:
        """Query `GET /sim/snapshot` across all (or specified) microservices."""
        targets = services or list(SERVICE_PORT_MAP.keys())
        snapshots: dict[str, Any] = {}
        for svc in targets:
            port = SERVICE_PORT_MAP[svc]
            _, payload = self._request_json("GET", f"{self.host}:{port}/sim/snapshot")
            snapshots[svc] = payload
        return snapshots

    def time_travel(
        self,
        *,
        days: float | None = None,
        target_date: str | None = None,
        services: list[str] | None = None,
    ) -> dict[str, Any]:
        """Advance the simulated clock via `POST /sim/time-travel`."""
        if days is None and not target_date:
            raise ValueError("Provide either `days` or `target_date`.")
        body: dict[str, Any] = {}
        if days is not None:
            body["days"] = days
        if target_date is not None:
            body["target_date"] = target_date

        targets = services or list(SERVICE_PORT_MAP.keys())
        results: dict[str, Any] = {}
        for svc in targets:
            port = SERVICE_PORT_MAP[svc]
            _, payload = self._request_json(
                "POST", f"{self.host}:{port}/sim/time-travel", body
            )
            results[svc] = payload
        return results

    def chaos(
        self,
        *,
        enabled: bool,
        error_rate: float = 0.0,
        status_code: int = 503,
        latency_ms: int = 0,
        services: list[str] | None = None,
    ) -> dict[str, Any]:
        """Configure chaos fault injection via `POST /sim/chaos`."""
        body = {
            "enabled": enabled,
            "error_rate": error_rate,
            "status_code": status_code,
            "latency_ms": latency_ms,
        }
        targets = services or list(SERVICE_PORT_MAP.keys())
        results: dict[str, Any] = {}
        for svc in targets:
            port = SERVICE_PORT_MAP[svc]
            _, payload = self._request_json(
                "POST", f"{self.host}:{port}/sim/chaos", body
            )
            results[svc] = payload
        return results

    def export_otlp_trace(self) -> dict[str, Any]:
        """Return recorded HTTP interactions in OTLP JSON trace format."""
        return {
            "resourceSpans": [
                {
                    "resource": {
                        "attributes": [
                            {
                                "key": "service.name",
                                "value": {"stringValue": "openenv-agent"},
                            }
                        ]
                    },
                    "scopeSpans": [{"spans": list(self.recorded_spans)}],
                }
            ]
        }

    def score(self) -> dict[str, Any]:
        """Invoke `bun eval/score.ts` on the current trajectory and live backend state."""
        if self._scorer_fn is not None:
            return self._scorer_fn(self.current_task, self.recorded_spans)

        trace_dir = Path(f"/tmp/openenv-traces-{self.task_id}")
        trace_dir.mkdir(parents=True, exist_ok=True)
        trace_file = trace_dir / "trace.json"
        trace_file.write_text(json.dumps(self.export_otlp_trace(), indent=2))

        out_dir = trace_dir / "report"
        out_dir.mkdir(parents=True, exist_ok=True)

        cmd = [
            os.environ.get("BUN_BIN", "bun"),
            "eval/score.ts",
            "--traces",
            str(trace_file),
            "--scenario",
            self.current_task["scenario_id"],
            "--seed",
            self.current_task["seed"],
            "--case",
            self.current_task["case_id"],
            "--out",
            str(out_dir),
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
                f"Scorer CLI failed ({res.returncode}): {res.stderr or res.stdout}"
            )
        report_path = out_dir / f"{self.current_task['scenario_id']}-report.json"
        return json.loads(report_path.read_text())


class EvergreenVerifiersEnv:
    """Prime Intellect `verifiers` (`vf.ToolEnv`) compatible RL environment wrapper.

    Exposes vectorized reward functions (`eo_compliance_reward`, `trace_reward`,
    `output_reward`, `combined_reward`) for GRPO / RLOO training loops.
    """

    def __init__(
        self,
        scenario: str | None = None,
        seed: str = "realistic",
        difficulty: str | None = None,
        max_turns: int = 20,
        gym_env_factory: Callable[[str], EvergreenGymEnv] | None = None,
    ) -> None:
        raw_tasks: dict[str, dict[str, Any]] = json.loads(TASKS_JSON_PATH.read_text())
        scenario_set = (
            {s.strip().zfill(2) for s in scenario.split(",") if s.strip()}
            if scenario
            else None
        )
        self.dataset: list[dict[str, Any]] = []
        for tid in sorted(raw_tasks.keys()):
            t = raw_tasks[tid]
            if scenario_set and t["scenario_id"] not in scenario_set:
                continue
            if seed != "all" and t["seed"] != seed:
                continue
            if difficulty and t["prompt_difficulty"] != difficulty and t["difficulty"] != difficulty:
                continue
            self.dataset.append({"task_id": tid, **t})

        self.max_turns = max_turns
        self._gym_factory = gym_env_factory or (lambda tid: EvergreenGymEnv(task_id=tid, max_steps=max_turns))

    def get_rubric(self) -> dict[str, Callable[[dict[str, Any]], float]]:
        """Return Prime Intellect `verifiers` reward rubric functions."""
        return {
            "eo_compliance_reward": lambda report: 1.0 if report["overall"]["eoCompliant"] else 0.0,
            "trace_reward": lambda report: float(report["trace"]["score"]),
            "output_reward": lambda report: float(report["output"]["score"]),
            "combined_reward": lambda report: float(report["overall"]["score"]),
        }

    def rollout(
        self,
        task_id: str,
        actions: list[dict[str, Any] | StepAction],
    ) -> dict[str, Any]:
        """Execute a multi-step rollout on `task_id` and compute rubric rewards."""
        env = self._gym_factory(task_id)
        obs, reset_info = env.reset()
        trajectory: list[dict[str, Any]] = []

        final_info: dict[str, Any] = {}
        for act in actions:
            obs, reward, terminated, truncated, step_info = env.step(act)
            trajectory.append({"action": act, "obs": obs, "reward": reward})
            final_info = step_info
            if terminated or truncated:
                break

        report = final_info.get("report") or env.score()
        rubric = self.get_rubric()
        rewards = {name: fn(report) for name, fn in rubric.items()}
        return {
            "task_id": task_id,
            "reset_info": reset_info,
            "steps": len(trajectory),
            "report": report,
            "rewards": rewards,
        }


def load_environment(
    scenario: str | None = None,
    seed: str = "realistic",
    difficulty: str | None = None,
    max_turns: int = 20,
) -> EvergreenVerifiersEnv:
    """Prime Intellect Environments Hub entry point (`vf.load_environment`)."""
    return EvergreenVerifiersEnv(
        scenario=scenario,
        seed=seed,
        difficulty=difficulty,
        max_turns=max_turns,
    )
