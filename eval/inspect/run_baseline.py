"""Run the ADR-005 3-model baseline evaluation and emit the README Results table.

Refreshes Google Cloud ADC credentials before each model/scenario batch (so
Vertex MaaS bearer tokens do not expire mid-run), runs `evergreen_langchain.py`
either serially against `:3000`–`:3007` or sharded in parallel across `N`
isolated 8-service stacks (`--parallel-stacks N`), and summarizes the resulting
`.eval` logs with `summarize_inspect.py`.

Usage:
  python3 eval/inspect/run_baseline.py --scenario 01,14,20 --difficulty scripted --epochs 1
  python3 eval/inspect/run_baseline.py --scenario all --difficulty natural --epochs 5 --parallel-stacks 4
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import shutil
import signal
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import google.auth
import google.auth.transport.requests
import httpx

from evergreen import load_evergreen_samples
from summarize_inspect import (
    collect_eval_files,
    extract_records_from_log,
    format_markdown_table,
    read_eval_log,
    summarize_records,
)

INSPECT_DIR = Path(__file__).resolve().parent
GYM_ROOT = INSPECT_DIR.parent.parent
DEFAULT_REGION = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")
ALL_SCENARIOS = [f"{i:02d}" for i in range(1, 21)]
STACK_SERVICE_NAMES = (
    "ams",
    "rater",
    "crm",
    "ecm",
    "comm",
    "summit-fire",
    "coastal-star",
    "claims",
)

WORKHORSE_MODELS: list[tuple[str, str]] = [
    ("gemini-3.8-flash", "google/gemini-3.8-flash"),
    ("claude-sonnet-5-5", "anthropic/vertex/claude-sonnet-5-5"),
    ("deepseek-v4.1-flash", "openai-api/vertex-maas/deepseek-ai/deepseek-v4.1-flash-maas"),
]

_AUTH_LOCK = threading.Lock()


@dataclass
class StackHandle:
    index: int
    base_port: int
    data_dir: Path | None
    process: subprocess.Popen[bytes] | None


def resolve_default_project(explicit_project: str = "") -> str:
    """Resolve GCP project ID lazily so importing run_baseline or running --help works offline."""
    if explicit_project:
        return explicit_project
    env_proj = os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("CLOUD_ML_PROJECT_ID")
    if env_proj:
        return env_proj
    return subprocess.check_output(["gcloud", "config", "get-value", "project"], text=True, timeout=10).strip()


def _default_adc_path() -> str:
    explicit = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    if explicit and Path(explicit).exists():
        return explicit
    gcloud_dir = Path.home() / ".config" / "gcloud"
    adc_file = gcloud_dir / "application_default_credentials.json"
    if adc_file.exists():
        return str(adc_file)
    legacy = sorted((gcloud_dir / "legacy_credentials").glob("*/adc.json"))
    if legacy:
        return str(legacy[0])
    return ""


def stack_base_urls(base_port: int = 3000) -> dict[str, str]:
    """Map an 8-service stack base port (e.g., 3100) to the EVERGREEN_BASE_URLS dictionary."""
    return {name: f"http://localhost:{base_port + offset}" for offset, name in enumerate(STACK_SERVICE_NAMES)}


def build_vertex_env(
    project: str,
    region: str,
    adc_path: str,
    base_port: int | None = None,
    artifacts_dir: str = "",
) -> dict[str, str]:
    with _AUTH_LOCK:
        env = dict(os.environ)
        resolved_adc = adc_path or _default_adc_path()
        if resolved_adc and Path(resolved_adc).exists():
            env["GOOGLE_APPLICATION_CREDENTIALS"] = resolved_adc
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = resolved_adc
        env["GOOGLE_CLOUD_PROJECT"] = project
        env["GOOGLE_CLOUD_LOCATION"] = region
        env["GOOGLE_GENAI_USE_VERTEXAI"] = "true"
        env["ANTHROPIC_VERTEX_PROJECT_ID"] = project
        env["ANTHROPIC_VERTEX_REGION"] = region

        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        creds.refresh(google.auth.transport.requests.Request())
        host = (
            "https://aiplatform.googleapis.com"
            if region == "global"
            else f"https://{region}-aiplatform.googleapis.com"
        )
        env["VERTEX_MAAS_BASE_URL"] = f"{host}/v1/projects/{project}/locations/{region}/endpoints/openapi"
        env["VERTEX_MAAS_API_KEY"] = str(creds.token)

    if base_port is not None:
        env["EVERGREEN_BASE_PORT"] = str(base_port)
        env["EVERGREEN_BASE_URLS"] = json.dumps(stack_base_urls(base_port))
    if artifacts_dir:
        env["EVERGREEN_ARTIFACTS_DIR"] = artifacts_dir
    return env


def verify_services(modality_mode: str = "strict", base_port: int = 3000, timeout: float = 5.0) -> None:
    for port in range(base_port, base_port + 8):
        resp = httpx.get(f"http://localhost:{port}/sim/status", timeout=timeout)
        resp.raise_for_status()
        actual = resp.json().get("modality_mode")
        if actual != modality_mode:
            raise RuntimeError(f"Service on :{port} has modality_mode={actual!r}, expected {modality_mode!r}")


def _is_stack_ready(base_port: int, modality_mode: str) -> bool:
    try:
        verify_services(modality_mode=modality_mode, base_port=base_port, timeout=1.5)
        return True
    except Exception:
        return False


def ensure_parallel_stacks(
    count: int,
    stack_base_port: int,
    modality_mode: str,
    startup_timeout_s: float = 90.0,
) -> list[StackHandle]:
    """Attach to pre-launched stacks or launch N isolated showcase stacks and wait until ready."""
    bun_bin = os.environ.get("BUN_BIN", "bun")
    handles: list[StackHandle] = []
    for i in range(count):
        base_port = stack_base_port + i * 100
        if _is_stack_ready(base_port, modality_mode):
            print(f"[stack-{i}] Attaching to existing {modality_mode} stack on :{base_port}..:{base_port + 7}", flush=True)
            handles.append(StackHandle(index=i, base_port=base_port, data_dir=None, process=None))
            continue

        # Keyed by port so two runners on different port ranges never share (or wipe) a data dir.
        data_dir = Path(f"/tmp/evergreen_stack_{base_port}")
        if data_dir.exists():
            shutil.rmtree(data_dir, ignore_errors=True)
        data_dir.mkdir(parents=True, exist_ok=True)

        cmd = [
            bun_bin,
            "run",
            "scripts/run-showcase.ts",
            *(["--strict"] if modality_mode == "strict" else []),
            "--base-port",
            str(base_port),
            "--data-dir",
            str(data_dir),
        ]
        stack_env = dict(os.environ)
        stack_env["MODALITY_MODE"] = modality_mode
        stack_env["EVERGREEN_BASE_PORT"] = str(base_port)
        stack_env["EVERGREEN_DATA_DIR"] = str(data_dir)
        log_file = (data_dir / "showcase.log").open("wb")
        print(f"[stack-{i}] Launching isolated stack on :{base_port}..:{base_port + 7} (data={data_dir})", flush=True)
        proc = subprocess.Popen(
            cmd,
            cwd=str(GYM_ROOT),
            env=stack_env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        log_file.close()
        handles.append(StackHandle(index=i, base_port=base_port, data_dir=data_dir, process=proc))

    deadline = time.monotonic() + startup_timeout_s
    for h in handles:
        while True:
            if _is_stack_ready(h.base_port, modality_mode):
                break
            if h.process is not None and h.process.poll() is not None:
                log_tail = ""
                if h.data_dir and (h.data_dir / "showcase.log").exists():
                    log_tail = (h.data_dir / "showcase.log").read_text(errors="replace")[-1500:]
                raise RuntimeError(
                    f"Stack {h.index} (:{h.base_port}) exited early with code {h.process.returncode}:\n{log_tail}"
                )
            if time.monotonic() >= deadline:
                raise TimeoutError(
                    f"Timed out waiting for stack {h.index} (:{h.base_port}..:{h.base_port + 7}) to reach /sim/status={modality_mode}"
                )
            time.sleep(0.4)
    return handles


def shutdown_stacks(handles: list[StackHandle]) -> None:
    for h in handles:
        if h.process is not None and h.process.poll() is None:
            try:
                os.killpg(h.process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    for h in handles:
        if h.process is not None:
            try:
                h.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(h.process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        if h.data_dir is not None and h.data_dir.exists():
            shutil.rmtree(h.data_dir, ignore_errors=True)


def parse_scenarios_arg(raw: str) -> list[str]:
    cleaned = raw.strip()
    if cleaned.lower() == "all":
        return list(ALL_SCENARIOS)
    return [s.strip().zfill(2) for s in cleaned.split(",") if s.strip()]


def run_inspect_batch(
    python_bin: str,
    model_id: str,
    scenario: str,
    seed: str,
    difficulty: str,
    modality_mode: str,
    epochs: int,
    turn_limit: int,
    log_dir: Path,
    env: dict[str, str],
    learning_mechanism: str = "none",
    artifacts_dir: str = "",
) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        python_bin,
        "-m",
        "inspect_ai",
        "eval",
        "eval/inspect/evergreen_langchain.py",
        "--model",
        model_id,
        "-T",
        f"scenario={scenario}",
        "-T",
        f"seed={seed}",
        "-T",
        f"difficulty={difficulty}",
        "-T",
        f"modality_mode={modality_mode}",
        "-T",
        f"turn_limit={turn_limit}",
        "-T",
        f"learning_mechanism={learning_mechanism}",
        *(["-T", f"artifacts_dir={artifacts_dir}"] if artifacts_dir else []),
        "--epochs",
        str(epochs),
        "--max-samples",
        "1",
        "--log-dir",
        str(log_dir),
        "--display",
        "plain",
    ]
    port_tag = env.get("EVERGREEN_BASE_PORT", "3000")
    print(
        f"\n=== Running {model_id} | scenario={scenario} | seed={seed} | difficulty={difficulty} "
        f"| learning={learning_mechanism} | epochs={epochs} | port={port_tag} ===",
        flush=True,
    )
    subprocess.run(cmd, cwd=str(GYM_ROOT), env=env, check=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--scenario",
        default="01,14,20",
        help="Comma-separated scenario IDs or 'all' (default: 01,14,20)",
    )
    parser.add_argument("--difficulty", default="scripted", help="Prompt difficulty tier (default: scripted)")
    parser.add_argument("--seed", default="realistic", help="Seed mode for main run (default: realistic)")
    parser.add_argument("--modality-mode", default="strict", help="Modality mode (default: strict)")
    parser.add_argument("--epochs", type=int, default=1, help="Number of epochs per sample (default: 1)")
    parser.add_argument("--turn-limit", type=int, default=60, help="Max model turns per sample (default: 60)")
    parser.add_argument("--models", default="all", help="Comma-separated short names or 'all'")
    parser.add_argument(
        "--learning-mechanism",
        choices=["none", "domain_skill"],
        default="none",
        help="Agent learning mechanism: 'none' (zero-shot) or 'domain_skill' (SOP) (default: none)",
    )
    parser.add_argument(
        "--parallel-stacks",
        type=int,
        default=1,
        help="Number of isolated 8-service stacks to run in parallel (default: 1 on :3000-:3007)",
    )
    parser.add_argument(
        "--stack-base-port",
        type=int,
        default=3100,
        help="Base port for stack 0 when --parallel-stacks > 1; stack i uses <base + i*100> (default: 3100)",
    )
    parser.add_argument("--artifacts-dir", default="", help="Optional directory for replayable receipt bundles")
    parser.add_argument("--out-dir", default="/tmp/evergreen-baseline-logs", help="Directory for .eval logs")
    parser.add_argument("--with-clean", action="store_true", help="Also run 1-epoch clean seed control arm for Drop column")
    parser.add_argument("--project", default="", help="Google Cloud project ID (resolved lazily if omitted)")
    parser.add_argument("--region", default=DEFAULT_REGION)
    parser.add_argument("--adc-path", default="")
    args = parser.parse_args(argv)

    if args.parallel_stacks < 1:
        raise SystemExit("--parallel-stacks must be >= 1")

    project = resolve_default_project(args.project)
    python_bin = sys.executable
    exit_code = 0
    out_root = Path(args.out_dir)
    main_dir = out_root / f"{args.seed}-{args.difficulty}"
    clean_dir = out_root / f"clean-{args.difficulty}"
    slug_suffix = "" if args.learning_mechanism == "none" else f"-{args.learning_mechanism}"

    wanted = {m.strip() for m in args.models.split(",") if m.strip()}
    selected_models = [
        (slug, mid)
        for slug, mid in WORKHORSE_MODELS
        if "all" in wanted or slug in wanted or mid in wanted
    ]

    if args.parallel_stacks == 1:
        verify_services(args.modality_mode, base_port=3000)
        scenario_arg = ",".join(parse_scenarios_arg(args.scenario))
        for slug, model_id in selected_models:
            env = build_vertex_env(project, args.region, args.adc_path, artifacts_dir=args.artifacts_dir)
            run_inspect_batch(
                python_bin=python_bin,
                model_id=model_id,
                scenario=scenario_arg,
                seed=args.seed,
                difficulty=args.difficulty,
                modality_mode=args.modality_mode,
                epochs=args.epochs,
                turn_limit=args.turn_limit,
                log_dir=main_dir / f"{slug}{slug_suffix}",
                env=env,
                learning_mechanism=args.learning_mechanism,
                artifacts_dir=args.artifacts_dir,
            )
            if args.with_clean:
                env = build_vertex_env(project, args.region, args.adc_path, artifacts_dir=args.artifacts_dir)
                run_inspect_batch(
                    python_bin=python_bin,
                    model_id=model_id,
                    scenario=scenario_arg,
                    seed="clean",
                    difficulty=args.difficulty,
                    modality_mode=args.modality_mode,
                    epochs=1,
                    turn_limit=args.turn_limit,
                    log_dir=clean_dir / f"{slug}{slug_suffix}",
                    env=env,
                    learning_mechanism=args.learning_mechanism,
                    artifacts_dir=args.artifacts_dir,
                )
    else:
        scenarios = parse_scenarios_arg(args.scenario)
        jobs: list[tuple[str, str, str, str, int, Path]] = []
        for slug, model_id in selected_models:
            for sc in scenarios:
                jobs.append((slug, model_id, sc, args.seed, args.epochs, main_dir / f"{slug}{slug_suffix}"))
            if args.with_clean:
                for sc in scenarios:
                    jobs.append((slug, model_id, sc, "clean", 1, clean_dir / f"{slug}{slug_suffix}"))
        runnable = []
        for job in jobs:
            if load_evergreen_samples(scenario=job[2], seed=job[3], difficulty=args.difficulty):
                runnable.append(job)
            else:
                print(f"[skip] {job[0]} scenario={job[2]} seed={job[3]}: no {args.difficulty} case for this variant", flush=True)
        jobs = runnable

        handles: list[StackHandle] = []
        try:
            handles = ensure_parallel_stacks(
                count=args.parallel_stacks,
                stack_base_port=args.stack_base_port,
                modality_mode=args.modality_mode,
            )
            available_ports: queue.Queue[int] = queue.Queue()
            for h in handles:
                available_ports.put(h.base_port)

            def _run_job(job: tuple[str, str, str, str, int, Path]) -> None:
                _slug, m_id, sc_id, j_seed, j_epochs, j_log_dir = job
                base_port = available_ports.get()
                try:
                    worker_env = build_vertex_env(
                        project,
                        args.region,
                        args.adc_path,
                        base_port=base_port,
                        artifacts_dir=args.artifacts_dir,
                    )
                    run_inspect_batch(
                        python_bin=python_bin,
                        model_id=m_id,
                        scenario=sc_id,
                        seed=j_seed,
                        difficulty=args.difficulty,
                        modality_mode=args.modality_mode,
                        epochs=j_epochs,
                        turn_limit=args.turn_limit,
                        log_dir=j_log_dir,
                        env=worker_env,
                        learning_mechanism=args.learning_mechanism,
                        artifacts_dir=args.artifacts_dir,
                    )
                finally:
                    available_ports.put(base_port)

            failures: list[str] = []
            with ThreadPoolExecutor(max_workers=len(handles)) as pool:
                futures = {pool.submit(_run_job, j): j for j in jobs}
                for fut in as_completed(futures):
                    try:
                        fut.result()
                    except Exception as exc:  # keep the other jobs and the summary
                        f_slug, _m, f_sc, f_seed, _e, _d = futures[fut]
                        failures.append(f"{f_slug} scenario={f_sc} seed={f_seed}: {exc}")
            if failures:
                print(f"\n{len(failures)} job(s) failed:", flush=True)
                for line in failures:
                    print(f"  - {line}", flush=True)
                exit_code = 1
        finally:
            shutdown_stacks(handles)

    records = []
    for f in collect_eval_files([main_dir]):
        log = read_eval_log(str(f))
        if log.status == "success":
            records.extend(extract_records_from_log(log, eval_log_path=f))

    clean_records = []
    if args.with_clean and clean_dir.exists():
        for f in collect_eval_files([clean_dir]):
            log = read_eval_log(str(f))
            if log.status == "success":
                clean_records.extend(extract_records_from_log(log, eval_log_path=f))

    rows = summarize_records(records, clean_records=clean_records)
    print("\n" + format_markdown_table(rows, include_anchors=True))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
