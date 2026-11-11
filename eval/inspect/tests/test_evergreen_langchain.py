"""Task wiring for evergreen_langchain and evergreen: no network, no models."""

from __future__ import annotations

import asyncio
import hashlib
import json
import types
from contextlib import AsyncExitStack, asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
import pytest
from inspect_ai import eval as inspect_eval
from inspect_ai.log import read_eval_log
from inspect_ai.model import ModelOutput, ModelUsage, get_model
from langchain_core.tools import StructuredTool

import evergreen
import evergreen_langchain as harness
from evergreen import GYM_ROOT, load_evergreen_samples
from openapi_tools import load_operations, service_base_urls

REPORT = {
    "scenario": "08",
    "caseId": "realistic-natural",
    "overall": {"score": 0.62, "eoCompliant": True, "apiCalls": 7, "expectedRange": [4, 12]},
    "trace": {"score": 0.5, "checks": [{"name": "escalated", "passed": True, "weight": 1}]},
    "output": {"score": 0.7, "checks": []},
    "eoTraps": [{"id": 0, "description": "state minimum", "caught": True}],
    "stateDiff": {
        "insertedCount": 1,
        "updatedCount": 0,
        "deletedCount": 0,
        "totalMutations": 1,
        "collateralFree": True,
        "unauthorizedMutations": 0,
        "collateralPenalty": 0,
        "findings": [],
    },
}


def test_task_runs_samples_one_at_a_time_with_setup_scorer_and_cleanup():
    task = harness.evergreen_langchain(scenario="01,09", seed="realistic", modality_mode="strict")
    expected = load_evergreen_samples(scenario="01,09", seed="realistic", modality_mode="strict")

    assert [s.id for s in task.dataset] == [s.id for s in expected]
    assert len(task.dataset) > 0
    assert task.config.max_connections == 1
    assert task.turn_limit == 100
    assert task.setup is not None
    assert task.cleanup is harness.release_services
    assert task.metadata["modality_mode"] == "strict"
    assert task.metadata["learning_mechanism"] == "None (zero-shot)"
    assert task.dataset[0].metadata["modality_mode"] == "strict"


def test_evergreen_py_delegates_to_evergreen_langchain_pipeline():
    task = evergreen.evergreen(scenario="01,19", seed="realistic", learning_mechanism="domain_skill")
    assert len(task.dataset) > 0
    assert task.setup is not None
    assert task.cleanup is harness.release_services
    assert task.config.max_connections == 1
    assert task.metadata["learning_mechanism"] == "Domain skill (SOP)"
    assert "google/gemini-3.8-flash" in task.metadata["recommended_models"]


def test_learning_mechanism_appends_domain_skill_sop_and_rejects_unknown():
    urls = service_base_urls()
    zero_shot = harness.system_prompt(urls, learning_mechanism="none")
    with_sop = harness.system_prompt(urls, learning_mechanism="domain_skill")

    assert len(with_sop) > len(zero_shot) + 1000
    assert "Customer Service Representative (CSR) Operational SOP" in with_sop
    assert "30/60/15" in with_sop and "30/60/25" in with_sop and "50/100/50" in with_sop
    assert "Customer Service Representative (CSR) Operational SOP" not in zero_shot

    with pytest.raises(ValueError, match="Unsupported learning_mechanism"):
        harness.evergreen_langchain(scenario="01", learning_mechanism="magic_oracle")


def test_scenario_given_as_yaml_integer_still_filters():
    # `-T scenario=01` reaches the task as the integer 1; `-T scenario=01,14,20` as a list.
    task = harness.evergreen_langchain(scenario=1, seed="realistic")
    assert {s.metadata["scenario_id"] for s in task.dataset} == {"01"}
    multi = harness.evergreen_langchain(scenario=["01", 14, "20"], seed="realistic")
    assert {s.metadata["scenario_id"] for s in multi.dataset} == {"01", "14", "20"}


