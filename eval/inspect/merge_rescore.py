"""Merge offline v0.9.1 rescore JSON and optional live replacement .eval logs into summary tables.

Reads original Inspect .eval logs so model usage/cost and agent answer text stay grounded in the
source runs, applies rescored grader outputs (recomputing `said_done_check_failed` from the
original answer text whenever pass/fail changes), optionally substitutes freshly executed live
trials (e.g., Scenario 11 realistic after prompt fixes), and writes summary.md, summary-report.json,
rescore-diff.json, and replay-manifest.json.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from dataclasses import asdict
from pathlib import Path
from typing import Any

from inspect_ai.log import read_eval_log_sample

from summarize_inspect import (
    SampleRecord,
    _REFUSAL_OR_ABORT_RE,
    _read_log_for_summary,
    build_replay_manifest,
    collect_eval_files,
    extract_records_from_log,
    format_markdown_table,
    is_system_caught_trap,
    said_done_check_failed,
    summarize_records,
)

TrialKey = tuple[str, str, str, int]


def trial_key_from_record(rec: SampleRecord) -> TrialKey:
    return (rec.model, rec.learning_mechanism, rec.sample_id, rec.epoch)


def trial_key_from_entry(entry: dict[str, Any]) -> TrialKey:
    return (
        str(entry["model"]),
        str(entry["learning_mechanism"]),
        str(entry["sample_id"]),
        int(entry["epoch"]),
    )


def load_records_with_answers(
    log_paths: list[Path],
    pass_threshold: float = 0.80,
) -> tuple[list[SampleRecord], dict[TrialKey, str]]:
    """Extract SampleRecords and full answer text for every trial in the given .eval logs."""
    records: list[SampleRecord] = []
    answers: dict[TrialKey, str] = {}
    for eval_file in collect_eval_files(log_paths):
        log = _read_log_for_summary(eval_file)
        if log.status != "success":
            continue
        batch_records = extract_records_from_log(
            log,
            pass_threshold=pass_threshold,
            eval_log_path=eval_file,
        )
        samples_by_id_epoch = {
            (str(s.id), int(getattr(s, "epoch", 1) or 1)): s for s in (log.samples or [])
        }
        for rec in batch_records:
            records.append(rec)
            sample = samples_by_id_epoch.get((rec.sample_id, rec.epoch))
            ans = ""
            if sample and sample.scores:
                score_obj = next(iter(sample.scores.values()))
                ans = score_obj.answer or ""
                if (not ans or (ans.endswith("...") and not _REFUSAL_OR_ABORT_RE.search(ans))) and not getattr(
                    sample, "output", None
                ):
                    full = read_eval_log_sample(
                        str(eval_file),
                        id=sample.id,
                        epoch=sample.epoch,
                        exclude_fields={"messages", "events", "attachments", "store"},
                    )
                    if full.scores:
                        ans = next(iter(full.scores.values())).answer or ""
                    if not ans and getattr(full, "output", None):
                        ans = getattr(full.output, "completion", None) or ""
                elif not ans and getattr(sample, "output", None):
                    ans = getattr(sample.output, "completion", None) or ""
            answers[trial_key_from_record(rec)] = ans
    return records, answers


def _count_traps(raw_traps: Any) -> tuple[int, int, int, int]:
    sys_total = sys_missed = judg_total = judg_missed = 0
    for trap in raw_traps if isinstance(raw_traps, list) else []:
        if not isinstance(trap, dict):
            continue
        caught = bool(trap.get("caught", False))
        if is_system_caught_trap(trap):
            sys_total += 1
            if not caught:
                sys_missed += 1
        else:
            judg_total += 1
            if not caught:
                judg_missed += 1
    return sys_total, sys_missed, judg_total, judg_missed


def apply_rescore_and_overrides(
    records: list[SampleRecord],
    answers: dict[TrialKey, str],
    rescore_entries: dict[TrialKey, dict[str, Any]],
    override_records: dict[TrialKey, SampleRecord] | None = None,
    *,
    pass_threshold: float = 0.80,
) -> tuple[list[SampleRecord], list[dict[str, Any]]]:
    """Apply offline rescore entries and optional live replacement records (fail-closed on misses)."""
    overrides = override_records or {}
    merged: list[SampleRecord] = []
    diffs: list[dict[str, Any]] = []

    for rec in records:
        key = trial_key_from_record(rec)
        if key in overrides:
            live = overrides[key]
            merged.append(live)
            diffs.append(
                {
                    "source": "live_rerun",
                    "model": live.model,
                    "learning_mechanism": live.learning_mechanism,
                    "sample_id": live.sample_id,
                    "scenario_id": live.scenario_id,
                    "seed": live.seed,
                    "epoch": live.epoch,
                    "old_score": rec.score,
                    "old_passed": rec.passed,
                    "new_score": live.score,
                    "new_passed": live.passed,
                    "new_eo_compliant": live.eo_compliant,
                    "new_unauthorized_mutations": live.unauthorized_mutations,
                }
            )
            continue

        entry = rescore_entries.get(key)
        if entry is None:
            raise ValueError(
                f"Missing rescore entry for {key}; refusing to mix stale scores with rescored rows"
            )

        new_score = float(entry["new_score"])
        new_eo = bool(entry["new_eo_compliant"])
        new_out = float(entry["new_output_score"])
        new_trace = float(entry["new_trace_score"])
        new_calls = int(entry["new_api_calls"])
        new_unauth = int(entry["new_unauthorized_mutations"])
        new_passed = (new_score >= pass_threshold) and new_eo
        sys_total, sys_missed, judg_total, judg_missed = _count_traps(entry.get("new_eo_traps"))
        ans = answers.get(key, "")
        trimmed = ans.strip()
        deferred = bool(new_calls > 0 and trimmed and _REFUSAL_OR_ABORT_RE.search(trimmed))

        updated = SampleRecord(
            model=rec.model,
            harness=rec.harness,
            learning_mechanism=rec.learning_mechanism,
            sample_id=rec.sample_id,
            scenario_id=rec.scenario_id,
            seed=rec.seed,
            epoch=rec.epoch,
            score=new_score,
            passed=new_passed,
            output_score=new_out,
            trace_score=new_trace,
            eo_compliant=new_eo,
            api_calls=new_calls,
            system_traps_total=sys_total,
            system_traps_missed=sys_missed,
            judgment_traps_total=judg_total,
            judgment_traps_missed=judg_missed,
            said_done_failed=said_done_check_failed(
                ans, new_out, new_eo, new_calls, passed=new_passed
            ),
            unauthorized_mutations=new_unauth,
            cost_usd=rec.cost_usd,
            deferred_or_refused=deferred,
            artifacts_dir=rec.artifacts_dir,
            eval_log=rec.eval_log,
        )
        merged.append(updated)
        diffs.append(
            {
                "source": "offline_rescore",
                "model": updated.model,
                "learning_mechanism": updated.learning_mechanism,
                "sample_id": updated.sample_id,
                "scenario_id": updated.scenario_id,
                "seed": updated.seed,
                "epoch": updated.epoch,
                "old_score": rec.score,
                "old_passed": rec.passed,
                "new_score": updated.score,
                "new_passed": updated.passed,
                "new_eo_compliant": updated.eo_compliant,
                "new_unauthorized_mutations": updated.unauthorized_mutations,
                "failed_output_checks": entry.get("failed_output_checks", []),
                "failed_trace_checks": entry.get("failed_trace_checks", []),
            }
        )

    return merged, diffs


def build_diff_summary(
    old_realistic: list[SampleRecord],
    old_clean: list[SampleRecord],
    new_realistic: list[SampleRecord],
    new_clean: list[SampleRecord],
    diffs: list[dict[str, Any]],
) -> dict[str, Any]:
    old_rows = {
        (r.model, r.learning_mechanism): asdict(r)
        for r in summarize_records(old_realistic, clean_records=old_clean)
    }
    new_rows = {
        (r.model, r.learning_mechanism): asdict(r)
        for r in summarize_records(new_realistic, clean_records=new_clean)
    }

    flips_by_scenario: dict[str, Counter[str]] = defaultdict(Counter)
    flip_totals: Counter[str] = Counter()
    source_totals: Counter[str] = Counter()
    for d in diffs:
        source_totals[d["source"]] += 1
        if d["old_passed"] and not d["new_passed"]:
            kind = "pass_to_fail"
        elif (not d["old_passed"]) and d["new_passed"]:
            kind = "fail_to_pass"
        else:
            kind = "unchanged"
        flip_totals[kind] += 1
        if kind != "unchanged":
            flips_by_scenario[f"{d['scenario_id']}-{d['seed']}"][kind] += 1

    arm_deltas: list[dict[str, Any]] = []
    for key, new_r in sorted(new_rows.items()):
        old_r = old_rows.get(key)
        arm_deltas.append(
            {
                "model": key[0],
                "learning_mechanism": key[1],
                "old_pass_at_1": old_r["pass_at_1"] if old_r else None,
                "new_pass_at_1": new_r["pass_at_1"],
                "delta_pass_at_1_pp": (
                    round((new_r["pass_at_1"] - old_r["pass_at_1"]) * 100.0, 1)
                    if old_r
                    else None
                ),
                "old_pass_hat_5": old_r["pass_hat_5"] if old_r else None,
                "new_pass_hat_5": new_r["pass_hat_5"],
                "old_pass_hat_5_unbiased": old_r["pass_hat_5_unbiased"] if old_r else None,
                "new_pass_hat_5_unbiased": new_r["pass_hat_5_unbiased"],
                "old_said_done_failed_rate": old_r["said_done_failed_rate"] if old_r else None,
                "new_said_done_failed_rate": new_r["said_done_failed_rate"],
            }
        )

    return {
        "total_trials": len(diffs),
        "sources": dict(source_totals),
        "flips": dict(flip_totals),
        "flips_by_scenario": {k: dict(v) for k, v in sorted(flips_by_scenario.items())},
        "arm_deltas": arm_deltas,
        "flipped_trials": [
            d for d in diffs if bool(d["old_passed"]) != bool(d["new_passed"])
        ],
    }


def load_rescore_map(paths: list[Path]) -> dict[TrialKey, dict[str, Any]]:
    mapping: dict[TrialKey, dict[str, Any]] = {}
    for p in paths:
        payload = json.loads(p.read_text(encoding="utf-8"))
        for entry in payload.get("trials", []):
            key = trial_key_from_entry(entry)
            if key in mapping:
                raise ValueError(f"Duplicate rescore entry for {key} in {p}")
            mapping[key] = entry
    return mapping


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--realistic-logs", nargs="+", required=True)
    parser.add_argument("--clean-logs", nargs="+", required=True)
    parser.add_argument("--rescore-json", nargs="+", required=True)
    parser.add_argument("--override-realistic-logs", nargs="*", default=[])
    parser.add_argument("--override-clean-logs", nargs="*", default=[])
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--exclude-models", nargs="*", default=[])
    parser.add_argument("--pass-threshold", type=float, default=0.80)
    parser.add_argument("--expect-realistic", type=int, default=0)
    parser.add_argument("--expect-clean", type=int, default=0)
    parser.add_argument("--include-anchors", action="store_true")
    args = parser.parse_args(argv)

    excluded = set(args.exclude_models)
    rescore_map = load_rescore_map([Path(p) for p in args.rescore_json])

    old_real, real_answers = load_records_with_answers(
        [Path(p) for p in args.realistic_logs], pass_threshold=args.pass_threshold
    )
    old_clean, clean_answers = load_records_with_answers(
        [Path(p) for p in args.clean_logs], pass_threshold=args.pass_threshold
    )
    if excluded:
        old_real = [r for r in old_real if r.model not in excluded]
        old_clean = [r for r in old_clean if r.model not in excluded]

    override_real_map: dict[TrialKey, SampleRecord] = {}
    if args.override_realistic_logs:
        ov_real, _ = load_records_with_answers(
            [Path(p) for p in args.override_realistic_logs],
            pass_threshold=args.pass_threshold,
        )
        for r in ov_real:
            if r.model not in excluded:
                override_real_map[trial_key_from_record(r)] = r

    override_clean_map: dict[TrialKey, SampleRecord] = {}
    if args.override_clean_logs:
        ov_clean, _ = load_records_with_answers(
            [Path(p) for p in args.override_clean_logs],
            pass_threshold=args.pass_threshold,
        )
        for r in ov_clean:
            if r.model not in excluded:
                override_clean_map[trial_key_from_record(r)] = r

    if args.expect_realistic and len(old_real) != args.expect_realistic:
        raise SystemExit(
            f"Expected {args.expect_realistic} realistic trials, got {len(old_real)}"
        )
    if args.expect_clean and len(old_clean) != args.expect_clean:
        raise SystemExit(
            f"Expected {args.expect_clean} clean trials, got {len(old_clean)}"
        )

    new_real, real_diffs = apply_rescore_and_overrides(
        old_real,
        real_answers,
        rescore_map,
        override_real_map,
        pass_threshold=args.pass_threshold,
    )
    new_clean, clean_diffs = apply_rescore_and_overrides(
        old_clean,
        clean_answers,
        rescore_map,
        override_clean_map,
        pass_threshold=args.pass_threshold,
    )

    rows = summarize_records(new_real, clean_records=new_clean)
    md_table = format_markdown_table(rows, include_anchors=args.include_anchors)
    diff_summary = build_diff_summary(
        old_real, old_clean, new_real, new_clean, [*real_diffs, *clean_diffs]
    )
    manifest = build_replay_manifest([*new_real, *new_clean])

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "summary.md").write_text(md_table + "\n", encoding="utf-8")
    (out_dir / "summary-report.json").write_text(
        json.dumps([asdict(r) for r in rows], indent=2) + "\n", encoding="utf-8"
    )
    (out_dir / "rescore-diff.json").write_text(
        json.dumps(diff_summary, indent=2) + "\n", encoding="utf-8"
    )
    (out_dir / "replay-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )

    print(md_table)
    print(
        f"\nMerged {len(new_real)} realistic + {len(new_clean)} clean trials -> {out_dir} "
        f"(flips: {diff_summary['flips']}, sources: {diff_summary['sources']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
