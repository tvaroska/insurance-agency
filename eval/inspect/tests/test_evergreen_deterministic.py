"""Unit and integration tests for `evergreen_deterministic.py`."""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
from pathlib import Path

import pytest

import evergreen_deterministic as ed


def test_load_deterministic_scenarios_and_samples_filtering():
    scenarios = ed.load_deterministic_scenarios()
    assert [s["id"] for s in scenarios] == [
        "DT-01",
        "DT-02",
        "DT-03",
        "DT-04",
        "DT-05",
        "DT-06",
        "DT-07",
        "DT-08",
        "DT-09",
        "DT-10",
    ]
    for item in scenarios:
        assert len(item["turns"]) >= 2
        assert item["start_state"]["base"] in {"empty", "clean", "realistic"}

    all_samples = ed.load_deterministic_samples()
    assert len(all_samples) == 10
    assert all_samples[0].id == "DT-01-household-endorsement-swap"
    assert all_samples[0].metadata["scenario_id"] == "DT-01"
    assert len(all_samples[0].metadata["turns"]) == 3

    filtered = ed.load_deterministic_samples(scenario="DT-02,DT-05,DT-09")
    assert [s.metadata["scenario_id"] for s in filtered] == ["DT-02", "DT-05", "DT-09"]

    hard_only = ed.load_deterministic_samples(difficulty="hard")
    assert [s.metadata["scenario_id"] for s in hard_only] == [
        "DT-03",
        "DT-05",
        "DT-06",
        "DT-07",
        "DT-08",
        "DT-09",
        "DT-10",
    ]


def test_build_seed_payloads_maps_carrier_names_and_defaults():
    urls = {
        "ams": "http://localhost:3000",
        "rater": "http://localhost:3001",
        "crm": "http://localhost:3002",
        "ecm": "http://localhost:3003",
        "comm": "http://localhost:3004",
        "summit-fire": "http://localhost:3005",
        "coastal-star": "http://localhost:3006",
        "claims": "http://localhost:3007",
    }
    start_state = {
        "base": "realistic",
        "tables": {
            "ams": {"clients": [{"id": "CLI-X"}]},
            "carrier-summit": {"quotes": [{"quote_id": "Q-1"}]},
            "carrier-coastal": {"id_cards": [{"card_id": "C-1"}]},
        },
    }
    payloads = ed.build_seed_payloads(start_state, urls)
    assert set(payloads.keys()) == set(urls.keys())
    assert payloads["ams"] == {"base": "realistic", "tables": {"clients": [{"id": "CLI-X"}]}}
    assert payloads["summit-fire"] == {"base": "realistic", "tables": {"quotes": [{"quote_id": "Q-1"}]}}
    assert payloads["coastal-star"] == {"base": "realistic", "tables": {"id_cards": [{"card_id": "C-1"}]}}
    assert payloads["claims"] == {"base": "realistic", "tables": {}}


def test_run_multiturn_conversation_accumulates_single_thread():
    observed_turn_lengths: list[int] = []

    class FakeGraph:
        async def ainvoke(self, payload: dict):
            msgs = list(payload["messages"])
            observed_turn_lengths.append(len(msgs))
            last_user = msgs[-1]["content"]
            return {"messages": [*msgs, {"role": "assistant", "content": f"ack:{last_user}"}]}

    turns = [
        {"role": "client", "message": "turn one"},
        {"role": "client", "message": "turn two"},
        {"role": "client", "message": "turn three"},
    ]
    final_messages = asyncio.run(ed.run_multiturn_conversation(FakeGraph(), turns))
    assert observed_turn_lengths == [1, 3, 5]
    assert len(final_messages) == 6
    assert final_messages[-1] == {"role": "assistant", "content": "ack:turn three"}


