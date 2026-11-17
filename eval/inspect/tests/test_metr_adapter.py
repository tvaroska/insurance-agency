"""Unit tests for the METR Task Standard adapter (`eval/metr/EvergreenInsurance.py`)."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

METR_PATH = Path(__file__).resolve().parents[2] / "metr" / "EvergreenInsurance.py"


def _load_metr_module():
    prev_dont_write = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec = importlib.util.spec_from_file_location("evergreen_metr", METR_PATH)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        sys.dont_write_bytecode = prev_dont_write


def test_task_family_start_propagates_scenario_id_and_resets_before_snapshot(monkeypatch, tmp_path):
    metr = _load_metr_module()
    events: list[tuple[str, object]] = []

    def fake_run(cmd, cwd=None, env=None, check=False, timeout=None):
        events.append(("compose_up", {"cmd": cmd, "env": dict(env or {})}))
        return MagicMock(returncode=0)

    class _FakeResp:
        def __init__(self, status: int, body: dict):
            self.status = status
            self._body = json.dumps(body).encode("utf-8")

        def read(self):
            return self._body

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_urlopen(req, timeout=None):
        body = json.loads(req.data.decode("utf-8")) if req.data else None
        headers = {k.lower(): v for k, v in req.header_items()}
        events.append(("http", {"method": req.get_method(), "url": req.full_url, "body": body, "headers": headers}))
        if req.full_url.endswith("/sim/reset"):
            return _FakeResp(200, {"status": "reset"})
        return _FakeResp(200, {"tables": {}})

    monkeypatch.setenv("EVERGREEN_SCORER_SECRET", "metr-test-secret")
    monkeypatch.setenv("EVERGREEN_BASE_PORT", "3200")
    monkeypatch.setattr(metr.subprocess, "run", fake_run)
    monkeypatch.setattr(metr.time, "sleep", lambda _s: None)
    monkeypatch.setattr(metr.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(metr, "SNAPSHOT_BEFORE_PATH", tmp_path / "snapshot-before.json")

    metr.TaskFamily.start({
        "scenario_id": "07",
        "scenario_name": "storm-claim",
        "seed": "realistic",
        "case_id": "realistic-natural",
        "prompt": "Test",
        "difficulty": "medium",
        "prompt_difficulty": "natural",
        "services": ["ams", "comm", "claims"],
    })

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
    # Every /sim/reset must complete before the first /sim/snapshot
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
        assert e["headers"]["x-evergreen-internal"] == "1"


def test_reset_all_services_raises_on_non_2xx(monkeypatch):
    metr = _load_metr_module()

    class _FailResp:
        status = 500

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(metr.urllib.request, "urlopen", lambda req, timeout=None: _FailResp())
    with pytest.raises(RuntimeError, match="HTTP 500"):
        metr._reset_all_services("realistic", "16")
