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
        modality_mode: str | None = None,
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
        self.modality_mode = modality_mode or os.environ.get("MODALITY_MODE", "strict")
        self._http_handler = http_handler
        self._scorer_fn = scorer_fn
        self.step_count = 0
        self.recorded_spans: list[dict[str, Any]] = []
        self._bearer_token: str | None = None
        self._portal_sessions: dict[str, dict[str, str]] = {}
        self._effective_seed: str = str(self.current_task["seed"])
        self._initial_snapshot: dict[str, Any] | None = None

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
        self._bearer_token = None
        self._portal_sessions = {}
        self._effective_seed = effective_seed

        reset_statuses: dict[str, Any] = {}
        for canonical_port, service in PORT_SERVICE_MAP.items():
            port = self._service_port(canonical_port)
            url = f"{self.host}:{port}/sim/reset"
            status_code, payload = self._request_json(
                "POST", url, {"seed_mode": effective_seed}
            )
            reset_statuses[service] = {"status_code": status_code, "response": payload}

        self._initial_snapshot = self.snapshot()

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

    def _ensure_bearer_token(self) -> str | None:
        if self._bearer_token:
            return self._bearer_token
        ams_port = self._service_port("ams")
        status_code, payload = self._request_json(
            "POST",
            f"{self.host}:{ams_port}/oauth/token",
            {
                "grant_type": "client_credentials",
                "client_id": os.environ.get("EVERGREEN_CLIENT_ID", "agent-full"),
                "client_secret": os.environ.get("EVERGREEN_CLIENT_SECRET", "dev-secret"),
            },
        )
        if status_code == 200 and isinstance(payload, dict) and isinstance(payload.get("access_token"), str):
            self._bearer_token = payload["access_token"]
            return self._bearer_token
        return None

    def _ensure_portal_headers(self, service: str) -> dict[str, str]:
        if service in self._portal_sessions:
            return dict(self._portal_sessions[service])
        port = self._service_port(service)
        cookie_header = ""
        if self._http_handler is None:
            try:
                with urllib.request.urlopen(f"{self.host}:{port}/", timeout=10) as boot_resp:
                    raw_cookie = boot_resp.headers.get("Set-Cookie") or ""
                    if raw_cookie:
                        cookie_header = raw_cookie.split(";", 1)[0]
            except Exception:
                cookie_header = ""
        boot_headers = {"Cookie": cookie_header} if cookie_header else {}
        status_code, payload = self._request_json(
            "POST",
            f"{self.host}:{port}/auth/portal-session",
            {"agent_code": "AG-EVERGREEN-01"},
            boot_headers,
        )
        out_headers: dict[str, str] = {}
        if cookie_header:
            out_headers["Cookie"] = cookie_header
        if status_code in (200, 201) and isinstance(payload, dict):
            token = payload.get("portal_session") or payload.get("session_token") or payload.get("token")
            if isinstance(token, str) and token:
                out_headers["X-Portal-Session"] = token
        self._portal_sessions[service] = out_headers
        return dict(out_headers)

    @staticmethod
    def _resolve_comm_mcp_call(
        method: str,
        path: str,
        body: dict[str, Any] | None,
        explicit_mcp_tool: str | None,
    ) -> tuple[str, dict[str, Any]] | None:
        if explicit_mcp_tool:
            tool_name = explicit_mcp_tool.removeprefix("comm_")
            return tool_name, dict(body or {})
        clean_path, _, query = path.partition("?")
        params: dict[str, Any] = dict(body or {})
        if query:
            for pair in query.split("&"):
                if "=" in pair:
                    k, v = pair.split("=", 1)
                    params.setdefault(k, urllib.request.unquote(v))
        if method == "POST" and clean_path == "/v1/messages/send":
            return "send_message", params
        if method == "GET" and clean_path == "/v1/messages/inbox":
            return "get_inbox", params
        if method == "GET" and clean_path == "/v1/messages":
            return "get_transcript", params
        if clean_path.startswith("/v1/webhooks"):
            return "manage_webhook", params
        return None

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
        canonical_port = SERVICE_PORT_MAP.get(service, 3000)
        port = self._service_port(canonical_port)
        method = str(act.get("method", "GET")).upper()
        path = str(act.get("path", "/v1/clients"))
        if not path.startswith("/"):
            path = "/" + path

        req_headers = dict(act.get("headers") or {})
        req_body = act.get("body")
        effective_method = method
        effective_path = path

        # Automatically attach OAuth Bearer JWT or strict carrier portal session headers when omitted
        if service in ("summit-fire", "coastal-star"):
            if "X-Portal-Session" not in req_headers and "x-portal-session" not in req_headers:
                for hk, hv in self._ensure_portal_headers(service).items():
                    req_headers.setdefault(hk, hv)
        elif "Authorization" not in req_headers and "authorization" not in req_headers:
            token = self._ensure_bearer_token()
            if token:
                req_headers["Authorization"] = f"Bearer {token}"

        # Route Comm Hub actions over Streamable HTTP MCP JSON-RPC under strict modality
        explicit_mcp = act.get("mcp_tool")
        if service == "comm" and (explicit_mcp or (self.modality_mode == "strict" and path != "/mcp")):
            mcp_resolved = self._resolve_comm_mcp_call(
                method, path, req_body if isinstance(req_body, dict) else None, str(explicit_mcp) if explicit_mcp else None
            )
            if mcp_resolved is not None:
                mcp_tool_name, mcp_args = mcp_resolved
                effective_method = "POST"
                effective_path = "/mcp"
                req_headers.setdefault("Accept", "application/json, text/event-stream")
                req_body = {
                    "jsonrpc": "2.0",
                    "id": self.step_count,
                    "method": "tools/call",
                    "params": {"name": mcp_tool_name, "arguments": mcp_args},
                }

        url = f"{self.host}:{port}{effective_path}"

        start_ns = time.time_ns()
        status_code, response_body = self._request_json(
            effective_method,
            url,
            req_body,
            req_headers,
        )
        end_ns = max(start_ns + 1_000_000, time.time_ns())

        if (
            effective_path == "/mcp"
            and isinstance(response_body, dict)
            and isinstance(response_body.get("result"), dict)
        ):
            content_items = response_body["result"].get("content")
            if isinstance(content_items, list) and content_items and isinstance(content_items[0], dict):
                raw_text = content_items[0].get("text")
                if isinstance(raw_text, str):
                    try:
                        response_body = json.loads(raw_text)
                    except Exception:
                        response_body = {"text": raw_text}

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
                    {"key": "url.full", "value": {"stringValue": f"{self.host}:{canonical_port}{path}"}},
                    {"key": "server.port", "value": {"intValue": canonical_port}},
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

    def _service_port(self, service_or_port: str | int) -> int:
        base_port = int(os.environ.get("EVERGREEN_BASE_PORT", "3000"))
        canonical = (
            service_or_port
            if isinstance(service_or_port, int)
            else SERVICE_PORT_MAP.get(service_or_port, 3000)
        )
        return base_port + (canonical - 3000)

    def _scorer_headers(self) -> dict[str, str]:
        headers = {"X-Eval-Scorer": "true"}
        secret = os.environ.get("EVERGREEN_SCORER_SECRET")
        if secret:
            headers["X-Evergreen-Scorer-Secret"] = secret
        return headers

    def snapshot(self, services: list[str] | None = None) -> dict[str, Any]:
        """Query `GET /sim/snapshot` across all (or specified) microservices."""
        targets = services or list(SERVICE_PORT_MAP.keys())
        snapshots: dict[str, Any] = {}
        headers = self._scorer_headers()
        for svc in targets:
            port = self._service_port(svc)
            _, payload = self._request_json(
                "GET", f"{self.host}:{port}/sim/snapshot", None, headers
            )
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
        headers = self._scorer_headers()
        for svc in targets:
            port = self._service_port(svc)
            _, payload = self._request_json(
                "POST", f"{self.host}:{port}/sim/time-travel", body, headers
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
        headers = self._scorer_headers()
        for svc in targets:
            port = self._service_port(svc)
            _, payload = self._request_json(
                "POST", f"{self.host}:{port}/sim/chaos", body, headers
            )
            results[svc] = payload
        return results

    def export_otlp_trace(self) -> dict[str, Any]:
        """Collect service-side OTLP traces (`GET /sim/trace`) across all 8 services, falling back to `self.recorded_spans` when running against mock handlers."""
        headers = self._scorer_headers()
        entries: list[tuple[int, dict[str, Any], dict[str, Any], dict[str, Any]]] = []
        saw_service_trace_endpoint = False

        for svc in SERVICE_PORT_MAP:
            port = self._service_port(svc)
            try:
                status_code, payload = self._request_json(
                    "GET", f"{self.host}:{port}/sim/trace", None, headers
                )
            except Exception:
                continue
            if status_code == 200 and isinstance(payload, dict) and isinstance(payload.get("resourceSpans"), list):
                saw_service_trace_endpoint = True
                for rs in payload["resourceSpans"]:
                    resource = rs.get("resource", {})
                    for ss in rs.get("scopeSpans", []):
                        scope = {k: v for k, v in ss.items() if k != "spans"}
                        for span in ss.get("spans", []):
                            start_ns = int(span.get("startTimeUnixNano", "0") or "0")
                            entries.append((start_ns, resource, scope, span))

        if saw_service_trace_endpoint:
            entries.sort(key=lambda item: item[0])
            resource_spans: list[dict[str, Any]] = []
            prev_resource: dict[str, Any] | None = None
            prev_scope: dict[str, Any] | None = None
            for _, resource, scope, span in entries:
                if resource != prev_resource or scope != prev_scope or not resource_spans:
                    resource_spans.append(
                        {
                            "resource": resource,
                            "scopeSpans": [{**scope, "spans": []}],
                        }
                    )
                    prev_resource = resource
                    prev_scope = scope
                resource_spans[-1]["scopeSpans"][0]["spans"].append(span)
            return {"resourceSpans": resource_spans}

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
        """Invoke `bun eval/score.ts` on the current trajectory and before/after 32-table snapshots."""
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
            self._effective_seed,
            "--case",
            self.current_task["case_id"],
            "--out",
            str(out_dir),
        ]
        if self._initial_snapshot is not None:
            before_file = trace_dir / "snapshot-before.json"
            after_file = trace_dir / "snapshot-after.json"
            before_file.write_text(json.dumps(self._initial_snapshot))
            after_file.write_text(json.dumps(self.snapshot()))
            cmd.extend(
                [
                    "--snapshot-before",
                    str(before_file),
                    "--snapshot-after",
                    str(after_file),
                ]
            )
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
        # Map `seed="realistic"` to each scenario's realistic variant or first non-clean messy variant in declaration order (e.g., 09-moderate)
        messy_seed_by_scenario: dict[str, str] = {}
        if seed == "realistic":
            by_sc_seeds: dict[str, list[str]] = {}
            for _tid, t_item in raw_tasks.items():
                sc_id = t_item["scenario_id"]
                s_val = t_item["seed"]
                if s_val != "clean" and s_val not in by_sc_seeds.setdefault(sc_id, []):
                    by_sc_seeds[sc_id].append(s_val)
            for sc_id, seeds_list in by_sc_seeds.items():
                messy_seed_by_scenario[sc_id] = "realistic" if "realistic" in seeds_list else seeds_list[0]

        self.dataset: list[dict[str, Any]] = []
        for tid, t in raw_tasks.items():
            if scenario_set and t["scenario_id"] not in scenario_set:
                continue
            if seed == "realistic":
                expected_seed = messy_seed_by_scenario.get(t["scenario_id"], "realistic")
                if t["seed"] != expected_seed:
                    continue
            elif seed != "all" and t["seed"] != seed:
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
