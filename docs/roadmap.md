# Privy/gym — Roadmap

**Last Updated:** 2026-10-19

## Strategic Overview

High-level priorities and feature areas for the Evergreen Insurance API Gym — a multi-modal small-business benchmark environment for evaluating AI models and agent harnesses across REST APIs, MCP, and Web UIs.

---

## Competitive Landscape & Positioning

> See [docs/benchmark-landscape.md](benchmark-landscape.md) for the full comparative analysis of public small-business/enterprise benchmarks, interoperability standards (METR, Harbor, Inspect AI, OpenEnv, HAL), and Sprint 0 architectural review findings.

| Benchmark | Origin | Focus | How Evergreen Gym Differentiates |
| :--- | :--- | :--- | :--- |
| **TheAgentCompany** | CMU / All Hands AI | Simulated software company (GitLab, Plane, RocketChat, OwnCloud) | Evergreen targets regulated main-street small business operations with lightweight microservices instead of heavy SWE/IT stacks. |
| **AppWorld** | Stony Brook / AI2 | 9 consumer apps, 457 REST APIs, DB state diffing | Evergreen tests B2B/small-business compliance (E&O triggers, underwriting, ACORD forms) and hybrid REST + MCP + Web UI modalities. |
| **$\tau$-bench / $\tau^2$-bench** | Sierra / Princeton | Customer support policy compliance + mock JSON tools | Evergreen combines OTLP trace scoring + live service state, adversarial dirty-data hygiene (deduplication, book audits), and async HITL manager escalations. |
| **CRMArena-Pro / WorkArena** | Salesforce / ServiceNow | Single-platform CRM or ERP UI workflows | Evergreen requires cross-system orchestration across 8 independent services (AMS, Rater, CRM, ECM, Comm MCP, Claims, 2 Carrier Portals). |
| **Vending-Bench 2** | Andon Labs | Long-horizon small business net-worth simulation | Evergreen tests deep operational & regulatory fidelity across 5 prompt framing tiers (`scripted` → `adversarial`). |

---

## Feature Areas

### Evaluation System & Benchmark Rigor

**Status:** Complete (v0.5.0)
**Priority:** P0
**Progress:** 100%

Goals:
- Scorer with output + trace evaluation (done)
- 20 benchmark scenarios (15 single-turn + 5 interactive multi-turn scenarios, 253 total cases across 5 prompt difficulty tiers) (done)
- Per-trap E&O payload verification & audit output checks (`S0-BUG-2`, `S0-BUG-3`, done)
- Snapshot-based exact DB state diffing & collateral damage detection (`S3-DIFF-1`, done)
- Strict 3-modality enforcement (`MODALITY_MODE=strict`) for REST + MCP + Browser harnesses (`S3-MOD-1`, done)
- Interactive multi-turn customer & underwriter simulator (`S3-SIM-1`, done)
- Cost, token efficiency & latency Pareto scoring (`S3-ECON-1`, done)
- Time simulation & chaos injection (`S3-SIM-2`, done)

### Interoperability & Harness Benchmarking

**Status:** Complete (v0.5.0)
**Priority:** P1
**Progress:** 100%

Goals:
- METR Task Standard v0.5.0 compatibility — 253 tasks exported via `eval/metr/EvergreenInsurance.py` (`S0-BUG-1`, `S1-INTOP-1`, done)
- **Harbor / Terminal-Bench framework adapter** (`S2-INTOP-1`, done) — packages tasks for zero-code execution across Claude Code, OpenHands, Codex CLI, Goose, and Aider
- Native UK AISI `Inspect AI` `@task` with multi-container Docker Compose sandboxing & native MCP (`S3-INTOP-2`, done)
- OpenEnv & Prime Intellect `verifiers` RL Gym Control Plane (`/sim/reset`, `/sim/snapshot`, `/sim/time-travel`, `/sim/chaos`) (`S3-INTOP-3`, done)
- Princeton HAL (`hal-harness`) Cost-vs-Score leaderboard exporter (`S3-INTOP-4`, done)
- Reference multi-harness runner & comparative leaderboard (`S3-HARN-1`, done)

### Infrastructure

**Status:** Complete (v0.5.0)
**Priority:** P1
**Progress:** 100%

Goals:
- Drizzle → Prisma 7 migration across all 8 services + runtime startup seeding (`S2-DB-1..4`, done)
- Prisma test helpers & `TEST_DATABASE_URL` PostgreSQL support + Cloud Build CI (`S2-TEST-1`, done)
- Kubernetes manifests + CloudNativePG cluster & Docker Compose PG override (`S2-K8S-1..4`, `S2-COMPOSE-1`, done)

---

## Release Plan

### v0.1.0 — Scorer MVP (done)

- Scorer CLI with output + trace evaluation
- 4 scenarios implemented (01, 04, 07, 08)
- GenAI semconv trace parser
- Clean + realistic seed variants

### v0.2.0 — Full Scenario Coverage (done)

- All 15 scenarios implemented (218 cases)
- Unit + integration tests for evaluators

### v0.3.0 — METR Interop & Prisma Migration (done)

- METR TaskFamily wrapper (203 tasks)
- Prisma Client across all 8 services + runtime container seeding

### v0.4.0 — K8s, PostgreSQL, Harbor & Scorer Hardening (current)

- Sprint 0 review bug fixes (`S0-BUG-1..3`, `S0-DEBT-1..2`)
- Harbor / Terminal-Bench task adapter (`S2-INTOP-1`)
- Prisma test setup cleanup (`S2-TEST-1`)
- CloudNativePG + K8s manifests & Docker Compose PG override (`S2-K8S-1..4`, `S2-COMPOSE-1`)

### v0.5.0 — Small-Business Model & Harness Benchmark Suite

- Snapshot-based exact state diffing (`S3-DIFF-1`)
- Strict modality enforcement (`S3-MOD-1`)
- Multi-turn customer simulator (`S3-SIM-1`)
- Cost/latency Pareto scoring & multi-harness runner (`S3-ECON-1`, `S3-HARN-1`)
- Native Inspect AI, OpenEnv / `verifiers` RL control plane, and HAL export (`S3-INTOP-2..4`)

---

**Updated by:** /wreplan command
