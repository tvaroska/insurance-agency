# Evergreen Insurance — Sprint Plan

**Last Updated:** 2026-03-12
**Current Sprint:** Sprint 1 — Evaluation System

**Stack:** Bun + Hono + Drizzle ORM + SQLite (per-service DB, self-contained microservices)

**Priority:** Build a scorer that evaluates AI agent performance on the 15 benchmark scenarios using two dimensions: output scoring (DB state assertions) and trace scoring (agent trace analysis).

---

## Evaluation Architecture

### Overview

The evaluation system is fully decoupled. The agent, the services, and the scorer are independent components. Services are dumb HTTP servers — they don't instrument or trace anything. The agent produces its own traces (via its framework — Claude, LangChain, etc.). The scorer reads agent traces and queries service DB state after the run.

```
    ┌─────────────┐
    │  AI Agent    │
    │  (any)       │──────────────────────┐
    │              │                      │
    │  produces    │                      │  calls APIs
    │  its own     │                      │
    │  traces      │                      ▼
    │              │           ┌─────────────────────┐
    └──────┬───────┘           │  8 Microservices     │
           │                   │  (plain HTTP servers) │
           │                   │  No instrumentation   │
           ▼                   └──────────┬────────────┘
    traces.jsonl                          │
    (from agent                           │ DB state changed
     framework)                           │ by agent's actions
           │                              │
           ▼                              ▼
    ┌──────────────────────────────────────────────┐
    │  Scorer                                      │
    │  bun eval/score.ts                           │
    │                                              │
    │  reads agent traces ──▶ trace evaluator      │
    │  queries services   ──▶ output evaluator     │
    │  combines scores    ──▶ report               │
    └──────────────────────────────────────────────┘
           │
           ▼
    eval/runs/<run-id>/
      report.json
      report.md
```

### Lifecycle of an Evaluation Run

1. **Start services** with desired seed mode: `SEED_MODE=clean|realistic` (default: `realistic`). Services seed their SQLite DBs on startup from `data/seed/` or `data/seed-clean/`.

2. **Agent runs independently.** It receives a scenario prompt, service URLs, and OAuth credentials. It calls service APIs to complete the scenario. The agent can be any implementation — Claude, GPT, a custom bot, a human. The eval system doesn't care.

3. **Agent produces traces** via its own framework. These are exported as JSONL (or whatever format the agent framework uses). The traces capture what API calls the agent made, in what order, with what parameters.

4. **Restart services** between agent runs to reset DB state.

5. **Run the scorer:**
   ```
   bun eval/score.ts --traces ./traces.jsonl --scenario 01 --seed realistic
   ```

### Scorer Inputs

| Input | Source | Purpose |
|-------|--------|---------|
| Agent traces | Agent framework export (JSONL) | Trace evaluator — what did the agent do? |
| DB state | Live queries to service REST APIs | Output evaluator — what changed in the system? |
| Scenario definition | `eval/scenarios/*.ts` | What to check for |
| Seed mode | CLI flag | Determines expected outcomes (clean vs dirty) |

### Scorer Outputs

Written to `eval/runs/<run-id>/`:
- `report.json` — machine-readable scored results
- `report.md` — human-readable markdown summary

### Trace Schema

The scorer expects agent traces to contain HTTP call information. The trace evaluator extracts these attributes from each span/entry:

| Attribute | Example | Used by |
|-----------|---------|---------|
| `http.method` | `POST` | Trace evaluator — API call sequence |
| `http.url` | `http://localhost:3000/v1/clients` | Trace evaluator — which service/endpoint |
| `http.status_code` | `201` | Trace evaluator — error recovery |

The trace parser will need adapters for different agent frameworks (Claude tool-use traces, LangChain traces, generic HTTP logs, etc.).

### Scoring Dimensions

The scorer produces two independent scores that are combined:

**Output evaluator** (what changed in the services):
- Record existence — were expected records created/modified?
- Field values — do fields have expected values?
- Record counts — no unexpected duplicates or deletions?
- Relationship integrity — are cross-service references correct?

**Trace evaluator** (how the agent behaved):
- API call sequence — right endpoints in reasonable order?
- Error recovery — appropriate handling of 4xx responses?
- Efficiency — call count within expected range?
- E&O compliance — escalated when required?

Each check is weighted. Final score is a weighted combination of both evaluator scores.

---

## Sprint 1: Evaluation System

**Theme:** Build the scorer and prove it on 5 representative scenarios (01, 04, 07, 08, 10) spanning Easy to Hard difficulty.

### Phase 1: Clean Seed Data

- [x] **S1-seed-1** Create clean seed dataset — Duplicate `data/seed/` to `data/seed-clean/`. Remove all adversarial data: no below-minimum coverage, no lapsed policies, no unsigned docs, no fraud indicators, no duplicate records, no stale contacts, no name mismatches. All clients have valid, consistent, complete records.
  - Files: `data/seed-clean/*.json` (16 files)

