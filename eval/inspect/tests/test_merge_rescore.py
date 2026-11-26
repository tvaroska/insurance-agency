from __future__ import annotations

import sys
from pathlib import Path

import pytest

INSPECT_DIR = Path(__file__).resolve().parents[1]
if str(INSPECT_DIR) not in sys.path:
    sys.path.insert(0, str(INSPECT_DIR))

from merge_rescore import (  # noqa: E402
    apply_rescore_and_overrides,
    build_diff_summary,
    trial_key_from_record,
)
from summarize_inspect import SampleRecord  # noqa: E402


def _make_record(
    *,
    sample_id: str = "02-realistic-natural",
    scenario_id: str = "02",
    seed: str = "realistic",
    epoch: int = 1,
    score: float = 0.88,
    passed: bool = True,
    eo_compliant: bool = True,
    said_done_failed: bool = False,
) -> SampleRecord:
    return SampleRecord(
        model="anthropic/vertex/claude-sonnet-5-5",
        harness="Inspect + LangChain",
        learning_mechanism="None (zero-shot)",
        sample_id=sample_id,
        scenario_id=scenario_id,
        seed=seed,
        epoch=epoch,
        score=score,
        passed=passed,
        output_score=1.0 if passed else 0.5,
        trace_score=0.8,
        eo_compliant=eo_compliant,
        api_calls=12,
        system_traps_total=0,
        system_traps_missed=0,
        judgment_traps_total=0,
        judgment_traps_missed=0,
        said_done_failed=said_done_failed,
        unauthorized_mutations=0,
        cost_usd=0.14,
        deferred_or_refused=False,
    )


def test_pass_to_fail_recomputes_said_done_failed_from_answer_text() -> None:
    rec_done = _make_record(epoch=1, score=0.88, passed=True, said_done_failed=False)
    rec_defer = _make_record(epoch=2, score=0.88, passed=True, said_done_failed=False)
    answers = {
        trial_key_from_record(rec_done): "All quote comparisons and emails are complete.",
        trial_key_from_record(rec_defer): "I could not complete the quote request; please confirm.",
    }
    rescore = {
        trial_key_from_record(rec_done): {
            "new_score": 0.64,
            "new_eo_compliant": True,
            "new_output_score": 0.4,
            "new_trace_score": 1.0,
            "new_api_calls": 12,
            "new_eo_traps": [],
            "new_unauthorized_mutations": 0,
        },
        trial_key_from_record(rec_defer): {
            "new_score": 0.64,
            "new_eo_compliant": True,
            "new_output_score": 0.4,
            "new_trace_score": 1.0,
            "new_api_calls": 12,
            "new_eo_traps": [],
            "new_unauthorized_mutations": 0,
        },
    }

    merged, diffs = apply_rescore_and_overrides([rec_done, rec_defer], answers, rescore)
    assert len(merged) == 2
    assert merged[0].passed is False
    assert merged[0].said_done_failed is True
    assert merged[1].passed is False
    assert merged[1].said_done_failed is False
    assert merged[1].deferred_or_refused is True
    assert [d["source"] for d in diffs] == ["offline_rescore", "offline_rescore"]


def test_fail_to_pass_and_live_override_precedence() -> None:
    rec_17 = _make_record(
        sample_id="17-realistic-natural",
        scenario_id="17",
        epoch=1,
        score=0.72,
        passed=False,
        said_done_failed=True,
    )
    rec_11 = _make_record(
        sample_id="11-realistic-natural",
        scenario_id="11",
        epoch=1,
        score=0.82,
        passed=True,
        said_done_failed=False,
    )
    live_11 = _make_record(
        sample_id="11-realistic-natural",
        scenario_id="11",
        epoch=1,
        score=0.95,
        passed=True,
        said_done_failed=False,
    )
    rescore = {
        trial_key_from_record(rec_17): {
            "new_score": 1.0,
            "new_eo_compliant": True,
            "new_output_score": 1.0,
            "new_trace_score": 1.0,
            "new_api_calls": 10,
            "new_eo_traps": [],
            "new_unauthorized_mutations": 0,
        },
    }
    answers = {
        trial_key_from_record(rec_17): "COI generated and sent.",
        trial_key_from_record(rec_11): "Meeting brief complete.",
    }
    merged, diffs = apply_rescore_and_overrides(
        [rec_17, rec_11],
        answers,
        rescore,
        {trial_key_from_record(rec_11): live_11},
    )
    assert merged[0].passed is True
    assert merged[0].said_done_failed is False
    assert merged[1].score == 0.95
    summary = build_diff_summary([rec_17, rec_11], [], merged, [], diffs)
    assert summary["sources"] == {"offline_rescore": 1, "live_rerun": 1}
    assert summary["flips"] == {"fail_to_pass": 1, "unchanged": 1}


def test_missing_rescore_entry_fails_closed() -> None:
    rec = _make_record()
    with pytest.raises(ValueError, match="Missing rescore entry"):
        apply_rescore_and_overrides([rec], {}, {})
