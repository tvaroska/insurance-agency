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
    assert row.mean_unasked_mutations == 1.0
    # clean arm covers scenario 20 only; messy 20 passed too, so no drop on the shared scenario
    assert row.drop_clean_to_messy_pp == 0.0
    assert row.pass_at_1_ci95 == wilson_ci95(1, 2)

    md = format_markdown_table(rows, include_anchors=True)
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
    assert rows[1].pass_at_1_ci95 is not None and len(rows[1].pass_at_1_ci95) == 2

    md = format_markdown_table(rows, include_anchors=False)
    assert "Domain skill (SOP)" in md
    assert "None (zero-shot)" in md
    assert "7.8%" in md  # 0.6**5 = 7.776%


def test_default_cli_args_exit_zero_and_export_json_and_replay_manifest(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
):
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
    assert len(parsed_summary) >= 3
    assert all("pass_at_1_ci95" in item for item in parsed_summary)

    manifest = json.loads(manifest_out.read_text())
    assert manifest["benchmark"] == "evergreen_insurance_gym"
    assert manifest["total_trials"] >= 18


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