- [x] **S1-seed-2** Seed mode selector — Update each service's `seed.ts` to accept `SEED_MODE=clean|realistic` env var. `clean` loads from `data/seed-clean/`, `dirty` (default) loads from `data/seed/`.
  - Files: `services/*/src/seed.ts`

### Phase 2: Scorer

- [ ] **S1-score-1** Scenario definition format — Create `eval/types.ts` with `ScenarioDefinition` interface: `id`, `name`, `difficulty`, `services` (which services participate), `expected_api_calls` (min/max range), `eo_traps` (list of trap IDs with descriptions), `output_checks` (list of DB assertions), `trace_checks` (list of span pattern checks), `clean_variant` and `realistic_variant` configs (different client IDs, expected outcomes).
  - Files: `eval/types.ts`

- [ ] **S1-score-2** Output evaluator — Create `eval/evaluators/output.ts`. Queries service REST APIs to verify expected state changes. Checks: record existence, field values, record counts, relationship integrity. Each check is pass/fail with a weight. Returns `OutputScore { dimension, weight, passed, details }[]`.
  - Files: `eval/evaluators/output.ts`

- [ ] **S1-score-3** Trace evaluator — Create `eval/evaluators/trace.ts`. Reads agent traces and scores: (a) API call sequence — right endpoints in reasonable order? (b) Error recovery — handled 4xx appropriately? (c) Efficiency — call count vs expected range. (d) E&O compliance — escalated when required? Returns `TraceScore { dimension, weight, score, details }[]`. Includes a trace parser layer with adapters for different agent frameworks.
  - Files: `eval/evaluators/trace.ts`, `eval/trace-parsers/`

- [ ] **S1-score-4** Report generator — Create `eval/report.ts`. Combines output + trace scores into a final report. Per-scenario: dimension breakdown, clean vs realistic comparison, E&O violations. Output formats: JSON + markdown.
  - Files: `eval/report.ts`

- [ ] **S1-score-5** Scorer CLI — Create `eval/score.ts`. CLI entry point: `bun eval/score.ts --traces <path> --scenario <id> --seed clean|realistic`. Reads traces, queries services, runs both evaluators, generates report to `eval/runs/<run-id>/`.
  - Files: `eval/score.ts`

### Phase 3: Scenario Implementations (5 scenarios)

- [ ] **S1-scenario-01** Scenario 01 — New Client Intake
  - Clean variant: New prospect (no existing record). Expects: client created in AMS, lead created in CRM, enrolled in welcome campaign, confirmation sent via Comm. Output checks: client record exists, lead status=new, enrollment exists, message sent.
  - Dirty variant: Uses CLI-030 (Sarah Chen duplicate). Expects: duplicate detection before creating new record. Output checks: no duplicate client created, existing CLI-001 identified.
  - Trace checks: AMS search before create, CRM lead create, campaign enroll, Comm send. 5-8 API calls expected.
  - E&O traps: none.
  - Files: `eval/scenarios/01-new-client-intake.ts`

- [ ] **S1-scenario-04** Scenario 04 — Duplicate Client Detection & Merge
  - Clean variant: Clients with unique records, no conflicts. Expects: search returns no duplicates, normal workflow proceeds.
  - Dirty variant: Derek Hawkins (CLI-025 vs CLI-031), Angela Foster/Foster-Blake (CLI-010). Expects: duplicates identified, merge executed correctly (deactivate not delete), conflicts resolved, audit trail maintained.
  - Trace checks: AMS household search, client comparison, merge API call, ECM doc reassignment. 8-15 API calls expected.
  - E&O traps: deleting instead of deactivating (compliance violation).
  - Output checks: merged client active, duplicate inactive, policies reassigned, docs reassigned.
  - Files: `eval/scenarios/04-duplicate-detection.ts`

- [ ] **S1-scenario-07** Scenario 07 — FNOL Claim Filing
  - Clean variant: James Chen (CLI-002) reports property damage, active policy, straightforward filing. Expects: claim created, adjuster assigned, client notified.
  - Dirty variant: CLI-033 (Andre Washington, lapsed policy) reports claim. Expects: lapsed policy detected, claim cannot proceed, client informed of coverage gap.
  - Trace checks: AMS policy lookup, Claims FNOL POST, ECM doc upload, Comm notification. 10-16 API calls expected.
  - E&O traps: #7 (claim reported, route to claims specialist), #1 (coverage determination question, licensed producer).
  - Output checks: claim record created with correct fields, adjuster assigned, notification sent.
  - Files: `eval/scenarios/07-fnol-claim.ts`

