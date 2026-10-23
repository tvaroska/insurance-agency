# Evaluation System

Scorer that evaluates AI agent performance on 15 benchmark scenarios using output scoring (DB state assertions) and trace scoring (agent trace analysis).

---

## Completed Work

### Phase 1: Clean Seed Data (Sprint 1, 2026-03-12)

- **S1-seed-1** Created clean seed dataset — `data/seed-clean/*.json` (16 files). Removed all adversarial data: no below-minimum coverage, no lapsed policies, no unsigned docs, no fraud indicators, no duplicates.
- **S1-seed-2** Seed mode selector — Updated each service's `seed.ts` to accept `SEED_MODE=clean|realistic` env var.

### Earlier Sprints (completed before workflow setup)

- **Sprint 0:** API docs & missing routes — Comm REST, AMS policies, CRM leads/campaigns, ECM filters, Rater/Claims aliases. OpenAPI spec updates. 810 tests, 0 failures.
- **Sprint 10:** Escalation & E&O framework — escalation endpoints, manager persona engine, E&O enforcement on bind, escalation audit trail, scenario smoke tests for all 15 scenarios.
- **Sprints 1-9:** All 8 services, shared package, carrier portals, K8s, E2E tests, adversarial seed data, claims service, ACORD PDF generation, scenario readiness.

### Phase 2: Scorer (Sprint 1, 2026-03-27)

- **S1-EVAL-1** Scenario definition format — `eval/types.ts`. TypeScript interfaces for ScenarioDefinition, VariantConfig, OutputCheck, TraceCheck, EoTrap, ApiCall, OTLP JSON parsing types, scoring results, and report structure.
- **S1-EVAL-2** Output evaluator — `eval/evaluators/output.ts`. Queries gym REST APIs with OAuth token to verify state after agent run. Supports record existence (GET + status check), field values (deep partial body matching), and array length assertions. Auth via `agent-readonly` client credentials.
- **S1-EVAL-3** Trace evaluator — `eval/evaluators/trace.ts`. Parses OTLP JSON spans, extracts HTTP client spans (kind=3) into sorted `ApiCall[]`. Evaluates four check types: sequence (ordered subsequence matching), presence, absence, and count (range-based). Pattern matching supports method, pathPattern (regex), service, and statusCode filters.
- **S1-EVAL-6** GenAI semconv trace parser — `eval/evaluators/trace-genai.ts`. Parses GenAI semantic convention spans, extracts HTTP from `_http` metadata or operationId mapping. Unified `parseTrace()` auto-detects format.
- **S1-EVAL-4** Report generator — `eval/report.ts`. `generateReport()` combines output + trace scores (40/60 weights). E&O override: uncaught trap caps score at 0. `formatMarkdown()` renders human-readable report with dimension breakdown and E&O trap table.
- **S1-EVAL-5** Scorer CLI — `eval/score.ts`. Entry point: `bun eval/score.ts --traces <path> --scenario <id> --seed clean|realistic`. Loads OTLP JSON (file/dir/JSONL), runs both evaluators, evaluates E&O traps, writes JSON + markdown reports. Supports comma-separated scenario IDs.

### Phase 3: Scenario Implementations (Sprint 1, 2026-03-30)

