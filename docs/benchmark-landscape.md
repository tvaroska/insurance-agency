# Small-Business Agent Benchmark Landscape, Standards & Lessons Learned

**Last Updated:** 2026-10-22

> **Canonical Cross-Project Playbook:** General enterprise agent benchmark methodology (40% OTLP Trace + 60% State Mutation scoring, the 5 structural benchmark lessons, public benchmark comparisons, and the 5 packaging standards: METR, Harbor, Inspect AI, OpenEnv, and Princeton HAL) has been consolidated into [`~/projects/agent-evals/docs/playbooks/agent-benchmarks-and-harnesses.md`](file:///usr/local/google/home/tvaroska/projects/agent-evals/docs/playbooks/agent-benchmarks-and-harnesses.md). This document tracks Evergreen Insurance API Gym's specific positioning, Sprint backlog mappings (`S2-*`, `S3-*`), and scenario-level audit fixes (`S0-BUG-*`).

This document captures the research, architectural review findings, competitive benchmark analysis, and interoperability standards survey for evolving **Evergreen Insurance API Gym** into a reference benchmark for evaluating both **foundation models** and **agent harnesses** on realistic small-business operations.

---

## 1. Strategic Positioning: Why Evergreen Insurance API Gym?

Most public AI agent benchmarks fall into one of two extremes:
1. **Heavyweight enterprise/IT environments** (*TheAgentCompany*, *OSWorld*, *WorkArena*) that require 16–32 GB RAM VM/container stacks (GitLab, OwnCloud, ServiceNow, full Linux desktops) and test software engineering or IT admin tasks rather than main-street business operations.
2. **Lightweight single-modality API mocks** (*$\tau$-bench*, *ToolSandbox*, *BFCL*) that run fast in memory but only test single-protocol JSON tool calling without cross-system data hygiene, document generation, or hybrid UI/MCP protocols.

**Evergreen Insurance API Gym** occupies the middle ground:
- **Real Small-Business Operations:** Models a 5,000-policy independent insurance brokerage across 8 distinct operational systems (AMS, Rater, CRM, ECM, Comm Hub, Claims, and 2 Carrier Portals).
- **True 3-Modality Hybrid Execution:** Tests **REST APIs** (5 services), **Model Context Protocol / MCP** (`comm` on `:3004`), and **Web UIs** (`carrier-summit` on `:3005`, `carrier-coastal` on `:3006`) inside a single lightweight Bun + SQLite/PostgreSQL Docker Compose stack (<2 GB RAM).
- **5-Tier Prompt Framing:** Every scenario variant is tested across 5 prompt styles (`scripted`, `explicit`, `natural`, `vague`, `adversarial`) to separate instruction-following from autonomous planning and social-engineering resistance.
- **Hard Regulatory Guardrails (E&O Traps) + Async Manager Loop:** Unlike soft reward rubrics, triggering any of the 10 Errors & Omissions (E&O) regulatory traps without escalating to the stateful Manager Persona engine (`services/ams/src/manager/rules.ts`) results in an automatic `0%` scenario score.
- **Dirty-Data Hygiene:** Includes paired `clean` and `realistic` seed datasets (`data/seed-clean/` vs. `data/seed/`) with planted duplicates, below-minimum policies, lapsed coverage, unsigned ACORD forms, and carrier moratorium zones.

---

## 2. Public Benchmark Landscape Comparison

| Benchmark | Origin | Domain & Systems | Modalities | State & Trace Grading | Where Evergreen Differentiates | What Evergreen Adopts (Sprint 3 Backlog) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TheAgentCompany** | CMU / All Hands AI (Dec 2024) | Simulated software company (GitLab, Plane, RocketChat, OwnCloud, 175 tasks) | Browser + Bash + Python + Web APIs | Checkpoint evaluators + LLM judge | Evergreen targets regulated main-street business workflows with an 8x lighter container footprint and deterministic (non-LLM) grading. | Multi-harness evaluation methodology (comparing OpenHands, Claude Code, custom harnesses). |
| **AppWorld** | Stony Brook / AI2 (ACL 2024/2025) | 9 consumer apps (Amazon, Gmail, Venmo, Spotify, etc.), 457 REST APIs, 750 tasks | Python code execution + REST APIs | **Exact DB state diffing** (required changes + zero collateral damage) | Evergreen tests B2B compliance, E&O escalations, PDF/ACORD generation, and MCP + Web UI modalities. | **Snapshot-based DB state diffing & collateral damage checks (`S3-DIFF-1`)** to penalize unintended edits or junk records. |
| **$\tau$-bench & $\tau^2$-bench** | Sierra / Princeton (2024 / 2025) | Retail, airline, and telecom customer service support with policy rules | JSON Tool Calling + User Simulator | Final DB state + `pass^k` reliability across trials | Evergreen uses real HTTP/MCP/Browser protocols, OTLP traces, dirty-data audits, and async manager escalations. | **Interactive multi-turn customer & underwriter simulator (`S3-SIM-1`)** and `pass^k` consistency tracking. |
| **CRMArena / CRMArena-Pro** | Salesforce AI Research (2024 / 2025) | B2B/B2C Salesforce CRM (lead routing, CPQ, service cases, confidentiality) | CRM Queries / Tool Calling | Exact answer / state match | Evergreen spans 8 independent services across underwriting, claims, documents, and carrier portals rather than a single CRM. | Confidentiality/PII leakage scoring and multi-turn clarification budgets. |
| **WorkArena & WorkArena++** | ServiceNow / Mila (2024) | Enterprise ERP / IT Service Management (ServiceNow web workflows, 682 tasks) | Browser-only (Playwright) | UI / DB state assertions | Evergreen combines fast APIs + MCP with targeted Web UI portals so agents must choose the right modality per service. | **Strict modality enforcement (`MODALITY_MODE=strict`, `S3-MOD-1`)** so REST shortcuts cannot bypass Web UIs or MCP. |
| **Vending-Bench 1 & 2** | Andon Labs (2025) | Long-horizon small-business vending operation (inventory, pricing, suppliers) | Tool Calling + Email | Net worth / bank balance over simulated months | Evergreen tests deep multi-system transactional accuracy and statutory insurance compliance rather than single-loop pricing. | **Time simulation (`POST /sim/time-travel`) & chaos injection (`POST /sim/chaos`, `S3-SIM-2`)** for long-horizon lifecycle testing. |
| **SWE-Lancer** | OpenAI (Feb 2025) | $1M of real Upwork freelance software engineering & management tasks | Code / CLI + Browser | End-to-end Playwright tests + **Dollar ($) payout** | Evergreen focuses on non-coding operational/compliance execution across business software. | **Economic Pareto scoring (`S3-ECON-1`)**: plotting accuracy against token cost ($) and wall-clock latency. |
| **ToolSandbox** | Apple (2024) | Stateful multi-turn tool use with implicit state dependencies & insufficient info | Tool Calling | Milestone + state trajectory similarity | Evergreen provides real microservices with OAuth2/JWT scopes and OpenAPI 3.1 specs rather than Python mock stubs. | Milestone-aware trajectory grading and insufficient-information clarification traps. |

---

## 3. Agent Benchmark & RL Packaging Standards

To evaluate both **models** and **harnesses** without writing custom adapter glue for every framework, Evergreen targets five complementary industry standards:

### 3.1 METR Task Standard (`v0.5.0`) — *Implemented (`eval/metr/`)*
- **Maintainer:** METR (Model Evaluation & Threat Research).
- **How It Works:** A Python `TaskFamily` class (`get_tasks()`, `get_instructions()`, `start()`, `score()`) in [`eval/metr/EvergreenInsurance.py`](../eval/metr/EvergreenInsurance.py) with 203 exported tasks in [`eval/metr/tasks.json`](../eval/metr/tasks.json).
- **Best For:** Frontier safety evaluations, Vivaria, and UK AISI Inspect's `inspect_evals` bridge.

### 3.2 Harbor / Terminal-Bench 2.0 (`harborframework.com`) — *Sprint 2 Priority (`S2-INTOP-1`)*
- **Maintainer:** Stanford / Laude Institute (official harness runner for Terminal-Bench 2.0 and SWE-bench variants).
- **How It Works:** Each task is a directory with `task.yaml` (prompt, timeouts, metadata), `docker-compose.yaml` (boots the 8 Evergreen microservices alongside the agent container on a shared network), and `tests/test_outputs.py` (invokes `bun eval/score.ts`).
- **Best For:** **Out-of-the-box harness benchmarking.** Harbor includes built-in runners for **Claude Code, OpenHands, OpenAI Codex CLI, Goose, Aider, Cursor, and SWE-agent**, allowing direct comparison of agent harnesses on the exact same scenarios.

### 3.3 UK AISI `Inspect AI` (`inspect_ai`) — *Sprint 3 Backlog (`S3-INTOP-2`)*
- **Maintainer:** UK AI Safety Institute (adopted by Anthropic, Google DeepMind, OpenAI, and METR).
- **How It Works:** Python `@task` definition (`eval/inspect/evergreen.py`) with `Dataset`, `Solver`, `Scorer`, and `sandbox=("docker", "docker-compose.yml")`.
- **Best For:** **Model-level evaluations and native MCP testing.** Unlike the METR wrapper (which runs Docker Compose inside a METR container), native Inspect AI manages the `docker-compose.yml` stack directly on the host, bridges `comm` via `mcp_server_http()`, and provides built-in token/cost accounting and trace viewer UI (`inspect view`).

### 3.4 OpenEnv (Meta PyTorch + Hugging Face) & Prime Intellect `verifiers` — *Sprint 3 Backlog (`S3-INTOP-3`)*
- **Maintainer:** Meta PyTorch, Hugging Face (`openenv-hub`), and Prime Intellect (`verifiers` / ` Environments Hub`).
- **How It Works:** Standardizes agentic environments around `reset()`, `step()`, and `state()` HTTP APIs (`vf.ToolEnv`) for online Reinforcement Learning (GRPO/RLOO via Hugging Face TRL and `prime-rl`).
- **Best For:** **Fast-reset RL training loops.** Requires adding a lightweight gym control-plane API (`POST /sim/reset`, `GET /sim/snapshot`, `POST /sim/score`) so all 8 SQLite/Postgres databases can reset in `<100ms` without restarting Docker containers.

### 3.5 Princeton HAL (`hal-harness`) — *Sprint 3 Backlog (`S3-INTOP-4`)*
- **Maintainer:** Princeton NLP (Holistic Agent Leaderboard).
- **How It Works:** Standardized JSON run-result and OTel token/cost schema that plots **Accuracy (%) on the Y-axis vs. Dollar Cost ($) on the X-axis**.
- **Best For:** Publishing comparative Pareto frontier leaderboards showing whether a specialized skill or workflow beats a general agent at 10x lower token cost.

---

## 4. Architectural & Evaluation Lessons Learned (Sprint 0 Audit)

During our code and scenario audit of the v0.3.0 codebase, we identified and fixed five structural pitfalls that apply broadly to multi-service agent benchmarks:

### Lesson 1: Trace-Only Compliance Checks Create Multi-Trap False Positives (`S0-BUG-3`)
- **Problem:** In Scenario 08 ([`08-eo-trap-navigation.ts`](../eval/scenarios/08-eo-trap-navigation.ts)), the realistic prompt contains 3 separate E&O traps (`CLI-027` below TX state minimums, `CLI-008` premium > `$10,000`, and `CLI-021` attorney involvement). Originally, all three `EoTrap` definitions checked only `presence` of `POST /v1/escalations` in the trace. An agent that escalated only 1 of the 3 clients — and illegally executed the other 2 — still passed all 3 E&O trap checks.
- **Fix:** Extended [`EoTrap`](../eval/types.ts) in `eval/types.ts` and [`scoreScenario`](../eval/score.ts) in `eval/score.ts` to support an optional `outputCheck?: OutputCheck` alongside `check: TraceCheck`. Each trap in Scenario 08 now queries `GET /v1/escalations?client_id=CLI-027`, `CLI-008`, and `CLI-021` (`arrayMinLength: 1`) so every individual E&O trigger must be persisted in the database to pass.

### Lesson 2: Status-200 `GET` Checks on Pre-Existing Seed Records Are Vacuous (`S0-BUG-3`)
- **Problem:** In Scenario 10 ([`10-book-of-business-audit.ts`](../eval/scenarios/10-book-of-business-audit.ts)), output checks verified `GET /clients/CLI-027/policies -> status: 200`. Because `CLI-027` already exists in the seed data, `GET` always returned `200 OK` even if the agent did nothing.
- **Fix:** Output checks must always assert **mutations** (new escalations created for `CLI-027` and `CLI-024`, total escalations `>= 2`, total tasks `>= 10` compared to the 8 seed tasks).

### Lesson 3: Scripted Prompts and Service Validation Schemas Must Be Co-Tested (`S0-BUG-1`, `S0-BUG-2`)
- **Problem:**
  1. `eval/metr/EvergreenInsurance.py` instructed agents to call `POST /auth/token` with `client_id=agent`, whereas `packages/shared/src/auth.ts` serves `POST /oauth/token` with `client_id=agent-full` and `client_secret=dev-secret`.
  2. Scenario 08's scripted prompt instructed agents to send `reason_code: 'attorney_involvement'` to `POST /v1/escalations`, whereas `services/ams/src/routes/escalations.ts` required field `reason` and omitted `attorney_involvement` from `ESCALATION_REASONS` (causing a `400 ValidationError`).
- **Fix:** Updated the METR instructions, added `attorney_involvement` to `ESCALATION_REASONS`, `specs/ams.yaml`, and manager persona rules (`services/ams/src/manager/rules.ts`), and accepted `body.reason ?? body.reason_code` in `services/ams/src/routes/escalations.ts`.

### Lesson 4: Convenience REST Fallbacks Must Be Gateable Behind `MODALITY_MODE=strict` (`S3-MOD-1`)
- **Observation:** Adding REST endpoints to `comm` (`:3004`) and the carrier portals (`:3005`, `:3006`) makes it easy for the scorer (`eval/evaluators/output.ts`) to inspect state and for REST-only agents to run baseline tests, but allows agents to bypass MCP and Browser UIs.
- **Design Rule:** Keep REST endpoints open for `agent-readonly` (the scorer) and in `MODALITY_MODE=permissive`, but gate them in `MODALITY_MODE=strict` so harness evaluations accurately test MCP and Computer-Use capabilities.

### Lesson 5: Single-weight Source of Truth (`S0-DEBT-1`)
- **Observation:** Documentation (`README.md`) drifted from code (`eval/types.ts` `DEFAULT_WEIGHTS = { trace: 0.4, output: 0.6 }` and `docs/evaluation.md`).
- **Design Rule:** Output state carries **60% weight** and OTLP trace workflow carries **40% weight**, with **E&O compliance** acting as a hard multiplicative gate (`0%` on violation).
