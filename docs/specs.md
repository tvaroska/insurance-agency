# Privy/gym — Product Specs

Requirements and acceptance criteria organized by feature area.

---

## Multi-Turn Conversation Scenarios

### Requirements

- Conversation simulator provides scripted user responses keyed to agent question patterns
- Response engine is template-based (no LLM) for deterministic reproducibility
- At least 3 scenarios have multi-turn variants (FNOL with incomplete info, ambiguous client identity, multi-policy endorsement with corrections)
- Trace evaluator scores: question relevance, turn count vs budget, information extraction completeness
- Turn budget defined per scenario variant (min/max turns); penalties for both over-asking and under-asking
- Conversation history passed to output evaluator for end-state verification

### Acceptance Criteria

- [x] Conversation simulator accepts scenario config and returns responses for ≥10 question patterns
- [x] At least 1 Easy, 1 Medium, 1 Hard scenario has a multi-turn variant
- [x] Scorer produces turn-efficiency score alongside existing trace/output scores
- [x] Agent that asks 0 clarifying questions on ambiguous input scores lower than one that asks relevant questions
- [x] Deterministic: same agent trace replayed twice produces identical scores

## Cost & Latency Evaluation

### Requirements

- Token counts extracted from GenAI semconv spans (`gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`)
- Wall-clock time calculated from trace span envelope (first start → last end)
- LLM invocation count from `gen_ai.operation.name` spans
- Per-scenario efficiency budgets: max tokens, max latency, max LLM calls
- Configurable cost model (price per token per model)
- Report includes cost breakdown table and latency percentiles

### Acceptance Criteria

- [x] Scorer extracts token usage from GenAI traces and includes in report
- [x] Cost estimate calculated using configurable per-model pricing
- [x] Efficiency score penalizes agents exceeding token/latency/call budgets
- [x] Report markdown includes cost and latency sections

## PostgreSQL Migration

### Requirements

- AMS service migrated from SQLite to PostgreSQL as first phase
- Docker Compose includes PostgreSQL container with health check
- Seed data loaded via SQL migration scripts (not baked into image)
- Reset via volume removal: `docker compose down -v && docker compose up`
- Connection pooling supports concurrent agent evaluation
- All existing AMS tests pass against PostgreSQL

### Acceptance Criteria

- [x] AMS service starts against PostgreSQL in Docker Compose
- [x] `bun test` in services/ams passes with PostgreSQL backend
- [x] Seed data loads correctly in both clean and realistic modes
- [x] Two concurrent agents can write to AMS without SQLite lock errors
- [x] Reset to seed state works via `docker compose down -v && up`

## Snapshot-Based State Diffing & Collateral Damage Detection (`S3-DIFF-1`)

### Requirements

- Pre-run and post-run state snapshots captured across all 8 services (via `GET /sim/snapshot` or direct Prisma table export)
- Output evaluator computes an exact structural diff between seed baseline, post-agent state, and expected mutations
- Positive checks verify required records/fields were created or updated
- Negative ("no collateral damage") checks automatically penalize unexpected mutations (e.g., modifying unrelated client records, deleting records, creating duplicate/junk tasks or policies)
- Report includes a `collateralDamage` section listing any unexpected state mutations

### Acceptance Criteria

- [x] Snapshot endpoint or dump utility captures deterministic state across all 8 services
- [x] Agent that completes a task cleanly scores 100% on output with 0 collateral mutations
- [x] Agent that completes a task but modifies an unrelated client or creates duplicate records receives a collateral damage penalty
- [x] Report markdown and JSON include exact state diff summary

## Strict Modality Enforcement (`S3-MOD-1`)

### Requirements