- **S1-SCEN-1** Scenario 01 — New Client Intake (Easy) — `eval/scenarios/01-new-client-intake.ts`. Clean + realistic variants. Trace: search-before-create sequence, lead, campaign enroll, send, task. Realistic: Sarah Chen duplicate detection.
- **S1-SCEN-2** Scenario 04 — Duplicate Client Detection (Medium) — `eval/scenarios/04-duplicate-detection.ts`. Realistic: 3 duplicate pairs (Hawkins/Chen/Foster), merge via POST /clients/{id}/merge, no-delete E&O trap. Output checks: inactive/active status validation.
- **S1-SCEN-3** Scenario 07 — FNOL Claim Filing (Hard) — `eval/scenarios/07-fnol-claim.ts`. Coverage-verify→file→assign sequence, client notification, task creation. E&O trap #7: escalate to claims specialist.
- **S1-SCEN-4** Scenario 08 — E&O Trap Navigation (Hard) — `eval/scenarios/08-eo-trap-navigation.ts`. 5 requests, 3 E&O traps (#2 state min, #3 premium threshold, #4 attorney). Validates 3+ escalation POSTs, no unauthorized modifications.

### Phase 3b: Full Scenario Coverage (Sprint 1, 2026-03-31)

- **S1-SCEN-5** Scenario 10 — Book of Business Audit (Hard) — `eval/scenarios/10-book-of-business-audit.ts`. Clean: no issues. Realistic: 60+ policies, 15 planted issues (Critical/High/Medium). E&O traps #2, #10.
- **S1-REL-7** Scenarios 02, 03, 05, 06, 09, 11, 12, 13, 14, 15 — 11 new scenario definitions. 218 total cases across all 15 scenarios. Each with 2-3 variants × 5 difficulty levels.
  - Easy: 12 (Policy Status Inquiry), 13 (COI Generation), 14 (Lead Qualification), 15 (Commission Reconciliation)
  - Medium: 02 (Multi-Carrier Quote Comparison), 05 (Renewal Re-Shop), 06 (Cross-Sell Detection)
  - Hard: 03 (Policy Binding E2E), 09 (Carrier Denial Recovery), 10 (Book of Business Audit), 11 (Client Meeting Prep)

### Phase 4: Tests (Sprint 1, 2026-04-02)

- **S1-TEST-1** Output evaluator unit tests — `eval/__tests__/output-evaluator.test.ts`. 23 tests covering all three assertion types (status, array length, body match), OAuth token caching, unknown service handling, network errors, and scoring weight propagation. Uses `global.fetch` mocking with module re-import for token cache isolation. Plan: `.claude/plans/wondrous-yawning-dahl.md`
- **S1-TEST-2** Trace evaluator unit tests — `eval/__tests__/trace-evaluator.test.ts`. 32 tests: parseOtlpTrace, parseGenAiTrace, evaluateTrace (all 4 check types), parseTrace (unified auto-detect). Plan: `.claude/plans/synchronous-fluttering-tide.md`
- **S1-TEST-3** Integration test — `eval/__tests__/integration.test.ts`. 5 tests: full pipeline all-pass (scenario 01 clean), partial output failures with weighted scoring verification, E&O trap failure overrides score to 0, E&O trap caught preserves score, report structure validation. Fixture: `eval/__tests__/fixtures/otlp-scenario01.json`. Plan: `.claude/plans/mighty-jingling-graham.md`

### Sprint 0 Review Fixes (2026-10-19)

- **S0-BUG-1** Fixed OAuth instructions in `eval/metr/EvergreenInsurance.py` (`POST /oauth/token`, `client_id=agent-full`, `client_secret=dev-secret`, OpenAPI specs in `specs/`).
- **S0-BUG-2** Added `attorney_involvement` to `ESCALATION_REASONS` and `reason ?? reason_code` alias support in `services/ams/src/routes/escalations.ts`, added manager rule in `services/ams/src/manager/rules.ts`, updated `specs/ams.yaml`, and added unit tests in `services/ams/src/__tests__/escalations.test.ts`.
- **S0-BUG-3** Added optional `outputCheck` to `EoTrap` (`eval/types.ts`, `eval/score.ts`), wired per-client escalation checks (`CLI-027`, `CLI-008`, `CLI-021`) into `eval/scenarios/08-eo-trap-navigation.ts`, and replaced vacuous `GET /clients/{id}/policies` checks in `eval/scenarios/10-book-of-business-audit.ts` with assertions on created escalations and remediation tasks.
- **S0-DEBT-1** Reconciled Output (60%) / Trace (40%) weights across `README.md`, `eval/types.ts`, and `docs/evaluation.md`.
- **S0-DEBT-2** Removed stale `PLAN.md`, populated `docs/architecture.md` and `docs/cujs.md`, and clarified seed data row counts and Prisma 7 stack in `README.md`.

## In Progress

No work in progress.

## Planned Work

See [TODO.md](../../TODO.md) (Sprint 2 & Sprint 3) and [docs/specs.md](../specs.md) for full task breakdowns:

- **Harbor / Terminal-Bench Framework Adapter (`S2-INTOP-1`, Priority: P1 — Active Sprint 2 TODO):** Package the 15 scenarios (203 task cases) into Harbor format (`task.yaml` + `docker-compose.yaml` + `tests/test_outputs.py`) for zero-code benchmarking of Claude Code, OpenHands, Codex CLI, Goose, and Aider.
- **Snapshot-Based State Diffing (`S3-DIFF-1`, Priority: P0):** Exact pre/post database state diffing across all 8 services to catch collateral damage (inspired by *AppWorld*).
- **Strict 3-Modality Enforcement (`S3-MOD-1`, Priority: P1):** `MODALITY_MODE=strict` to require true MCP usage on `comm` and browser interaction on carrier portals when benchmarking agent harnesses.
- **Multi-Harness Runner & Leaderboard (`S3-HARN-1`, Priority: P2):** Standardized evaluation runner and comparative leaderboard across models and harnesses (ADK, Claude Code, OpenHands, LangGraph, Inspect AI).
- **Additional Benchmark & RL Standards (`S3-INTOP-2..4`, Priority: P2/P3 — Backlog):** Native UK AISI `Inspect AI` `@task` (`S3-INTOP-2`), OpenEnv / Prime Intellect `verifiers` RL control plane with fast `/sim/reset` (`S3-INTOP-3`), and Princeton HAL (`hal-harness`) Cost-vs-Score exporter (`S3-INTOP-4`).

### Multi-Turn Conversation Scenarios (`S3-SIM-1`, Priority: P1)
- **Problem:** All 15 scenarios are single-shot tasks. Enterprise agents rarely operate this way — real insurance workflows involve clarification loops ("Which vehicle was involved?"), partial information gathering across multiple interactions, and user corrections mid-task. Without multi-turn evaluation, the gym cannot measure an agent's ability to handle ambiguity, ask clarifying questions, or recover from misunderstandings — the dominant interaction pattern in production.
- **Scope:**
  - Conversation simulator that feeds scripted user responses based on agent questions
  - Template-based response engine (not LLM) for reproducibility
  - New scenario variants requiring clarification (incomplete FNOL, ambiguous client identity, multi-policy changes)
  - Trace evaluation extended to score question quality, turn count efficiency, and information extraction completeness
  - Turn budget checks (agent should resolve in N turns, penalize both over-asking and under-asking)
- **Priority:** P1
- **Status:** Planned
- **Added:** 2026-03-31

### Cost & Latency Evaluation (Priority: P2)
- **Problem:** The scoring model measures correctness and compliance but not economic efficiency. The Privy evolution thesis (General Agent → Skill → Code reduces cost) requires cost/latency data to validate. Without this dimension, the gym cannot demonstrate that specialization actually pays off — or identify agents that achieve correctness through brute-force token consumption.
- **Scope:**
  - Extract token counts from GenAI semantic convention spans (`gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`)
  - Wall-clock time from trace span durations (first span start → last span end)
  - LLM invocation count from `gen_ai.operation.name` spans
  - New scoring dimension: efficiency score (token budget, latency budget, API call budget per scenario)
  - Cost model configuration (price per input/output token, per-model pricing)
  - Report extension: cost breakdown table, latency percentiles, token usage by LLM call
- **Priority:** P2
- **Status:** Planned
- **Added:** 2026-03-31

### PostgreSQL Migration (Priority: P2)
- **Problem:** SQLite-per-service architecture blocks concurrent agent evaluation (SQLite write locks) and prevents testing realistic transaction semantics (optimistic locking, concurrent modifications, race conditions). Multi-agent research — where two agents modify the same client record or race on policy endorsements — is impossible with the current architecture. PostgreSQL also enables shared state visibility across services for more realistic cross-service consistency checks.
- **Scope:**
  - Migrate AMS service from SQLite/Drizzle to PostgreSQL (highest cross-service dependency)
  - Docker Compose: add PostgreSQL container with per-service databases
  - Update seed approach: SQL migration scripts instead of baked-in SQLite files
  - Reset mechanism: `docker compose down -v && docker compose up` (volume-based reset)
  - Evaluate migrating remaining 7 services (phased: AMS first, then Claims, then rest)
  - Connection pooling configuration for concurrent agent evaluation
- **Priority:** P2
- **Status:** Planned
- **Added:** 2026-03-31
