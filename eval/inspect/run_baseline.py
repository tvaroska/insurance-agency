"""Run the ADR-005 3-model baseline evaluation and emit the README Results table.

Refreshes Google Cloud ADC credentials before each model/scenario batch (so
Vertex MaaS bearer tokens do not expire mid-run), runs `evergreen_langchain.py`
serially (`--max-samples 1`) against the live 8-service stack (`:3000`–`:3007`),
and summarizes the resulting `.eval` logs with `summarize_inspect.py`.

Usage:
  python eval/inspect/run_baseline.py --scenario 01,14,20 --difficulty scripted --epochs 1
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

import google.auth
import google.auth.transport.requests
import httpx

from summarize_inspect import (
    collect_eval_files,
    extract_records_from_log,
    format_markdown_table,
    read_eval_log,
    summarize_records,
)

INSPECT_DIR = Path(__file__).resolve().parent
GYM_ROOT = INSPECT_DIR.parent.parent
DEFAULT_PROJECT = (
    os.environ.get("GOOGLE_CLOUD_PROJECT")
    or os.environ.get("CLOUD_ML_PROJECT_ID")
    or subprocess.check_output(["gcloud", "config", "get-value", "project"], text=True).strip()
)
DEFAULT_REGION = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")

WORKHORSE_MODELS: list[tuple[str, str]] = [
    ("gemini-3.8-flash", "google/gemini-3.8-flash"),
    ("claude-sonnet-5-5", "anthropic/vertex/claude-sonnet-5-5"),
    ("deepseek-v4.1-flash", "openai-api/vertex-maas/deepseek-ai/deepseek-v4.1-flash-maas"),
]


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


def build_vertex_env(project: str, region: str, adc_path: str) -> dict[str, str]:
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
    host = "https://aiplatform.googleapis.com" if region == "global" else f"https://{region}-aiplatform.googleapis.com"
    env["VERTEX_MAAS_BASE_URL"] = f"{host}/v1/projects/{project}/locations/{region}/endpoints/openapi"
    env["VERTEX_MAAS_API_KEY"] = str(creds.token)
    return env


def verify_services(modality_mode: str = "strict") -> None:
    for port in range(3000, 3008):
        resp = httpx.get(f"http://localhost:{port}/sim/status", timeout=5.0)
        resp.raise_for_status()
        actual = resp.json().get("modality_mode")
        if actual != modality_mode:
            raise RuntimeError(f"Service on :{port} has modality_mode={actual!r}, expected {modality_mode!r}")


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
        "--epochs",
        str(epochs),
        "--max-samples",
        "1",
        "--log-dir",
        str(log_dir),
        "--display",
        "plain",
    ]
    print(f"\n=== Running {model_id} | scenario={scenario} | seed={seed} | difficulty={difficulty} | epochs={epochs} ===", flush=True)
    subprocess.run(cmd, cwd=str(GYM_ROOT), env=env, check=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", default="01,14,20", help="Comma-separated scenario IDs (default: 01,14,20)")
    parser.add_argument("--difficulty", default="scripted", help="Prompt difficulty tier (default: scripted)")
    parser.add_argument("--seed", default="realistic", help="Seed mode for main run (default: realistic)")
    parser.add_argument("--modality-mode", default="strict", help="Modality mode (default: strict)")
    parser.add_argument("--epochs", type=int, default=1, help="Number of epochs per sample (default: 1)")
    parser.add_argument("--turn-limit", type=int, default=60, help="Max model turns per sample (default: 60)")
    parser.add_argument("--models", default="all", help="Comma-separated short names or 'all'")
    parser.add_argument("--out-dir", default="/tmp/evergreen-baseline-logs", help="Directory for .eval logs")
    parser.add_argument("--with-clean", action="store_true", help="Also run 1-epoch clean seed control arm for Drop column")
    parser.add_argument("--project", default=DEFAULT_PROJECT)
    parser.add_argument("--region", default=DEFAULT_REGION)
    parser.add_argument("--adc-path", default="")
    args = parser.parse_args(argv)

    verify_services(args.modality_mode)
    python_bin = sys.executable
    out_root = Path(args.out_dir)
    main_dir = out_root / f"{args.seed}-{args.difficulty}"
    clean_dir = out_root / f"clean-{args.difficulty}"

    wanted = {m.strip() for m in args.models.split(",") if m.strip()}
    selected_models = [
        (slug, mid)
        for slug, mid in WORKHORSE_MODELS
        if "all" in wanted or slug in wanted or mid in wanted
    ]

    for slug, model_id in selected_models:
        env = build_vertex_env(args.project, args.region, args.adc_path)
        run_inspect_batch(
            python_bin=python_bin,
            model_id=model_id,
            scenario=args.scenario,
            seed=args.seed,
            difficulty=args.difficulty,
            modality_mode=args.modality_mode,
            epochs=args.epochs,
            turn_limit=args.turn_limit,
            log_dir=main_dir / slug,
            env=env,
        )
        if args.with_clean:
            env = build_vertex_env(args.project, args.region, args.adc_path)
            run_inspect_batch(
                python_bin=python_bin,
                model_id=model_id,
                scenario=args.scenario,
                seed="clean",
                difficulty=args.difficulty,
                modality_mode=args.modality_mode,
                epochs=1,
                turn_limit=args.turn_limit,
                log_dir=clean_dir / slug,
                env=env,
            )

    records = []
    for f in collect_eval_files([main_dir]):
        log = read_eval_log(str(f))
        if log.status == "success":
            records.extend(extract_records_from_log(log))

    clean_records = []
    if args.with_clean and clean_dir.exists():
        for f in collect_eval_files([clean_dir]):
            log = read_eval_log(str(f))
            if log.status == "success":
                clean_records.extend(extract_records_from_log(log))

    rows = summarize_records(records, clean_records=clean_records)
    print("\n" + format_markdown_table(rows, include_anchors=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
