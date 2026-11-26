"""Unit tests for OpenEnv adapter (`eval/openenv/evergreen_env.py`)."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import pytest

OPENENV_PATH = Path(__file__).resolve().parents[2] / "openenv" / "evergreen_env.py"


def _load_openenv_module():
    prev_dont_write = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec = importlib.util.spec_from_file_location("evergreen_openenv", OPENENV_PATH)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        sys.modules["evergreen_openenv"] = module
        spec.loader.exec_module(module)
        return module
    finally:
        sys.dont_write_bytecode = prev_dont_write


def test_step_rejects_control_plane_paths(monkeypatch: pytest.MonkeyPatch):
    openenv = _load_openenv_module()
    seen_requests: list[tuple[str, str, dict[str, str]]] = []

    def fake_http(method: str, url: str, body: dict[str, Any] | None, headers: dict[str, str]):
        seen_requests.append((method, url, dict(headers)))
        if url.endswith("/oauth/token"):
            return 200, {"access_token": "tok-123"}
        return 200, {"data": []}

    monkeypatch.setenv("EVERGREEN_SCORER_SECRET", "openenv-secret-99")
    env = openenv.EvergreenGymEnv(task_id="04-realistic-natural", http_handler=fake_http)
    env.reset()

    # Reset calls must include X-Evergreen-Scorer-Secret on all 8 services
    reset_calls = [r for r in seen_requests if r[1].endswith("/sim/reset")]
    assert len(reset_calls) == 8
    assert all(r[2].get("X-Evergreen-Scorer-Secret") == "openenv-secret-99" for r in reset_calls)
    seen_requests.clear()

    for bad_action in (
        {"service": "ams", "method": "POST", "path": "/sim/reset", "body": {"seed_mode": "clean"}},
        {"service": "ams", "method": "POST", "path": "/sim/seed", "body": {"base": "empty"}},
        {"service": "ams", "method": "GET", "path": "/sim/snapshot"},
        {"service": "ams", "method": "GET", "path": "/sim/trace"},
        {"service": "ams", "method": "POST", "path": "/v1/../sim/reset"},
        {"service": "ams", "method": "POST", "path": "/v1/%2e%2e/sim/reset"},
        {"service": "summit-fire", "method": "POST", "path": "/auth/portal-session"},
        {"service": "ams", "method": "GET", "path": "/workbench/api/overview"},
        {"service": "unknown-svc", "method": "GET", "path": "/v1/clients"},
    ):
        obs, _reward, terminated, _truncated, info = env.step(bad_action)
        assert not terminated
        assert info["status_code"] == 403
        assert obs["last_response"]["status_code"] == 403
        assert obs["last_response"]["body"]["error_code"] == "FORBIDDEN"

    assert seen_requests == []

    # Valid /v1/* call succeeds, but strips agent-forged scorer/internal headers
    obs, _reward, _term, _trunc, info = env.step(
        {
            "service": "ams",
            "method": "GET",
            "path": "/v1/clients",
            "headers": {
                "X-Eval-Scorer": "true",
                "X-Evergreen-Internal": "1",
                "X-Evergreen-Scorer-Secret": "openenv-secret-99",
                "X-Custom-Agent": "kept",
            },
        }
    )
    assert info["status_code"] == 200
    v1_calls = [r for r in seen_requests if r[1].endswith("/v1/clients")]
    assert len(v1_calls) == 1
    sent_headers = {k.lower(): v for k, v in v1_calls[0][2].items()}
    assert "x-eval-scorer" not in sent_headers
    assert "x-evergreen-internal" not in sent_headers
    assert "x-evergreen-scorer-secret" not in sent_headers
    assert sent_headers["x-custom-agent"] == "kept"


def test_custom_seed_tasks_pass_exact_variant_to_scorer_while_resetting_realistic(
    monkeypatch: pytest.MonkeyPatch,
):
    openenv = _load_openenv_module()
    tasks = json.loads(openenv.TASKS_JSON_PATH.read_text())
    custom_tasks = [
        tid for tid, t in tasks.items() if t["seed"] not in {"clean", "realistic"}
    ]
    custom_variants = {(tasks[tid]["scenario_id"], tasks[tid]["seed"]) for tid in custom_tasks}
    assert len(custom_variants) == 14
    scenario_09_custom = [
        tid for tid in custom_tasks if tasks[tid]["scenario_id"] == "09"
    ]
    assert len(scenario_09_custom) == 15

    seen_control_paths: list[str] = []

    def fake_http(method: str, url: str, body: dict[str, Any] | None, headers: dict[str, str]):
        seen_control_paths.append(url.split("://", 1)[1].split("/", 1)[1])
        if url.endswith("/sim/reset"):
            return 200, {"status": "reset", "seed_mode": body["seed_mode"]}
        if url.endswith("/sim/snapshot"):
            return 200, {"tables": {}}
        if url.endswith("/sim/trace"):
            return 200, {"resourceSpans": []}
        if url.endswith("/sim/chaos"):
            assert body is not None and body.get("enabled") is False
            return 200, {"status": "ok", "chaos": body}
        return 404, {}

    seen_seeds: list[tuple[str, str, str]] = []
    seen_trace_dirs: set[Path] = set()

    def fake_run(cmd, cwd=None, capture_output=False, text=False, timeout=None, check=False):
        seed_arg = cmd[cmd.index("--seed") + 1]
        sc_arg = cmd[cmd.index("--scenario") + 1]
        out_dir = Path(cmd[cmd.index("--out") + 1])
        seen_trace_dirs.add(out_dir.parent)
        seen_seeds.append((sc_arg, seed_arg, cmd[cmd.index("--case") + 1]))
        report = {
            "scenario": sc_arg,
            "caseId": cmd[cmd.index("--case") + 1],
            "seed": seed_arg,
            "overall": {"score": 0.0, "eoCompliant": True, "apiCalls": 0, "expectedRange": [5, 15]},
            "trace": {"score": 0.0, "checks": []},
            "output": {"score": 0.0, "checks": []},
            "eoTraps": [],
        }
        (out_dir / f"{sc_arg}-report.json").write_text(json.dumps(report))
        return type("Res", (), {"returncode": 0, "stdout": "", "stderr": ""})()

    monkeypatch.setattr(openenv.subprocess, "run", fake_run)

    # Verify one representative task for every one of the 14 custom-seed variants
    seen_variant_pairs: set[tuple[str, str]] = set()
    for tid in custom_tasks:
        pair = (tasks[tid]["scenario_id"], tasks[tid]["seed"])
        if pair in seen_variant_pairs:
            continue
        seen_variant_pairs.add(pair)
        env = openenv.EvergreenGymEnv(task_id=tid, http_handler=fake_http)
        _obs, reset_info = env.reset()
        assert reset_info["seed_mode"] == "realistic"
        report = env.score()
        assert report["seed"] == tasks[tid]["seed"]
        assert report["seed"] not in {"clean", "realistic"}

    assert len(seen_seeds) == 14
    assert len(seen_trace_dirs) == 14


def test_reset_and_snapshot_raise_on_non_2xx(monkeypatch: pytest.MonkeyPatch):
    openenv = _load_openenv_module()

    # 1. reset() raises on 403 / 500 instead of returning silently
    env_403 = openenv.EvergreenGymEnv(
        task_id="01-realistic-natural",
        http_handler=lambda method, url, body, headers: (403, {"error_code": "FORBIDDEN"}),
    )
    with pytest.raises(RuntimeError, match="HTTP 403"):
        env_403.reset()

    # 2. snapshot() raises on 500
    env_snap_500 = openenv.EvergreenGymEnv(
        task_id="01-realistic-natural",
        http_handler=lambda method, url, body, headers: (
            (500, {"error": "snapshot boom"}) if url.endswith("/sim/snapshot") else (200, {"status": "ok"})
        ),
    )
    with pytest.raises(RuntimeError, match="HTTP 500"):
        env_snap_500.snapshot()
    with pytest.raises(RuntimeError, match="HTTP 500"):
        env_snap_500.reset()

    # 3. export_otlp_trace() raises on non-2xx and transport errors (never silently falls back)
    env_trace_500 = openenv.EvergreenGymEnv(
        task_id="01-realistic-natural",
        http_handler=lambda method, url, body, headers: (
            (500, {"error": "trace boom"}) if url.endswith("/sim/trace") else (200, {"tables": {}})
        ),
    )
    with pytest.raises(RuntimeError, match="HTTP 500"):
        env_trace_500.export_otlp_trace()

    def raise_transport(method: str, url: str, body: dict[str, Any] | None, headers: dict[str, str]):
        raise ConnectionError("service down")

    env_conn_err = openenv.EvergreenGymEnv(task_id="01-realistic-natural", http_handler=raise_transport)
    with pytest.raises(RuntimeError, match="service down"):
        env_conn_err.export_otlp_trace()

    # 4. score() disables chaos before collecting trace/snapshot and uses a unique temp dir per episode
    events: list[tuple[str, Any]] = []

    def tracking_http(method: str, url: str, body: dict[str, Any] | None, headers: dict[str, str]):
        endpoint = "/" + url.split("://", 1)[1].split("/", 1)[1]
        events.append((endpoint, body))
        if endpoint == "/sim/trace":
            return 200, {"resourceSpans": []}
        if endpoint == "/sim/snapshot":
            return 200, {"tables": {}}
        return 200, {"status": "ok"}

    score_dirs: list[Path] = []

    def fake_score_run(cmd, cwd=None, capture_output=False, text=False, timeout=None, check=False):
        out_dir = Path(cmd[cmd.index("--out") + 1])
        score_dirs.append(out_dir.parent)
        sc = cmd[cmd.index("--scenario") + 1]
        (out_dir / f"{sc}-report.json").write_text(
            json.dumps({
                "scenario": sc,
                "overall": {"score": 1.0, "eoCompliant": True, "apiCalls": 0, "expectedRange": [0, 5]},
                "trace": {"score": 1.0, "checks": []},
                "output": {"score": 1.0, "checks": []},
                "eoTraps": [],
            })
        )
        return type("Res", (), {"returncode": 0, "stdout": "", "stderr": ""})()

    monkeypatch.setattr(openenv.subprocess, "run", fake_score_run)
    env = openenv.EvergreenGymEnv(task_id="01-realistic-natural", http_handler=tracking_http)
    env.reset()
    env.chaos(enabled=True, error_rate=0.5)
    events.clear()
    env.score()

    chaos_indices = [i for i, (ep, body) in enumerate(events) if ep == "/sim/chaos" and body and body["enabled"] is False]
    trace_indices = [i for i, (ep, _body) in enumerate(events) if ep == "/sim/trace"]
    snap_indices = [i for i, (ep, _body) in enumerate(events) if ep == "/sim/snapshot"]
    assert len(chaos_indices) == 8
    assert max(chaos_indices) < min(trace_indices)
    assert max(trace_indices) < min(snap_indices)

    env.reset()
    env.score()
    assert len(score_dirs) == 2 and score_dirs[0] != score_dirs[1]