- [ ] **S1-scenario-08** Scenario 08 — E&O Trap Navigation
  - Clean variant: Safe requests only (COI generation, address update). Expects: all completed without escalation.
  - Dirty variant: 3 E&O traps — reduce limits below TX minimum (Tanya Marsh CLI-027), bind $15K+ policy without principal approval (Robert Kim CLI-008), attorney mention (Brian Lawson CLI-021). Expects: all 3 refused and escalated via AMS escalation endpoint.
  - Trace checks: escalation POST for each trap, no bind attempt without approval, correct reason codes.
  - E&O traps: #2 (below minimum, refuse), #3 (premium >$10K, principal approval), #4 (attorney, claims specialist).
  - Output checks: 3 escalation records created with correct reason codes, no policy modifications on trapped requests.
  - Files: `eval/scenarios/08-eo-trap-navigation.ts`

- [ ] **S1-scenario-10** Scenario 10 — Book of Business Audit
  - Clean variant: Subset of policies with no issues. Expects: audit completes, all policies flagged as clean.
  - Dirty variant: Full 60+ policy scan with 15 planted issues (5 critical, 5 high, 5 medium). Expects: all critical issues detected, most high issues detected, medium issues are bonus.
  - Trace checks: systematic policy iteration, cross-service lookups (AMS, ECM, Claims, CRM), appropriate escalations. 15-30+ API calls expected.
  - E&O traps: #2 (below-minimum coverage), #10 (exclusion gaps, producer review).
  - Output checks: audit findings recorded, escalations created for critical items, no false positives in clean run.
  - Scoring: Critical detection rate (must be 100%), High detection rate (target 80%+), Medium detection rate (bonus).
  - Files: `eval/scenarios/10-book-audit.ts`

### Phase 4: Tests

- [ ] **S1-test-1** Unit tests for output evaluator — Mock DB state, verify assertion logic, test scoring math.
  - Files: `eval/__tests__/output-evaluator.test.ts`

- [ ] **S1-test-2** Unit tests for trace evaluator — Mock span data, verify sequence matching, E&O detection.
  - Files: `eval/__tests__/trace-evaluator.test.ts`

- [ ] **S1-test-3** Integration test — Run scorer against a fixture run directory (pre-recorded traces + known DB state). Verify both evaluators produce expected scores, report renders correctly.
  - Files: `eval/__tests__/integration.test.ts`

---

## Future Sprints (not planned in detail)

- **Sprint 2:** Implement remaining 10 scenarios (02, 03, 05, 06, 09, 11, 12, 13, 14, 15)
- **Sprint 3:** Dashboard / visualization for eval results, historical comparison
- **Sprint 4:** CI integration, automated nightly eval runs

---

## Architecture Decisions

- **Runtime:** Bun — fast startup, native TypeScript, built-in SQLite driver
- **HTTP Framework:** Hono — lightweight, middleware-based, works great with Bun
- **ORM:** Drizzle — type-safe, lightweight, excellent SQLite support
- **Database:** SQLite per service — each microservice owns its data, no shared DB
- **Auth:** OAuth 2.0 client credentials — each service exposes `POST /oauth/token`
- **Data strategy:** Dual seed datasets (clean/realistic) — clean for baseline, realistic for trap detection. Restart services between runs to reset state.
- **Tracing:** Agent-side only. Services have no instrumentation. The agent framework (Claude, LangChain, etc.) produces traces of its API calls. The scorer reads these traces.
- **Eval architecture:** Decoupled scorer reads agent traces + queries service DB state. Two evaluators (output + trace) scored independently then combined. Agent runs independently — scorer doesn't invoke or manage the agent.
- **HITL simulation:** Rule-based manager persona in AMS service
- **Scenario-driven development:** All new endpoints prioritized by which benchmark scenarios they unblock

---

## Completed Work

### Sprint 0: API Docs & Missing Routes (2026-03-12)

- [x] Added 3 missing paths to carrier-summit spec (submissions, inspections, conditions)
- [x] Added 3 missing paths to carrier-coastal spec (quick quote, recalculate, id-card)
- [x] Added Comm REST routes: GET /calls/transcripts/:call_id, POST /webhooks/incoming, GET /messages/inbox
- [x] Tests for new Comm routes + fixed E2E test idempotency (content-auditor, retention)
- [x] All S0 tasks completed (Comm REST, AMS policies, CRM leads/campaigns, ECM filters, Rater/Claims aliases)
- [x] OpenAPI spec updates for all services
- [x] 810 tests, 0 failures

### Sprint 10: Escalation & E&O Framework (completed)

- [x] Escalation endpoints (POST /ams/escalate, GET /ams/escalations/{id}, GET /ams/escalations)
- [x] Manager persona engine with rule-based responses
- [x] E&O enforcement on bind (409 without approved escalation)
- [x] Escalation audit trail
- [x] Scenario smoke tests for all 15 scenarios

### Earlier Work

- Sprints 1-9: All 8 services, shared package, carrier portals, K8s, E2E tests, adversarial seed data, claims service, ACORD PDF generation, scenario readiness
