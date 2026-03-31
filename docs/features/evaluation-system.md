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

## In Progress

No work in progress.

## Planned Work

See TODO.md Sprint 1 — Phase 4 (Tests).

### Multi-Turn Conversation Scenarios (Priority: P1)
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
