# Privy/gym — Development Plan

**Last Updated:** 2026-10-23
**Current Focus:** v0.5.0 Complete (Sprint 0, Sprint 1, Sprint 2 & Sprint 3 All Complete)
**Cadence:** 2-week sprints
**Repo:** gym

> See [docs/roadmap.md](docs/roadmap.md) for strategic overview
> See [docs/features/](docs/features/) for feature history

<!-- Counters: BUG=3 SEC=0 INFRA=2 PERF=0 DEBT=2 REL=0 -->

---

## Sprint 0: Critical Issues & Review Findings

- [x] `S0-BUG-1` **Fix broken OAuth instructions in METR wrapper** — P0 *(done 2026-10-19)*
  `eval/metr/EvergreenInsurance.py` (`get_instructions()`) instructs agents to call `POST /auth/token` with `client_id=agent` and `client_secret=agent-secret`. Updated to match `packages/shared/src/auth.ts`: `POST /oauth/token` with `client_id=agent-full` and `client_secret=dev-secret`, plus OpenAPI spec references (`specs/`).
  Files: `eval/metr/EvergreenInsurance.py`

- [x] `S0-BUG-2` **Fix Scenario 08 escalation reason_code vs AMS schema mismatch** — P0 *(done 2026-10-19)*
  Added `attorney_involvement` to `ESCALATION_REASONS` in `services/ams/src/routes/escalations.ts`, added `reason ?? reason_code` field alias support, added manager persona rule (`template_id: "attorney_referral_confirmation"`) in `services/ams/src/manager/rules.ts`, updated `specs/ams.yaml`, and added unit tests in `services/ams/src/__tests__/escalations.test.ts`.
  Files: `services/ams/src/routes/escalations.ts`, `services/ams/src/manager/rules.ts`, `specs/ams.yaml`, `services/ams/src/__tests__/escalations.test.ts`

- [x] `S0-BUG-3` **Per-trap E&O verification & audit output checks (Scenarios 08 & 10)** — P1 *(done 2026-10-19)*
  Extended `EoTrap` in `eval/types.ts` and `eval/score.ts` with optional `outputCheck?: OutputCheck`. Added client-specific output checks (`CLI-027`, `CLI-008`, `CLI-021`) to all `eoTraps` in `eval/scenarios/08-eo-trap-navigation.ts`. Replaced vacuous `GET /clients/{id}/policies` checks in `eval/scenarios/10-book-of-business-audit.ts` with assertions on `CLI-027` and `CLI-024` escalations (`arrayMinLength: 1`), total critical escalations (`arrayMinLength: 2`), and remediation tasks (`arrayMinLength: 10`).
  Files: `eval/scenarios/08-eo-trap-navigation.ts`, `eval/scenarios/10-book-of-business-audit.ts`, `eval/types.ts`, `eval/score.ts`

- [x] `S0-DEBT-1` **Align Trace vs Output scoring weights (40/60 vs 60/40)** — P1 *(done 2026-10-19)*
  Aligned `README.md` with `eval/types.ts` (`DEFAULT_WEIGHTS = { trace: 0.4, output: 0.6 }`), `docs/evaluation.md`, and `eval/__tests__/integration.test.ts` (Output 60% / Trace 40%).
  Files: `README.md`, `TODO.md`, `docs/features/evaluation-system.md`

- [x] `S0-DEBT-2` **Clean up stale planning and architecture docs** — P2 *(done 2026-10-19)*
  Removed stale `PLAN.md`, populated `docs/architecture.md` and `docs/cujs.md`, and clarified seed data row counts (80 policies, 33 clients, 87 documents across 16 JSON files modeling a ~5,000-policy agency) and Prisma 7 stack in `README.md`.
  Files: `PLAN.md`, `docs/architecture.md`, `docs/cujs.md`, `README.md`

---

## Sprint 1: Evaluation System

