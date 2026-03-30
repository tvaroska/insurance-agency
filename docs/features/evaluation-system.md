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

## In Progress

No work in progress.

## Planned Work

See TODO.md Sprint 1 — Phases 2-4 (Scorer, Scenarios, Tests).
