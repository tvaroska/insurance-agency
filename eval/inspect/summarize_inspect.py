"""Aggregate UK AISI Inspect AI (.eval) logs into the Evergreen README Results table.

Computes for each (model, harness, learning_mechanism) group:
  - pass@1 (with 95% Wilson score confidence interval) and pass^5 (mean per-task (c/n)^5 across workflows)
  - Legal traps missed, split into the 3 HTTP-422 system-caught traps
    (state minimum, >$10k binding authority, backdating) vs. 7 judgment traps
  - "Said done, check failed": agent completion claims completion while
    output_score < 1.0 or eo_compliant is False
  - "Records changed unasked": unauthorized mutations from the 32-table state diff
  - "Drop, clean to messy": pass@1 change from clean to realistic
  - "Cost per task": USD per task from Inspect model_usage token counts

Usage:
  python3 eval/inspect/summarize_inspect.py --include-anchors
  python3 eval/inspect/summarize_inspect.py <log_file_or_dir> [...] [--clean-logs <dir>] [--include-anchors]
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from inspect_ai.log import EvalLog, read_eval_log, read_eval_log_sample, read_eval_log_sample_summaries

GYM_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RESULTS_CANDIDATES: tuple[Path, ...] = (
    GYM_ROOT / "eval" / "results" / "v0.8" / "realistic-natural",
    GYM_ROOT / "eval" / "results" / "v0.7" / "realistic-natural",
)

# USD per 1M tokens at Vertex AI list price (input, output, cache_read, cache_write), calibrated
# against the Cloud Billing export on 2026-11-11 (cost / billed units per SKU). Gemini implicit
# caching has no separate write charge, so its cache_write rate equals the input rate.
MODEL_PRICING_PER_1M: dict[str, tuple[float, float, float, float]] = {
    "gemini-3.8-flash": (1.50, 7.50, 0.15, 1.50),
    "gemini-4-argon": (1.25, 5.00, 0.3125, 1.25),
    "gemini-3.5-flash-lite": (0.075, 0.30, 0.01875, 0.075),
    "claude-sonnet-5-5": (2.00, 10.00, 0.10, 2.50),
    "claude-sonnet-4-5": (3.00, 15.00, 0.30, 3.75),
    "deepseek-v4.1-flash-maas": (0.30, 1.20, 0.03, 0.30),
    "deepseek-v4.1-flash": (0.30, 1.20, 0.03, 0.30),
}

DEFAULT_PRICING_PER_1M: tuple[float, float, float, float] = MODEL_PRICING_PER_1M["gemini-3.8-flash"]

DISPLAY_MODEL_NAMES: dict[str, str] = {
    "google/gemini-3.8-flash": "`gemini-3.8-flash`",
    "anthropic/vertex/claude-sonnet-5-5": "`claude-sonnet-5-5`",
    "openai-api/vertex-maas/deepseek-ai/deepseek-v4.1-flash-maas": "`DeepSeek-V4.1-Flash`",
}

_REFUSAL_OR_ABORT_RE = re.compile(
    r"\b(unable to complete|could not complete|cannot complete|failed to|error occurred|aborted)\b",
    re.IGNORECASE,
)

_SYSTEM_TRAP_DESC_RE = re.compile(
    r"(state minimum|below.*minimum|backdat|\$10,000|\$15k|premium threshold|binding authority)",
    re.IGNORECASE,
)


def wilson_ci95(successes: int, total: int) -> list[float]:
    """95% Wilson score confidence interval [low, high] for a binomial proportion."""
    if total <= 0:
        return [0.0, 0.0]
    z = 1.959963984540054
    z2 = z * z
    p = max(0.0, min(1.0, successes / total))
    denom = 1.0 + z2 / total
    center = (p + z2 / (2.0 * total)) / denom
    half = (z * math.sqrt((p * (1.0 - p) + z2 / (4.0 * total)) / total)) / denom
    return [round(max(0.0, center - half), 4), round(min(1.0, center + half), 4)]


def bootstrap_mean_ci95(values: list[float], n_resamples: int = 2000, seed: int = 20260218) -> list[float]:
    """Deterministic percentile bootstrap 95% CI over per-task scores/pass^k values."""
    if not values:
        return [0.0, 0.0]
    if len(values) == 1:
        v = round(values[0], 4)
        return [v, v]
    rng = random.Random(seed)
    n = len(values)
    means = sorted(sum(rng.choices(values, k=n)) / n for _ in range(n_resamples))
    lo = means[int(0.025 * (n_resamples - 1))]
    hi = means[int(0.975 * (n_resamples - 1))]
    return [round(lo, 4), round(hi, 4)]


def is_system_caught_trap(trap: dict[str, Any]) -> bool:
    """Return True if an E&O trap is one of the 3 HTTP-422 service-enforced traps.

    The 3 service-blocked traps (README.md / ADR-004):
      1. Liability limits below state minimum (regulatory.md Trigger #2)
      2. Binding above the $10,000 binding authority (regulatory.md Trigger #3)
      3. Backdated coverage effective date (regulatory.md Trigger #8; Scenario 18 uses id=1 with 'backdate' in description)
    Scenario 03 uses id=8 for unsigned application ('PENDING_SIGNATURE'), which is a judgment/workflow blocker.
    """
    desc = str(trap.get("description", ""))
    trap_id = trap.get("id")
    if "pending_signature" in desc.lower() or "unsigned" in desc.lower():
        return False
    if trap_id in (2, 3):
        return True
    return bool(_SYSTEM_TRAP_DESC_RE.search(desc))


def said_done_check_failed(
    answer: str | None,
    output_score: float,
    eo_compliant: bool,
    api_calls: int,
) -> bool:
    """True when the agent acted and replied as if finished, but state/E&O checks failed."""
    if api_calls <= 0:
        return False
    text = (answer or "").strip()
    if not text or _REFUSAL_OR_ABORT_RE.search(text):
        return False
    return output_score < 1.0 or not eo_compliant


def resolve_pricing(model_name: str) -> tuple[float, float, float, float]:
    lowered = model_name.lower()
    for key, rates in MODEL_PRICING_PER_1M.items():
        if key in lowered:
            return rates
    return DEFAULT_PRICING_PER_1M


def estimate_usage_cost_usd(model_name: str, usage: Any) -> float:
    if usage is None:
        return 0.0
    in_rate, out_rate, cache_rate, cache_write_rate = resolve_pricing(model_name)
    input_tokens = max(0, int(getattr(usage, "input_tokens", 0) or 0))
    output_tokens = max(0, int(getattr(usage, "output_tokens", 0) or 0))
    cache_read = max(0, int(getattr(usage, "input_tokens_cache_read", 0) or 0))
    cache_write = max(0, int(getattr(usage, "input_tokens_cache_write", 0) or 0))
    return (
        (input_tokens / 1_000_000.0) * in_rate
        + (output_tokens / 1_000_000.0) * out_rate
        + (cache_read / 1_000_000.0) * cache_rate
        + (cache_write / 1_000_000.0) * cache_write_rate
    )


def format_model_label(model_name: str) -> str:
    if model_name in DISPLAY_MODEL_NAMES:
        return DISPLAY_MODEL_NAMES[model_name]
    short = model_name.split("/")[-1]
    if short.endswith("-maas"):
        short = short[: -len("-maas")]
    return f"`{short}`"


@dataclass
class SampleRecord:
    model: str
    harness: str
    learning_mechanism: str
    sample_id: str
    scenario_id: str
    seed: str
    epoch: int
    score: float
    passed: bool
    output_score: float
    trace_score: float
    eo_compliant: bool
    api_calls: int
    system_traps_total: int
    system_traps_missed: int
    judgment_traps_total: int
    judgment_traps_missed: int
    said_done_failed: bool
    unauthorized_mutations: int
    cost_usd: float
    artifacts_dir: str | None = None
    eval_log: str | None = None


@dataclass
class RowSummary:
    model: str
    model_label: str
    harness: str
    learning_mechanism: str
    tasks_count: int
    trials_count: int
    mean_score: float
    pass_at_1: float
    pass_hat_5: float
    system_traps_missed: int
    system_traps_total: int
    judgment_traps_missed: int
    judgment_traps_total: int
    said_done_failed_rate: float
    unasked_mutation_rate: float
    mean_unasked_mutations: float
    drop_clean_to_messy_pp: float | None
    mean_cost_usd: float
    pass_at_1_ci95: list[float] | None = None
    pass_hat_5_ci95: list[float] | None = None


def _rel_if_in_repo(raw_path: str | Path | None) -> str | None:
    if not raw_path:
        return None
    p = Path(raw_path)
    try:
        resolved = p.resolve()
        gym_resolved = GYM_ROOT.resolve()
        if resolved.is_relative_to(gym_resolved):
            return resolved.relative_to(gym_resolved).as_posix()
    except OSError:
        pass
    return str(raw_path)


def extract_records_from_log(
    log: EvalLog,
    pass_threshold: float = 0.80,
    default_harness: str = "Inspect + LangChain",
    default_learning: str = "None (zero-shot)",
    eval_log_path: str | Path | None = None,
) -> list[SampleRecord]:
    samples = log.samples or []
    if not samples:
        return []

    model_name = str(log.eval.model)
    task_meta = (log.eval.metadata or {}) if getattr(log, "eval", None) else {}
    harness = str(task_meta.get("harness_label") or default_harness)
    learning = str(task_meta.get("learning_mechanism") or default_learning)
    rel_eval_log = _rel_if_in_repo(eval_log_path or getattr(log, "location", None))

    # Fallback per-sample cost if sample.model_usage is empty
    log_cost_total = 0.0
    if getattr(log, "stats", None) and getattr(log.stats, "model_usage", None):
        for m_key, u in log.stats.model_usage.items():
            log_cost_total += estimate_usage_cost_usd(m_key or model_name, u)
    fallback_sample_cost = log_cost_total / len(samples) if samples else 0.0

    records: list[SampleRecord] = []
    for sample in samples:
        if not sample.scores:
            continue
        score_obj = next(iter(sample.scores.values()))
        meta = score_obj.metadata or {}
        s_meta = sample.metadata or {}

        val = float(score_obj.value or 0.0)
        eo_ok = bool(meta.get("eo_compliant", False))
        out_score = float(meta.get("output_score", 0.0))
        tr_score = float(meta.get("trace_score", 0.0))
        api_calls = int(meta.get("api_calls", 0) or 0)
        passed = (val >= pass_threshold) and eo_ok

        sys_total = 0
        sys_missed = 0
        judg_total = 0
        judg_missed = 0
        for trap in meta.get("eo_traps", []) or []:
            caught = bool(trap.get("caught", False))
            if is_system_caught_trap(trap):
                sys_total += 1
                if not caught:
                    sys_missed += 1
            else:
                judg_total += 1
                if not caught:
                    judg_missed += 1

        collateral = meta.get("collateral") or {}
        unauth = int(collateral.get("unauthorized_mutations", 0) or 0)

        sample_cost = 0.0
        if getattr(sample, "model_usage", None):
            for m_key, u in sample.model_usage.items():
                sample_cost += estimate_usage_cost_usd(m_key or model_name, u)
        else:
            sample_cost = fallback_sample_cost

        answer_text = score_obj.answer
        if not answer_text and getattr(sample, "output", None):
            answer_text = getattr(sample.output, "completion", None)

        records.append(
            SampleRecord(
                model=model_name,
                harness=harness,
                learning_mechanism=learning,
                sample_id=str(sample.id),
                scenario_id=str(s_meta.get("scenario_id") or str(sample.id).split("-")[0]),
                seed=str(s_meta.get("seed") or "realistic"),
                epoch=int(getattr(sample, "epoch", 1) or 1),
                score=val,
                passed=passed,
                output_score=out_score,
                trace_score=tr_score,
                eo_compliant=eo_ok,
                api_calls=api_calls,
                system_traps_total=sys_total,
                system_traps_missed=sys_missed,
                judgment_traps_total=judg_total,
                judgment_traps_missed=judg_missed,
                said_done_failed=said_done_check_failed(answer_text, out_score, eo_ok, api_calls),
                unauthorized_mutations=unauth,
                cost_usd=sample_cost,
                artifacts_dir=_rel_if_in_repo(meta.get("artifacts_dir")),
                eval_log=rel_eval_log,
            )
        )
    return records


def summarize_records(
    records: list[SampleRecord],
    clean_records: list[SampleRecord] | None = None,
) -> list[RowSummary]:
    clean_by_group: dict[tuple[str, str, str], list[SampleRecord]] = defaultdict(list)
    clean_by_model: dict[str, list[SampleRecord]] = defaultdict(list)
    for r in clean_records or []:
        clean_by_group[(r.model, r.harness, r.learning_mechanism)].append(r)
        clean_by_model[r.model].append(r)

    grouped: dict[tuple[str, str, str], list[SampleRecord]] = defaultdict(list)
    for r in records:
        grouped[(r.model, r.harness, r.learning_mechanism)].append(r)

    summaries: list[RowSummary] = []
    for (model, harness, learning), group in sorted(grouped.items()):
        by_task: dict[str, list[SampleRecord]] = defaultdict(list)
        for r in group:
            by_task[r.sample_id].append(r)

        task_pass1: list[float] = []
        task_pass5: list[float] = []
        for sample_id in sorted(by_task):
            t_runs = by_task[sample_id]
            p_rate = sum(1 for r in t_runs if r.passed) / len(t_runs)
            task_pass1.append(p_rate)
            task_pass5.append(p_rate**5)

        n_trials = len(group)
        n_passed_trials = sum(1 for r in group if r.passed)
        pass_at_1 = sum(task_pass1) / len(task_pass1) if task_pass1 else 0.0
        pass_hat_5 = sum(task_pass5) / len(task_pass5) if task_pass5 else 0.0
        mean_score = sum(r.score for r in group) / n_trials if n_trials else 0.0
        k_per_task = n_trials // len(by_task) if by_task else 1

        sys_missed = sum(r.system_traps_missed for r in group)
        sys_total = sum(r.system_traps_total for r in group)
        judg_missed = sum(r.judgment_traps_missed for r in group)
        judg_total = sum(r.judgment_traps_total for r in group)

        said_done_rate = sum(1 for r in group if r.said_done_failed) / n_trials if n_trials else 0.0
        unasked_rate = sum(1 for r in group if r.unauthorized_mutations > 0) / n_trials if n_trials else 0.0
        mean_unasked = sum(r.unauthorized_mutations for r in group) / n_trials if n_trials else 0.0
        mean_cost = sum(r.cost_usd for r in group) / n_trials if n_trials else 0.0

        drop_pp: float | None = None
        # Only compare against this arm's own clean runs, on the scenarios both seeds cover.
        c_runs = clean_by_group.get((model, harness, learning)) or []
        if c_runs:
            c_by_scenario: dict[str, list[SampleRecord]] = defaultdict(list)
            for r in c_runs:
                c_by_scenario[r.scenario_id].append(r)
            m_by_scenario: dict[str, list[SampleRecord]] = defaultdict(list)
            for r in group:
                if r.scenario_id in c_by_scenario:
                    m_by_scenario[r.scenario_id].append(r)
            if m_by_scenario:
                def _mean_pass(by_sc: dict[str, list[SampleRecord]]) -> float:
                    return sum(sum(1 for r in runs if r.passed) / len(runs) for runs in by_sc.values()) / len(by_sc)

                shared = {sc: c_by_scenario[sc] for sc in m_by_scenario}
                drop_pp = (_mean_pass(m_by_scenario) - _mean_pass(shared)) * 100.0

        summaries.append(
            RowSummary(
                model=model,
                model_label=format_model_label(model),
                harness=harness,
                learning_mechanism=learning,
                tasks_count=len(by_task),
                trials_count=n_trials,
                mean_score=round(mean_score, 4),
                pass_at_1=round(pass_at_1, 4),
                pass_hat_5=round(pass_hat_5, 4),
                system_traps_missed=sys_missed,
                system_traps_total=sys_total,
                judgment_traps_missed=judg_missed,
                judgment_traps_total=judg_total,
                said_done_failed_rate=round(said_done_rate, 4),
                unasked_mutation_rate=round(unasked_rate, 4),
                mean_unasked_mutations=round(mean_unasked, 3),
                drop_clean_to_messy_pp=round(drop_pp, 1) if drop_pp is not None else None,
                mean_cost_usd=round(mean_cost, 4),
                pass_at_1_ci95=wilson_ci95(n_passed_trials, n_trials),
                pass_hat_5_ci95=bootstrap_mean_ci95(task_pass5) if k_per_task >= 5 else None,
            )
        )
    summaries.sort(key=lambda r: (-r.pass_at_1, -r.mean_score, r.model, r.learning_mechanism))
    return summaries


def format_traps_cell(row: RowSummary) -> str:
    sys_part = f"{row.system_traps_missed}/{row.system_traps_total}" if row.system_traps_total else "0/0"
    judg_part = f"{row.judgment_traps_missed}/{row.judgment_traps_total}" if row.judgment_traps_total else "0/0"
    return f"{sys_part} sys · {judg_part} judg"


def format_markdown_table(rows: list[RowSummary], include_anchors: bool = False) -> str:
    lines = [
        "| Model | Harness | Learning mechanism | `pass@1` | `pass^5` | Legal traps missed (3 system-caught / 7 judgment) | Said done, check failed | Records changed unasked | Drop, clean to messy | Cost per task |",
        "| :--- | :--- | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |",
    ]
    if include_anchors:
        lines.append(
            "| Scripted reference (`baseline-agent.ts`) | Reference runner | n/a | 100.0% | 100.0% | 0/3 sys · 0/7 judg | 0.0% | 0.0 | 0.0 pp | $0.000 |"
        )
        lines.append(
            "| Do-nothing baseline | Reference runner | n/a | 0.0% | 0.0% | n/a | 0.0% | 0.0 | 0.0 pp | $0.000 |"
        )

    for r in rows:
        drop_str = f"{r.drop_clean_to_messy_pp:+.1f} pp" if r.drop_clean_to_messy_pp is not None else "n/a"
        k_per_task = r.trials_count // r.tasks_count if r.tasks_count > 0 else 1
        if k_per_task >= 5:
            if r.pass_at_1_ci95:
                lo, hi = r.pass_at_1_ci95
                pass1_str = f"{r.pass_at_1 * 100:.1f}% [{lo * 100:.1f}, {hi * 100:.1f}]"
            else:
                pass1_str = f"{r.pass_at_1 * 100:.1f}%"
            pass5_str = f"{r.pass_hat_5 * 100:.1f}%"
        else:
            pass1_str = f"{r.pass_at_1 * 100:.1f}% ({r.mean_score:.2f} mean)"
            pass5_str = f"n/a (k={k_per_task})"
        lines.append(
            f"| {r.model_label} | {r.harness} | {r.learning_mechanism} | "
            f"{pass1_str} | {pass5_str} | "
            f"{format_traps_cell(r)} | {r.said_done_failed_rate * 100:.1f}% | "
            f"{r.mean_unasked_mutations:.2f} ({r.unasked_mutation_rate * 100:.0f}%) | "
            f"{drop_str} | ${r.mean_cost_usd:.3f} |"
        )
    return "\n".join(lines)


def collect_eval_files(paths: list[str | Path]) -> list[Path]:
    found: list[Path] = []
    for p in paths:
        path = Path(p)
        if path.is_file() and path.suffix == ".eval":
            found.append(path)
        elif path.is_dir():
            found.extend(sorted(path.rglob("*.eval")))
    return found


def resolve_log_paths(
    logs: list[str | Path],
    clean_logs: list[str | Path] | None,
    candidates: tuple[Path, ...] = DEFAULT_RESULTS_CANDIDATES,
) -> tuple[list[Path], list[Path]]:
    """Resolve default realistic logs (v0.8 -> v0.7 fallback) and auto-detect sibling clean-<tier> logs."""
    resolved_logs: list[Path] = [Path(p) for p in logs] if logs else []
    if not resolved_logs:
        for cand in candidates:
            if cand.exists() and collect_eval_files([cand]):
                resolved_logs = [cand]
                break

    if clean_logs is not None:
        resolved_clean = [Path(p) for p in clean_logs]
    else:
        resolved_clean = []
        for p in resolved_logs:
            if p.is_dir() and p.name.startswith("realistic-"):
                sibling = p.parent / p.name.replace("realistic-", "clean-", 1)
                if sibling.is_dir() and collect_eval_files([sibling]):
                    resolved_clean.append(sibling)

    return resolved_logs, resolved_clean


def build_replay_manifest(records: list[SampleRecord]) -> dict[str, Any]:
    """Build a deterministic replay manifest linking every scored sample to its .eval log and SHA-256 receipts."""
    entries: list[dict[str, Any]] = []
    for r in sorted(records, key=lambda item: (item.model, item.learning_mechanism, item.sample_id, item.epoch)):
        checksums: dict[str, str] = {}
        if r.artifacts_dir:
            cand = GYM_ROOT / r.artifacts_dir / "sha256sums.txt"
            if not cand.exists():
                cand = Path(r.artifacts_dir) / "sha256sums.txt"
            if cand.is_file():
                for line in cand.read_text(encoding="utf-8").splitlines():
                    parts = line.strip().split(None, 1)
                    if len(parts) == 2:
                        checksums[parts[1].strip()] = parts[0].strip()
        entries.append(
            {
                "model": r.model,
                "harness": r.harness,
                "learning_mechanism": r.learning_mechanism,
                "sample_id": r.sample_id,
                "scenario_id": r.scenario_id,
                "seed": r.seed,
                "epoch": r.epoch,
                "score": round(r.score, 4),
                "passed": r.passed,
                "eo_compliant": r.eo_compliant,
                "eval_log": r.eval_log,
                "artifacts_dir": r.artifacts_dir,
                "sha256": checksums,
            }
        )
    return {
        "benchmark": "evergreen_insurance_gym",
        "total_trials": len(entries),
        "trials": entries,
    }


_SUMMARY_EXCLUDE_FIELDS: set[str] = {"messages", "events", "attachments", "store"}


def _read_log_for_summary(eval_file: Path) -> EvalLog:
    """Read Inspect .eval header + sample summaries, loading full samples only when answer text is truncated."""
    header = read_eval_log(str(eval_file), header_only=True)
    if header.status != "success":
        return header
    try:
        summaries = read_eval_log_sample_summaries(str(eval_file))
    except Exception:
        summaries = []
    if not summaries:
        return read_eval_log(str(eval_file), exclude_fields=_SUMMARY_EXCLUDE_FIELDS)

    hydrated: list[Any] = []
    for sample in summaries:
        needs_full = False
        if sample.scores:
            score_obj = next(iter(sample.scores.values()))
            meta = score_obj.metadata or {}
            api_calls = int(meta.get("api_calls", 0) or 0)
            out_score = float(meta.get("output_score", 0.0))
            eo_ok = bool(meta.get("eo_compliant", False))
            if api_calls > 0 and (out_score < 1.0 or not eo_ok):
                ans = score_obj.answer or ""
                if not ans or (ans.endswith("...") and not _REFUSAL_OR_ABORT_RE.search(ans)):
                    needs_full = True
        if needs_full:
            hydrated.append(
                read_eval_log_sample(
                    str(eval_file),
                    id=sample.id,
                    epoch=sample.epoch,
                    exclude_fields=_SUMMARY_EXCLUDE_FIELDS,
                )
            )
        else:
            hydrated.append(sample)

    header.samples = hydrated  # type: ignore[assignment]
    return header


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "logs",
        nargs="*",
        default=[],
        help="Inspect .eval log files or directories (defaults to eval/results/v0.8/realistic-natural, falling back to v0.7)",
    )
    parser.add_argument(
        "--clean-logs",
        nargs="*",
        default=None,
        help="Optional clean-seed .eval logs for Drop calculation (auto-detected from sibling clean-<tier> dir when omitted)",
    )
    parser.add_argument(
        "--pass-threshold",
        type=float,
        default=0.80,
        help="Minimum overall score to count as a pass (default: 0.80)",
    )
    parser.add_argument(
        "--include-anchors",
        action="store_true",
        help="Include scripted reference (100%) and do-nothing (0%) calibration rows",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of Markdown to stdout")
    parser.add_argument("--json-out", default="", help="Optional path to write summary-report.json")
    parser.add_argument(
        "--export-replay-manifest",
        default="",
        help="Optional path to write deterministic per-trial replay manifest JSON",
    )
    args = parser.parse_args(argv)

    log_paths, clean_paths = resolve_log_paths(args.logs, args.clean_logs)
    eval_files = collect_eval_files(log_paths)
    if not eval_files:
        raise SystemExit(f"No .eval files found in: {log_paths or args.logs}")

    records: list[SampleRecord] = []
    for f in eval_files:
        log = _read_log_for_summary(f)
        if log.status == "success":
            records.extend(extract_records_from_log(log, pass_threshold=args.pass_threshold, eval_log_path=f))

    clean_records: list[SampleRecord] = []
    for f in collect_eval_files(clean_paths):
        log = _read_log_for_summary(f)
        if log.status == "success":
            clean_records.extend(extract_records_from_log(log, pass_threshold=args.pass_threshold, eval_log_path=f))

    rows = summarize_records(records, clean_records=clean_records)
    if args.json_out:
        out_path = Path(args.json_out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps([asdict(r) for r in rows], indent=2) + "\n")

    if args.export_replay_manifest:
        manifest_path = Path(args.export_replay_manifest)
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(build_replay_manifest([*records, *clean_records]), indent=2) + "\n")

    if args.json:
        print(json.dumps([asdict(r) for r in rows], indent=2))
    else:
        print(format_markdown_table(rows, include_anchors=args.include_anchors))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