**Theme:** Build a scorer that evaluates AI agent performance on 15 benchmark scenarios using output scoring (REST API queries) and trace scoring (OTel span analysis). See [docs/evaluation.md](docs/evaluation.md) for full design.

### Phase 1b: Trace Parsers

- [x] `S1-EVAL-1` **OTLP HTTP trace parser** — P0 *(done 2026-03-26)*
- [x] `S1-EVAL-2` **OTLP output evaluator** — P0 *(done 2026-03-26)*
- [x] `S1-EVAL-6` **GenAI semconv trace parser** — P1 *(done 2026-03-30)*
  Parses GenAI semantic convention spans (`gen_ai.operation.name = "execute_tool"`). Extracts HTTP details from `_http` metadata in tool responses (primary) or operationId→spec mapping (fallback). Works with ADK, LangChain, PydanticAI, CrewAI. Unified `parseTrace()` auto-detects format.
  Files: `eval/evaluators/trace-genai.ts`, `eval/tool-mapping.ts`, `eval/evaluators/trace.ts`, `eval/types.ts`

### Phase 2: Scorer

- [x] `S1-EVAL-4` **Report generator** — P1 *(done 2026-03-30)*
  `generateReport()` combines output + trace scores with 40/60 weights. E&O override caps at 0. `formatMarkdown()` renders human-readable report. Plan: `.claude/plans/swift-dazzling-shamir.md`
  Files: `eval/report.ts`

- [x] `S1-EVAL-5` **Scorer CLI** — P1 *(done 2026-03-30)*
  Entry point: `bun eval/score.ts --traces <path> --scenario <id> --seed clean|realistic`. Loads OTLP JSON (file or dir, supports JSONL), runs both evaluators, generates JSON + markdown reports. Supports comma-separated scenario IDs. Plan: `.claude/plans/swift-dazzling-shamir.md`
  Files: `eval/score.ts`

### Phase 3: Scenario Implementations

- [x] `S1-SCEN-1` **Scenario 01 — New Client Intake** (Easy) — P1 *(done 2026-03-30)*
  Clean + realistic variants. Trace: search-before-create sequence, lead, campaign enroll, send, task. Output: client/lead/task existence. Plan: `.claude/plans/swift-dazzling-shamir.md`
  Files: `eval/scenarios/01-new-client-intake.ts`

- [x] `S1-SCEN-2` **Scenario 04 — Duplicate Client Detection** (Medium) — P1 *(done 2026-03-30)*
  Clean + realistic variants. Realistic: 3 duplicate pairs, merge checks, no-delete E&O trap. Output: CLI-031/030 inactive, CLI-025/001/010 active. Plan: `.claude/plans/swift-dazzling-shamir.md`
  Files: `eval/scenarios/04-duplicate-detection.ts`

- [x] `S1-SCEN-3` **Scenario 07 — FNOL Claim Filing** (Hard) — P1 *(done 2026-03-30)*
  Clean + realistic variants. Trace: coverage-verify→file→assign sequence, notify, task. E&O trap #7: escalate to claims specialist. Plan: `.claude/plans/swift-dazzling-shamir.md`
  Files: `eval/scenarios/07-fnol-claim.ts`