def test_contract_report_score_and_artifact_archiving(tmp_path: Path):
    work_dir = tmp_path / "work"
    work_dir.mkdir()
    (work_dir / "snapshot-before.json").write_text('{"ams":{}}')
    (work_dir / "snapshot-after.json").write_text('{"ams":{}}')
    report_path = work_dir / "contract-report.json"
    report = {
        "scenario_id": "DT-01",
        "base": "empty",
        "passed": True,
        "score": 1,
        "summary": "PASS | inserts 1/1 | updates 1/1 | deletes 0/0 | unexpected 0",
        "matchedInserts": [{"label": "james_collision_deductible_endorsement"}],
        "missingInserts": [],
        "matchedUpdates": [{"label": "james_phone_updated"}],
        "missingUpdates": [],
        "matchedDeletes": [],
        "missingDeletes": [],
        "unexpectedWrites": [],
        "allowedExtrasUsed": [],
        "extraGovernanceWrites": 0,
        "systemAuditWrites": 0,
        "diffSummary": {"insertedCount": 1, "updatedCount": 1, "deletedCount": 0, "totalMutations": 2},
    }
    report_path.write_text(json.dumps(report))

    archived = ed.archive_deterministic_artifacts(
        artifacts_root=tmp_path / "artifacts",
        model_name="google/gemini-3.8-flash",
        sample_id="DT-01-household-endorsement-swap",
        epoch=1,
        work_dir=work_dir,
        report_path=report_path,
    )
    archived_dir = Path(archived)
    assert (archived_dir / "contract-report.json").exists()
    assert (archived_dir / "snapshot-before.json").exists()
    assert (archived_dir / "snapshot-after.json").exists()
    sums = (archived_dir / "sha256sums.txt").read_text()
    assert "contract-report.json" in sums
    assert "snapshot-before.json" in sums
    assert "snapshot-after.json" in sums

    score_ok = ed.contract_report_score(report, answer="Done", work_dir=archived_dir)
    assert score_ok.value == 1.0
    assert score_ok.metadata["passed"] is True

    fail_report = {**report, "passed": False, "score": 0, "summary": "FAIL | unexpected 1"}
    score_fail = ed.contract_report_score(fail_report, answer="Oops", work_dir=archived_dir)
    assert score_fail.value == 0.0
    assert score_fail.metadata["passed"] is False


