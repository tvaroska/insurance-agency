# UK AISI `Inspect AI` Native Task Definition (`eval/inspect/`)

Provides a native [**UK AISI Inspect AI**](https://inspect.aisi.org.uk/) `@task` (`evergreen_insurance`) for the **Evergreen Insurance API Gym**, eliminating the Docker-in-Docker overhead of the METR wrapper by using Inspect's native multi-container Docker Compose sandbox (`sandbox=("docker", "../../docker-compose.yml")`) and Streamable HTTP MCP registration (`mcp_server_http(name="comm", url="http://localhost:3004/mcp")`).

---

## 1. Features

- **All 20 Scenarios (253 Tasks):** Dynamically loads Scenarios `01`–`20` (including the interactive multi-turn Scenarios `16`–`20`) from `eval/metr/tasks.json`.
- **Native 3-Modality Sandbox:** Connects directly to `docker-compose.yml` on the host and registers the Comm Hub MCP endpoint (`http://localhost:3004/mcp`) via `mcp_server_http`.
- **Decoupled 40/60 Scorer + Hard E&O Gate:** `evergreen_scorer()` invokes `bun eval/score.ts` and records `eo_compliant`, `trace_score`, `output_score`, and `api_calls` in Inspect's per-sample score metadata for `inspect view`.

---

## 2. Running Evaluations with `inspect eval`

```bash
# Run all realistic tasks with Gemini 3.8 Flash (workhorse model):
inspect eval eval/inspect/evergreen.py \
  --model google/gemini-3.8-flash

# Run Scenario 08 (E&O Trap Navigation) & Scenario 19 (Multi-Turn Claim Reversal) with Gemini 4 Argon:
inspect eval eval/inspect/evergreen.py \
  --model google/gemini-4-argon \
  -T scenario=08,19 \
  -T seed=realistic \
  -T difficulty=natural \
  -T modality_mode=strict

# Fast smoke run on Scenario 01 with Gemini 3.5 Flash Lite:
inspect eval eval/inspect/evergreen.py \
  --model google/gemini-3.5-flash-lite \
  -T scenario=01 \
  -T seed=clean \
  -T difficulty=explicit

# Launch the interactive Inspect trace & score viewer:
inspect view
```
