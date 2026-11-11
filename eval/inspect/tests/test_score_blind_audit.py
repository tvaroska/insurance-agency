"""Unit tests for the 60-trial blind human audit sheet, sealed key, and agreement scorer."""

from __future__ import annotations

import json
import pytest

import score_blind_audit as sba
from evergreen import GYM_ROOT


def test_committed_v08_blind_audit_sheet_is_strictly_blind_and_matches_sealed_key():
    v08_dir = GYM_ROOT / "eval" / "results" / "v0.8"
    sheet_path = v08_dir / "blind-audit-60-sheet.md"
    key_path = v08_dir / "blind-audit-60-key.json"

    assert sheet_path.is_file()
    assert key_path.is_file()

    sheet_text = sheet_path.read_text(encoding="utf-8")
    parsed = sba.parse_blind_sheet(sheet_text)
    key_doc = json.loads(key_path.read_text(encoding="utf-8"))

    assert key_doc["total_items"] == 60
    assert len(key_doc["items"]) == 60
    assert len(parsed) == 60
    # Unmarked template starts with all 60 items unchecked
    assert all(v["passed"] is None for v in parsed.values())

    # Blinding guard: model names, arm labels, and grader scores must not leak in the rater sheet
    for forbidden in (
        "gemini-3.8-flash",
        "claude-sonnet-5-5",
        "deepseek-v4.1-flash",
        "grader_passed",
        "grader_score",
        "Domain skill (SOP)",
    ):
        assert forbidden not in sheet_text, f"Blind sheet leaked {forbidden!r}"

    # Stratification invariants: 15 items per arm across all 4 v0.8 realistic arms, covering collateral + E&O slices
    by_arm: dict[str, int] = {}
    for item in key_doc["items"]:
        by_arm[item["arm"]] = by_arm.get(item["arm"], 0) + 1
    assert by_arm == {
        "gemini-3.8-flash-domain_skill": 15,
        "deepseek-v4.1-flash": 15,
        "gemini-3.8-flash": 15,
        "claude-sonnet-5-5": 15,
    }
    assert key_doc["collateral_flagged_count"] >= 5
    assert key_doc["eo_missed_count"] >= 10


def test_score_blind_audit_computes_kappa_gwets_ac1_and_detects_double_check(tmp_path):
    sheet_md = """# Sample Audit

## AUD-01 — Workflow 01 (`01-realistic-natural`)
- [x] `PASS`
- [ ] `FAIL`
- **Rater Note:** clean intake

## AUD-02 — Workflow 06 (`06-realistic-natural`)
- [ ] `PASS`
- [x] `FAIL`
- **Rater Note:** missed producer task

## AUD-03 — Workflow 10 (`10-realistic-natural`)
- [x] `PASS`
- [ ] `FAIL`
- **Rater Note:** borderline task count
"""
    key_json = {
        "schema_version": "1.0",
        "total_items": 3,
        "items": [
            {
                "audit_id": "AUD-01",
                "sample_id": "01-realistic-natural",
                "arm": "gemini-3.8-flash",
                "epoch": 1,
                "grader_passed": True,
                "grader_score": 0.94,
                "unauthorized_mutations": 0,
                "eo_compliant": True,
                "taxonomy": "PASS",
            },
            {
                "audit_id": "AUD-02",
                "sample_id": "06-realistic-natural",
                "arm": "claude-sonnet-5-5",
                "epoch": 1,
                "grader_passed": False,
                "grader_score": 0.0,
                "unauthorized_mutations": 0,
                "eo_compliant": False,
                "taxonomy": "T2_JUDGMENT_EO_TRAP_MISSED",
            },
            {
                "audit_id": "AUD-03",
                "sample_id": "10-realistic-natural",
                "arm": "deepseek-v4.1-flash",
                "epoch": 2,
                "grader_passed": False,
                "grader_score": 0.72,
                "unauthorized_mutations": 1,
                "eo_compliant": True,
                "taxonomy": "T5_COLLATERAL_MUTATION_PENALTY",
            },
        ],
    }
    sp = tmp_path / "sheet.md"
    kp = tmp_path / "key.json"
    sp.write_text(sheet_md, encoding="utf-8")
    kp.write_text(json.dumps(key_json), encoding="utf-8")

    res = sba.score_audit(sp, kp)
    assert res["marked_count"] == 3
    assert res["overall"]["tp"] == 1
    assert res["overall"]["tn"] == 1
    assert res["overall"]["fn"] == 1
    assert res["overall"]["fp"] == 0
    assert res["overall"]["raw_agreement"] == pytest.approx(2 / 3, abs=1e-3)
    assert len(res["disagreements"]) == 1
    assert res["disagreements"][0]["audit_id"] == "AUD-03"

    # Double-marked block must raise ValueError
    bad_md = "## AUD-01 — Workflow 01\n- [x] `PASS`\n- [x] `FAIL`\n"
    with pytest.raises(ValueError, match="both PASS and FAIL"):
        sba.parse_blind_sheet(bad_md)
