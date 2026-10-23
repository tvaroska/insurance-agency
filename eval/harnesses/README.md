# Multi-Harness Benchmark Runner & Comparative Leaderboard (`eval/harnesses/`)

Provides reference adapter profiles, CLI command builders, and Pareto-frontier leaderboard aggregation across **5 major AI agent harnesses** and customer-facing **Gemini models** (`gemini-3.8-flash`, `gemini-4-argon`, `gemini-3.5-flash-lite`).

---

## 1. Supported Agent Harness Profiles

| Harness ID | Adapter | Default Model | Supported Modalities | Description |
| :--- | :--- | :--- | :--- | :--- |
| `google-adk` | ADK | `gemini-3.8-flash` | REST + MCP + Web Portal | Google Agent Development Kit orchestrator with Streamable HTTP MCP (`:3004`) and OpenAPI toolsets. |
| `claude-code` | Harbor | `gemini-4-argon` | REST + MCP | Claude Code CLI executed inside the Harbor container topology (`eval/harbor/`). |
| `openhands` | Harbor | `gemini-4-argon` | REST + MCP + Web Portal | OpenHands CodeAct + Playwright browser portal runner via Harbor. |
| `langgraph` | OpenEnv | `gemini-3.8-flash` | REST + MCP | LangGraph state machine with OpenTelemetry GenAI (`execute_tool`) tracing. |
| `inspect-ai` | Inspect AI | `gemini-3.8-flash` | REST + MCP | UK AISI Inspect AI native `@task` runner (`eval/inspect/evergreen.py`). |

---

## 2. Usage

```bash
# Run comparative leaderboard aggregation across all 5 harnesses and 20 scenarios:
bun eval/harnesses/runner.ts --out eval/runs/leaderboard

# Compare specific harnesses on multi-turn scenarios (16-20):
bun eval/harnesses/runner.ts \
  --harnesses google-adk,inspect-ai,openhands \
  --scenarios 16,17,18,19,20 \
  --out eval/runs/multiturn-leaderboard
```