def test_python_to_bun_score_snapshots_round_trip(tmp_path: Path):
    before = {
        "ams": {"clients": [], "policies": [], "endorsements": [], "escalations": [], "escalation_events": []},
        "rater": {"quote_requests": [], "carrier_quotes": [], "carriers": []},
    }
    after = {
        "ams": {
            "clients": [],
            "policies": [],
            "endorsements": [],
            "escalations": [
                {
                    "escalation_id": "esc_1",
                    "client_id": "CLI-DT04-A",
                    "policy_id": "POL-PA-DT04-A",
                    "reason": "state_minimum_violation",
                    "summary": "Client asked for 15/30/10 in TX",
                }
            ],
            "escalation_events": [{"id": 1, "escalation_id": "esc_1", "event_type": "created"}],
        },
        "rater": {"quote_requests": [], "carrier_quotes": [], "carriers": []},
    }
    before_path = tmp_path / "before.json"
    after_path = tmp_path / "after.json"
    out_path = tmp_path / "contract-report.json"
    before_path.write_text(json.dumps(before))
    after_path.write_text(json.dumps(after))

    res = subprocess.run(
        [
            os.environ.get("BUN_BIN", "bun"),
            "eval/run-state-scenarios.ts",
            "--score-snapshots",
            "--scenario",
            "DT-04",
            "--before",
            str(before_path),
            "--after",
            str(after_path),
            "--out",
            str(out_path),
        ],
        cwd=str(ed.GYM_ROOT),
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert res.returncode == 0, res.stderr
    parsed = json.loads(out_path.read_text())
    assert parsed["passed"] is True
    assert parsed["score"] == 1
    assert len(parsed["allowedExtrasUsed"]) == 1
    assert parsed["systemAuditWrites"] == 1
    assert parsed["extraGovernanceWrites"] == 0


def test_prepare_and_multiturn_agent_pass_turns_via_store_not_agent_state_metadata(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    if not ed._HAS_INSPECT:
        pytest.skip("inspect_ai not installed")

    from inspect_ai.agent import AgentState

    fake_store: dict[str, object] = {}

    class _FakeStore:
        def get(self, key: str, default=None):
            return fake_store.get(key, default)

        def set(self, key: str, value: object):
            fake_store[key] = value

    class _FakeTaskState:
        sample_id = "DT-01-household-endorsement-swap"
        epoch = 1
        metadata = {
            "modality_mode": "strict",
            "start_state": {"base": "empty", "tables": {}},
            "turns": [
                {"role": "client", "message": "turn 1"},
                {"role": "client", "message": "turn 2"},
            ],
        }
        store = _FakeStore()

    async def _noop_modality(http, urls, mode):
        return None

    async def _noop_seed(http, urls, start_state):
        return None

    async def _fake_snapshot(http, urls):
        return {"ams": {}}

    monkeypatch.setattr(ed, "check_modality", _noop_modality)
    monkeypatch.setattr(ed, "seed_services", _noop_seed)
    monkeypatch.setattr(ed, "take_snapshot", _fake_snapshot)

    async def _run_prepare():
        solver = ed.prepare_state_scenario()
        state = _FakeTaskState()
        try:
            await solver(state, None)
        finally:
            await ed.release_services(state)

    asyncio.run(_run_prepare())
    assert fake_store[ed.TURNS_KEY] == _FakeTaskState.metadata["turns"]
    assert Path(str(fake_store[ed.WORK_DIR_KEY]), "snapshot-before.json").exists()

    # Confirm real AgentState has no `.metadata` attribute and multiturn agent reads store().
    agent_state = AgentState(messages=[])
    assert not hasattr(agent_state, "metadata")
    observed_turns: list[dict] = []

    class _FakeBridge:
        def __init__(self, st):
            self.state = st

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

    async def _fake_open_mcp(stack, urls, work_dir):
        return []

    async def _fake_run_mt(graph, turns):
        observed_turns.extend(turns)
        return []

    monkeypatch.setattr(ed, "store", lambda: _FakeStore())
    monkeypatch.setattr(ed, "open_mcp_tools", _fake_open_mcp)
    monkeypatch.setattr(ed, "build_rest_tools", lambda rc: [])
    monkeypatch.setattr(ed, "create_agent", lambda model, tools, system_prompt: object())
    monkeypatch.setattr(ed, "agent_bridge", lambda st, **kw: _FakeBridge(st))
    monkeypatch.setattr(ed, "run_multiturn_conversation", _fake_run_mt)

    agent_fn = ed.multiturn_langchain_agent()
    asyncio.run(agent_fn(agent_state))
    assert observed_turns == _FakeTaskState.metadata["turns"]


def test_summarize_deterministic_reads_archived_v1_logs_and_manifest(tmp_path: Path):
    if not ed._HAS_INSPECT:
        pytest.skip("inspect_ai not installed")

    import summarize_deterministic as sd

    logs_dir = ed.GYM_ROOT / "eval" / "results" / "deterministic-v1" / "logs"
    if not logs_dir.is_dir():
        pytest.skip("deterministic-v1 logs not present")

    md_out = tmp_path / "summary.md"
    json_out = tmp_path / "summary-report.json"
    manifest_out = tmp_path / "replay-manifest.json"
    rc = sd.main(
        [
            str(logs_dir),
            "--artifacts-dir",
            str(ed.GYM_ROOT / "eval" / "results" / "deterministic-v1" / "artifacts"),
            "--md-out",
            str(md_out),
            "--json-out",
            str(json_out),
            "--export-replay-manifest",
            str(manifest_out),
        ]
    )
    assert rc == 0
    report = json.loads(json_out.read_text(encoding="utf-8"))
    assert report["total_trials"] == 50
    assert len(report["models"]) == 5
    md_text = md_out.read_text(encoding="utf-8")
    assert "None: None" not in md_text
    assert "`claude-sonnet-5-5`" in md_text
    assert "`gemini-4-hydrogen`" in md_text
    assert "`gpt-oss-120b`" in md_text

    manifest = json.loads(manifest_out.read_text(encoding="utf-8"))
    assert manifest["benchmark"] == "evergreen_deterministic_state"
    assert manifest["total_trials"] == 50
    assert all(t["eval_log"].startswith("eval/results/deterministic-v1/logs/") for t in manifest["trials"])
