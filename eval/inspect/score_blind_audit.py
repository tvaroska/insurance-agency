"""Score human markings in `blind-audit-60-sheet.md` against `blind-audit-60-key.json`.

Computes human-vs-grader agreement metrics for arXiv grader-validity verification:
  - Raw percent agreement
  - Cohen's kappa
  - Gwet's AC1 (chance-corrected nominal agreement, immune to prevalence paradox)
  - Confusion matrix (treating human verdict as gold reference: TP, FP, TN, FN, sensitivity, specificity)
  - Slice breakdowns on collateral-flagged runs and E&O-trap runs

Usage:
  python3 eval/inspect/score_blind_audit.py [eval/results/v0.8/blind-audit-60-sheet.md] [--key eval/results/v0.8/blind-audit-60-key.json]
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

GYM_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SHEET = GYM_ROOT / "eval" / "results" / "v0.8" / "blind-audit-60-sheet.md"
DEFAULT_KEY = GYM_ROOT / "eval" / "results" / "v0.8" / "blind-audit-60-key.json"

_HEADER_RE = re.compile(r"^##\s+(AUD-\d+)\b", re.MULTILINE)
_PASS_CHECK_RE = re.compile(r"^-\s*\[[xX]\]\s*`?PASS`?\b", re.MULTILINE)
_FAIL_CHECK_RE = re.compile(r"^-\s*\[[xX]\]\s*`?FAIL`?\b", re.MULTILINE)
_NOTE_RE = re.compile(r"^-\s*\*\*Rater Note:\*\*\s*(.*)$", re.MULTILINE)


def parse_blind_sheet(markdown: str) -> dict[str, dict[str, Any]]:
    """Parse marked `AUD-XX` blocks from a blind audit Markdown sheet."""
    matches = list(_HEADER_RE.finditer(markdown))
    parsed: dict[str, dict[str, Any]] = {}
    for idx, match in enumerate(matches):
        aud_id = match.group(1)
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(markdown)
        block = markdown[start:end]

        pass_marked = bool(_PASS_CHECK_RE.search(block))
        fail_marked = bool(_FAIL_CHECK_RE.search(block))
        if pass_marked and fail_marked:
            raise ValueError(f"{aud_id} has both PASS and FAIL checked")

        verdict: bool | None
        if pass_marked:
            verdict = True
        elif fail_marked:
            verdict = False
        else:
            verdict = None

        note_match = _NOTE_RE.search(block)
        note = note_match.group(1).strip() if note_match else ""
        parsed[aud_id] = {"passed": verdict, "note": note}
    return parsed


def compute_agreement_metrics(pairs: list[tuple[bool, bool]]) -> dict[str, Any]:
    """Compute agreement between `(human_passed, grader_passed)` boolean pairs."""
    n = len(pairs)
    if n == 0:
        return {
            "n": 0,
            "raw_agreement": 0.0,
            "cohens_kappa": 0.0,
            "gwets_ac1": 0.0,
            "tp": 0,
            "fp": 0,
            "tn": 0,
            "fn": 0,
            "grader_tpr_vs_human": 0.0,
            "grader_tnr_vs_human": 0.0,
        }

    tp = sum(1 for h, g in pairs if h and g)
    fp = sum(1 for h, g in pairs if (not h) and g)
    tn = sum(1 for h, g in pairs if (not h) and (not g))
    fn = sum(1 for h, g in pairs if h and (not g))

    p_o = (tp + tn) / n
    p_h_pos = (tp + fn) / n
    p_g_pos = (tp + fp) / n
    p_e_kappa = p_h_pos * p_g_pos + (1.0 - p_h_pos) * (1.0 - p_g_pos)
    cohens_kappa = 1.0 if abs(1.0 - p_e_kappa) <= 1e-12 else (p_o - p_e_kappa) / (1.0 - p_e_kappa)

    pi_pos = (p_h_pos + p_g_pos) / 2.0
    p_e_ac1 = 2.0 * pi_pos * (1.0 - pi_pos)
    gwets_ac1 = 1.0 if abs(1.0 - p_e_ac1) <= 1e-12 else (p_o - p_e_ac1) / (1.0 - p_e_ac1)

    tpr = tp / (tp + fn) if (tp + fn) > 0 else 1.0
    tnr = tn / (tn + fp) if (tn + fp) > 0 else 1.0

    return {
        "n": n,
        "raw_agreement": round(p_o, 4),
        "cohens_kappa": round(cohens_kappa, 4),
        "gwets_ac1": round(gwets_ac1, 4),
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "grader_tpr_vs_human": round(tpr, 4),
        "grader_tnr_vs_human": round(tnr, 4),
    }


def score_audit(sheet_path: Path, key_path: Path) -> dict[str, Any]:
    sheet = parse_blind_sheet(sheet_path.read_text(encoding="utf-8"))
    key_doc = json.loads(key_path.read_text(encoding="utf-8"))
    items: list[dict[str, Any]] = key_doc["items"]

    all_pairs: list[tuple[bool, bool]] = []
    collateral_pairs: list[tuple[bool, bool]] = []
    eo_pairs: list[tuple[bool, bool]] = []
    disagreements: list[dict[str, Any]] = []
    unmarked: list[str] = []

    for item in items:
        aud_id = item["audit_id"]
        mark = sheet.get(aud_id)
        if mark is None or mark["passed"] is None:
            unmarked.append(aud_id)
            continue
        h_pass = bool(mark["passed"])
        g_pass = bool(item["grader_passed"])
        pair = (h_pass, g_pass)
        all_pairs.append(pair)
        if int(item.get("unauthorized_mutations", 0)) > 0:
            collateral_pairs.append(pair)
        if not bool(item.get("eo_compliant", True)):
            eo_pairs.append(pair)
        if h_pass != g_pass:
            disagreements.append({
                "audit_id": aud_id,
                "sample_id": item["sample_id"],
                "arm": item["arm"],
                "epoch": item["epoch"],
                "human_passed": h_pass,
                "grader_passed": g_pass,
                "grader_score": item["grader_score"],
                "taxonomy": item.get("taxonomy"),
                "note": mark["note"],
            })

    return {
        "total_key_items": len(items),
        "marked_count": len(all_pairs),
        "unmarked_ids": unmarked,
        "overall": compute_agreement_metrics(all_pairs),
        "collateral_slice": compute_agreement_metrics(collateral_pairs),
        "eo_trap_slice": compute_agreement_metrics(eo_pairs),
        "disagreements": disagreements,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Score a marked 60-trial blind audit sheet against the sealed grader key.")
    parser.add_argument("sheet", nargs="?", type=Path, default=DEFAULT_SHEET, help="Path to marked blind-audit-60-sheet.md")
    parser.add_argument("--key", type=Path, default=DEFAULT_KEY, help="Path to blind-audit-60-key.json")
    parser.add_argument("--json", action="store_true", help="Emit JSON output")
    args = parser.parse_args(argv)

    summary = score_audit(args.sheet, args.key)
    if args.json:
        print(json.dumps(summary, indent=2))
        return 0

    ov = summary["overall"]
    print(f"Marked: {summary['marked_count']} / {summary['total_key_items']} (unmarked: {len(summary['unmarked_ids'])})")
    if ov["n"] > 0:
        print(
            f"Overall (n={ov['n']}): agreement={ov['raw_agreement']*100:.1f}%, "
            f"Gwet AC1={ov['gwets_ac1']:.3f}, Cohen kappa={ov['cohens_kappa']:.3f} "
            f"(TP={ov['tp']}, FP={ov['fp']}, TN={ov['tn']}, FN={ov['fn']})"
        )
    col = summary["collateral_slice"]
    if col["n"] > 0:
        print(f"Collateral slice (n={col['n']}): agreement={col['raw_agreement']*100:.1f}%, Gwet AC1={col['gwets_ac1']:.3f}")
    eo = summary["eo_trap_slice"]
    if eo["n"] > 0:
        print(f"E&O trap slice (n={eo['n']}): agreement={eo['raw_agreement']*100:.1f}%, Gwet AC1={eo['gwets_ac1']:.3f}")
    if summary["disagreements"]:
        print(f"\nDisagreements ({len(summary['disagreements'])}):")
        for d in summary["disagreements"]:
            print(
                f"  {d['audit_id']} ({d['sample_id']} / {d['arm']} e{d['epoch']}): "
                f"human={d['human_passed']} vs grader={d['grader_passed']} (score={d['grader_score']:.3f}, {d['taxonomy']})"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
