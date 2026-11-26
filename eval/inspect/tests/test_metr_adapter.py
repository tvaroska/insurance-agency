"""Unit tests for the METR Task Standard adapter (`eval/metr/EvergreenInsurance.py`)."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import urllib.error
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest

import evergreen_langchain as inspect_harness

METR_PATH = Path(__file__).resolve().parents[2] / "metr" / "EvergreenInsurance.py"
OPENENV_PATH = Path(__file__).resolve().parents[2] / "openenv" / "evergreen_env.py"


def _load_module_no_bytecode(name: str, path: Path):
    prev_dont_write = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec = importlib.util.spec_from_file_location(name, path)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        sys.dont_write_bytecode = prev_dont_write


def _load_metr_module():
    return _load_module_no_bytecode("evergreen_metr", METR_PATH)


def _load_openenv_module():
    return _load_module_no_bytecode("evergreen_openenv_parity", OPENENV_PATH)


class _FakeResp:
    def __init__(self, status: int, body: dict[str, Any]):
        self.status = status
        self._body = json.dumps(body).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _sample_task() -> dict[str, Any]:
    return {
        "scenario_id": "07",
        "scenario_name": "storm-claim",
        "seed": "realistic",
        "case_id": "realistic-natural",
        "prompt": "Test",
        "difficulty": "medium",
        "prompt_difficulty": "natural",
        "services": ["ams", "comm", "claims"],
    }


def test_task_family_start_propagates_scenario_id_and_resets_before_snapshot(monkeypatch, tmp_path):
    metr = _load_metr_module()
    events: list[tuple[str, object]] = []

    def fake_run(cmd, cwd=None, env=None, check=False, timeout=None):
        events.append(("compose_up", {"cmd": cmd, "env": dict(env or {})}))
        return MagicMock(returncode=0)

    def fake_urlopen(req, timeout=None):
        body = json.loads(req.data.decode("utf-8")) if req.data else None
        headers = {k.lower(): v for k, v in req.header_items()}
        events.append(("http", {"method": req.get_method(), "url": req.full_url, "body": body, "headers": headers}))
        if req.full_url.endswith("/sim/reset"):
            return _FakeResp(200, {"status": "reset"})
        return _FakeResp(200, {"tables": {}})

    monkeypatch.setenv("EVERGREEN_SCORER_SECRET", "metr-test-secret")
    monkeypatch.setenv("EVERGREEN_BASE_PORT", "3200")
    monkeypatch.delenv("EVERGREEN_BASE_URLS", raising=False)
    monkeypatch.setattr(metr.subprocess, "run", fake_run)
    monkeypatch.setattr(metr.time, "sleep", lambda _s: None)
    monkeypatch.setattr(metr.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(metr, "SNAPSHOT_BEFORE_PATH", tmp_path / "snapshot-before.json")

    metr.TaskFamily.start(_sample_task())

    compose_events = [e[1] for e in events if e[0] == "compose_up"]
    assert len(compose_events) == 1
    assert compose_events[0]["env"]["SCENARIO_ID"] == "07"
    assert compose_events[0]["env"]["SEED_MODE"] == "realistic"
    assert compose_events[0]["env"]["MODALITY_MODE"] == "strict"
    assert compose_events[0]["env"]["SIMULATED_TODAY"] == "2026-10-14"

    http_events = [e[1] for e in events if e[0] == "http"]
    reset_events = [e for e in http_events if e["url"].endswith("/sim/reset")]
    snap_events = [e for e in http_events if e["url"].endswith("/sim/snapshot")]

    assert len(reset_events) == 8
    assert len(snap_events) == 8
    first_snap_idx = next(i for i, e in enumerate(http_events) if e["url"].endswith("/sim/snapshot"))
    last_reset_idx = max(i for i, e in enumerate(http_events) if e["url"].endswith("/sim/reset"))
    assert last_reset_idx < first_snap_idx

    expected_ports = [f"http://localhost:{3200 + i}/sim/reset" for i in range(8)]
    assert [e["url"] for e in reset_events] == expected_ports
    for e in reset_events:
        assert e["method"] == "POST"
        assert e["body"] == {"seed_mode": "realistic", "scenario_id": "07"}
        assert e["headers"]["x-eval-scorer"] == "true"
        assert e["headers"]["x-evergreen-scorer-secret"] == "metr-test-secret"


def test_reset_all_services_raises_on_non_2xx(monkeypatch):
    metr = _load_metr_module()

    class _FailResp:
        status = 500

        def read(self):
            return b'{"error":"boom"}'

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(metr.urllib.request, "urlopen", lambda req, timeout=None: _FailResp())
    with pytest.raises(RuntimeError, match="HTTP 500"):
        metr._reset_all_services("realistic", "16")


def test_score_ignores_submission(monkeypatch, tmp_path):
    metr = _load_metr_module()
    task = _sample_task()
    forged_submission = tmp_path / "forged-trace.json"
    forged_submission.write_text('{"resourceSpans": []}')

    collected_path = tmp_path / "metr-service-trace.json"
    # Attacker plants a directory at the fixed trace output path to force failure
    collected_path.mkdir()
    monkeypatch.setattr(metr, "COLLECTED_TRACE_PATH", collected_path)
    monkeypatch.setattr(metr, "SNAPSHOT_BEFORE_PATH", tmp_path / "nonexistent-before.json")

    seen_cmds: list[list[str]] = []
    monkeypatch.setattr(
        metr.subprocess,
        "run",
        lambda cmd, **kwargs: seen_cmds.append(list(cmd)) or MagicMock(returncode=0),
    )
    monkeypatch.setattr(
        metr.urllib.request,
        "urlopen",
        lambda req, timeout=None: (_ for _ in ()).throw(urllib.error.URLError("connection refused")),
    )

    with pytest.raises(RuntimeError, match="Could not collect the service-side trace"):
        metr.TaskFamily.score(task, submission=str(forged_submission))
    assert not collected_path.exists()
    assert seen_cmds == []


def test_score_fails_closed_when_trace_collection_fails(monkeypatch, tmp_path):
    metr = _load_metr_module()
    task = _sample_task()
    monkeypatch.setenv("EVERGREEN_SCORER_SECRET", "metr-secret")
    monkeypatch.setenv("EVERGREEN_BASE_PORT", "3000")
    monkeypatch.delenv("EVERGREEN_BASE_URLS", raising=False)
    monkeypatch.setattr(metr, "COLLECTED_TRACE_PATH", tmp_path / "trace.json")
    monkeypatch.setattr(metr, "SNAPSHOT_BEFORE_PATH", tmp_path / "before.json")

    def fail_on_comm(req, timeout=None):
        if ":3004/sim/trace" in req.full_url:
            return _FakeResp(403, {"error_code": "FORBIDDEN"})
        if req.full_url.endswith("/sim/snapshot"):
            return _FakeResp(500, {"error": "db offline"})
        return _FakeResp(200, {"resourceSpans": []})

    monkeypatch.setattr(metr.urllib.request, "urlopen", fail_on_comm)

    # export_otlp_trace fails closed on non-2xx just like eval/collect-trace.ts:88-91
    with pytest.raises(RuntimeError, match="HTTP 403"):
        metr.export_otlp_trace()

    # _capture_snapshot fails closed instead of returning {}
    with pytest.raises(RuntimeError, match="HTTP 500"):
        metr._capture_snapshot(tmp_path / "after.json")

    # TaskFamily.score() fails closed and never invokes eval/score.ts
    called_score = False

    def forbid_score(*args, **kwargs):
        nonlocal called_score
        called_score = True
        return MagicMock(returncode=0)

    monkeypatch.setattr(metr.subprocess, "run", forbid_score)
    with pytest.raises(RuntimeError, match="HTTP 403"):
        metr.TaskFamily.score(task)
    assert called_score is False


def test_adapters_issue_identical_control_requests(monkeypatch, tmp_path):
    metr = _load_metr_module()
    openenv = _load_openenv_module()

    monkeypatch.setenv("EVERGREEN_SCORER_SECRET", "shared-parity-secret")
    monkeypatch.setenv("EVERGREEN_BASE_PORT", "3300")
    monkeypatch.delenv("EVERGREEN_BASE_URLS", raising=False)

    def _normalize(
        method: str,
        url: str,
        headers: dict[str, str],
        body: Any,
    ) -> tuple[str, str, tuple[tuple[str, str], ...], Any]:
        lowered = {k.lower(): v for k, v in headers.items()}
        control_hdrs = tuple(
            sorted(
                (k, v)
                for k, v in lowered.items()
                if k in ("x-eval-scorer", "x-evergreen-scorer-secret", "x-evergreen-internal")
            )
        )
        return (method.upper(), url, control_hdrs, body)

    # 1. Inspect adapter (async httpx)
    inspect_reqs: list[tuple[str, str, tuple[tuple[str, str], ...], Any]] = []

    def inspect_handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8")) if request.content else None
        inspect_reqs.append(_normalize(request.method, str(request.url), dict(request.headers), body))
        if request.url.path == "/sim/reset":
            return httpx.Response(200, json={"status": "reset"})
        if request.url.path == "/sim/snapshot":
            return httpx.Response(200, json={"tables": {"clients": []}})
        if request.url.path == "/sim/trace":
            return httpx.Response(200, json={"resourceSpans": []})
        return httpx.Response(404, json={})

    async def _run_inspect():
        urls = inspect_harness.service_base_urls()
        async with httpx.AsyncClient(transport=httpx.MockTransport(inspect_handler)) as http:
            await inspect_harness.reset_services(http, urls, "realistic", scenario_id="07")
            await inspect_harness.take_snapshot(http, urls)
            await inspect_harness.collect_trace(http, urls)

    asyncio.run(_run_inspect())

    # 2. OpenEnv adapter (sync http_handler)
    openenv_reqs: list[tuple[str, str, tuple[tuple[str, str], ...], Any]] = []

    def openenv_handler(method: str, url: str, body: dict[str, Any] | None, headers: dict[str, str]):
        openenv_reqs.append(_normalize(method, url, headers, body))
        if url.endswith("/sim/reset"):
            return 200, {"status": "reset"}
        if url.endswith("/sim/snapshot"):
            return 200, {"tables": {"clients": []}}
        if url.endswith("/sim/trace"):
            return 200, {"resourceSpans": []}
        return 404, {}

    env = openenv.EvergreenGymEnv(task_id="07-realistic-natural", http_handler=openenv_handler)
    env.reset()  # issues 8x /sim/reset then 8x /sim/snapshot
    env.export_otlp_trace()  # issues 8x /sim/trace

    # 3. METR adapter (sync urllib.request)
    metr_reqs: list[tuple[str, str, tuple[tuple[str, str], ...], Any]] = []

    def metr_urlopen(req, timeout=None):
        body = json.loads(req.data.decode("utf-8")) if req.data else None
        headers = dict(req.header_items())
        metr_reqs.append(_normalize(req.get_method(), req.full_url, headers, body))
        if req.full_url.endswith("/sim/reset"):
            return _FakeResp(200, {"status": "reset"})
        if req.full_url.endswith("/sim/snapshot"):
            return _FakeResp(200, {"tables": {"clients": []}})
        if req.full_url.endswith("/sim/trace"):
            return _FakeResp(200, {"resourceSpans": []})
        return _FakeResp(404, {})

    monkeypatch.setattr(metr.urllib.request, "urlopen", metr_urlopen)
    metr._reset_all_services("realistic", "07")
    metr._capture_snapshot(tmp_path / "metr-snap.json")
    metr.export_otlp_trace()

    assert len(inspect_reqs) == 24
    assert sorted(inspect_reqs) == sorted(openenv_reqs) == sorted(metr_reqs)
    # Exact order parity across reset (0:8), snapshot (8:16), and trace (16:24)
    assert openenv_reqs == metr_reqs
    assert sorted(inspect_reqs[:8]) == sorted(metr_reqs[:8])
    assert inspect_reqs[8:16] == metr_reqs[8:16]
    assert sorted(inspect_reqs[16:24]) == sorted(metr_reqs[16:24])

    # All three adapters fail closed identically on HTTP 403
    async def _run_inspect_403():
        urls = inspect_harness.service_base_urls()
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _r: httpx.Response(403, json={"error": "forbidden"}))
        ) as http:
            await inspect_harness.take_snapshot(http, urls)

    with pytest.raises(RuntimeError, match="HTTP 403"):
        asyncio.run(_run_inspect_403())

    env_403 = openenv.EvergreenGymEnv(
        task_id="07-realistic-natural",
        http_handler=lambda *_a: (403, {"error": "forbidden"}),
    )
    with pytest.raises(RuntimeError, match="HTTP 403"):
        env_403.snapshot()

    monkeypatch.setattr(metr.urllib.request, "urlopen", lambda req, timeout=None: _FakeResp(403, {"error": "forbidden"}))
    with pytest.raises(RuntimeError, match="HTTP 403"):
        metr._capture_snapshot(tmp_path / "fail-snap.json")
