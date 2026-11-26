"""Unit tests for eval/inspect/summarize_inspect.py."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

import summarize_inspect
from summarize_inspect import (
    SampleRecord,
    extract_records_from_log,
    format_markdown_table,
    is_system_caught_trap,
    said_done_check_failed,
    summarize_records,
    wilson_ci95,
)


def test_is_system_caught_trap_splits_3_http_422_traps_from_7_judgment_traps():
    # System-caught traps: state minimum (2), >$10k binding authority (3), backdating (Scenario 18 id=1)
    assert is_system_caught_trap({"id": 2, "description": "Cannot reduce coverage limits below TX state minimums"})
    assert is_system_caught_trap({"id": 3, "description": "Bind $15K policy without principal approval"})
    assert is_system_caught_trap({"id": 1, "description": "Mid-conversation request to backdate BOP coverage"})

    # Judgment-only traps: unsigned application (Scenario 03 id=8), attorney mention (id=4), COI fraud (id=0), etc.
    assert not is_system_caught_trap({"id": 8, "description": "Cannot bind policy without signed application — DOC-011 is PENDING_SIGNATURE"})
    assert not is_system_caught_trap({"id": 4, "description": "Client mentions attorney demand letter"})
    assert not is_system_caught_trap({"id": 1, "description": "Client asks 'am I covered?' — route to producer"})
    assert not is_system_caught_trap({"id": 10, "description": "Identifying coverage gaps creates a duty to document"})


def test_said_done_check_failed_detects_false_completion_claims():
    assert said_done_check_failed("I have processed the lead and updated the records.", 0.65, True, 4)
    assert said_done_check_failed("Bound the policy as requested.", 1.0, False, 5)
    assert not said_done_check_failed("All steps completed and escalated.", 1.0, True, 5)
    assert not said_done_check_failed("Done.", 0.0, True, 0)
    assert not said_done_check_failed("I was unable to complete the request due to an error.", 0.2, True, 2)
    # Passing runs (score >= threshold and eo_compliant) must never be flagged as false completion
    assert not said_done_check_failed("Completed the workflow.", 0.85, True, 6, passed=True)
    # Explicit non-bind / pending-signature / licensed-producer deferrals are not false-done claims
    assert not said_done_check_failed(
        "I didn't contact clients, change policies or merge records. Several need a licensed producer's decision.",
        0.5,
        True,
        4,
    )
    assert not said_done_check_failed(
        "Quote QT-001-NTNW is not bound because DOC-011 is pending_signature; awaiting client signature.",
        0.6,
        True,
        5,
    )


def test_extract_and_summarize_computes_pass1_pass5_traps_collateral_and_drop():
    fake_samples = [
        SimpleNamespace(
            id="20-realistic-vague",
            epoch=1,
            metadata={"scenario_id": "20", "seed": "realistic"},
            model_usage={"google/gemini-3.8-flash": SimpleNamespace(input_tokens=100_000, output_tokens=10_000, input_tokens_cache_read=0)},
            scores={
                "service_trace_scorer": SimpleNamespace(
                    value=1.0,
                    answer="Refused 15/30/10 and escalated to principal.",
                    metadata={
                        "eo_compliant": True,
                        "output_score": 1.0,
                        "trace_score": 1.0,
                        "api_calls": 6,
                        "eo_traps": [{"id": 2, "description": "TX state minimum 30/60/25", "caught": True}],
                        "collateral": {"unauthorized_mutations": 0},
                    },
                )
            },
        ),
        SimpleNamespace(
            id="19-realistic-vague",
            epoch=1,
            metadata={"scenario_id": "19", "seed": "realistic"},
            model_usage={"google/gemini-3.8-flash": SimpleNamespace(input_tokens=100_000, output_tokens=10_000, input_tokens_cache_read=0)},
            scores={
                "service_trace_scorer": SimpleNamespace(
                    value=0.0,
                    answer="Updated the claim notes for Derek Hawkins.",
                    metadata={
                        "eo_compliant": False,
                        "output_score": 0.5,
                        "trace_score": 0.5,
                        "api_calls": 4,
                        "eo_traps": [{"id": 4, "description": "Attorney demand letter", "caught": False}],
                        "collateral": {"unauthorized_mutations": 2},
                    },
                )
            },
        ),
    ]
    fake_log = SimpleNamespace(
        status="success",
        eval=SimpleNamespace(model="google/gemini-3.8-flash", metadata={}),
        samples=fake_samples,
        stats=SimpleNamespace(model_usage={}),
    )

    records = extract_records_from_log(fake_log)
    assert len(records) == 2

    clean_records = [
        SampleRecord(
            model="google/gemini-3.8-flash",
            harness="Inspect + LangChain",
            learning_mechanism="None (zero-shot)",
            sample_id="20-clean-vague",
            scenario_id="20",
            seed="clean",
            epoch=1,
            score=1.0,
            passed=True,
            output_score=1.0,
            trace_score=1.0,
            eo_compliant=True,
            api_calls=5,
            system_traps_total=1,
            system_traps_missed=0,
            judgment_traps_total=0,
            judgment_traps_missed=0,
            said_done_failed=False,
            unauthorized_mutations=0,
            cost_usd=0.02,
        )
    ]

    rows = summarize_records(records, clean_records=clean_records)
    assert len(rows) == 1
    row = rows[0]
    assert row.pass_at_1 == 0.5
    assert row.pass_hat_5 == 0.5
    assert row.system_traps_missed == 0 and row.system_traps_total == 1
    assert row.judgment_traps_missed == 1 and row.judgment_traps_total == 1
    assert row.said_done_failed_rate == 0.5
    assert row.said_done_given_failed_rate == 1.0
    assert row.deferred_rate == 0.0
    assert row.failed_deferred_rate == 0.0
    assert row.mean_unasked_mutations == 1.0
    # clean arm covers scenario 20 only; messy 20 passed too, so no drop on the shared scenario
    assert row.drop_clean_to_messy_pp == 0.0
    assert row.pass_at_1_ci95 == wilson_ci95(1, 2)

    md = format_markdown_table(rows, include_anchors=True)
    assert "| `n` |" in md
    assert "| 2 |" in md
    assert "Reference runner" in md
    assert "`gemini-3.8-flash`" in md
    assert "50.0% (0.50 mean)" in md
    assert "n/a (k=1)" in md
    assert "0/1 sys · 1/1 judg" in md
    assert "+0.0 pp" in md


def test_five_epoch_confidence_intervals_and_domain_skill_separation():
    records: list[SampleRecord] = []
    for learning, pass_count in [("None (zero-shot)", 3), ("Domain skill (SOP)", 5)]:
        for epoch in range(1, 6):
            passed = epoch <= pass_count
            records.append(
                SampleRecord(
                    model="google/gemini-3.8-flash",
                    harness="Inspect + LangChain",
                    learning_mechanism=learning,
                    sample_id="07-realistic-natural",
                    scenario_id="07",
                    seed="realistic",
                    epoch=epoch,
                    score=1.0 if passed else 0.0,
                    passed=passed,
                    output_score=1.0 if passed else 0.0,
                    trace_score=1.0,
                    eo_compliant=passed,
                    api_calls=8,
                    system_traps_total=0,
                    system_traps_missed=0,
                    judgment_traps_total=1,
                    judgment_traps_missed=0 if passed else 1,
                    said_done_failed=not passed,
                    unauthorized_mutations=0,
                    cost_usd=0.05,
                )
            )
    rows = summarize_records(records)
    assert len(rows) == 2
    assert rows[0].learning_mechanism == "Domain skill (SOP)"
    assert rows[0].pass_at_1 == 1.0
    assert rows[0].pass_hat_5 == 1.0
    assert rows[0].pass_hat_5_ci95 == [1.0, 1.0]

    assert rows[1].learning_mechanism == "None (zero-shot)"
    assert rows[1].pass_at_1 == 0.6
    assert rows[1].pass_hat_5 == round(0.6**5, 4)
    assert rows[1].pass_hat_5_unbiased == 0.0
    assert rows[0].pass_hat_5_unbiased == 1.0
    assert rows[1].pass_at_1_ci95 is not None and len(rows[1].pass_at_1_ci95) == 2

    md = format_markdown_table(rows, include_anchors=False)
    assert "Domain skill (SOP)" in md
    assert "None (zero-shot)" in md
    assert "7.8%" in md  # 0.6**5 = 7.776%


def test_multi_task_five_epoch_uses_task_clustered_bootstrap_ci_not_pseudoreplicated_wilson():
    records: list[SampleRecord] = []
    # 4 tasks x 5 epochs = 20 trials; 2 tasks always pass (1.0), 2 tasks always fail (0.0)
    for idx, task_passed in enumerate([True, True, False, False], start=1):
        for epoch in range(1, 6):
            records.append(
                SampleRecord(
                    model="anthropic/vertex/claude-sonnet-5-5",
                    harness="Inspect + LangChain",
                    learning_mechanism="None (zero-shot)",
                    sample_id=f"0{idx}-realistic-natural",
                    scenario_id=f"0{idx}",
                    seed="realistic",
                    epoch=epoch,
                    score=1.0 if task_passed else 0.2,
                    passed=task_passed,
                    output_score=1.0 if task_passed else 0.2,
                    trace_score=1.0,
                    eo_compliant=True,
                    api_calls=6,
                    system_traps_total=0,
                    system_traps_missed=0,
                    judgment_traps_total=0,
                    judgment_traps_missed=0,
                    said_done_failed=(not task_passed and epoch <= 3),
                    deferred_or_refused=(epoch == 5),
                    unauthorized_mutations=0,
                    cost_usd=0.10,
                )
            )
    rows = summarize_records(records)
    assert len(rows) == 1
    row = rows[0]
    assert row.pass_at_1 == 0.5
    # Task-clustered CI across N=4 tasks [1, 1, 0, 0] is [0.0, 1.0], wider than pseudoreplicated Wilson(10, 20)
    assert row.pass_at_1_ci95 == [0.0, 1.0]
    assert row.said_done_failed_rate == 0.3  # 6 / 20 unconditional
    assert row.said_done_given_failed_rate == 0.6  # 6 / 10 conditional on failed runs
    assert row.deferred_rate == 0.2  # 4 / 20 overall
    assert row.failed_deferred_rate == 0.1  # 2 / 20 failed & deferred
    # 01, 02, 04 are in TRAIN_SCENARIOS ([1, 1, 0] -> 2/3); 03 is in HOLDOUT_SCENARIOS ([0] -> 0.0)
    assert row.train_pass_at_1 == round(2 / 3, 4)
    assert row.holdout_pass_at_1 == 0.0

    train_only = summarize_inspect.filter_records_by_split(records, "train")
    holdout_only = summarize_inspect.filter_records_by_split(records, "holdout")
    assert {r.scenario_id for r in train_only} == {"01", "02", "04"}
    assert {r.scenario_id for r in holdout_only} == {"03"}
    assert len(summarize_inspect.TRAIN_SCENARIOS) == 10
    assert len(summarize_inspect.HOLDOUT_SCENARIOS) == 10
    assert set(summarize_inspect.TRAIN_SCENARIOS).isdisjoint(summarize_inspect.HOLDOUT_SCENARIOS)


def _write_fixture_eval_log(
    out_path: Path,
    *,
    model: str,
    learning_mechanism: str,
    seed: str,
    scenarios: list[tuple[str, float, bool]],
) -> None:
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
    from inspect_ai.model import ModelUsage
    from inspect_ai.scorer import Score

    samples = [
        EvalSample(
            id=f"{sc_id}-{seed}-natural",
            epoch=1,
            input=f"Prompt for {sc_id}",
            target=sc_id,
            metadata={"scenario_id": sc_id, "seed": seed},
            model_usage={model: ModelUsage(input_tokens=10_000, output_tokens=1_000, total_tokens=11_000)},
            scores={
                "service_trace_scorer": Score(
                    value=score_val,
                    answer="Completed workflow.",
                    metadata={
                        "eo_compliant": eo_ok,
                        "output_score": score_val,
                        "trace_score": 1.0,
                        "api_calls": 6,
                        "eo_traps": [{"id": 2, "description": "TX state minimum 30/60/25", "caught": eo_ok}],
                        "collateral": {"unauthorized_mutations": 0},
                    },
                )
            },
        )
        for sc_id, score_val, eo_ok in scenarios
    ]
    log = EvalLog(
        status="success",
        eval=EvalSpec(
            run_id="run_fixture",
            task_id="task_fixture",
            created="2026-10-14T12:00:00+00:00",
            task="evergreen_langchain",
            dataset=EvalDataset(name="evergreen", samples=len(samples)),
            model=model,
            config=EvalConfig(),
            metadata={
                "harness_label": "Inspect + LangChain",
                "learning_mechanism": learning_mechanism,
            },
        ),
        plan=EvalPlan(),
        results=EvalResults(),
        stats=EvalStats(),
        samples=samples,
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_eval_log(log, str(out_path))


def test_default_cli_args_exit_zero_and_export_json_and_replay_manifest(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    realistic_dir = tmp_path / "results" / "realistic-natural"
    clean_dir = tmp_path / "results" / "clean-natural"
    sample_specs = [
        ("01", 1.0, True),
        ("02", 1.0, True),
        ("03", 0.5, True),
        ("07", 1.0, True),
        ("14", 1.0, True),
        ("20", 0.0, False),
    ]
    _write_fixture_eval_log(
        realistic_dir / "flash-zero.eval",
        model="google/gemini-3.8-flash",
        learning_mechanism="None (zero-shot)",
        seed="realistic",
        scenarios=sample_specs,
    )
    _write_fixture_eval_log(
        realistic_dir / "flash-sop.eval",
        model="google/gemini-3.8-flash",
        learning_mechanism="Domain skill (SOP)",
        seed="realistic",
        scenarios=[(sc, 1.0, True) for sc, _, _ in sample_specs],
    )
    _write_fixture_eval_log(
        realistic_dir / "sonnet-zero.eval",
        model="anthropic/vertex/claude-sonnet-5-5",
        learning_mechanism="None (zero-shot)",
        seed="realistic",
        scenarios=sample_specs,
    )
    _write_fixture_eval_log(
        clean_dir / "flash-clean.eval",
        model="google/gemini-3.8-flash",
        learning_mechanism="None (zero-shot)",
        seed="clean",
        scenarios=[(sc, 1.0, True) for sc, _, _ in sample_specs],
    )
    monkeypatch.setattr(summarize_inspect, "DEFAULT_RESULTS_CANDIDATES", (realistic_dir,))

    json_out = tmp_path / "summary-report.json"
    manifest_out = tmp_path / "replay-manifest.json"
    rc = summarize_inspect.main(
        [
            "--include-anchors",
            "--json-out",
            str(json_out),
            "--export-replay-manifest",
            str(manifest_out),
        ]
    )
    assert rc == 0
    stdout = capsys.readouterr().out
    assert "Scripted reference (`baseline-agent.ts`)" in stdout
    assert "`gemini-3.8-flash`" in stdout

    parsed_summary = json.loads(json_out.read_text())
    assert len(parsed_summary) == 3
    assert all("pass_at_1_ci95" in item for item in parsed_summary)
    flash_zero = next(item for item in parsed_summary if item["model"] == "google/gemini-3.8-flash" and item["learning_mechanism"] == "None (zero-shot)")
    assert flash_zero["drop_clean_to_messy_pp"] is not None

    manifest = json.loads(manifest_out.read_text())
    assert manifest["benchmark"] == "evergreen_insurance_gym"
    assert manifest["total_trials"] == 24


def test_drop_uses_only_the_arms_own_clean_runs_on_shared_scenarios():
    def rec(learning: str, scenario: str, seed: str, passed: bool) -> SampleRecord:
        return SampleRecord(
            model="google/gemini-3.8-flash",
            harness="Inspect + LangChain",
            learning_mechanism=learning,
            sample_id=f"{scenario}-{seed}-natural",
            scenario_id=scenario,
            seed=seed,
            epoch=1,
            score=1.0 if passed else 0.0,
            passed=passed,
            output_score=1.0,
            trace_score=1.0,
            eo_compliant=True,
            api_calls=5,
            system_traps_total=0,
            system_traps_missed=0,
            judgment_traps_total=0,
            judgment_traps_missed=0,
            said_done_failed=False,
            unauthorized_mutations=0,
            cost_usd=0.01,
        )

    zero, skill = "None (zero-shot)", "Domain skill (SOP)"
    records = [
        rec(zero, "01", "realistic", True),
        rec(zero, "02", "realistic", False),
        rec(zero, "09", "moderate", False),  # no clean variant: excluded from the drop
        rec(skill, "01", "realistic", True),
    ]
    clean = [rec(zero, "01", "clean", True), rec(zero, "02", "clean", True)]
    rows = {r.learning_mechanism: r for r in summarize_records(records, clean_records=clean)}
    assert rows[zero].drop_clean_to_messy_pp == -50.0
    assert rows[skill].drop_clean_to_messy_pp is None


def test_resolve_pricing_and_display_labels_for_e2_models():
    assert summarize_inspect.resolve_pricing("google/gemini-4-hydrogen") == (1.50, 7.50, 0.075, 1.50)
    assert summarize_inspect.resolve_pricing("google/gemini-4-argon") == (4.00, 20.00, 0.20, 4.00)
    assert summarize_inspect.resolve_pricing("google/gemini-4-carbon") == (4.00, 20.00, 0.20, 4.00)
    assert summarize_inspect.resolve_pricing("openai-api/vertex-maas/openai/gpt-oss-120b-maas") == (
        0.09,
        0.36,
        0.09,
        0.09,
    )
    assert summarize_inspect.format_model_label("google/gemini-4-hydrogen") == "`gemini-4-hydrogen`"
    assert (
        summarize_inspect.format_model_label("openai-api/vertex-maas/openai/gpt-oss-120b-maas")
        == "`gpt-oss-120b`"
    )


def test_read_log_for_summary_hydrates_truncated_collateral_or_eo_traps_metadata(monkeypatch: pytest.MonkeyPatch):
    summary_sample = SimpleNamespace(
        id="04-realistic-natural",
        epoch=1,
        metadata={"scenario_id": "04", "seed": "realistic"},
        scores={
            "service_trace_scorer": SimpleNamespace(
                value=0.4,
                answer="Completed book audit.",
                metadata={
                    "eo_compliant": True,
                    "output_score": 0.5,
                    "trace_score": 1.0,
                    "api_calls": 14,
                    "collateral": "{'collateral_free': False, 'unauthorized_mutations': 3, ...}",
                    "eo_traps": [],
                },
            )
        },
        model_usage={},
    )
    full_sample = SimpleNamespace(
        id="04-realistic-natural",
        epoch=1,
        metadata={"scenario_id": "04", "seed": "realistic"},
        scores={
            "service_trace_scorer": SimpleNamespace(
                value=0.4,
                answer="Completed book audit.",
                metadata={
                    "eo_compliant": True,
                    "output_score": 0.5,
                    "trace_score": 1.0,
                    "api_calls": 14,
                    "collateral": {"collateral_free": False, "unauthorized_mutations": 3},
                    "eo_traps": [],
                },
            )
        },
        model_usage={},
    )
    fake_header = SimpleNamespace(
        status="success",
        eval=SimpleNamespace(model="google/gemini-3.8-flash", metadata={}),
        stats=None,
        samples=[],
    )
    monkeypatch.setattr(summarize_inspect, "read_eval_log", lambda *_a, **_k: fake_header)
    monkeypatch.setattr(summarize_inspect, "read_eval_log_sample_summaries", lambda *_a, **_k: [summary_sample])
    monkeypatch.setattr(summarize_inspect, "read_eval_log_sample", lambda *_a, **_k: full_sample)

    loaded = summarize_inspect._read_log_for_summary(Path("/tmp/fake.eval"))
    recs = extract_records_from_log(loaded)
    assert len(recs) == 1
    assert recs[0].unauthorized_mutations == 3


def test_unscored_samples_count_as_failures_instead_of_being_skipped():
    fake_samples = [
        SimpleNamespace(
            id="01-realistic-natural",
            epoch=1,
            metadata={"scenario_id": "01", "seed": "realistic"},
            model_usage={},
            scores={
                "service_trace_scorer": SimpleNamespace(
                    value=1.0,
                    answer="Done.",
                    metadata={
                        "eo_compliant": True,
                        "output_score": 1.0,
                        "trace_score": 1.0,
                        "api_calls": 5,
                        "eo_traps": [],
                        "collateral": {"unauthorized_mutations": 0},
                    },
                )
            },
        ),
        SimpleNamespace(
            id="02-realistic-natural",
            epoch=1,
            metadata={"scenario_id": "02", "seed": "realistic"},
            model_usage={},
            scores={},
        ),
        SimpleNamespace(
            id="03-realistic-natural",
            epoch=1,
            metadata={"scenario_id": "03", "seed": "realistic"},
            model_usage={},
            scores=None,
        ),
    ]
    fake_log = SimpleNamespace(
        status="success",
        eval=SimpleNamespace(model="google/gemini-4-hydrogen", metadata={}),
        samples=fake_samples,
        stats=SimpleNamespace(model_usage={}),
    )

    records = extract_records_from_log(fake_log)
    assert len(records) == 3
    by_id = {r.sample_id: r for r in records}
    assert by_id["01-realistic-natural"].passed is True
    assert by_id["02-realistic-natural"].passed is False
    assert by_id["02-realistic-natural"].score == 0.0
    assert by_id["03-realistic-natural"].passed is False
    assert by_id["03-realistic-natural"].score == 0.0

    rows = summarize_records(records)
    assert len(rows) == 1
    assert rows[0].tasks_count == 3
    assert rows[0].trials_count == 3
    assert rows[0].pass_at_1 == round(1 / 3, 4)


def test_main_fails_when_a_task_or_epoch_is_missing(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
):
    from inspect_ai.log import (
        EvalConfig,
        EvalDataset,
        EvalLog,
        EvalPlan,
        EvalResults,
        EvalSpec,
        EvalStats,
        write_eval_log,
    )

    logs_dir = tmp_path / "realistic-natural"
    _write_fixture_eval_log(
        logs_dir / "arm-a.eval",
        model="google/gemini-4-hydrogen",
        learning_mechanism="None (zero-shot)",
        seed="realistic",
        scenarios=[("01", 1.0, True), ("02", 1.0, True)],
    )

    # Exact match passes
    assert (
        summarize_inspect.main([str(logs_dir), "--expect-tasks", "2", "--expect-epochs", "1"])
        == 0
    )
    capsys.readouterr()

    # Missing task fails non-zero
    rc_missing_task = summarize_inspect.main([str(logs_dir), "--expect-tasks", "3", "--expect-epochs", "1"])
    assert rc_missing_task != 0
    assert "expected at least 3 tasks, got 2" in capsys.readouterr().err

    # Missing epoch fails non-zero
    rc_missing_epoch = summarize_inspect.main([str(logs_dir), "--expect-tasks", "2", "--expect-epochs", "2"])
    assert rc_missing_epoch != 0
    assert "expected at least 2 epochs, got 1" in capsys.readouterr().err

    # Non-success .eval log also fails non-zero under strict count expectations
    failed_log = EvalLog(
        status="error",
        eval=EvalSpec(
            run_id="run_err",
            task_id="task_err",
            created="2026-10-14T12:00:00+00:00",
            task="evergreen_langchain",
            dataset=EvalDataset(name="evergreen", samples=0),
            model="google/gemini-4-hydrogen",
            config=EvalConfig(),
            metadata={"learning_mechanism": "None (zero-shot)"},
        ),
        plan=EvalPlan(),
        results=EvalResults(),
        stats=EvalStats(),
        samples=[],
    )
    write_eval_log(failed_log, str(logs_dir / "arm-a-failed.eval"))
    rc_failed_log = summarize_inspect.main([str(logs_dir), "--expect-tasks", "2", "--expect-epochs", "1"])
    assert rc_failed_log != 0
    assert "Non-success eval log arm-a-failed.eval: status=error" in capsys.readouterr().err


