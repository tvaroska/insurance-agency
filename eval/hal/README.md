# Princeton HAL (`hal-harness`) Leaderboard Exporter (`eval/hal/`)

Converts **Evergreen Insurance API Gym** `ScenarioReport`s and OpenTelemetry `gen_ai.*` token/latency spans into the standardized [**Princeton Holistic Agent Leaderboard (`hal-harness`)**](https://hal.cs.princeton.edu/) upload JSON format (`hal_results.json`).

Enables side-by-side **Accuracy / E&O Compliance vs. Dollar Cost ($)** Pareto frontier comparison across models (`gemini-3.8-flash`, `gemini-4-argon`, `gemini-3.5-flash-lite`) and agent harnesses (`google-adk`, `claude-code`, `openhands`, `langgraph`, `inspect-ai`).

---

## 1. Usage

```bash
# Export a directory of ScenarioReport JSON files to hal_results.json:
bun eval/hal/export-hal.ts \
  --runs eval/runs/latest \
  --model gemini-3.8-flash \
  --agent google-adk \
  --out eval/hal/hal_results.json
```

---

## 2. Exported Schema (`hal_results.json`)

- `benchmark_name`: `"evergreen_insurance_gym"`
- `model_name`: Public model identifier (`gemini-3.8-flash`, `gemini-4-argon`, `gemini-3.5-flash-lite`)
- `agent_name`: Harness profile (`google-adk`, `claude-code`, `openhands`, `langgraph`, `inspect-ai`)
- `total_cost_usd`: Total LLM token cost in USD across evaluated scenarios
- `total_tokens`: `{ input_tokens, output_tokens, total_tokens }`
- `latencies`: `{ mean_sec, median_sec, p95_sec, total_sec }`
- `eo_compliance_rate`: Fraction of tasks with zero uncaught E&O regulatory traps (`0.0` to `1.0`)
- `pareto_metrics`: `{ score_per_dollar, cost_per_successful_task_usd, mean_score, mean_cost_usd, mean_latency_sec, pareto_efficiency_index }`
- `task_results`: Per-task dictionary with `score`, `successful`, `eo_compliant`, `trace_score`, `output_score`, `api_calls`, `cost_usd`, and `latency_sec`
