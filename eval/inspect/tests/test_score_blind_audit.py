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


def test_committed_v091_blind_audit_sheet_is_strictly_blind_and_matches_sealed_key():
    v091_dir = GYM_ROOT / "eval" / "results" / "v0.9.1"
    sheet_path = v091_dir / "blind-audit-60-sheet.md"
    key_path = v091_dir / "blind-audit-60-key.json"

    assert sba.DEFAULT_SHEET == sheet_path
    assert sba.DEFAULT_KEY == key_path
    assert sheet_path.is_file()
    assert key_path.is_file()

    sheet_text = sheet_path.read_text(encoding="utf-8")
    key_text = key_path.read_text(encoding="utf-8")
    parsed = sba.parse_blind_sheet(sheet_text)
    key_doc = json.loads(key_text)

    assert "**Rater ID:**" in sheet_text
    assert sba.parse_rater_id(sheet_text) is None
    assert key_doc["grader_version"] == "v0.9.1"
    assert key_doc["total_items"] == 60
    assert len(key_doc["items"]) == 60
    assert len(parsed) == 60
    assert all(v["passed"] is None for v in parsed.values())

    forbidden_home = "/".join(["", "usr", "local", "google"])
    for forbidden in (
        "gemini-4-hydrogen",
        "gemini-3.8-flash",
        "claude-sonnet-5-5",
        "deepseek-v4.1-flash",
        "grader_passed",
        "grader_score",
        "Domain skill (SOP)",
        forbidden_home,
    ):
        assert forbidden not in sheet_text, f"v0.9.1 blind sheet leaked {forbidden!r}"
    assert forbidden_home not in key_text

    by_arm: dict[str, int] = {}
    for item in key_doc["items"]:
        by_arm[item["arm"]] = by_arm.get(item["arm"], 0) + 1
    assert by_arm == {
        "gemini-4-hydrogen-domain_skill": 15,
        "gemini-4-hydrogen": 15,
        "claude-sonnet-5-5": 15,
        "deepseek-v4.1-flash": 15,
    }
    assert key_doc["collateral_flagged_count"] >= 5
    assert key_doc["eo_missed_count"] >= 10


def test_empty_class_tpr_and_tnr_return_none_and_cli_prints_cleanly(
    tmp_path, capsys: pytest.CaptureFixture[str]
):
    # All negative human labels: tp + fn == 0 -> TPR must be None (not 1.0)
    all_neg = sba.compute_agreement_metrics([(False, False), (False, False)])
    assert all_neg["grader_tpr_vs_human"] is None
    assert all_neg["grader_tnr_vs_human"] == 1.0

    # All positive human labels: tn + fp == 0 -> TNR must be None (not 1.0)
    all_pos = sba.compute_agreement_metrics([(True, True), (True, True)])
    assert all_pos["grader_tpr_vs_human"] == 1.0
    assert all_pos["grader_tnr_vs_human"] is None

    # Empty set -> both None
    empty = sba.compute_agreement_metrics([])
    assert empty["grader_tpr_vs_human"] is None
    assert empty["grader_tnr_vs_human"] is None

    # CLI printing handles None TPR/TNR cleanly without crashing
    sheet = tmp_path / "sheet.md"
    key = tmp_path / "key.json"
    sheet.write_text(
        "# Audit\n**Rater ID:** rater-a\n\n## AUD-01 — Workflow 01\n- [ ] `PASS`\n- [x] `FAIL`\n- **Rater Note:** bad\n",
        encoding="utf-8",
    )
    key.write_text(
        json.dumps({
            "schema_version": "1.1",
            "total_items": 1,
            "items": [
                {
                    "audit_id": "AUD-01",
                    "sample_id": "01-realistic-natural",
                    "arm": "gemini-4-hydrogen",
                    "epoch": 1,
                    "grader_passed": False,
                    "grader_score": 0.4,
                    "unauthorized_mutations": 0,
                    "eo_compliant": True,
                    "taxonomy": "T4_INCOMPLETE_PRIMARY_STATE_CHANGE",
                }
            ],
        }),
        encoding="utf-8",
    )
    rc = sba.main([str(sheet), "--key", str(key)])
    assert rc == 0
    out = capsys.readouterr().out
    assert "Rater rater-a" in out
    assert "TPR=n/a" in out
    assert "TNR=100.0%" in out