def test_bridge_filters_preserve_assistant_reasoning_and_empty_list_content():
    from inspect_ai._util.content import ContentReasoning, ContentText
    from inspect_ai.model import ChatCompletionChoice, ChatMessageAssistant, GenerateConfig
    from inspect_ai.tool import ToolCall

    in_filter, out_filter = harness.bridge_filters()
    tc_gemini = ToolCall(id="call_gem_1", function="listClients", arguments={"last_name": "Chen"})
    gemini_blocks = [
        ContentReasoning(reasoning=" visible thought ", redacted=False),
        ContentReasoning(
            reasoning="AY89a1878==",
            redacted=True,
            internal={"gemini_function_call_id": "call_gem_1"},
        ),
    ]
    out_gemini = ModelOutput(
        model="gemini-3.8-flash",
        choices=[
            ChatCompletionChoice(
                message=ChatMessageAssistant(id="msg_g1", content=gemini_blocks, tool_calls=[tc_gemini]),
                stop_reason="tool_calls",
            )
        ],
    )
    tc_claude = ToolCall(id="toolu_cl_1", function="createLead", arguments={"body": {}})
    out_claude = ModelOutput(
        model="claude-sonnet-5-5",
        choices=[
            ChatCompletionChoice(
                message=ChatMessageAssistant(id="msg_c1", content=[], tool_calls=[tc_claude]),
                stop_reason="tool_calls",
            )
        ],
    )

    async def run():
        model = get_model("mockllm/model")
        empty_in = harness.GenerateInput([], [], None, GenerateConfig())
        await out_filter(model, out_gemini, empty_in)
        await out_filter(model, out_claude, empty_in)

        degraded_gemini = ChatMessageAssistant(
            content=[
                ContentReasoning(reasoning=" visible thought ", redacted=False),
                ContentText(text="<think redacted='true'>AY89a1878==</think>"),
            ],
            tool_calls=[tc_gemini],
        )
        degraded_claude = ChatMessageAssistant(content="", tool_calls=[tc_claude])
        res = await in_filter(model, [degraded_gemini, degraded_claude], [], None, GenerateConfig())
        return res.input

    restored_gemini, restored_claude = asyncio.run(run())
    assert restored_gemini.content == gemini_blocks
    assert restored_gemini.id == "msg_g1"
    assert restored_claude.content == []
    assert restored_claude.id == "msg_c1"


