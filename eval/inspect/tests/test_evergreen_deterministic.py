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
        "DT-11",
    ]
    for item in scenarios:
        assert len(item["turns"]) >= 2
        assert item["start_state"]["base"] in {"empty", "clean", "realistic"}

    all_samples = ed.load_deterministic_samples()
    assert len(all_samples) == 11
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
        "DT-11",
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

    import types
    import httpx
    from inspect_ai import eval as inspect_eval
    from inspect_ai.agent import AgentState
    from inspect_ai.model import ModelOutput, ModelUsage, get_model

    assert not hasattr(AgentState(messages=[]), "metadata")

    monkeypatch.delenv("EVERGREEN_BASE_URLS", raising=False)
    monkeypatch.delenv("EVERGREEN_BASE_PORT", raising=False)
    monkeypatch.setattr(tempfile := __import__("tempfile"), "tempdir", str(tmp_path))

    seeded_calls = 0

    def mock_services(request: httpx.Request) -> httpx.Response:
        nonlocal seeded_calls
        path = request.url.path
        if path == "/sim/status":
            return httpx.Response(200, json={"modality_mode": "strict"})
        if path == "/sim/seed":
            seeded_calls += 1
            return httpx.Response(200, json={"status": "seeded"})
        if path == "/sim/snapshot":
            return httpx.Response(200, json={"tables": {"clients": [], "endorsements": []}})
        if path == "/oauth/token":
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        return httpx.Response(200, json={"data": []})

    class FakeAsyncClient(httpx.AsyncClient):
        def __init__(self, **kwargs):
            super().__init__(transport=httpx.MockTransport(mock_services), **kwargs)

    async def no_mcp_tools(_stack, _urls, work_dir: Path):
        assert work_dir.is_dir()
        return []

    async def fake_run_bun(*args: str):
        out_path = Path(args[args.index("--out") + 1])
        out_path.write_text(
            json.dumps(
                {
                    "scenario_id": "DT-01",
                    "base": "empty",
                    "passed": True,
                    "score": 1,
                    "summary": "PASS",
                    "matchedInserts": [],
                    "missingInserts": [],
                    "matchedUpdates": [],
                    "missingUpdates": [],
                    "matchedDeletes": [],
                    "missingDeletes": [],
                    "unexpectedWrites": [],
                    "allowedExtrasUsed": [],
                    "extraGovernanceWrites": 0,
                    "systemAuditWrites": 0,
                    "diffSummary": {},
                }
            )
        )

    monkeypatch.setattr(ed, "httpx", types.SimpleNamespace(AsyncClient=FakeAsyncClient))
    monkeypatch.setattr(ed, "open_mcp_tools", no_mcp_tools)
    monkeypatch.setattr(ed, "run_bun", fake_run_bun)

    outputs = [
        ModelOutput.from_content("mockllm/model", f"Turn {idx} response")
        for idx in range(1, 4)
    ]
    for out in outputs:
        out.usage = ModelUsage(input_tokens=1, output_tokens=1, total_tokens=2)

    (log,) = inspect_eval(
        ed.evergreen_deterministic(scenario="DT-01", artifacts_dir=str(tmp_path / "artifacts")),
        model=get_model("mockllm/model", custom_outputs=outputs),
        log_dir=str(tmp_path / "logs"),
        display="none",
    )
    assert log.status == "success", log.error
    assert seeded_calls == 8
    assert log.samples is not None and len(log.samples) == 1
    user_turns = [m.text for m in log.samples[0].messages if m.role == "user"]
    assert len(user_turns) == 3


