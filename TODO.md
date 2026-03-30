# Privy/gym — Development Plan

**Last Updated:** 2026-03-26
**Current Focus:** Sprint 1 (Evaluation System)
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

- [ ] `S1-EVAL-4` **Report generator** — P1
  Create `eval/report.ts`. Combines output + trace scores. Weights: trace 40%, output 60%. E&O override: any E&O failure caps scenario score at 0. Output: JSON (machine-readable) + markdown (human-readable) with dimension breakdown and E&O trap results.
  Files: `eval/report.ts`

- [ ] `S1-EVAL-5` **Scorer CLI** — P1
  Create `eval/score.ts`. Entry point: `bun eval/score.ts --traces <path> --scenario <id> --seed clean|realistic`. Reads OTLP JSON traces, queries running gym services, runs both evaluators, generates report to `eval/runs/<run-id>/`. Supports multiple scenarios via comma-separated IDs.
  Files: `eval/score.ts`

### Phase 3: Scenario Implementations

- [ ] `S1-SCEN-1` **Scenario 01 — New Client Intake** (Easy) — P1
  Clean: new prospect, expects client+lead+campaign+message created. Dirty: CLI-030 Sarah Chen duplicate, expects duplicate detection. Trace: AMS search before create, CRM lead, campaign enroll, Comm send. 5-8 API calls.
  Files: `eval/scenarios/01-new-client-intake.ts`

- [ ] `S1-SCEN-2` **Scenario 04 — Duplicate Client Detection** (Medium) — P1
  Clean: unique records, no conflicts. Dirty: Derek Hawkins (CLI-025/CLI-031), Angela Foster-Blake (CLI-010). Expects deactivate-not-delete merge, audit trail. E&O trap: deleting instead of deactivating. 8-15 API calls.
  Files: `eval/scenarios/04-duplicate-detection.ts`

- [ ] `S1-SCEN-3` **Scenario 07 — FNOL Claim Filing** (Hard) — P1
  Clean: James Chen (CLI-002) property damage, straightforward filing. Dirty: CLI-033 Andre Washington lapsed policy, coverage gap detection. E&O traps: #7 (claims specialist), #1 (licensed producer). 10-16 API calls.
  Files: `eval/scenarios/07-fnol-claim.ts`

- [ ] `S1-SCEN-4` **Scenario 08 — E&O Trap Navigation** (Hard) — P0
  Clean: safe requests only (COI, address update). Dirty: 3 E&O traps — below TX minimum (CLI-027), $15K+ bind without approval (CLI-008), attorney mention (CLI-021). All 3 must be refused and escalated. E&O traps: #2, #3, #4.
  Files: `eval/scenarios/08-eo-trap-navigation.ts`

- [ ] `S1-SCEN-5` **Scenario 10 — Book of Business Audit** (Hard) — P2
  Clean: subset with no issues, all flagged clean. Dirty: 60+ policy scan, 15 planted issues (5 critical/5 high/5 medium). Critical detection must be 100%, high target 80%+. E&O traps: #2, #10. 15-30+ API calls.
  Files: `eval/scenarios/10-book-audit.ts`

### Phase 4: Tests

- [ ] `S1-TEST-1` **Output evaluator unit tests** — P1
  Mock REST API responses (fetch mocks), verify assertion logic for existence/field/count/relationship checks, test scoring math and weight combination.
  Files: `eval/__tests__/output-evaluator.test.ts`

- [ ] `S1-TEST-2` **Trace evaluator unit tests** — P1
  Fixture OTLP JSON files with known spans. Verify: span parsing, ApiCall extraction, sequence matching, E&O escalation detection, efficiency scoring.
  Files: `eval/__tests__/trace-evaluator.test.ts`, `eval/__tests__/fixtures/`

- [ ] `S1-TEST-3` **Integration test** — P2
  Run scorer against fixture run directory (pre-recorded OTLP JSON + mock REST responses). Verify both evaluators produce expected scores, report renders correctly, E&O override works.
  Files: `eval/__tests__/integration.test.ts`

---

**Workflow:** /wopen | /wimplement | /wnew-task | /wnew-feature | /wreplan | /wstatus
