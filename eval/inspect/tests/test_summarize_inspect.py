"""Unit tests for eval/inspect/summarize_inspect.py."""

from __future__ import annotations

from types import SimpleNamespace

from summarize_inspect import (
    SampleRecord,
    extract_records_from_log,
    format_markdown_table,
    is_system_caught_trap,
    said_done_check_failed,
    summarize_records,
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
    # Claimed done, but output_score < 1.0
    assert said_done_check_failed("I have processed the lead and updated the records.", 0.65, True, 4)
    # Claimed done, but missed E&O trap
    assert said_done_check_failed("Bound the policy as requested.", 1.0, False, 5)
    # Passed everything -> False
    assert not said_done_check_failed("All steps completed and escalated.", 1.0, True, 5)
    # No API calls (do-nothing) -> False
    assert not said_done_check_failed("Done.", 0.0, True, 0)
    # Explicit abort message -> False
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
    assert row.drop_clean_to_messy_pp == -50.0

    md = format_markdown_table(rows, include_anchors=True)
    assert "Reference runner" in md
    assert "`gemini-3.8-flash`" in md
    assert "50.0% (0.50 mean)" in md
    assert "n/a (k=1)" in md
    assert "0/1 sys · 1/1 judg" in md
    assert "-50.0 pp" in md