def test_two_marked_sheets_yield_an_inter_rater_kappa(
    tmp_path, capsys: pytest.CaptureFixture[str]
):
    sheet_a = tmp_path / "rater-a.md"
    sheet_b = tmp_path / "rater-b.md"
    key = tmp_path / "key.json"

    sheet_a.write_text(
        """# Blind Audit
**Rater ID:** alice

## AUD-01 — Workflow 01
- [x] `PASS`
- [ ] `FAIL`
- **Rater Note:** clean

## AUD-02 — Workflow 02
- [ ] `PASS`
- [x] `FAIL`
- **Rater Note:** missing quote

## AUD-03 — Workflow 03
- [x] `PASS`
- [ ] `FAIL`
- **Rater Note:** acceptable

## AUD-04 — Workflow 04
- [ ] `PASS`
- [x] `FAIL`
- **Rater Note:** duplicate missed
""",
        encoding="utf-8",
    )
    sheet_b.write_text(
        """# Blind Audit
**Rater ID:** bob

## AUD-01 — Workflow 01
- [x] `PASS`
- [ ] `FAIL`
- **Rater Note:** clean

## AUD-02 — Workflow 02
- [ ] `PASS`
- [x] `FAIL`
- **Rater Note:** missing quote

## AUD-03 — Workflow 03
- [ ] `PASS`
- [x] `FAIL`
- **Rater Note:** strict fail

## AUD-04 — Workflow 04
- [ ] `PASS`
- [x] `FAIL`
- **Rater Note:** duplicate missed
""",
        encoding="utf-8",
    )
    key.write_text(
        json.dumps({
            "schema_version": "1.1",
            "total_items": 4,
            "items": [
                {
                    "audit_id": "AUD-01",
                    "sample_id": "01-realistic-natural",
                    "arm": "gemini-4-hydrogen",
                    "epoch": 1,
                    "grader_passed": True,
                    "grader_score": 0.95,
                    "unauthorized_mutations": 0,
                    "eo_compliant": True,
                    "taxonomy": "PASS",
                },
                {
                    "audit_id": "AUD-02",
                    "sample_id": "02-realistic-natural",
                    "arm": "claude-sonnet-5-5",
                    "epoch": 1,
                    "grader_passed": False,
                    "grader_score": 0.5,
                    "unauthorized_mutations": 0,
                    "eo_compliant": True,
                    "taxonomy": "T4_INCOMPLETE_PRIMARY_STATE_CHANGE",
                },
                {
                    "audit_id": "AUD-03",
                    "sample_id": "03-realistic-natural",
                    "arm": "deepseek-v4.1-flash",
                    "epoch": 1,
                    "grader_passed": False,
                    "grader_score": 0.0,
                    "unauthorized_mutations": 0,
                    "eo_compliant": False,
                    "taxonomy": "T2_JUDGMENT_EO_TRAP_MISSED",
                },
                {
                    "audit_id": "AUD-04",
                    "sample_id": "04-realistic-natural",
                    "arm": "gemini-4-hydrogen-domain_skill",
                    "epoch": 1,
                    "grader_passed": False,
                    "grader_score": 0.6,
                    "unauthorized_mutations": 1,
                    "eo_compliant": True,
                    "taxonomy": "T5_COLLATERAL_MUTATION_PENALTY",
                },
            ],
        }),
        encoding="utf-8",
    )

    rc = sba.main([str(sheet_a), "--sheet-b", str(sheet_b), "--key", str(key), "--json"])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["mode"] == "two_rater"
    assert payload["rater_a_id"] == "alice"
    assert payload["rater_b_id"] == "bob"
    assert payload["both_marked_count"] == 4
    assert payload["consensus_count"] == 3
    # 3/4 agreement (TP=1, TN=2, FN=1, FP=0): p_o=0.75, p_e=0.5*0.25 + 0.5*0.75 = 0.5 -> kappa=0.5
    assert payload["inter_rater"]["raw_agreement"] == pytest.approx(0.75, abs=1e-4)
    assert payload["inter_rater"]["cohens_kappa"] == pytest.approx(0.5, abs=1e-4)
    assert payload["inter_rater"]["gwets_ac1"] > 0.5
    assert len(payload["inter_rater_disagreements"]) == 1
    assert payload["inter_rater_disagreements"][0]["audit_id"] == "AUD-03"
    # On the 3 consensus items (AUD-01 pass, AUD-02 fail, AUD-04 fail), consensus matches grader 3/3
    assert payload["consensus_vs_grader"]["raw_agreement"] == 1.0
    assert payload["consensus_vs_grader"]["cohens_kappa"] == 1.0
    assert payload["consensus_vs_grader"]["grader_tpr_vs_human"] == 1.0
    assert payload["consensus_vs_grader"]["grader_tnr_vs_human"] == 1.0

    # Also verify non-JSON CLI formatting works with positional second sheet
    rc_text = sba.main([str(sheet_a), str(sheet_b), "--key", str(key)])
    assert rc_text == 0
    text_out = capsys.readouterr().out
    assert "alice" in text_out and "bob" in text_out
    assert "Inter-rater (n=4)" in text_out
    assert "Cohen kappa=0.500" in text_out
