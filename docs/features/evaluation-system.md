# Evaluation System

Scorer that evaluates AI agent performance on 20 benchmark scenarios (259 test cases across 5 prompt difficulty tiers) using output scoring (DB state assertions and 32-table pre/post state diffing), trace scoring (OTLP HTTP and GenAI trace analysis), hard E&O compliance overrides, and calibrated atomic rubrics.

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
- **S1-REL-7** Scenarios 02, 03, 05, 06, 09, 11, 12, 13, 14, 15 — 11 scenario definitions. Each with 2-3 variants × 5 difficulty levels.

### Phase 4: Tests (Sprint 1, 2026-04-02)

- **S1-TEST-1** Output evaluator unit tests — `eval/__tests__/output-evaluator.test.ts`.
- **S1-TEST-2** Trace evaluator unit tests — `eval/__tests__/trace-evaluator.test.ts`.
- **S1-TEST-3** Integration test — `eval/__tests__/integration.test.ts`.

### Sprint 0 Review Fixes (2026-10-19)

- **S0-BUG-1** Fixed OAuth instructions in `eval/metr/EvergreenInsurance.py`.
- **S0-BUG-2** Added `attorney_involvement` to `ESCALATION_REASONS` and `reason ?? reason_code` alias support in `services/ams/src/routes/escalations.ts`.
- **S0-BUG-3** Added optional `outputCheck` to `EoTrap` (`eval/types.ts`, `eval/score.ts`).
- **S0-DEBT-1** Reconciled Output (60%) / Trace (40%) weights across `README.md`, `eval/types.ts`, and `docs/evaluation.md`.
- **S0-DEBT-2** Populated `docs/architecture.md` and `docs/cujs.md`, and clarified seed data row counts and Prisma 7 stack in `README.md`.

### Sprint 2 & Sprint 3: 20-Scenario Multi-Turn Suite, State Diffing, Economics & Adapters (v0.5.0)

- **S2-INTOP-1 & S3-INTOP-2..4:** Shipped Harbor / Terminal-Bench 2.0 adapter (`eval/harbor/`), UK AISI Inspect AI `@task` (`eval/inspect/evergreen.py`), OpenEnv / `verifiers` RL control plane (`eval/openenv/`), and Princeton HAL exporter (`eval/hal/`).
- **S3-DIFF-1:** Shipped 32-table pre/post snapshot state diffing and collateral damage scoring (`eval/evaluators/state-diff.ts`).
- **S3-MOD-1:** Shipped `MODALITY_MODE=strict` enforcement across Comm MCP and Carrier Web Portals.
- **S3-SIM-1 & S3-SIM-2:** Added 5 interactive multi-turn scenarios (`Scenarios 16–20`, expanding the suite to **20 scenarios and 253 total test cases**), deterministic customer simulator (`eval/simulator/`), `/sim/time-travel`, and `/sim/chaos`.
- **S3-ECON-1 & S3-HARN-1:** Shipped OTel GenAI token/cost/turn-budget Pareto evaluator (`eval/evaluators/economics.ts`), calibrated atomic rubrics (`eval/evaluators/rubric.ts`), and multi-harness runner (`eval/harnesses/runner.ts`).

### Executive Operations & Governance Showcase (v0.6.0, 2026-11-09)

- **1st-Line Service-Layer E&O Firewall:** Shipped `packages/shared/src/compliance-firewall.ts` enforcing 10-state auto statutory minimums (`CA`, `TX`, `FL`, `NY`, `IL`, `PA`, `OH`, `GA`, `NC`, `MI`), backdating prohibition, and binding authority caps (`HTTP 422`) in AMS and Rater.
- **Real ACORD 25 PDF Generation:** Shipped `services/ecm/src/templates/acord-25.ts` (`pdf-lib`) rendering real multi-field ACORD 25 COI PDFs (`POST /v1/documents/coi/generate` and `POST /v1/coi`).
- **20-Scenario Playable Trajectories & 3-Stage Evolution:** Expanded `eval/agents/baseline-agent.ts` to all 20 scenarios (`01`–`20`) and added `eval/evolution-showcase.ts` (`Stage 1 General Agent -> Stage 2 Domain Skill -> Stage 3 $0-Token Compiled Code` with `FallbackToSkill`).
- **GM3 Light Executive Workbench & HTML Scorecard:** Mounted 4-tab Executive Workbench at `GET /` on AMS (`:3000`), added `bun run showcase`, and added `--html-out` (`docs/executive-scorecard.html`).

## In Progress

No work in progress.