- `MODALITY_MODE=strict|permissive` environment variable (default: `permissive` for backward compatibility, `strict` for harness benchmarking)
- In `strict` mode:
  - `comm` service disables `/v1/messages/*`, `/v1/calls/*`, and `/v1/webhooks/*` REST routes for agent tokens, requiring all communication operations to go through the `/mcp` Model Context Protocol endpoint (retaining read-only access for the scorer's `agent-readonly` token)
  - `carrier-summit` and `carrier-coastal` require UI session/interaction proof (or browser-flow endpoints) rather than direct headless REST shortcuts for portal-designated scenarios
- Allows clean ablation across API-only harnesses, MCP-capable harnesses, and Computer-Use/Browser harnesses

### Acceptance Criteria

- [x] Starting gym with `MODALITY_MODE=strict` blocks `agent-full` from calling `comm` REST endpoints (`403 Forbidden` with hint to use MCP)
- [x] Scorer (`agent-readonly`) can still query `comm` and carrier state during output evaluation
- [x] Trace evaluator distinguishes MCP tool invocations, REST calls, and carrier portal UI interactions

## Multi-Harness Benchmark Runner & Leaderboard (`S3-HARN-1`)

### Requirements

- Standardized runner scripts under `eval/harnesses/` to execute the 15 benchmark scenarios against multiple agent harnesses (Google ADK, Claude Code, OpenHands, LangGraph, Inspect AI / METR)
- Automated gym reset (`docker compose down && up`) between scenario runs
- Aggregator CLI that compiles per-scenario reports into a comparative matrix: Overall Score, E&O Compliance Rate, Modality Coverage, Mean API Calls, Mean Token Cost ($), and p50/p95 Latency

### Acceptance Criteria

- [x] Runner executes a configurable subset of scenarios/variants and stores traces + reports per harness+model pair
- [x] Leaderboard generator outputs a comparative Markdown table and JSON summary plotting Score vs. Cost/Latency

## Harbor Framework Adapter (`S2-INTOP-1`)

### Requirements

- Exporter script (`eval/harbor/export-harbor.ts`) generates Harbor-compatible task directories (`task.yaml`, `docker-compose.yaml` reference, and `tests/test_outputs.py`) for all 15 scenarios (203 task cases)
- Agent container in Harbor connects to the 8 gym microservices on the shared Docker Compose network, with `SEED_MODE` configured per variant
- `tests/test_outputs.py` runs `bun eval/score.ts` against the agent's exported OTLP trace file and live service state, asserting overall score and E&O compliance
- Compatible out-of-the-box with `harbor run` across built-in harnesses (Claude Code, OpenHands, Codex CLI, Goose, Aider)

### Acceptance Criteria

- [x] `bun eval/harbor/export-harbor.ts` generates valid Harbor task bundles
- [x] `harbor run` boots the 8 services, runs an agent harness on a scenario, and executes `test_outputs.py` to record the score
- [x] Documentation (`eval/harbor/README.md`) provides single-command examples for benchmarking Claude Code and OpenHands

## Additional Benchmark & RL Standards (Backlog: `S3-INTOP-2..4`)

### Requirements

- **Native UK AISI `Inspect AI` (`S3-INTOP-2`):** Python `@task` module (`eval/inspect/evergreen.py`) using Inspect's native `sandbox=("docker", "docker-compose.yml")` and MCP tool bridge (`mcp_server_http`), avoiding Docker-in-Docker overhead.
- **OpenEnv & Prime Intellect `verifiers` RL Control Plane (`S3-INTOP-3`):** Fast in-place reset endpoint (`POST /sim/reset`) and state/score endpoints (`GET /sim/snapshot`, `POST /sim/score`) exposed via an OpenEnv / Gymnasium / `verifiers` (`vf.ToolEnv`) wrapper for sub-second trajectory resets during online RL training.
- **Princeton HAL Exporter (`S3-INTOP-4`):** Formatter exporting `eval/score.ts` outputs and OTel GenAI token/cost metrics into the `hal-harness` leaderboard schema.

### Acceptance Criteria

- [x] `inspect eval eval/inspect/evergreen.py` runs scenarios natively without nested Docker-in-Docker
- [x] `POST /sim/reset` re-seeds all 8 services in <500ms without container restarts
- [x] OpenEnv / `verifiers` client can execute `env.reset()` and `env.step()` loops against the gym
