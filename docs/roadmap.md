# Privy/gym — Roadmap

**Last Updated:** 2026-03-31

## Strategic Overview

High-level priorities and feature areas for the Evergreen Insurance API Gym.

---

## Feature Areas

### Evaluation System

**Status:** In Progress (Sprint 1)
**Priority:** P0
**Progress:** 85%

Goals:
- Scorer with output + trace evaluation (done)
- 15 benchmark scenarios (15/15 implemented, 218 total cases)
- Multi-turn conversation scenarios (planned, P1)
- Cost & latency scoring dimension (planned, P2)

### Interoperability

**Status:** Planned
**Priority:** P1
**Progress:** 0%

Goals:
- METR Task Standard compatibility — expose gym scenarios as a `TaskFamily` so any agent harness (Inspect AI, Vivaria, custom) can run against them without gym-specific integration. `get_tasks()` lists scenarios, `start()` boots services, `score()` invokes existing scorer CLI.
- Inspect AI support (backlog) — expose scenarios as Inspect `Task` + `Scorer` for model-agnostic evaluation. Natural fit: output scorer maps to Inspect's `Scorer`, trace scorer maps to `Solver` analysis.

### Infrastructure

**Status:** Planned
**Priority:** P2
**Progress:** 0%

Goals:
- PostgreSQL migration for concurrent agent evaluation
- Connection pooling and multi-agent support

---

## Release Plan

### v0.1.0 — Scorer MVP (done)

- Scorer CLI with output + trace evaluation
- 4 scenarios implemented (01, 04, 07, 08)
- GenAI semconv trace parser
- Clean + realistic seed variants

### v0.2.0 — Full Scenario Coverage

- All 15 scenarios implemented
- Unit + integration tests for evaluators
- Multi-turn conversation variants (P1)

### v0.3.0 — Efficiency & Scale

- Cost & latency evaluation dimension
- PostgreSQL migration (AMS first)
- Concurrent agent evaluation support

---

**Updated by:** /wreplan command
