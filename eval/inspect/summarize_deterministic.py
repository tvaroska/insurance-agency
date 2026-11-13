"""Aggregate UK AISI Inspect AI (.eval) logs from deterministic DB-state runs.

Produces:
  - Markdown summary (overall table, per-scenario matrix, exact failure diagnostics)
  - Machine-readable `summary-report.json` (model aggregates + per-trial records)
  - `replay-manifest.json` linking every trial to its `.eval` log and SHA-256 artifact receipts

Usage:
  python3 eval/inspect/summarize_deterministic.py eval/results/deterministic-v1/logs \
    --artifacts-dir eval/results/deterministic-v1/artifacts \
    --gcs-artifacts-uri gs://btvaroska/insurance-agency/results/deterministic-v1/artifacts \
    --md-out eval/results/deterministic-v1/summary.md \
    --json-out eval/results/deterministic-v1/summary-report.json \
    --export-replay-manifest eval/results/deterministic-v1/replay-manifest.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from inspect_ai.log import EvalLog, read_eval_log

from evergreen_langchain import _slugify_model
from summarize_inspect import (
    GYM_ROOT,
    _rel_if_in_repo,
    collect_eval_files,
    estimate_usage_cost_usd,
    format_model_label,
    wilson_ci95,
)

DEFAULT_DETERMINISTIC_LOGS = GYM_ROOT / "eval" / "results" / "deterministic-v1" / "logs"
_EXCLUDE_FIELDS: set[str] = {"events", "attachments", "store"}


@dataclass
class DeterministicTrialRecord:
    model: str
    model_slug: str
    model_label: str
    harness: str
    learning_mechanism: str
    sample_id: str
    scenario_id: str
    base: str
    epoch: int
    passed: bool
    score: float
    explanation: str
    tool_calls: int
    wall_time_s: float
    extra_governance_writes: int
    system_audit_writes: int
    missing_inserts: int
    missing_updates: int
    missing_deletes: int
    unexpected_writes: int
    input_tokens: int
    cache_write_tokens: int
    cache_read_tokens: int
    output_tokens: int
    reasoning_tokens: int
    cost_usd_list: float
    eval_log: str | None = None
    artifacts_dir: str | None = None
    failure_details: list[str] | None = None


@dataclass
class DeterministicModelSummary:
    model: str
    model_slug: str
    model_label: str
    harness: str
    learning_mechanism: str
    scenarios_count: int
    trials_count: int
    passed_count: int
    pass_rate: float
    pass_rate_ci95: list[float]
    total_tool_calls: int
    total_wall_time_s: float
    extra_governance_writes: int
    system_audit_writes: int
    total_cost_usd_list: float
    mean_cost_usd_list: float
    cost_per_pass_usd_list: float | None
    tokens: dict[str, int]


def _count_tool_calls(sample: Any) -> int:
    total = 0
    for msg in getattr(sample, "messages", None) or []:
        tcs = getattr(msg, "tool_calls", None)
        if tcs:
            total += len(tcs)
    return total


def _extract_failure_details(meta: dict[str, Any]) -> list[str]:
    details: list[str] = []
    for item in meta.get("missing_inserts") or []:
        label = item.get("label") or item.get("name") or "unknown"
        detail = item.get("detail") or item.get("reason") or ""
        details.append(f"MISSING INSERT {label}: {detail}")
    for item in meta.get("missing_updates") or []:
        label = item.get("label") or item.get("name") or "unknown"
        detail = item.get("detail") or item.get("reason") or ""
        details.append(f"MISSING UPDATE {label}: {detail}")
    for item in meta.get("missing_deletes") or []:
        label = item.get("label") or item.get("name") or "unknown"
        detail = item.get("detail") or item.get("reason") or ""
        details.append(f"MISSING DELETE {label}: {detail}")
    for item in meta.get("unexpected_writes") or []:
        table = f"{item.get('service')}.{item.get('table')}"
        reason = item.get("reason") or f"Unexpected {item.get('op')} in {table}"
        row = item.get("row") or {}
        compact_row = {
            k: v
            for k, v in row.items()
            if k in ("client_id", "policy_id", "reason", "status", "summary", "document_type", "filename")
        }
        suffix = f" {json.dumps(compact_row, ensure_ascii=False)}" if compact_row else ""
        details.append(f"UNEXPECTED WRITE ({table}): {reason}{suffix}")
    return details


def _resolve_artifacts_dir(
    *,
    artifacts_root: Path | None,
    model_slug: str,
    sample_id: str,
    epoch: int,
    recorded: str | None,
) -> str | None:
    if artifacts_root is not None:
        cand = artifacts_root / model_slug / "deterministic" / f"{sample_id}-e{epoch}"
        if cand.is_dir():
            return _rel_if_in_repo(cand)
    return _rel_if_in_repo(recorded)


def extract_deterministic_records(
    log: EvalLog,
    *,
    eval_log_path: Path | str | None = None,
    artifacts_root: Path | None = None,
) -> list[DeterministicTrialRecord]:
    samples = log.samples or []
    if not samples:
        return []

    model_name = str(log.eval.model)
    model_slug = _slugify_model(model_name)
    model_label = format_model_label(model_name)
    task_meta = (log.eval.metadata or {}) if getattr(log, "eval", None) else {}
    harness = str(task_meta.get("harness") or "Inspect + LangChain direct multi-turn")
    learning = str(task_meta.get("learning_mechanism") or "None (zero-shot)")
    rel_eval_log = _rel_if_in_repo(eval_log_path or getattr(log, "location", None))

    records: list[DeterministicTrialRecord] = []
    for sample in samples:
        if not sample.scores:
            continue
        score_obj = next(iter(sample.scores.values()))
        meta = score_obj.metadata or {}
        s_meta = sample.metadata or {}
        epoch = int(getattr(sample, "epoch", 1) or 1)

        val = float(score_obj.value or 0.0)
        passed = bool(meta.get("passed", val >= 1.0))
        in_tok = cw_tok = cr_tok = out_tok = reas_tok = 0
        cost = 0.0
        for m_key, u in (getattr(sample, "model_usage", None) or {}).items():
            in_tok += max(0, int(getattr(u, "input_tokens", 0) or 0))
            cw_tok += max(0, int(getattr(u, "input_tokens_cache_write", 0) or 0))
            cr_tok += max(0, int(getattr(u, "input_tokens_cache_read", 0) or 0))
            out_tok += max(0, int(getattr(u, "output_tokens", 0) or 0))
            reas_tok += max(0, int(getattr(u, "reasoning_tokens", 0) or 0))
            cost += estimate_usage_cost_usd(m_key or model_name, u)

        start_state = s_meta.get("start_state") or {}
        base = str(meta.get("base") or start_state.get("base") or "empty")
        scenario_id = str(meta.get("scenario_id") or s_meta.get("scenario_id") or str(sample.id)[:5])
        artifacts_dir = _resolve_artifacts_dir(
            artifacts_root=artifacts_root,
            model_slug=model_slug,
            sample_id=str(sample.id),
            epoch=epoch,
            recorded=meta.get("artifacts_dir"),
        )
        failure_details = [] if passed else _extract_failure_details(meta)

        records.append(
            DeterministicTrialRecord(
                model=model_name,
                model_slug=model_slug,
                model_label=model_label,
                harness=harness,
                learning_mechanism=learning,
                sample_id=str(sample.id),
                scenario_id=scenario_id,
                base=base,
                epoch=epoch,
                passed=passed,
                score=val,
                explanation=str(score_obj.explanation or ""),
                tool_calls=_count_tool_calls(sample),
                wall_time_s=round(float(getattr(sample, "total_time", 0.0) or 0.0), 2),
                extra_governance_writes=int(meta.get("extra_governance_writes", 0) or 0),
                system_audit_writes=int(meta.get("system_audit_writes", 0) or 0),
                missing_inserts=len(meta.get("missing_inserts") or []),
                missing_updates=len(meta.get("missing_updates") or []),
                missing_deletes=len(meta.get("missing_deletes") or []),
                unexpected_writes=len(meta.get("unexpected_writes") or []),
                input_tokens=in_tok,
                cache_write_tokens=cw_tok,
                cache_read_tokens=cr_tok,
                output_tokens=out_tok,
                reasoning_tokens=reas_tok,
                cost_usd_list=round(cost, 6),
                eval_log=rel_eval_log,
                artifacts_dir=artifacts_dir,
                failure_details=failure_details,
            )
        )
    return records


def summarize_deterministic_records(
    records: list[DeterministicTrialRecord],
) -> list[DeterministicModelSummary]:
    grouped: dict[tuple[str, str, str], list[DeterministicTrialRecord]] = defaultdict(list)
    for r in records:
        grouped[(r.model, r.harness, r.learning_mechanism)].append(r)

    summaries: list[DeterministicModelSummary] = []
    for (model, harness, learning), group in sorted(grouped.items()):
        n = len(group)
        passed = sum(1 for r in group if r.passed)
        total_cost = sum(r.cost_usd_list for r in group)
        scenarios = {r.scenario_id for r in group}
        summaries.append(
            DeterministicModelSummary(
                model=model,
                model_slug=group[0].model_slug,
                model_label=group[0].model_label,
                harness=harness,
                learning_mechanism=learning,
                scenarios_count=len(scenarios),
                trials_count=n,
                passed_count=passed,
                pass_rate=round(passed / n, 4) if n else 0.0,
                pass_rate_ci95=wilson_ci95(passed, n),
                total_tool_calls=sum(r.tool_calls for r in group),
                total_wall_time_s=round(sum(r.wall_time_s for r in group), 2),
                extra_governance_writes=sum(r.extra_governance_writes for r in group),
                system_audit_writes=sum(r.system_audit_writes for r in group),
                total_cost_usd_list=round(total_cost, 4),
                mean_cost_usd_list=round(total_cost / n, 4) if n else 0.0,
                cost_per_pass_usd_list=round(total_cost / passed, 4) if passed else None,
                tokens={
                    "input": sum(r.input_tokens for r in group),
                    "cache_write": sum(r.cache_write_tokens for r in group),
                    "cache_read": sum(r.cache_read_tokens for r in group),
                    "output": sum(r.output_tokens for r in group),
                    "reasoning": sum(r.reasoning_tokens for r in group),
                },
            )
        )

    summaries.sort(key=lambda s: (-s.pass_rate, s.total_cost_usd_list, s.total_wall_time_s, s.model))
    return summaries


def build_deterministic_replay_manifest(
    records: list[DeterministicTrialRecord],
    *,
    gcs_artifacts_uri: str | None = None,
) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    for r in sorted(records, key=lambda x: (x.model_slug, x.learning_mechanism, x.scenario_id, x.epoch)):
        checksums: dict[str, str] = {}
        if r.artifacts_dir:
            bundle = GYM_ROOT / r.artifacts_dir
            if not bundle.is_dir():
                bundle = Path(r.artifacts_dir)
            sums_file = bundle / "sha256sums.txt"
            if sums_file.is_file():
                for line in sums_file.read_text(encoding="utf-8").splitlines():
                    parts = line.strip().split(None, 1)
                    if len(parts) == 2:
                        checksums[parts[1].strip()] = parts[0].strip()
            elif bundle.is_dir():
                for fname in ("contract-report.json", "snapshot-after.json", "snapshot-before.json"):
                    fpath = bundle / fname
                    if fpath.is_file():
                        checksums[fname] = hashlib.sha256(fpath.read_bytes()).hexdigest()

        entries.append(
            {
                "model": r.model,
                "model_slug": r.model_slug,
                "harness": r.harness,
                "learning_mechanism": r.learning_mechanism,
                "sample_id": r.sample_id,
                "scenario_id": r.scenario_id,
                "base": r.base,
                "epoch": r.epoch,
                "score": round(r.score, 4),
                "passed": r.passed,
                "extra_governance_writes": r.extra_governance_writes,
                "system_audit_writes": r.system_audit_writes,
                "eval_log": r.eval_log,
                "artifacts_dir": r.artifacts_dir,
                "sha256": checksums,
            }
        )
    manifest: dict[str, Any] = {
        "benchmark": "evergreen_deterministic_state",
        "grading_policy": "hybrid_32_table_closed_world",
        "total_trials": len(entries),
    }
    if gcs_artifacts_uri:
        manifest["gcs_artifacts_uri"] = gcs_artifacts_uri
    manifest["trials"] = entries
    return manifest


def _fmt_duration(seconds: float) -> str:
    total = int(round(seconds))
    mins, secs = divmod(total, 60)
    return f"{mins}m {secs:02d}s"


def format_deterministic_markdown(
    summaries: list[DeterministicModelSummary],
    records: list[DeterministicTrialRecord],
) -> str:
    lines: list[str] = [
        "# Deterministic Multi-Turn DB-State Evaluation (`deterministic-v1`)",
        "",
        "Pure 32-table SQLite start-state -> direct multi-turn chat -> closed-world expected end-state evaluation (`MODALITY_MODE=strict`, Hybrid grading policy).",
        "",
        "## Model Summary",
        "",
        "| Model | Pass Rate | Tools | Wall Time | `extra_gov` | `audit` | List Cost (USD) | Cost / Pass |",
        "| :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |",
    ]
    for s in summaries:
        cpp = f"${s.cost_per_pass_usd_list:.3f}" if s.cost_per_pass_usd_list is not None else "n/a"
        lines.append(
            f"| {s.model_label} | {s.passed_count}/{s.trials_count} ({s.pass_rate * 100:.0f}%) | "
            f"{s.total_tool_calls} | {_fmt_duration(s.total_wall_time_s)} | "
            f"{s.extra_governance_writes} | {s.system_audit_writes} | "
            f"${s.total_cost_usd_list:.2f} | {cpp} |"
        )

    scenarios = sorted({r.scenario_id for r in records})
    by_model_sc: dict[tuple[str, str], DeterministicTrialRecord] = {
        (r.model_slug, r.scenario_id): r for r in records
    }
    model_order = [(s.model_slug, s.model_label) for s in summaries]

    lines.extend(
        [
            "",
            "## Per-Scenario Matrix",
            "",
            "| Scenario | " + " | ".join(lbl for _, lbl in model_order) + " |",
            "| :--- | " + " | ".join(":---" for _ in model_order) + " |",
        ]
    )
    for sc in scenarios:
        cells: list[str] = []
        for slug, _ in model_order:
            rec = by_model_sc.get((slug, sc))
            if rec is None:
                cells.append("n/a")
            else:
                verdict = "**PASS**" if rec.passed else "FAIL"
                gov = f", +{rec.extra_governance_writes}g" if rec.extra_governance_writes else ""
                cells.append(f"{verdict} ({rec.tool_calls}t, {int(round(rec.wall_time_s))}s{gov})")
        lines.append(f"| `{sc}` | " + " | ".join(cells) + " |")

    failures = [r for r in records if not r.passed]
    if failures:
        lines.extend(["", "## Failure Breakdown", ""])
        by_slug: dict[str, list[DeterministicTrialRecord]] = defaultdict(list)
        for r in failures:
            by_slug[r.model_slug].append(r)
        for slug, label in model_order:
            m_fails = sorted(by_slug.get(slug, []), key=lambda x: (x.scenario_id, x.epoch))
            if not m_fails:
                continue
            lines.append(f"### {label} ({len(m_fails)} failed)")
            lines.append("")
            for f in m_fails:
                lines.append(f"- **`{f.scenario_id}`**: {f.explanation}")
                for d in f.failure_details or []:
                    lines.append(f"  - {d}")
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "logs",
        nargs="*",
        default=[],
        help="Inspect .eval log files or directories (defaults to eval/results/deterministic-v1/logs)",
    )
    parser.add_argument(
        "--artifacts-dir",
        default="",
        help="Canonical artifacts directory root (<artifacts_dir>/<model_slug>/deterministic/<sample>-e<epoch>)",
    )
    parser.add_argument(
        "--gcs-artifacts-uri",
        default="",
        help="Optional GCS archive URI recorded in replay-manifest.json",
    )
    parser.add_argument("--md-out", default="", help="Optional path to write Markdown summary")
    parser.add_argument("--json-out", default="", help="Optional path to write summary-report.json")
    parser.add_argument(
        "--export-replay-manifest",
        default="",
        help="Optional path to write replay-manifest.json",
    )
    args = parser.parse_args(argv)

    targets = [Path(p) for p in args.logs] if args.logs else [DEFAULT_DETERMINISTIC_LOGS]
    eval_files = collect_eval_files(targets)
    if not eval_files:
        raise SystemExit(f"No .eval files found in: {targets}")

    artifacts_root = Path(args.artifacts_dir) if args.artifacts_dir else None
    records: list[DeterministicTrialRecord] = []
    for f in eval_files:
        log = read_eval_log(str(f), exclude_fields=_EXCLUDE_FIELDS)
        if log.status == "success":
            records.extend(
                extract_deterministic_records(
                    log,
                    eval_log_path=f,
                    artifacts_root=artifacts_root,
                )
            )

    summaries = summarize_deterministic_records(records)
    md_text = format_deterministic_markdown(summaries, records)

    if args.md_out:
        out = Path(args.md_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(md_text, encoding="utf-8")

    if args.json_out:
        out = Path(args.json_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "benchmark": "evergreen_deterministic_state",
            "grading_policy": "hybrid_32_table_closed_world",
            "total_trials": len(records),
            "models": [asdict(s) for s in summaries],
            "trials": [
                asdict(r)
                for r in sorted(records, key=lambda x: (x.model_slug, x.scenario_id, x.epoch))
            ],
        }
        out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    if args.export_replay_manifest:
        out = Path(args.export_replay_manifest)
        out.parent.mkdir(parents=True, exist_ok=True)
        manifest = build_deterministic_replay_manifest(
            records,
            gcs_artifacts_uri=args.gcs_artifacts_uri or None,
        )
        out.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    print(md_text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
