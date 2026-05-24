# Privy/gym — Development Plan

**Last Updated:** 2026-05-13
**Current Focus:** Sprint 2 (Kubernetes & PostgreSQL)
**Cadence:** 2-week sprints
**Repo:** gym

> See [docs/roadmap.md](docs/roadmap.md) for strategic overview
> See [docs/features/](docs/features/) for feature history

<!-- Counters: BUG=0 SEC=0 INFRA=1 PERF=0 DEBT=0 REL=0 -->

---

## Sprint 0: Critical Issues

No open issues.

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

- [ ] `S2-DB-3` **Seed scripts for Prisma** — P1
  Rewrite each service's `seed.ts` to use Prisma Client instead of Drizzle inserts. Register as `prisma db seed` in `package.json`. Support `SEED_MODE=clean|realistic` via env var.
  Files: `services/*/src/seed.ts`, `services/*/package.json`

- [ ] `S2-DB-4` **Runtime seeding** — P1
  Move seed from Dockerfile `RUN` (build-time) to a startup entrypoint that runs `prisma migrate deploy && prisma db seed` if the DB is empty. Remove `RUN bun run src/seed.ts` from all 8 Dockerfiles.
  Files: `services/*/Dockerfile`, `scripts/entrypoint.sh`

### Phase 2: Test Adaptation

- [ ] `S2-TEST-1` **Update test setup for Prisma** — P1
  Update test `setup.ts` files to use Prisma Client with SQLite for fast in-memory tests. Ensure all existing tests pass. Add a CI step that runs tests against PG via `TEST_DATABASE_URL`.
  Files: `services/*/src/__tests__/setup.ts`

### Phase 3: Kubernetes Manifests

- [ ] `S2-K8S-1` **PostgreSQL operator cluster** — P0
  CloudNativePG `Cluster` CR with one instance, 8 databases (one per service). Include `initdb` SQL to create databases. Document operator installation prerequisites.
  Files: `k8s/postgres.yaml`

- [ ] `S2-K8S-2` **Service deployments** — P1
  Deployment + ClusterIP Service for each of the 8 services. Env vars from ConfigMap (ports, service URLs) and Secret (JWT_SECRET, DATABASE_URL). Liveness/readiness probes on `/health`. Prisma schema set to `provider = "postgresql"` via build arg or multi-provider config.
  Files: `k8s/services/*.yaml`

- [ ] `S2-K8S-3` **Seed Job** — P1
  Kubernetes Job that runs `prisma migrate deploy && prisma db seed` against PG after the cluster is ready. Supports `SEED_MODE` via ConfigMap. Can be re-run for reset.
  Files: `k8s/seed-job.yaml`

- [ ] `S2-K8S-4` **Kustomize overlays** — P2
  Base + overlays for `clean` and `realistic` seed modes. Optional ingress overlay for external access.
  Files: `k8s/kustomization.yaml`, `k8s/overlays/`

### Phase 4: Docker Compose Update

- [ ] `S2-COMPOSE-1` **Docker Compose with PG option** — P2
  `docker-compose.pg.yaml` override that adds a Postgres container and sets `DATABASE_URL` on all services. Default `docker-compose.yml` continues to work with embedded SQLite via Prisma.
  Files: `docker-compose.pg.yaml`

---

**Workflow:** /wopen | /wimplement | /wnew-task | /wnew-feature | /wreplan | /wstatus
