"""Score human markings in `blind-audit-60-sheet.md` against `blind-audit-60-key.json`.

Computes human-vs-grader agreement metrics (single-rater or two-rater) for arXiv
grader-validity verification:
  - Raw percent agreement
  - Cohen's kappa
  - Gwet's AC1 (chance-corrected nominal agreement, immune to prevalence paradox)
  - Confusion matrix (treating human verdict as gold reference: TP, FP, TN, FN,
    sensitivity `grader_tpr_vs_human`, specificity `grader_tnr_vs_human`, returning
    `None` when a class is empty instead of fabricating `1.0`)
  - Slice breakdowns on collateral-flagged runs and E&O-trap runs
  - Two-rater inter-rater agreement (Rater A vs Rater B) and consensus-vs-grader metrics

Usage:
  python3 eval/inspect/score_blind_audit.py [eval/results/v0.9.1/blind-audit-60-sheet.md] [--key eval/results/v0.9.1/blind-audit-60-key.json]
  python3 eval/inspect/score_blind_audit.py rater-a-sheet.md --sheet-b rater-b-sheet.md [--key eval/results/v0.9.1/blind-audit-60-key.json]
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

GYM_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SHEET = GYM_ROOT / "eval" / "results" / "v0.9.1" / "blind-audit-60-sheet.md"
DEFAULT_KEY = GYM_ROOT / "eval" / "results" / "v0.9.1" / "blind-audit-60-key.json"

_HEADER_RE = re.compile(r"^##\s+(AUD-\d+)\b", re.MULTILINE)
_PASS_CHECK_RE = re.compile(r"^-\s*\[[xX]\]\s*`?PASS`?\b", re.MULTILINE)
_FAIL_CHECK_RE = re.compile(r"^-\s*\[[xX]\]\s*`?FAIL`?\b", re.MULTILINE)
_NOTE_RE = re.compile(r"^-\s*\*\*Rater Note:\*\*[ \t]*(.*)$", re.MULTILINE)
_RATER_ID_RE = re.compile(r"^(?:-\s*)?(?:\*\*)?Rater ID:(?:\*\*)?[ \t]*(.*)$", re.MULTILINE | re.IGNORECASE)


def parse_rater_id(markdown: str) -> str | None:
    """Extract optional `Rater ID:` header metadata from a blind audit sheet."""
    match = _RATER_ID_RE.search(markdown)
    if not match:
        return None
    raw = match.group(1).strip().strip("`").strip()
    if not raw or (raw.startswith("<") and raw.endswith(">")):
        return None
    return raw


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
    """Compute agreement between `(reference_passed, comparison_passed)` boolean pairs."""
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
            "grader_tpr_vs_human": None,
            "grader_tnr_vs_human": None,
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

    tpr = round(tp / (tp + fn), 4) if (tp + fn) > 0 else None
    tnr = round(tn / (tn + fp), 4) if (tn + fp) > 0 else None

    return {
        "n": n,
        "raw_agreement": round(p_o, 4),
        "cohens_kappa": round(cohens_kappa, 4),
        "gwets_ac1": round(gwets_ac1, 4),
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "grader_tpr_vs_human": tpr,
        "grader_tnr_vs_human": tnr,
    }


def score_audit(sheet_path: Path, key_path: Path) -> dict[str, Any]:
    sheet_text = sheet_path.read_text(encoding="utf-8")
    rater_id = parse_rater_id(sheet_text)
    sheet = parse_blind_sheet(sheet_text)
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
        "rater_id": rater_id,
        "total_key_items": len(items),
        "marked_count": len(all_pairs),
        "unmarked_ids": unmarked,
        "overall": compute_agreement_metrics(all_pairs),
        "collateral_slice": compute_agreement_metrics(collateral_pairs),
        "eo_trap_slice": compute_agreement_metrics(eo_pairs),
        "disagreements": disagreements,
    }


def score_two_rater_audit(
    sheet_a_path: Path,
    sheet_b_path: Path,
    key_path: Path,
) -> dict[str, Any]:
    """Score inter-rater agreement (Rater A vs Rater B), consensus vs grader, and per-rater vs grader."""
    text_a = sheet_a_path.read_text(encoding="utf-8")
    text_b = sheet_b_path.read_text(encoding="utf-8")
    sheet_a = parse_blind_sheet(text_a)
    sheet_b = parse_blind_sheet(text_b)
    rater_a_summary = score_audit(sheet_a_path, key_path)
    rater_b_summary = score_audit(sheet_b_path, key_path)
    key_doc = json.loads(key_path.read_text(encoding="utf-8"))
    items: list[dict[str, Any]] = key_doc["items"]

    inter_pairs: list[tuple[bool, bool]] = []
    inter_col_pairs: list[tuple[bool, bool]] = []
    inter_eo_pairs: list[tuple[bool, bool]] = []
    inter_disagreements: list[dict[str, Any]] = []

    consensus_pairs: list[tuple[bool, bool]] = []
    consensus_col_pairs: list[tuple[bool, bool]] = []
    consensus_eo_pairs: list[tuple[bool, bool]] = []
    consensus_disagreements: list[dict[str, Any]] = []

    for item in items:
        aud_id = item["audit_id"]
        mark_a = sheet_a.get(aud_id)
        mark_b = sheet_b.get(aud_id)
        if (
            mark_a is None
            or mark_b is None
            or mark_a["passed"] is None
            or mark_b["passed"] is None
        ):
            continue
        a_pass = bool(mark_a["passed"])
        b_pass = bool(mark_b["passed"])
        g_pass = bool(item["grader_passed"])
        is_col = int(item.get("unauthorized_mutations", 0)) > 0
        is_eo = not bool(item.get("eo_compliant", True))

        inter_pair = (a_pass, b_pass)
        inter_pairs.append(inter_pair)
        if is_col:
            inter_col_pairs.append(inter_pair)
        if is_eo:
            inter_eo_pairs.append(inter_pair)

        if a_pass != b_pass:
            inter_disagreements.append({
                "audit_id": aud_id,
                "sample_id": item["sample_id"],
                "arm": item["arm"],
                "epoch": item["epoch"],
                "rater_a_passed": a_pass,
                "rater_b_passed": b_pass,
                "grader_passed": g_pass,
                "rater_a_note": mark_a["note"],
                "rater_b_note": mark_b["note"],
            })
        else:
            cons_pair = (a_pass, g_pass)
            consensus_pairs.append(cons_pair)
            if is_col:
                consensus_col_pairs.append(cons_pair)
            if is_eo:
                consensus_eo_pairs.append(cons_pair)
            if a_pass != g_pass:
                consensus_disagreements.append({
                    "audit_id": aud_id,
                    "sample_id": item["sample_id"],
                    "arm": item["arm"],
                    "epoch": item["epoch"],
                    "consensus_passed": a_pass,
                    "grader_passed": g_pass,
                    "grader_score": item["grader_score"],
                    "taxonomy": item.get("taxonomy"),
                    "rater_a_note": mark_a["note"],
                    "rater_b_note": mark_b["note"],
                })

    return {
        "mode": "two_rater",
        "total_key_items": len(items),
        "rater_a_id": rater_a_summary["rater_id"] or "rater_a",
        "rater_b_id": rater_b_summary["rater_id"] or "rater_b",
        "both_marked_count": len(inter_pairs),
        "consensus_count": len(consensus_pairs),
        "inter_rater": compute_agreement_metrics(inter_pairs),
        "inter_rater_collateral_slice": compute_agreement_metrics(inter_col_pairs),
        "inter_rater_eo_trap_slice": compute_agreement_metrics(inter_eo_pairs),
        "inter_rater_disagreements": inter_disagreements,
        "consensus_vs_grader": compute_agreement_metrics(consensus_pairs),
        "consensus_collateral_slice": compute_agreement_metrics(consensus_col_pairs),
        "consensus_eo_trap_slice": compute_agreement_metrics(consensus_eo_pairs),
        "consensus_disagreements_vs_grader": consensus_disagreements,
        "rater_a": rater_a_summary,
        "rater_b": rater_b_summary,
    }


def _fmt_opt_rate(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Score marked 60-trial blind audit sheet(s) against the sealed grader key."
    )
    parser.add_argument(
        "sheet",
        nargs="?",
        type=Path,
        default=DEFAULT_SHEET,
        help="Path to marked blind-audit-60-sheet.md (Rater A)",
    )
    parser.add_argument(
        "sheet_b_pos",
        nargs="?",
        type=Path,
        default=None,
        help="Optional second rater sheet (Rater B) for inter-rater agreement",
    )
    parser.add_argument(
        "--sheet-b",
        dest="sheet_b",
        type=Path,
        default=None,
        help="Optional second rater sheet (Rater B) for inter-rater agreement",
    )
    parser.add_argument("--key", type=Path, default=DEFAULT_KEY, help="Path to blind-audit-60-key.json")
    parser.add_argument("--json", action="store_true", help="Emit JSON output")
    args = parser.parse_args(argv)

    if args.sheet_b is not None and args.sheet_b_pos is not None:
        raise SystemExit("Specify the second rater sheet either positionally or via --sheet-b, not both.")
    sheet_b = args.sheet_b or args.sheet_b_pos

    if sheet_b is not None:
        summary = score_two_rater_audit(args.sheet, sheet_b, args.key)
        if args.json:
            print(json.dumps(summary, indent=2))
            return 0
        ir = summary["inter_rater"]
        cons = summary["consensus_vs_grader"]
        print(
            f"Raters: {summary['rater_a_id']} ({summary['rater_a']['marked_count']}/{summary['total_key_items']}) "
            f"vs {summary['rater_b_id']} ({summary['rater_b']['marked_count']}/{summary['total_key_items']}) | "
            f"both marked: {summary['both_marked_count']}, consensus: {summary['consensus_count']}"
        )
        if ir["n"] > 0:
            print(
                f"Inter-rater (n={ir['n']}): agreement={ir['raw_agreement']*100:.1f}%, "
                f"Gwet AC1={ir['gwets_ac1']:.3f}, Cohen kappa={ir['cohens_kappa']:.3f}"
            )
        if cons["n"] > 0:
            print(
                f"Consensus vs grader (n={cons['n']}): agreement={cons['raw_agreement']*100:.1f}%, "
                f"Gwet AC1={cons['gwets_ac1']:.3f}, Cohen kappa={cons['cohens_kappa']:.3f} "
                f"(TP={cons['tp']}, FP={cons['fp']}, TN={cons['tn']}, FN={cons['fn']}, "
                f"TPR={_fmt_opt_rate(cons['grader_tpr_vs_human'])}, TNR={_fmt_opt_rate(cons['grader_tnr_vs_human'])})"
            )
        return 0

    summary = score_audit(args.sheet, args.key)
    if args.json:
        print(json.dumps(summary, indent=2))
        return 0

    ov = summary["overall"]
    rater_prefix = f"Rater {summary['rater_id']} | " if summary["rater_id"] else ""
    print(f"{rater_prefix}Marked: {summary['marked_count']} / {summary['total_key_items']} (unmarked: {len(summary['unmarked_ids'])})")
    if ov["n"] > 0:
        print(
            f"Overall (n={ov['n']}): agreement={ov['raw_agreement']*100:.1f}%, "
            f"Gwet AC1={ov['gwets_ac1']:.3f}, Cohen kappa={ov['cohens_kappa']:.3f} "
            f"(TP={ov['tp']}, FP={ov['fp']}, TN={ov['tn']}, FN={ov['fn']}, "
            f"TPR={_fmt_opt_rate(ov['grader_tpr_vs_human'])}, TNR={_fmt_opt_rate(ov['grader_tnr_vs_human'])})"
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
