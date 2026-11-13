"""Direct multi-turn deterministic DB-state evaluation task for Inspect AI.

Loads declarative YAML scenarios from `eval/deterministic/*.yaml`, each defining:
  1. `start_state`: exact start DB state (`base: empty|clean|realistic` + per-table rows)
     applied via `POST /sim/seed` across all 8 services.
  2. `turns`: deterministic multi-turn client <-> agent chat messages stepped in one
     continuous conversation thread over Evergreen's typed tools.
  3. `expected_diff`: closed-world 32-table DB state contract evaluated purely on
     `snapshot-before.json` vs. `snapshot-after.json` (zero trace regexes, zero LLM judge).

Usage:
  inspect eval eval/inspect/evergreen_deterministic.py --model google/gemini-3.8-flash
  inspect eval eval/inspect/evergreen_deterministic.py --model google/gemini-3.8-flash -T scenario=DT-01
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import tempfile
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any

import httpx
import yaml

from evergreen import GYM_ROOT, _HAS_INSPECT, MemoryDataset, Sample, Score, Target, Task, scorer, task
from evergreen_langchain import (
    LEARNING_MECHANISM_LABELS,
    STACK_HELD_KEY,
    WORK_DIR_KEY,
    _slugify_model,
    _stack_lock,
    bridge_filters,
    check_modality,
    normalize_learning_mechanism,
    open_mcp_tools,
    release_services,
    run_bun,
    scorer_headers,
    system_prompt,
    take_snapshot,
)
from openapi_tools import RestClient, build_rest_tools, service_base_urls

DETERMINISTIC_DIR = GYM_ROOT / "eval" / "deterministic"
TURNS_KEY = "evergreen_deterministic:turns"

SERVICE_URL_KEY_MAP: dict[str, str] = {
    "ams": "ams",
    "rater": "rater",
    "crm": "crm",
    "ecm": "ecm",
    "comm": "comm",
    "carrier-summit": "summit-fire",
    "summit-fire": "summit-fire",
    "carrier-coastal": "coastal-star",
    "coastal-star": "coastal-star",
    "claims": "claims",
}

DIRECT_CHAT_GUIDANCE = (
    "\n\nDirect client conversation mode:\n"
    "- You are chatting directly with the client across multiple turns.\n"
    "- If the client's request is ambiguous, incomplete, or asks you to verify before "
    "acting, look up the records and ask clarifying questions in your reply without "
    "mutating records prematurely.\n"
    "- Never mutate policies, clients, claims, or quotes that the client explicitly "
    "asked you to leave untouched."
)

if _HAS_INSPECT:
    from inspect_ai.agent import AgentState, agent, agent_bridge
    from inspect_ai.model import GenerateConfig
    from inspect_ai.scorer import mean, stderr
    from inspect_ai.solver import Generate, TaskState, solver
    from inspect_ai.util import store
    from langchain.agents import create_agent
    from langchain_openai import ChatOpenAI
else:
    AgentState = Any  # type: ignore[assignment,misc]
    Generate = Any  # type: ignore[assignment,misc]
    TaskState = Any  # type: ignore[assignment,misc]
    GenerateConfig = None  # type: ignore[assignment]
    agent_bridge = None  # type: ignore[assignment]
    create_agent = None  # type: ignore[assignment]
    ChatOpenAI = None  # type: ignore[assignment]
    store = None  # type: ignore[assignment]

    def agent(fn=None, **_kwargs):  # type: ignore[misc]
        return fn if fn is not None else (lambda f: f)

    def solver(fn=None, **_kwargs):  # type: ignore[misc]
        return fn if fn is not None else (lambda f: f)

    def mean():  # type: ignore[misc]
        return None

    def stderr():  # type: ignore[misc]
        return None


def load_deterministic_scenarios(
    scenarios_dir: Path | str = DETERMINISTIC_DIR,
) -> list[dict[str, Any]]:
    """Load and validate all YAML deterministic DB-state scenarios."""
    root = Path(scenarios_dir)
    if not root.exists():
        raise FileNotFoundError(f"Deterministic scenarios directory not found: {root}")
    scenarios: list[dict[str, Any]] = []
    for path in sorted(root.glob("*.yaml")):
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"{path}: expected YAML mapping")
        for req in ("id", "slug", "name", "description", "difficulty", "services", "start_state", "turns", "expected_diff"):
            if req not in raw:
                raise ValueError(f"{path}: missing required field '{req}'")
        if not isinstance(raw["turns"], list) or len(raw["turns"]) < 2:
            raise ValueError(f"{path}: deterministic multi-turn scenario needs at least 2 turns")
        scenarios.append(raw)
    return scenarios


def load_deterministic_samples(
    scenario: str | list[str] | tuple[str, ...] | None = None,
    difficulty: str | None = None,
    modality_mode: str = "strict",
    scenarios_dir: Path | str = DETERMINISTIC_DIR,
) -> list[Sample]:
    """Convert YAML deterministic scenarios into Inspect AI `Sample` objects."""
    if scenario is None:
        wanted: set[str] | None = None
    elif isinstance(scenario, (list, tuple, set)):
        wanted = {str(s).strip() for s in scenario if str(s).strip()}
    else:
        wanted = {s.strip() for s in str(scenario).split(",") if s.strip()}

    samples: list[Sample] = []
    for item in load_deterministic_scenarios(scenarios_dir):
        if wanted and item["id"] not in wanted and item["slug"] not in wanted:
            continue
        if difficulty and item["difficulty"] != difficulty:
            continue
        turns = item["turns"]
        samples.append(
            Sample(
                id=f"{item['id']}-{item['slug']}",
                input=turns[0]["message"],
                target=item["id"],
                metadata={
                    "scenario_id": item["id"],
                    "slug": item["slug"],
                    "scenario_name": item["name"],
                    "difficulty": item["difficulty"],
                    "services": item["services"],
                    "start_state": item["start_state"],
                    "turns": turns,
                    "modality_mode": modality_mode,
                },
            )
        )
    return samples


def build_seed_payloads(
    start_state: dict[str, Any],
    urls: dict[str, str],
) -> dict[str, dict[str, Any]]:
    """Build per-service `POST /sim/seed` JSON bodies across all configured services."""
    base = str(start_state.get("base", "empty"))
    raw_tables = start_state.get("tables") or {}
    tables_by_url_key: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for svc, svc_tables in raw_tables.items():
        url_key = SERVICE_URL_KEY_MAP.get(svc, svc)
        merged = dict(tables_by_url_key.get(url_key, {}))
        merged.update(svc_tables or {})
        tables_by_url_key[url_key] = merged

    return {
        url_key: {"base": base, "tables": tables_by_url_key.get(url_key, {})}
        for url_key in urls
    }


async def seed_services(
    http: httpx.AsyncClient,
    urls: dict[str, str],
    start_state: dict[str, Any],
) -> None:
    """Seed all 8 services deterministically via `POST /sim/seed`."""
    payloads = build_seed_payloads(start_state, urls)
    headers = scorer_headers()

    async def _seed_one(url_key: str, url: str) -> None:
        resp = await http.post(f"{url}/sim/seed", json=payloads[url_key], headers=headers)
        resp.raise_for_status()

    await asyncio.gather(*(_seed_one(k, u) for k, u in urls.items()))


async def run_multiturn_conversation(
    graph: Any,
    turns: list[dict[str, Any]],
) -> list[Any]:
    """Step through scripted client turns sequentially in one continuous thread."""
    messages: list[Any] = []
    for turn in turns:
        messages.append({"role": "user", "content": str(turn["message"])})
        result = await graph.ainvoke({"messages": messages})
        messages = list(result["messages"])
    return messages


def contract_report_score(
    report: dict[str, Any],
    answer: str,
    work_dir: Path | str,
) -> Score:
    """Convert a `StateContractResult` JSON report into a binary Inspect `Score`."""
    passed = bool(report.get("passed", False))
    value = 1.0 if passed else 0.0
    scenario_id = str(report.get("scenario_id", "unknown"))
    summary = str(report.get("summary", ""))
    return Score(
        value=value,
        answer=answer,
        explanation=f"{scenario_id}: {summary}",
        metadata={
            "passed": passed,
            "scenario_id": scenario_id,
            "base": report.get("base"),
            "matched_inserts": report.get("matchedInserts", []),
            "missing_inserts": report.get("missingInserts", []),
            "matched_updates": report.get("matchedUpdates", []),
            "missing_updates": report.get("missingUpdates", []),
            "matched_deletes": report.get("matchedDeletes", []),
            "missing_deletes": report.get("missingDeletes", []),
            "unexpected_writes": report.get("unexpectedWrites", []),
            "allowed_extras_used": report.get("allowedExtrasUsed", []),
            "extra_governance_writes": int(report.get("extraGovernanceWrites", 0)),
            "system_audit_writes": int(report.get("systemAuditWrites", 0)),
            "diff_summary": report.get("diffSummary", {}),
            "artifacts_dir": str(work_dir),
        },
    )


def archive_deterministic_artifacts(
    *,
    artifacts_root: str | Path,
    model_name: str,
    sample_id: str,
    epoch: int,
    work_dir: Path,
    report_path: Path,
    learning_mechanism: str = "none",
) -> str:
    """Persist before/after snapshots and state-contract report with SHA-256 manifest."""
    root_path = Path(artifacts_root)
    if not root_path.is_absolute():
        root_path = GYM_ROOT / root_path
    norm_learning = normalize_learning_mechanism(learning_mechanism)
    arm_dir = _slugify_model(model_name) + ("" if norm_learning == "none" else f"-{norm_learning}")
    bundle_dir = root_path / arm_dir / "deterministic" / f"{sample_id}-e{epoch}"
    bundle_dir.mkdir(parents=True, exist_ok=True)

    sources = [
        ("contract-report.json", report_path),
        ("snapshot-before.json", work_dir / "snapshot-before.json"),
        ("snapshot-after.json", work_dir / "snapshot-after.json"),
    ]
    manifest_lines: list[str] = []
    for dest_name, src_path in sorted(sources, key=lambda item: item[0]):
        if src_path.exists():
            dest_path = bundle_dir / dest_name
            shutil.copy2(src_path, dest_path)
            digest = hashlib.sha256(dest_path.read_bytes()).hexdigest()
            manifest_lines.append(f"{digest}  {dest_name}")
    (bundle_dir / "sha256sums.txt").write_text("\n".join(manifest_lines) + ("\n" if manifest_lines else ""))

    resolved_bundle = bundle_dir.resolve()
    resolved_gym = GYM_ROOT.resolve()
    if resolved_bundle.is_relative_to(resolved_gym):
        return resolved_bundle.relative_to(resolved_gym).as_posix()
    return str(bundle_dir)


@solver
def prepare_state_scenario():
    """Acquire stack lock, apply declarative `start_state` via `/sim/seed`, and capture before snapshot."""

    async def solve(state: TaskState, generate: Generate):
        await _stack_lock().acquire()
        state.store.set(STACK_HELD_KEY, True)
        work_dir = Path(tempfile.mkdtemp(prefix=f"evergreen-dt-{state.sample_id}-e{state.epoch}-"))
        state.store.set(WORK_DIR_KEY, str(work_dir))
        state.store.set(TURNS_KEY, list(state.metadata["turns"]))
        urls = service_base_urls()
        async with httpx.AsyncClient(timeout=120) as http:
            await check_modality(http, urls, state.metadata["modality_mode"])
            await seed_services(http, urls, state.metadata["start_state"])
            snapshot = await take_snapshot(http, urls)
        (work_dir / "snapshot-before.json").write_text(json.dumps(snapshot))
        return state

    return solve


@agent
def multiturn_langchain_agent(learning_mechanism: str = "none"):
    """LangChain typed-tool agent stepped through direct multi-turn client messages."""
    norm_learning = normalize_learning_mechanism(learning_mechanism)

    async def execute(state: AgentState):
        urls = service_base_urls()
        work_dir = Path(store().get(WORK_DIR_KEY))
        turns = list(store().get(TURNS_KEY) or [])
        in_filter, out_filter = bridge_filters()
        async with AsyncExitStack() as stack:
            http = await stack.enter_async_context(httpx.AsyncClient(timeout=60))
            rest_client = RestClient(http, urls)
            tools = [*build_rest_tools(rest_client), *await open_mcp_tools(stack, urls, work_dir)]
            model = ChatOpenAI(model="inspect", api_key="inspect", disable_streaming=True)
            prompt = system_prompt(urls, learning_mechanism=norm_learning) + DIRECT_CHAT_GUIDANCE
            graph = create_agent(model, tools, system_prompt=prompt)
            async with agent_bridge(
                state,
                filter=in_filter,
                response_filter=out_filter,
                web_search=False,
                code_execution=False,
                client_mcp_servers=False,
            ) as bridge:
                try:
                    await run_multiturn_conversation(graph, turns)
                finally:
                    state.messages = list(bridge.state.messages)
                    if bridge.state.output:
                        state.output = bridge.state.output
                return bridge.state

    return execute


@scorer(metrics=[mean(), stderr()])
def state_contract_scorer(
    artifacts_dir: str | None = None,
    learning_mechanism: str = "none",
):
    """Capture post-run 32-table snapshot and grade purely against the YAML state contract."""

    async def score(state: TaskState, target: Target):
        meta = state.metadata
        work_dir = Path(state.store.get(WORK_DIR_KEY))
        before_file = work_dir / "snapshot-before.json"
        after_file = work_dir / "snapshot-after.json"
        report_file = work_dir / "contract-report.json"

        async with httpx.AsyncClient(timeout=120) as http:
            after_file.write_text(json.dumps(await take_snapshot(http, service_base_urls())))

        await run_bun(
            "eval/run-state-scenarios.ts",
            "--score-snapshots",
            "--scenario",
            str(meta["scenario_id"]),
            "--before",
            str(before_file),
            "--after",
            str(after_file),
            "--out",
            str(report_file),
        )
        report = json.loads(report_file.read_text(encoding="utf-8"))
        effective_artifacts = artifacts_dir or os.environ.get("EVERGREEN_ARTIFACTS_DIR") or None
        recorded_dir: Path | str = work_dir
        if effective_artifacts:
            model_str = str(getattr(state, "model", None) or getattr(state.output, "model", None) or "unknown")
            recorded_dir = archive_deterministic_artifacts(
                artifacts_root=effective_artifacts,
                model_name=model_str,
                sample_id=str(state.sample_id),
                epoch=int(getattr(state, "epoch", 1) or 1),
                work_dir=work_dir,
                report_path=report_file,
                learning_mechanism=learning_mechanism,
            )
        answer = state.output.completion if state.output else ""
        return contract_report_score(report, answer=answer, work_dir=recorded_dir)

    return score


@task
def evergreen_deterministic(
    scenario: str | None = None,
    difficulty: str | None = None,
    modality_mode: str = "strict",
    turn_limit: int = 100,
    learning_mechanism: str = "none",
    artifacts_dir: str | None = None,
) -> Task:
    """Direct multi-turn deterministic DB-state evaluation task for Evergreen."""
    norm_learning = normalize_learning_mechanism(learning_mechanism)
    samples = load_deterministic_samples(
        scenario=scenario,
        difficulty=difficulty,
        modality_mode=modality_mode,
    )
    return Task(
        dataset=MemoryDataset(samples=samples, name="evergreen_deterministic_state"),
        setup=prepare_state_scenario(),
        solver=multiturn_langchain_agent(learning_mechanism=norm_learning),
        scorer=state_contract_scorer(
            artifacts_dir=artifacts_dir,
            learning_mechanism=norm_learning,
        ),
        cleanup=release_services,
        config=GenerateConfig(max_connections=1),
        turn_limit=turn_limit,
        metadata={
            "benchmark": "evergreen_deterministic_state",
            "harness": "langchain create_agent direct multi-turn via inspect agent_bridge",
            "grading": "pure_32_table_state_contract",
            "learning_mechanism": LEARNING_MECHANISM_LABELS[norm_learning],
            "learning_mechanism_id": norm_learning,
            "modality_mode": modality_mode,
            "scenario_filter": scenario,
            "difficulty_filter": difficulty,
        },
    )