def test_playwright_server_is_pinned_headless_isolated_and_limited_to_the_portals(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    monkeypatch.delenv("EVERGREEN_BASE_URLS", raising=False)
    monkeypatch.delenv("EVERGREEN_BASE_PORT", raising=False)
    monkeypatch.setenv("EVERGREEN_CHROME_PATH", "/opt/chrome/chrome")
    args = harness.playwright_mcp_args(service_base_urls(), tmp_path)

    assert args[: args.index("--headless")] == ["--prefer-offline", "--yes", "@playwright/mcp@0.0.85"]
    assert "--isolated" in args
    assert args[args.index("--executable-path") + 1] == "/opt/chrome/chrome"
    assert args[args.index("--allowed-origins") + 1] == "http://localhost:3005;http://localhost:3006"
    assert args[args.index("--output-dir") + 1] == str(tmp_path)


def test_mcp_tools_authenticate_comm_with_bearer_token_and_drop_browser_code_execution(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    opened: list[str] = []
    captured_connections: dict[str, Any] = {}

    def oauth_handler(request: httpx.Request):
        assert request.url.path == "/oauth/token"
        return httpx.Response(200, json={"access_token": "mcp-tok-42", "expires_in": 3600})

    class FakeAuthClient(httpx.AsyncClient):
        def __init__(self, **kwargs: Any):
            super().__init__(transport=httpx.MockTransport(oauth_handler), **kwargs)

    @asynccontextmanager
    async def fake_session(self: Any, name: str):
        captured_connections.update(self.connections)
        opened.append(name)
        yield name

    async def fake_load(session: str, server_name: str):
        names = {
            "comm": ["get_inbox", "send_message"],
            "portals": ["browser_navigate", "browser_evaluate", "browser_run_code_unsafe", "browser_click"],
        }[server_name]
        return [StructuredTool.from_function(func=lambda: "", name=n, description=n) for n in names]

    monkeypatch.setattr(harness, "httpx", types.SimpleNamespace(AsyncClient=FakeAuthClient))
    monkeypatch.setattr(harness.MultiServerMCPClient, "session", fake_session)
    monkeypatch.setattr(harness, "load_mcp_tools", fake_load)

    async def run():
        async with AsyncExitStack() as stack:
            tools = await harness.open_mcp_tools(stack, service_base_urls(), tmp_path)
            return [tool.name for tool in tools]

    assert asyncio.run(run()) == ["get_inbox", "send_message", "browser_navigate", "browser_click"]
    assert opened == ["comm", "portals"]
    assert captured_connections["comm"]["headers"] == {"Authorization": "Bearer mcp-tok-42"}


def test_take_snapshot_forwards_scorer_secret_when_configured(monkeypatch: pytest.MonkeyPatch):
    seen_headers: list[dict[str, str]] = []

    def handler(request: httpx.Request):
        seen_headers.append(dict(request.headers))
        return httpx.Response(200, json={"tables": {"clients": []}})

    async def snap():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await harness.take_snapshot(client, {"ams": "http://localhost:3000"})

    monkeypatch.delenv("EVERGREEN_SCORER_SECRET", raising=False)
    asyncio.run(snap())
    assert seen_headers[-1]["x-eval-scorer"] == "true"
    assert "x-evergreen-scorer-secret" not in seen_headers[-1]

    monkeypatch.setenv("EVERGREEN_SCORER_SECRET", "s3cr3t-gate")
    asyncio.run(snap())
    assert seen_headers[-1]["x-eval-scorer"] == "true"
    assert seen_headers[-1]["x-evergreen-scorer-secret"] == "s3cr3t-gate"


def test_seed_mode_maps_variants_to_realistic_data():
    assert harness.seed_mode("clean") == "clean"
    assert harness.seed_mode("realistic") == "realistic"
    assert harness.seed_mode("attorney") == "realistic"


def test_system_prompt_covers_all_10_regulatory_triggers_and_real_tools(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("EVERGREEN_BASE_PORT", raising=False)
    monkeypatch.delenv("EVERGREEN_BASE_URLS", raising=False)
    prompt = harness.system_prompt(service_base_urls())
    operation_ids = {op.operation_id for op in load_operations()}
    assert "createEscalation" in operation_ids
    assert "createEscalation" in prompt
    assert "check the inbox with get_inbox for the client's reply" in prompt
    assert "http://localhost:3005" in prompt and "http://localhost:3006" in prompt
    for expected_token in (
        "coverage_adequacy",
        "state_minimum_violation",
        "premium_threshold",
        "attorney_involvement",
        "principal_review",
        "backdating",
        "surplus_lines",
        "claims specialist",
        "appointment",
        "underwriting",
        "exclusions",
    ):
        assert expected_token in prompt


def test_report_score_carries_the_scorer_breakdown(tmp_path: Path):
    score = harness.report_score(REPORT, answer="done", work_dir=tmp_path)

    assert score.value == 0.62
    assert score.answer == "done"
    assert score.metadata["eo_compliant"] is True
    assert score.metadata["trace_score"] == 0.5
    assert score.metadata["output_score"] == 0.7
    assert score.metadata["collateral"] == {
        "collateral_free": True,
        "unauthorized_mutations": 0,
        "penalty": 0,
        "total_mutations": 1,
        "findings": [],
    }
    assert score.metadata["artifacts_dir"] == str(tmp_path)


def test_archive_sample_artifacts_writes_receipt_bundle_and_sha256sums(tmp_path: Path):
    work_dir = tmp_path / "work"
    report_dir = work_dir / "report"
    report_dir.mkdir(parents=True)
    (work_dir / "trace.json").write_text('{"resourceSpans": []}')
    (work_dir / "snapshot-before.json").write_text('{"ams": {}}')
    (work_dir / "snapshot-after.json").write_text('{"ams": {"clients": []}}')
    (report_dir / "01-report.json").write_text(json.dumps(REPORT))

    artifacts_root = tmp_path / "artifacts"
    recorded = harness.archive_sample_artifacts(
        artifacts_root=artifacts_root,
        model_name="openai-api/vertex-maas/deepseek-ai/deepseek-v4.1-flash-maas",
        seed="realistic",
        difficulty="natural",
        sample_id="01-realistic-natural",
        epoch=2,
        scenario_id="01",
        work_dir=work_dir,
        report_dir=report_dir,
    )
    bundle = Path(recorded)
    assert bundle == artifacts_root / "deepseek-v4.1-flash" / "realistic-natural" / "01-realistic-natural-e2"
    manifest = (bundle / "sha256sums.txt").read_text().splitlines()
    assert len(manifest) == 4
    for line in manifest:
        digest, fname = line.split("  ", 1)
        assert digest == hashlib.sha256((bundle / fname).read_bytes()).hexdigest()

    # Repo-inside paths are recorded as portable repo-relative POSIX paths (ADR-005).
    in_repo_target = GYM_ROOT / "eval" / "results" / "_tmp_test_receipt_check"
    try:
        rel_recorded = harness.archive_sample_artifacts(
            artifacts_root=in_repo_target,
            model_name="google/gemini-3.8-flash",
            seed="clean",
            difficulty="natural",
            sample_id="01-clean-natural",
            epoch=1,
            scenario_id="01",
            work_dir=work_dir,
            report_dir=report_dir,
        )
        assert rel_recorded == "eval/results/_tmp_test_receipt_check/gemini-3.8-flash/clean-natural/01-clean-natural-e1"
    finally:
        import shutil

        shutil.rmtree(in_repo_target, ignore_errors=True)


def run_pipeline(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, max_samples: int, **task_args: Any):
    """Two scenario 01 samples against fake services and a fake bun; returns the log and the event order."""
    monkeypatch.delenv("EVERGREEN_BASE_URLS", raising=False)
    monkeypatch.delenv("EVERGREEN_BASE_PORT", raising=False)
    monkeypatch.delenv("EVERGREEN_ARTIFACTS_DIR", raising=False)
    monkeypatch.setattr(harness.tempfile, "tempdir", str(tmp_path))
    events: list[str] = []

    def services(request: httpx.Request):
        path = request.url.path
        if path == "/sim/status":
            return httpx.Response(200, json={"modality_mode": "strict"})
        if path == "/sim/reset":
            if request.url.port == 3000:
                events.append(f"reset {json.loads(request.content)['seed_mode']}")
            return httpx.Response(200, json={"status": "reset"})
        if path == "/sim/snapshot":
            return httpx.Response(200, json={"service": "x", "tables": {"clients": [{"id": "CLI-001"}]}})
        if path == "/oauth/token":
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        events.append(f"{request.method} {path} {request.headers['authorization']}")
        return httpx.Response(200, json={"data": []})

    class FakeAsyncClient(httpx.AsyncClient):
        def __init__(self, **kwargs: Any):
            super().__init__(transport=httpx.MockTransport(services), **kwargs)

    async def no_mcp_tools(stack: AsyncExitStack, urls: dict[str, str], work_dir: Path):
        assert work_dir.is_dir()
        return []

    async def fake_bun(*args: str):
        events.append(args[0])
        out = Path(args[args.index("--out") + 1])
        if args[0] == "eval/collect-trace.ts":
            out.write_text('{"resourceSpans": []}')
            return
        assert args[args.index("--seed") + 1] == "realistic"
        before = json.loads(Path(args[args.index("--snapshot-before") + 1]).read_text())
        assert before["ams"] == {"clients": [{"id": "CLI-001"}]}
        assert Path(args[args.index("--snapshot-after") + 1]).exists()
        out.mkdir()
        (out / f"{args[args.index('--scenario') + 1]}-report.json").write_text(json.dumps(REPORT))

    monkeypatch.setattr(harness, "httpx", types.SimpleNamespace(AsyncClient=FakeAsyncClient))
    monkeypatch.setattr(harness, "open_mcp_tools", no_mcp_tools)
    monkeypatch.setattr(harness, "run_bun", fake_bun)

    outputs = []
    for _ in range(2):
        outputs += [
            ModelOutput.for_tool_call("mockllm/model", "listClients", {"status": "active"}),
            ModelOutput.from_content("mockllm/model", "Listed the active clients."),
        ]
    for output in outputs:
        # mockllm otherwise counts tokens with tiktoken, which downloads its encoding.
        output.usage = ModelUsage(input_tokens=1, output_tokens=1, total_tokens=2)

    (log,) = inspect_eval(
        harness.evergreen_langchain(scenario="01", seed="realistic", **task_args),
        model=get_model("mockllm/model", custom_outputs=outputs),
        limit=2,
        max_samples=max_samples,
        log_dir=str(tmp_path / "logs"),
        display="none",
    )
    assert log.status == "success", log.error
    assert log.samples is not None and len(log.samples) == 2
    return log, events


ONE_SAMPLE = ["reset realistic", "GET /v1/clients Bearer t", "eval/collect-trace.ts", "eval/score.ts"]


def test_pipeline_resets_runs_collects_and_scores_one_sample_at_a_time(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    """--max-samples 2: the stack lock must still serialize the samples and preserve .eval messages."""
    artifacts_out = tmp_path / "receipts"
    log, events = run_pipeline(monkeypatch, tmp_path, max_samples=2, artifacts_dir=str(artifacts_out))

    assert events == ONE_SAMPLE * 2
    artifacts = set()
    for sample in log.samples:
        (score,) = sample.scores.values()
        assert score.value == 0.62
        assert score.answer == "Listed the active clients."
        assert score.metadata["eo_compliant"] is True
        assert [m.role for m in sample.messages] == ["system", "user", "assistant", "tool", "assistant"]
        receipt_dir = Path(score.metadata["artifacts_dir"])
        assert (receipt_dir / "sha256sums.txt").is_file()
        artifacts.add(score.metadata["artifacts_dir"])
    assert len(artifacts) == 2

    disk_eval = next((tmp_path / "logs").glob("*.eval"))
    reloaded = read_eval_log(str(disk_eval))
    assert [m.role for m in reloaded.samples[0].messages] == ["system", "user", "assistant", "tool", "assistant"]


def test_turn_limit_hit_inside_the_agent_is_still_scored_and_preserves_messages(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    log, events = run_pipeline(monkeypatch, tmp_path, max_samples=1, turn_limit=1)

    assert events == ONE_SAMPLE * 2
    for sample in log.samples:
        assert sample.limit is not None and sample.limit.type == "turn"
        assert len(sample.messages) >= 3
        (score,) = sample.scores.values()
        assert score.value == 0.62


def test_archive_sample_artifacts_separates_learning_mechanism_arms(tmp_path: Path):
    work_dir = tmp_path / "work"
    report_dir = work_dir / "report"
    report_dir.mkdir(parents=True)
    (work_dir / "trace.json").write_text("{}")
    (report_dir / "01-report.json").write_text(json.dumps(REPORT))
    common = dict(
        artifacts_root=tmp_path / "artifacts",
        model_name="google/gemini-3.8-flash",
        seed="realistic",
        difficulty="natural",
        sample_id="01-realistic-natural",
        epoch=1,
        scenario_id="01",
        work_dir=work_dir,
        report_dir=report_dir,
    )
    zero = Path(harness.archive_sample_artifacts(**common))
    skill = Path(harness.archive_sample_artifacts(**common, learning_mechanism="domain_skill"))
    assert zero.parts[-3] == "gemini-3.8-flash"
    assert skill.parts[-3] == "gemini-3.8-flash-domain_skill"
    assert zero != skill