- [x] `S1-SCEN-4` **Scenario 08 — E&O Trap Navigation** (Hard) — P0 *(done 2026-03-30)*
  Clean: safe only (COI + address). Realistic: 5 requests, 3 E&O traps (#2 state min, #3 premium threshold, #4 attorney). 3+ escalation POSTs, no unauthorized modifications. Plan: `.claude/plans/swift-dazzling-shamir.md`
  Files: `eval/scenarios/08-eo-trap-navigation.ts`

- [x] `S1-SCEN-5` **Scenario 10 — Book of Business Audit** (Hard) — P2 *(done 2026-03-31)*
  Clean: subset with no issues, all flagged clean. Dirty: 60+ policy scan, 15 planted issues (5 critical/5 high/5 medium). Critical detection must be 100%, high target 80%+. E&O traps: #2, #10. 15-30+ API calls.
  Files: `eval/scenarios/10-book-of-business-audit.ts`
  Plan: `.claude/plans/optimized-growing-chipmunk.md`

### Phase 5: Interoperability

- [x] `S1-INTOP-1` **METR Task Standard wrapper** — P1 *(done 2026-04-02)*
  203 tasks (15 scenarios × seed variants × 5 difficulties) exposed as METR TaskFamily. `get_tasks()` reads exported `tasks.json`, `start()` boots gym via docker compose, `score()` invokes `bun eval/score.ts` on OTLP traces. Includes Dockerfile + manifest.
  Files: `eval/metr/EvergreenInsurance.py`, `eval/metr/export-tasks.ts`, `eval/metr/tasks.json`, `eval/metr/Dockerfile`, `eval/metr/manifest.yaml`
  Plan: `.claude/plans/unified-tinkering-nova.md`

- [x] `S1-INTOP-2` **Inspect AI task definitions** — P2 *(dropped 2026-04-02)*
  Not needed — Inspect AI natively supports METR Task Standard format. Covered by S1-INTOP-1.

### Phase 4: Tests

- [x] `S1-TEST-1` **Output evaluator unit tests** — P1 *(done 2026-04-02)*
  23 tests: status/array-length/body-match assertions, auth caching, unknown service, network errors, scoring weights. Fetch mocks via `global.fetch` override.
  Files: `eval/__tests__/output-evaluator.test.ts`
  Plan: `.claude/plans/wondrous-yawning-dahl.md`

- [x] `S1-TEST-2` **Trace evaluator unit tests** — P1 *(done 2026-04-02)*
  32 tests: parseOtlpTrace (span parsing, service resolution, timestamp sorting), parseGenAiTrace (_http extraction, nested result, toolMapping fallback, prefix stripping), evaluateTrace (presence/absence/sequence/count checks, pattern matching, weights), parseTrace (unified auto-detect). OTLP JSON fixtures for HTTP client spans and GenAI tool spans.
  Files: `eval/__tests__/trace-evaluator.test.ts`, `eval/__tests__/fixtures/`
  Plan: `.claude/plans/synchronous-fluttering-tide.md`

- [x] `S1-TEST-3` **Integration test** — P2 *(done 2026-04-03)*
  5 tests: full pipeline all-pass (scenario 01), partial output failures with weighted scoring, E&O trap failure overrides score to 0, E&O trap caught preserves score, report structure validation. Fixture: pre-recorded OTLP JSON for scenario 01 clean.
  Files: `eval/__tests__/integration.test.ts`, `eval/__tests__/fixtures/otlp-scenario01.json`
  Plan: `.claude/plans/mighty-jingling-graham.md`

---

## Sprint 2: Kubernetes & PostgreSQL

**Theme:** Replace Drizzle/SQLite with Prisma for database independence, then add Kubernetes manifests with PostgreSQL operator support. Prisma's single schema works across SQLite (local dev, Docker Compose) and PostgreSQL (k8s) with zero query changes.

### Phase 1: Drizzle → Prisma Migration

- [x] `S2-DB-1` **Prisma schema per service** — P0 *(done 2026-05-13)*
  Created `prisma/schema.prisma` + `prisma.config.ts` (Prisma 7 format) for all 8 services, translating existing Drizzle models. Added `prisma`, `@prisma/client` deps. Drizzle deps kept until S2-DB-2 swaps queries.
  Files: `services/*/prisma/schema.prisma`, `services/*/prisma.config.ts`, `services/*/package.json`
  Plan: `.claude/plans/lazy-nibbling-turtle.md`

- [x] `S2-DB-2` **Replace Drizzle queries with Prisma Client** — P0 *(done 2026-05-23)*
  Converted all 34 route/tool files from Drizzle to Prisma Client across 8 services. Created `prisma.ts` singletons with `PrismaLibSql` adapter. Added `applyPrismaCursorPagination` to shared pagination helper. Deleted `db.ts` from all services. All 624 tests pass.
  Files: `services/*/src/routes/*.ts`, `services/*/src/prisma.ts`, `packages/shared/src/pagination.ts`
  Plan: `.claude/plans/reflective-floating-stallman.md`

- [x] `S2-DB-3` **Seed scripts for Prisma** — P1 *(done 2026-05-24)*
  Rewrote all 8 service seed.ts from Drizzle to Prisma Client. Table creation via `$executeRawUnsafe`, data insertion via `createMany`/`create`. Registered as `prisma db seed` in `prisma.config.ts`. All 624 tests pass.
  Files: `services/*/src/seed.ts`, `services/*/prisma.config.ts`
  Plan: `.claude/plans/validated-marinating-squirrel.md`

- [x] `S2-DB-4` **Runtime seeding** — P1 *(done 2026-06-08)*
  Created shared `scripts/entrypoint.sh` that seeds on first start if DB is empty. Removed build-time `RUN bun run src/seed.ts` from all 8 Dockerfiles. Moved `SEED_MODE` from build arg to runtime env var in docker-compose.yml. All 619 tests pass.
  Files: `scripts/entrypoint.sh`, `services/*/Dockerfile`, `docker-compose.yml`, `CLAUDE.md`
  Plan: `.claude/plans/validated-marinating-squirrel.md`

### Phase 2: Test Adaptation

- [x] `S2-TEST-1` **Update test setup for Prisma** — P1 *(done 2026-10-23)*
  Updated `packages/shared/src/testing.ts` and `services/*/src/__tests__/setup.ts` across all 8 services with `createTestPrisma` / `getTestDatabaseUrl` supporting SQLite and `TEST_DATABASE_URL` PostgreSQL overrides. Added Google Cloud Build CI (`cloudbuild.yaml`) running unit tests across all services, shared packages, eval suites, and K8s manifests.
  Files: `packages/shared/src/testing.ts`, `services/*/src/__tests__/setup.ts`, `cloudbuild.yaml`

### Phase 3: Kubernetes Manifests

- [x] `S2-K8S-1` **PostgreSQL operator cluster** — P0 *(done 2026-10-23)*
  CloudNativePG `Cluster` CR (`evergreen-pg`) with one instance and 8 databases (`ams`, `rater`, `crm`, `ecm`, `comm`, `carrier_summit`, `carrier_coastal`, `claims`) initialized via `postInitApplicationSQL`.
  Files: `k8s/postgres.yaml`, `k8s/README.md`

- [x] `S2-K8S-2` **Service deployments** — P1 *(done 2026-10-23)*
  Deployment + ClusterIP Service manifests for each of the 8 services (`k8s/services/*.yaml`), backed by `k8s/configmap.yaml` (`evergreen-config`) and `k8s/secret.yaml` (`evergreen-secrets`) with `/health` HTTP liveness/readiness probes.
  Files: `k8s/services/*.yaml`, `k8s/configmap.yaml`, `k8s/secret.yaml`

- [x] `S2-K8S-3` **Seed Job** — P1 *(done 2026-10-23)*
  Kubernetes `batch/v1` Job (`evergreen-seed-job`) with `wait-for-pg` initContainer and 8 seed containers supporting `SEED_MODE` via ConfigMap.
  Files: `k8s/seed-job.yaml`

- [x] `S2-K8S-4` **Kustomize overlays** — P2 *(done 2026-10-23)*
  Base `k8s/kustomization.yaml` + overlays for `clean`, `realistic`, and `ingress` (`evergreen.local` path routing), verified by `tests/k8s-manifests.test.ts`.
  Files: `k8s/kustomization.yaml`, `k8s/overlays/`, `tests/k8s-manifests.test.ts`

### Phase 4: Docker Compose Update

- [x] `S2-COMPOSE-1` **Docker Compose with PG option** — P2 *(done 2026-10-23)*
  `docker-compose.pg.yaml` override with `postgres:16-alpine`, `scripts/init-pg-dbs.sql` initializing all 8 databases, healthcheck dependencies, and `DATABASE_URL` overrides across all 8 services.
  Files: `docker-compose.pg.yaml`, `scripts/init-pg-dbs.sql`

### Phase 5: Benchmark Interoperability (Harbor)

- [x] `S2-INTOP-1` **Harbor / Terminal-Bench framework adapter (`eval/harbor/`)** — P1 *(done 2026-10-23)*
  Packaged all 20 scenarios (253 task cases) into the Harbor task standard (`eval/harbor/export-harbor.ts`, `eval/harbor/tasks-manifest.json`, `eval/harbor/docker-compose.harbor.yaml`, and `eval/harbor/tasks/<task_id>/task.yaml` + `tests/test_outputs.py` invoking `bun eval/score.ts`).
  Files: `eval/harbor/export-harbor.ts`, `eval/harbor/tasks/`, `eval/harbor/README.md`, `eval/harbor/__tests__/harbor.test.ts`

---

## Sprint 3: Small-Business Model & Harness Benchmark Upgrades

**Theme:** Evolve Evergreen Insurance API Gym into a premier multi-modal benchmark for evaluating both foundation models and agent harnesses (e.g., Claude Code, OpenHands, Google ADK, LangGraph, custom loops) on realistic small-business operations, incorporating best practices from *AppWorld*, *$\tau$-bench*, *TheAgentCompany*, *ToolSandbox*, and *SWE-Lancer*.

### Phase 1: State Diffing & Strict Modality Enforcement

- [x] `S3-DIFF-1` **Snapshot-based database state diffing & collateral damage detection** — P0 *(done 2026-10-23)*
  Added `GET /sim/snapshot` across all 8 services via `packages/shared/src/sim.ts` and implemented `fetchGymSnapshot`, `diffSnapshots`, and `evaluateCollateralDamage` in `eval/evaluators/state-diff.ts` with `--snapshot-before` / `--snapshot-after` CLI integration in `eval/score.ts`.
  Files: `eval/evaluators/state-diff.ts`, `eval/evaluators/output.ts`, `eval/types.ts`, `eval/score.ts`, `packages/shared/src/sim.ts`

- [x] `S3-MOD-1` **Strict 3-modality enforcement (`MODALITY_MODE=strict`)** — P1 *(done 2026-10-23)*
  Added `strictModalityGuard` in `packages/shared/src/sim.ts` and mounted on `comm` (`/v1/*` blocked in `strict` mode in favor of `/mcp`), `carrier-summit`, and `carrier-coastal` (`/v1/summit/*` and `/v1/coastal/*` require `X-Portal-Session` from `/auth/portal-session` or browser UI interaction), while allowing scorer queries via `X-Eval-Scorer: true`.
  Files: `packages/shared/src/sim.ts`, `services/comm/src/index.ts`, `services/carrier-summit/src/index.ts`, `services/carrier-coastal/src/index.ts`, `docker-compose.yml`

### Phase 2: Interactive Multi-Turn & Long-Horizon Simulation

- [x] `S3-SIM-1` **Interactive multi-turn customer & underwriter simulator** — P1 *(done 2026-10-23)*
  Implemented deterministic template/rule-based conversation responder in `services/comm/src/simulator/{engine,rules}.ts` hooked into `comm:messages:send`, added 5 multi-turn scenarios (`16`–`20` in `eval/scenarios/`), and added turn-budget efficiency scoring in `eval/evaluators/trace.ts` and `eval/evaluators/economics.ts`.
  Files: `services/comm/src/simulator/`, `eval/scenarios/16..20-multiturn-*.ts`, `eval/evaluators/trace.ts`, `eval/evaluators/economics.ts`

- [x] `S3-SIM-2` **Time simulation (`POST /sim/time-travel`) & chaos injection (`POST /sim/chaos`)** — P2 *(done 2026-10-23)*
  Implemented `POST /sim/time-travel`, `POST /sim/chaos`, `POST /sim/reset`, and `GET /sim/status` in `packages/shared/src/sim.ts` and mounted across all 8 services with domain lifecycle transitions (policy/quote/envelope expiration, campaign step advancement, claim status progression) and configurable HTTP error/latency fault injection.
  Files: `packages/shared/src/sim.ts`, `services/*/src/index.ts`, `packages/shared/src/__tests__/sim.test.ts`, `services/ams/src/__tests__/sim-and-modality.test.ts`

### Phase 3: Harness Economics & Multi-Harness Runner

- [x] `S3-ECON-1` **Cost, token efficiency & latency Pareto scoring** — P1 *(done 2026-10-23)*
  Implemented `extractEconomicsMetrics` in `eval/evaluators/economics.ts` parsing `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, LLM calls, wall-clock duration, 4xx/5xx error/retry rates, turn-budget efficiency, and per-model cost (`gemini-3.8-flash`, `gemini-4-argon`, `gemini-4.0-pro`, `gemini-3.5-flash-lite`, etc.) with Pareto efficiency in `eval/report.ts`.
  Files: `eval/evaluators/economics.ts`, `eval/evaluators/trace-genai.ts`, `eval/report.ts`, `eval/types.ts`, `eval/__tests__/state-diff-and-econ.test.ts`

- [x] `S3-HARN-1` **Reference multi-harness benchmark runner & leaderboard** — P2 *(done 2026-10-23)*
  Implemented harness runner (`eval/harnesses/runner.ts`) and Pareto leaderboard generator (`eval/harnesses/leaderboard.ts`) for `google-adk`, `claude-code`, `openhands`, `langgraph`, and `inspect-ai`.
  Files: `eval/harnesses/runner.ts`, `eval/harnesses/leaderboard.ts`, `eval/harnesses/README.md`, `eval/harnesses/__tests__/harnesses.test.ts`

### Phase 4: Additional Benchmark & RL Environment Standards

- [x] `S3-INTOP-2` **Native UK AISI `Inspect AI` `@task` definition (`eval/inspect/`)** — P2 *(done 2026-10-23)*
  Implemented native Inspect AI `@task` (`eval/inspect/evergreen.py`) with multi-container Docker Compose sandboxing, native MCP server attachment (`http://localhost:3004/mcp`), and `@scorer` integration across all 253 tasks.
  Files: `eval/inspect/evergreen.py`, `eval/inspect/README.md`, `eval/inspect/__tests__/inspect.test.ts`

- [x] `S3-INTOP-3` **OpenEnv / Prime Intellect `verifiers` RL Gym Control Plane (`/sim/*`)** — P2 *(done 2026-10-23)*
  Exposed `/sim/reset`, `/sim/snapshot`, `/sim/time-travel`, `/sim/chaos` on all 8 services and built `eval/openenv/client.ts` + `eval/openenv/evergreen_env.py` (`EvergreenGymEnv` and `EvergreenVerifiersEnv` `vf.ToolEnv` adapter).
  Files: `eval/openenv/evergreen_env.py`, `eval/openenv/client.ts`, `eval/openenv/README.md`, `eval/openenv/__tests__/openenv.test.ts`, `packages/shared/src/sim.ts`

- [x] `S3-INTOP-4` **Princeton HAL (`hal-harness`) leaderboard exporter** — P3 *(done 2026-10-23)*
  Implemented `eval/hal/export-hal.ts` exporting `ScenarioReport`s and OTel `gen_ai.usage.*` token/cost/latency metrics into the Princeton Holistic Agent Leaderboard (`hal-harness`) JSON format.
  Files: `eval/hal/export-hal.ts`, `eval/hal/README.md`, `eval/hal/__tests__/hal.test.ts`

---

**Workflow:** /wopen | /wimplement | /wnew-task | /wnew-feature | /wreplan | /wstatus