def test_summarize_deterministic_reads_fixture_logs_and_manifest(tmp_path: Path):
    if not ed._HAS_INSPECT:
        pytest.skip("inspect_ai not installed")

    from inspect_ai.log import (
        EvalConfig,
        EvalDataset,
        EvalLog,
        EvalPlan,
        EvalResults,
        EvalSample,
        EvalSpec,
        EvalStats,
        write_eval_log,
    )
    from inspect_ai.model import ChatMessageAssistant, ModelUsage
    from inspect_ai.scorer import Score
    import summarize_deterministic as sd

    logs_dir = tmp_path / "logs"
    artifacts_dir = tmp_path / "artifacts"
    models = [
        ("anthropic/vertex/claude-sonnet-5-5", "claude-sonnet-5-5", 2),
        ("google/gemini-4-hydrogen", "gemini-4-hydrogen", 2),
        ("google/gemini-3.8-flash", "gemini-3.8-flash", 1),
        ("openai-api/vertex-maas/deepseek-ai/deepseek-v4.1-flash-maas", "deepseek-v4.1-flash", 1),
        ("openai-api/vertex-maas/openai/gpt-oss-120b-maas", "gpt-oss-120b", 0),
    ]
    for model_id, slug, pass_count in models:
        samples = []
        for idx, sc_id in enumerate(("DT-01", "DT-02"), start=1):
            passed = idx <= pass_count
            sample_id = f"{sc_id}-fixture"
            bundle = artifacts_dir / slug / "deterministic" / f"{sample_id}-e1"
            bundle.mkdir(parents=True, exist_ok=True)
            (bundle / "contract-report.json").write_text('{"passed": true}')
            (bundle / "sha256sums.txt").write_text("deadbeef  contract-report.json\n")
            samples.append(
                EvalSample(
                    id=sample_id,
                    epoch=1,
                    input="turn 1",
                    target=sc_id,
                    messages=[ChatMessageAssistant(content="done")],
                    metadata={"scenario_id": sc_id, "start_state": {"base": "realistic"}},
                    model_usage={model_id: ModelUsage(input_tokens=5_000, output_tokens=500, total_tokens=5_500)},
                    total_time=12.5,
                    scores={
                        "state_contract_scorer": Score(
                            value=1.0 if passed else 0.0,
                            answer="done",
                            explanation=f"{sc_id}: {'PASS' if passed else 'FAIL'}",
                            metadata={
                                "passed": passed,
                                "scenario_id": sc_id,
                                "base": "realistic",
                                "extra_governance_writes": 0,
                                "system_audit_writes": 1,
                                "missing_inserts": [] if passed else [{"label": "expected_row", "detail": "missing"}],
                                "missing_updates": [],
                                "missing_deletes": [],
                                "unexpected_writes": [],
                                "artifacts_dir": str(bundle),
                            },
                        )
                    },
                )
            )
        eval_log = EvalLog(
            status="success",
            eval=EvalSpec(
                run_id=f"run_{slug}",
                task_id=f"task_{slug}",
                created="2026-10-14T12:00:00+00:00",
                task="evergreen_deterministic",
                dataset=EvalDataset(name="evergreen_deterministic_state", samples=len(samples)),
                model=model_id,
                config=EvalConfig(),
                metadata={
                    "harness": "langchain create_agent direct multi-turn via inspect agent_bridge",
                    "learning_mechanism": "None (zero-shot)",
                },
            ),
            plan=EvalPlan(),
            results=EvalResults(),
            stats=EvalStats(),
            samples=samples,
        )
        out_eval = logs_dir / slug / "fixture.eval"
        out_eval.parent.mkdir(parents=True, exist_ok=True)
        write_eval_log(eval_log, str(out_eval))

    md_out = tmp_path / "summary.md"
    json_out = tmp_path / "summary-report.json"
    manifest_out = tmp_path / "replay-manifest.json"
    rc = sd.main(
        [
            str(logs_dir),
            "--artifacts-dir",
            str(artifacts_dir),
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
    assert report["total_trials"] == 10
    assert len(report["models"]) == 5
    md_text = md_out.read_text(encoding="utf-8")
    assert "None: None" not in md_text
    assert "`claude-sonnet-5-5`" in md_text
    assert "`gemini-4-hydrogen`" in md_text
    assert "`gpt-oss-120b`" in md_text

    manifest = json.loads(manifest_out.read_text(encoding="utf-8"))
    assert manifest["benchmark"] == "evergreen_deterministic_state"
    assert manifest["total_trials"] == 10
    assert all(t["sha256"].get("contract-report.json") == "deadbeef" for t in manifest["trials"])
